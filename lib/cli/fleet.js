'use strict';

// `concertino fleet` — a read-only snapshot of .concertino/runs for the Claude
// Code fleet pane (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
// Folds every run with lib/ui/reducer.js exactly as the dashboard does, but
// with NO tmux windows: liveness for driver-session lanes is the mod's job
// (it correlates runs with the session's own Agent calls), so a live run here
// reads `unknown` (or `needs-you` with an open escalation). Writes nothing
// except the ticket-detail cache (.concertino/cache/fleet-tickets.json) when
// `--tickets` is given.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('../ui/store');
const { reduce } = require('../ui/reducer');
const linear = require('../ui/linear');
const ticketCache = require('../ui/fleet-ticket-cache');
const { kindFor } = require('../ui/ticket-provider');
const localTickets = require('../ui/tickets/local');
const ticketText = require('../ui/ticket-text');
const { hasHelpFlag, resolveOut, resolveConfigPath, exists, read, dim, yellow, red } = require('./shared');
const { printUsage } = require('./help');

const EXCERPT_MAX = 1024;
const TIMELINE_MAX = 20;
// Fleet pane v2: runs named in `--tickets` carry their whole timeline for the
// pane's Activity tab, bounded by this as a safety cap.
const TIMELINE_FULL_MAX = 300;
// Fields a timeline entry keeps besides {t, kind}: enough for the pane's
// TIMELINE block, nothing that can carry a large payload (context, first_error).
// Fleet pane v2: plus what escalation.answered carries (lib/cli/answer.js and
// emit-event.sh's answer-file path: answer or sub_answers, resolution_channel,
// answer_source, escalation_id). `answer`/`sub_answers` are free text, so
// string values are clipped to TIMELINE_VALUE_MAX.
const TIMELINE_FIELDS = ['phase', 'cycle', 'agent', 'role', 'verdict', 'gate', 'status', 'url', 'label',
  'escalation_id', 'answer', 'sub_answers', 'resolution_channel', 'answer_source'];
const TIMELINE_VALUE_MAX = 200;
// Fleet pane v2: escalation `context` is shown as wrapped text in the pane's
// escalation card; emit-event.sh already caps a whole line at 4000 bytes, this
// keeps the snapshot (polled every few seconds) from carrying all of it.
const CONTEXT_MAX = 2000;

// Mirrors emit-event.sh's main_checkout(): the directory holding the common
// git dir is the main checkout, so a worktree cwd still finds the shared
// `.concertino/runs`. Outside a repo (or without git) the directory is used
// as given — store.listTickets tolerates a missing runs dir.
function resolveRoot(dir, deps = {}) {
  const run = deps.execFileSync || execFileSync;
  try {
    let common = run('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!common) return dir;
    if (!path.isAbsolute(common)) common = path.resolve(dir, common);
    return path.dirname(common);
  } catch (e) {
    return dir;
  }
}

// Fleet pane v2: persist-evidence.sh keeps ticket.md's worktree-relative path
// (CON-23), so it lands at e.g. evidence/spec/changes/<change>/ticket.md, not
// evidence/ticket.md. Found the way the dashboard drill-down finds it
// (ticket-text.js persistedPath), and titled the same way (parseTicketMd: first
// non-empty line, a leading `TICKET-ID:` stripped). The excerpt stays v1's: the
// whole body after the title line, which the pane renders as Markdown.
function readTicketDoc(root, ticket) {
  const file = ticketText.persistedPath(root, ticket);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { title: null, excerpt: null };
  }
  const { title } = ticketText.parseTicketMd(raw);
  const lines = raw.split('\n');
  const titleAt = lines.findIndex((l) => l.trim() !== '');
  const body = titleAt >= 0 ? lines.slice(titleAt + 1).join('\n').trim() : '';
  return { title: title || null, excerpt: body ? body.slice(0, EXCERPT_MAX) : null };
}

function readPendingAnswer(root, ticket) {
  // readAnswerFileRaw is not exported; the same defensive read inline.
  try {
    return JSON.parse(fs.readFileSync(store.answerPath(root, ticket), 'utf8'));
  } catch (e) {
    return null;
  }
}

function timelineOf(events, max = TIMELINE_MAX) {
  return events.slice(-max).map((ev) => {
    const row = { t: ev.t, kind: ev.kind };
    for (const f of TIMELINE_FIELDS) {
      if (ev[f] == null) continue;
      row[f] = typeof ev[f] === 'string' && ev[f].length > TIMELINE_VALUE_MAX ? ev[f].slice(0, TIMELINE_VALUE_MAX) : ev[f];
    }
    return row;
  });
}

// Fleet pane v2: the newest `pr` event anywhere in the log, so the pane's PR
// link survives a run that kept emitting after delivery (it no longer has to
// be among the last TIMELINE_MAX events).
function prUrlOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'pr' && typeof ev.url === 'string' && ev.url) return ev.url;
  }
  return null;
}

// Fleet pane v2: the reducer's escalation, shaped for the pane. A multi-part
// raise (CON-46) carries only `sub_questions`, so `question` falls back to the
// first sub-question's text and a toast built from it is never empty;
// `context` is clipped to CONTEXT_MAX (contextTruncated then reads true). The
// reducer's own question stays as logged: the TUI escalation screen renders
// sub-questions itself.
function escalationOf(esc) {
  if (!esc) return null;
  const out = Object.assign({}, esc);
  if (!out.question && Array.isArray(out.subQuestions)) {
    const first = out.subQuestions.find((q) => q && typeof q.question === 'string' && q.question.trim());
    if (first) out.question = first.question;
  }
  if (typeof out.context === 'string' && out.context.length > CONTEXT_MAX) {
    out.context = out.context.slice(0, CONTEXT_MAX);
    out.contextTruncated = true;
  }
  return out;
}

// Fleet pane v2: the pane's header names the project. config project.name
// when set, else the main checkout's directory name.
function projectName(config, root) {
  const name = config && config.project && config.project.name;
  return typeof name === 'string' && name.trim() ? name.trim() : path.basename(root);
}

function currentAgentOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if ((ev.kind === 'agent.spawn' || ev.kind === 'agent.resume') && ev.agent) return ev.agent;
  }
  return null;
}

// v1.1: `--tickets=A,B` — the pane's shown lanes, whose Linear detail is kept
// fresh through the per-ticket cache (fleet-ticket-cache.js)
// (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
function parseTickets(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Launch-pad fields the pane does not need.
const META_DROP = ['epicId', 'epicName', 'number', 'updatedAt', 'createdAt', 'completedAt', 'commentCount'];
function toMeta(entry) {
  if (!entry || entry.error) return null;
  const meta = Object.assign({}, entry);
  for (const k of META_DROP) delete meta[k];
  meta.source = 'linear';
  return meta;
}

// Fleet pane v2: a local ticket (tickets/<ID>.md, read by the local provider)
// in TicketMeta shape. The whole body is the description (no EXCERPT_MAX
// cut); state.type is null for a state outside the shared vocabulary.
function localMeta(ticket, now) {
  const meta = Object.assign({}, ticket);
  for (const k of META_DROP) delete meta[k];
  meta.description = typeof ticket.description === 'string' ? ticket.description.trim() : '';
  meta.url = null;
  meta.comments = [];
  meta.commentsTruncated = false;
  meta.epic = ticket.epicName || null;
  meta.source = 'local';
  meta.fetchedAt = now;
  return meta;
}

// Local provider: each requested ticket is read from its file on every
// invocation (cheap; no cache, no write). A missing or malformed file is that
// run's ticket_meta_error; the snapshot never fails because of it.
function enrichLocal(runs, want, root, now, deps) {
  const readTicket = deps.readLocalTicket || localTickets.readTicket;
  for (const run of runs) {
    run.ticket_meta = null;
    run.ticket_meta_error = null;
    if (!want.has(run.ticket.toUpperCase())) continue;
    try {
      run.ticket_meta = localMeta(readTicket(root, run.ticket), now);
    } catch (e) {
      run.ticket_meta_error = String((e && e.message) || e);
    }
  }
  return runs;
}

// Non-linear repos are silent (skip, no error): the pane has nothing to say.
function linearGate(config, env) {
  if (kindFor(config) !== 'linear') return { error: null, skip: true };
  if (!env.LINEAR_API_KEY) return { error: 'LINEAR_API_KEY is not set \u2014 ticket detail is unavailable', skip: false };
  return { error: null, skip: false };
}

// Total wall-clock budget for all Linear fetches in one invocation; the pane
// kills `concertino fleet` after a few seconds.
const FLEET_LINEAR_BUDGET_MS = 2500;
const MIN_FETCH_MS = 200;
const RATE_LIMIT_BACKOFF_MS = 60000;
const AUTH_RETRY_MS = 30000;

// Errors that mean "Linear is unusable right now": stop fetching this
// invocation. Anything else (not found, ...) is per-ticket.
function isInvocationError(message) {
  return /HTTP 429|rejected \(HTTP 40[13]\)|timed out|ENOTFOUND|ECONN|EAI_AGAIN|socket|budget/i.test(String(message));
}

// Requested tickets (in the pane's shown-lane order): served from cache while
// fresh, otherwise fetched and cached (written after every fetch). A
// per-ticket failure (e.g. not found) is cached negatively and the next ticket
// is still fetched; an invocation error (429, auth, network, timeout, budget)
// stops further fetches and is reported on every requested run. The snapshot
// never fails because of Linear. A requested ticket with no run directory is
// still fetched and cached.
async function enrichTickets(root, runs, requested, deps) {
  const env = deps.env || process.env;
  const now = deps.now != null ? deps.now : Date.now();
  const clock = deps.clock || Date.now;
  const want = new Set(requested.map((t) => t.toUpperCase()));
  if (requested.length && kindFor(deps.config || {}) === 'local') return enrichLocal(runs, want, root, now, deps);
  let cache = deps.cache || ticketCache.read(root);
  let error = null;
  const save = () => {
    try { ticketCache.write(root, cache); } catch (e) { /* a cache write failure is not a snapshot failure */ }
  };

  if (requested.length) {
    const gate = linearGate(deps.config || {}, env);
    error = gate.error;
    if (!error && !gate.skip) {
      const fetchDetail = deps.fetchDetail || ((opts) => linear.fetchTicketDetail(Object.assign({ apiKey: env.LINEAR_API_KEY }, opts)));
      const ttl = ticketCache.ttlFromEnv(env);
      const start = clock();
      for (const id of requested) {
        const entry = ticketCache.get(cache, id);
        if (ticketCache.isFresh(entry, now, ttl) || ticketCache.isBlocked(entry, now)) continue;
        const remaining = FLEET_LINEAR_BUDGET_MS - (clock() - start);
        if (remaining < MIN_FETCH_MS) { error = 'linear: time budget exhausted'; break; }
        try {
          const fetched = await fetchDetail({ id, timeoutMs: remaining });
          cache = ticketCache.put(cache, fetched, now, id);
          if (String(fetched.identifier).toUpperCase() !== id.toUpperCase()) cache = ticketCache.put(cache, fetched, now);
          save();
        } catch (e) {
          const message = String((e && e.message) || e);
          const rateLimited = /HTTP 429/.test(message);
          const invocation = isInvocationError(message);
          const retryUntil = rateLimited ? now + RATE_LIMIT_BACKOFF_MS : (invocation ? now + AUTH_RETRY_MS : undefined);
          cache = ticketCache.putFailure(cache, id, message, now, retryUntil);
          save();
          if (invocation) { error = message; break; }
        }
      }
    }
  }

  for (const run of runs) {
    const entry = ticketCache.get(cache, run.ticket);
    const requestedRun = want.has(run.ticket.toUpperCase());
    run.ticket_meta = toMeta(entry);
    run.ticket_meta_error = requestedRun ? (error || (entry && entry.error) || null) : null;
  }
  return runs;
}

async function buildSnapshot(root, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const requested = new Set((opts.tickets || []).map((t) => t.toUpperCase()));
  const runs = reduce(store.readAll(root), [], now)
    .filter((run) => opts.all || run.status !== 'done')
    .map((run) => {
      const events = run.events;
      const timelineMax = requested.has(String(run.ticket).toUpperCase()) ? TIMELINE_FULL_MAX : TIMELINE_MAX;
      // `events` is the full fold input and can be large; the snapshot ships
      // the bounded timeline instead. Fleet pane v2: `escalationStale` is
      // dropped too. It is a tmux-window fact and this snapshot has no
      // windows, so it always read true.
      const { events: _dropped, escalationStale: _stale, ...rest } = run;
      return {
        ...rest,
        escalation: escalationOf(run.escalation),
        prUrl: prUrlOf(events),
        ticket_doc: readTicketDoc(root, run.ticket),
        pendingAnswer: readPendingAnswer(root, run.ticket),
        timeline: timelineOf(events, timelineMax),
        timelineTruncated: events.length > timelineMax,
        // A terminal run.end means nobody is working the run any more; the
        // last agent.spawn would otherwise keep naming one (fleet pane v2).
        currentAgent: run.endStatus ? null : currentAgentOf(events),
      };
    });
  const deps = opts.deps || {};
  await enrichTickets(root, runs, opts.tickets || [], deps);
  return { generatedAt: now, root, project: projectName(opts.config || deps.config, root), runs };
}

function fmtElapsed(ms) {
  if (ms == null) return '-';
  const m = Math.floor(ms / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

function renderTable(snapshot) {
  if (!snapshot.runs.length) return dim('no active runs under ' + store.runsDir(snapshot.root));
  const colour = (run, s) => run.status === 'needs-you' ? yellow(s) : run.status === 'failed' ? red(s) : s;
  return snapshot.runs.map((run) => {
    const passed = run.gates.filter((g) => g.status === 'pass').length;
    return colour(run, [
      run.ticket.padEnd(10),
      run.status.padEnd(10),
      (run.phase || '-').padEnd(11),
      ('c' + (run.cycle != null ? run.cycle : '-')).padEnd(4),
      (passed + '/' + run.gates.length).padEnd(6),
      fmtElapsed(run.elapsedMs).padEnd(6),
      run.currentAgent || '',
    ].join(' ').trimEnd());
  }).join('\n');
}

// --config wins; else the main checkout's config, then the cwd's (a worktree
// has no untracked concertino.config.json of its own). Bad JSON reads as {}.
function readConfig(args, dir, root) {
  const candidates = args.config ? [resolveConfigPath(args, dir)] : [resolveConfigPath(args, root), resolveConfigPath(args, dir)];
  for (const p of candidates) {
    if (!exists(p)) continue;
    try { return JSON.parse(read(p)); } catch (e) { return {}; }
  }
  return {};
}

async function cmdFleet(args) {
  if (hasHelpFlag(args)) { printUsage('fleet'); return; }
  const dir = resolveOut(args);
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch (e) { /* reported below */ }
  if (!isDir) throw new Error(dir + ' is not a directory');
  const root = resolveRoot(dir);
  const config = readConfig(args, dir, root);
  const snapshot = await buildSnapshot(root, { all: !!args.all, tickets: parseTickets(args.tickets), deps: { config } });
  if (args.json) {
    process.stdout.write(JSON.stringify(snapshot) + '\n');
    return;
  }
  console.log(renderTable(snapshot));
}

module.exports = { cmdFleet, readConfig, projectName, escalationOf, prUrlOf, CONTEXT_MAX, TIMELINE_VALUE_MAX, isInvocationError, FLEET_LINEAR_BUDGET_MS, RATE_LIMIT_BACKOFF_MS, AUTH_RETRY_MS, buildSnapshot, parseTickets, enrichTickets, resolveRoot, readTicketDoc, renderTable, EXCERPT_MAX, TIMELINE_MAX, TIMELINE_FULL_MAX, timelineOf, localMeta };
