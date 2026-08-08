'use strict';

// CON-44: the local ticket store — `tickets/<ID>.md`, tracked in the repo.
//
// Unlike `.concertino/cache/`, these files are the SOURCE OF TRUTH, not a
// cache of someone else's board: gitignoring them would mean a backlog that
// dies with the checkout, with no remote to re-fetch it from. That is why
// they live at a tracked top-level `tickets/` and not under `.concertino/`,
// whose own gitignore comment declares it "never committed".
//
// The contract this module exists to satisfy: **emit exactly the shape
// linear.js's normaliseTicket() emits.** Everything downstream of that
// boundary — the launch pad screens, deriveEpics, the detail pane, the queue,
// retention — then works unchanged. linear.js itself is never modified;
// deriveEpics and OPEN_STATE_TYPES are reused from it so the two providers
// can never disagree about epic bucketing or what "open" means.

const fs = require('fs');
const path = require('path');
const { deriveEpics, OPEN_STATE_TYPES, stateTypesFromConfig } = require('../linear');
const { looksLikeTicket } = require('../ticket');

const TICKETS_DIR = 'tickets';

// Linear's own `state.type` vocabulary, verbatim. Sharing it is what lets
// stateTypesFromConfig, the `launchPad.backlog: false` dial and every
// downstream state check work identically under both providers. Exported —
// CON-94's test/scripts/ticket-state-vocabulary.test.sh requires this module
// and reads `.STATES` directly, to byte-compare this vocabulary against
// core/scripts/set-ticket-state.sh's own copy, so this is a real testing
// seam, not a dead export.
const STATES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

// linear.js:352-353's contract: state.type is what code branches on,
// state.name is what a human reads. Linear supplies Backlog/Todo/In
// Progress/Done/Canceled for the latter; this map makes local tickets match
// so the launch pad's status column no longer shows the raw state.type.
const STATE_NAMES = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Deliberately not a YAML parser. This project has zero runtime dependencies
// and is not taking one on for a handful of scalar fields, so the accepted
// grammar is exactly: `key: value` per line, plus one inline-array form
// `labels: [a, b]`. Anything richer is a malformed ticket, which is a
// per-file skip rather than a crash — see readTickets.
function parseFrontmatter(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return null;

  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 1) return null; // a frontmatter line that is not key: value at all
    fields[line.slice(0, idx).trim()] = parseValue(line.slice(idx + 1));
  }
  return { fields, body: raw.slice(m[0].length) };
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

function parseValue(v) {
  const s = v.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
  }
  return unquote(s);
}

// The filename stem is the identifier — it is what `/concertino-deliver`
// takes and what a branch name is built from. A frontmatter `id:` is optional
// and purely for readability when the file is open; if it is present and
// disagrees, the file is malformed rather than silently resolved one way,
// because either resolution produces a ticket that cannot be addressed by
// one of the two ids written down for it.
function parseTicket(stem, raw, mtimeMs) {
  // Under `linear` the id shape was structurally guaranteed — the provider
  // issued it. Here the id is a filename anyone can type, so the project's
  // canonical pattern (ticket.js's TICKET_RE, the same one assert-phase.sh and
  // friends carry) is enforced at this seam instead. Without it,
  // `tickets/fix-login.md` — which matches the docs' own `tickets/<ID>.md`
  // phrasing — lists on the launch pad, is selectable and queueable, and only
  // dies at prompt.js's spawn with a bare "not a ticket id" naming no file.
  // Rejecting here counts it as unreadable, so the launch pad's existing
  // unreadable-count message points at the frontmatter/filename instead.
  if (!looksLikeTicket(stem)) return null;

  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const f = parsed.fields;

  if (f.id && f.id !== stem) return null;

  const title = typeof f.title === 'string' ? f.title.trim() : '';
  if (!title) return null;

  if (!STATES.includes(f.state)) return null;

  // `0` is a real priority ("None"), so this can never use `||` — the exact
  // trap linear.js:359 already documents. Absent is null; present-but-invalid
  // is a malformed file, never a silent null.
  let priority = null;
  if (f.priority !== undefined && f.priority !== '') {
    if (!/^[0-4]$/.test(String(f.priority))) return null;
    priority = Number(f.priority);
  }

  const epic = typeof f.epic === 'string' && f.epic ? f.epic : null;
  const numMatch = /-(\d+)$/.exec(stem);

  return {
    id: stem,
    identifier: stem,
    number: numMatch ? Number(numMatch[1]) : null,
    title,
    description: parsed.body,
    // Local tickets have no URL. Null, not '' — the screens already handle a
    // null url for Linear tickets that lack one.
    url: null,
    state: { name: STATE_NAMES[f.state], type: f.state },
    // Linear concepts with no local meaning. They normalise to null exactly
    // as they do for a Linear ticket that does not set them.
    estimate: null,
    assignee: null,
    priority,
    labels: Array.isArray(f.labels) ? f.labels : [],
    epicId: epic,
    epicName: epic,
    // The file's own mtime — there is no remote to report an updatedAt.
    updatedAt: typeof mtimeMs === 'number' ? mtimeMs : null,
    // Comments are deferred to a child ticket of CON-44. Empty, never absent,
    // so the detail pane's existing comment rendering needs no null guard.
    comments: [],
    commentCount: 0,
    commentsTruncated: false,
  };
}

// A missing directory and an unreadable file are both "nothing to show here",
// never thrown errors — the same contract cache.js#read documents. But the
// skip is PER FILE: one bad ticket must not blank the whole board, so the
// count comes back alongside the good tickets for the launch pad to report.
function readTickets(root) {
  const dir = path.join(root, TICKETS_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return { tickets: [], unreadable: 0, dirExists: false };
  }

  const tickets = [];
  let unreadable = 0;

  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(dir, name);
    let ticket;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const mtimeMs = fs.statSync(file).mtimeMs;
      ticket = parseTicket(name.slice(0, -3), raw, mtimeMs);
    } catch (e) {
      unreadable++;
      continue;
    }
    if (ticket) tickets.push(ticket);
    else unreadable++;
  }

  return { tickets, unreadable, dirExists: true };
}

// Mirrors linear.js's fetchTickets return shape, minus the paging concepts a
// directory read does not have: `pages` is always 1 and `truncated` always
// false, because there is no cap to hit — the whole directory is always read.
function fetchTickets(options) {
  const opts = options || {};
  const stateTypes = opts.stateTypes || OPEN_STATE_TYPES;
  const { tickets, unreadable } = readTickets(opts.root);

  const open = tickets.filter((t) => stateTypes.includes(t.state.type));
  open.sort((a, b) => String(a.identifier).localeCompare(String(b.identifier), undefined, { numeric: true }));

  return {
    teamKey: opts.teamKey || null,
    tickets: open,
    epics: deriveEpics(open),
    pages: 1,
    truncated: false,
    unreadable,
  };
}

// The local analogue of linear.js's resolveTeam: it answers the one question
// a zero-ticket fetch leaves open. For Linear that needs a second network
// round trip (an unknown team key and an empty team look identical); here it
// is a directory-existence check.
function resolveTeam(opts) {
  return { found: readTickets((opts || {}).root).dirExists };
}

// Two conditions, not linear.js's three — there is no API key to check.
function launchPadStatus(config, env) {
  const cfg = config || {};
  const launchPad = (cfg.dashboard || {}).launchPad || {};
  const provider = cfg.ticketProvider || {};

  if (launchPad.enabled !== true) {
    return {
      enabled: false,
      reason: 'disabled',
      message: 'launch pad is off — set dashboard.launchPad.enabled to true in concertino.config.json',
    };
  }
  if (provider.kind !== 'local') {
    return {
      enabled: false,
      reason: 'provider',
      message: 'launch pad needs ticketProvider.kind "local" — this project uses "' + (provider.kind || 'none') + '"',
    };
  }
  return { enabled: true, reason: null, message: null };
}

// Same precedence as linear.js's, minus the LINEAR_TEAM_KEY override — that
// env var names a Linear team and means nothing for a directory of files.
function teamKeyFromConfig(config, env) {
  const provider = (config || {}).ticketProvider || {};

  if (provider.teamKey) return { key: String(provider.teamKey).toUpperCase(), source: 'config' };

  const m = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(String(provider.idExample || '').trim());
  if (m) return { key: m[1].toUpperCase(), source: 'idExample' };

  return { key: null, source: null };
}

// Occupies the same slot as linear.js's "no team with key X" message, but a
// missing tickets/ directory is a first-run state, not a misconfiguration —
// so it reads as an instruction rather than an error to go debug.
function teamNotFoundMessage(teamKey) {
  const prefix = teamKey || 'TICKET';
  return 'no tickets/ directory — create tickets/' + prefix + '-1.md to get started';
}

// TUI ticket authoring against a local store is a child ticket of CON-44.
// Rejecting (rather than omitting the export) keeps the resolver's surface
// uniform across providers and gives a caller that slips past draft.js's
// gate a real message instead of "createTicket is not a function".
function createTicket() {
  return Promise.reject(new Error('local: creating tickets from the dashboard is not supported yet — ' +
    'add tickets/<ID>.md by hand'));
}

// CON-93 item 4: the local analogue of linear.js's fetchOneTicket, for
// `concertino validate --ticket <ID>` — reads exactly the one file needed
// rather than readTickets' whole-directory scan, since validate only ever
// needs one ticket's labels. Rejects (never throws synchronously) so
// ticket-provider.js's Promise.resolve-wrapped dispatch and validate.js's
// existing .catch handling both see the same shape linear.js's own
// fetchOneTicket rejection does.
function fetchOneTicket(opts) {
  const o = opts || {};
  const file = path.join(o.root || '.', TICKETS_DIR, o.id + '.md');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return Promise.reject(new Error('local: ticket "' + o.id + '" was not found — expected ' +
      path.join(TICKETS_DIR, o.id + '.md')));
  }

  const ticket = parseTicket(o.id, raw, null);
  if (!ticket) {
    return Promise.reject(new Error('local: ' + path.join(TICKETS_DIR, o.id + '.md') +
      ' is malformed — check its frontmatter'));
  }

  return Promise.resolve({ id: ticket.id, identifier: ticket.identifier, labels: ticket.labels });
}

module.exports = {
  STATES,
  STATE_NAMES,
  parseFrontmatter,
  parseTicket,
  readTickets,
  fetchTickets,
  resolveTeam,
  launchPadStatus,
  teamKeyFromConfig,
  stateTypesFromConfig,
  teamNotFoundMessage,
  createTicket,
  fetchOneTicket,
};
