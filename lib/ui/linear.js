'use strict';

// The launch pad's ticket source. Read-only against Linear — Concertino never
// writes ticket STATE from the TUI, because the orchestrator already owns
// that transition.
//
// CON-21: the one deliberate exception is `createTicket`, below — the
// ticket-draft flow's issue-creation mutation. Creation is a different act
// than a status transition (the orchestrator still owns every transition
// after creation, unchanged); this file otherwise stays read-only. Do not
// widen this into `issueUpdate`/state-transition mutations without
// re-litigating that boundary — see design.md (ticket-creation-flow)
// Decision 1.
//
// The whole file exists to serve one decision: fetch **once, in bulk**, with
// full descriptions and comments, and cache it. Never query per keystroke.
// That is what makes an instant ticket viewer possible, which is the thing you
// actually need before handing a ticket to an autonomous agent.
//
// Everything Linear-shaped stops here. Screens see `normalise`'s flat model and
// nothing else, so a Linear schema change is a change to this file alone.

const https = require('https');

const API_URL = 'https://api.linear.app/graphql';

// Linear state types are backlog | unstarted | started | completed | canceled.
//
// "Open" for the launch pad is the first three, and `started` is the load-
// bearing choice: the launch pad's inline status column exists precisely so a
// ticket already In Progress in Linear is visible *at selection time* rather
// than only on the confirm screen. Filtering `started` out of the query would
// make that column impossible to render — you cannot warn about a ticket you
// never fetched. Completed and canceled are excluded because there is nothing
// left to deliver.
const OPEN_STATE_TYPES = ['backlog', 'unstarted', 'started'];

// Linear caps a page at 250. 50 keeps the per-request complexity budget clear
// once comments are nested inside each issue, and a real backlog needs several
// pages regardless — the Helio Platform team returns 250+ open issues with a
// next page still pending.
const PAGE_SIZE = 50;

// Cheap insurance against a single pathological comment thread — this is NOT
// what keeps the cache small. Measurement (ticket.md) found comments are 0.6%
// of a real 740 KB fetch (Helio Platform, 267 tickets); descriptions are 79%
// and ticket count is what was actually unbounded. MAX_TICKETS and the
// `backlog` opt-out below are the mechanisms that bound cache size. We still
// take only the first N comments and record `commentCount` /
// `commentsTruncated` so the viewer can say "showing 50 of 214" rather than
// silently pretending it has the whole thread.
const COMMENT_LIMIT = 50;

// A cursor that fails to advance would otherwise spin forever against a broken
// or changed API. 200 pages at PAGE_SIZE 50 is 10k tickets — far past any real
// team, and a hard stop rather than a hang, not a real size bound (that's
// MAX_TICKETS below).
const MAX_PAGES = 200;

// The real bound on a fetch (design.md Decision 1). Measurement (ticket.md)
// put the largest team actually seen — Helio Platform — at 267 open tickets /
// 740.1 KB, roughly 2.8 KB per ticket. 500 is:
//   - Double the largest team measured, so the cap does not engage for any
//     team observed so far — it exists for teams that outgrow what's been
//     seen, not to shrink today's usage.
//   - ~1.4 MB at the worst case (500 * 2.8 KB), well under half the ~2.8 MB
//     the ticket's own "1,000 tickets, extrapolated" example calls out as the
//     unbounded-growth pain case.
const MAX_TICKETS = 500;

const QUERY = `
query ConcertinoLaunchPad($teamKey: String!, $states: [String!]!, $pageSize: Int!, $commentLimit: Int!, $after: String) {
  issues(
    first: $pageSize
    after: $after
    filter: { team: { key: { eq: $teamKey } }, state: { type: { in: $states } } }
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      number
      title
      description
      url
      estimate
      priority
      updatedAt
      state { name type }
      assignee { name displayName }
      labels(first: 20) { nodes { name } }
      project { id name }
      comments(first: $commentLimit) {
        pageInfo { hasNextPage }
        nodes {
          id
          body
          createdAt
          user { name displayName }
        }
      }
    }
  }
}`;

// A team lookup by key, independent of the `issues` query above (design.md
// Decision 1). Linear's `issues` connection filters silently — a `team.key`
// that matches no team returns an empty connection, the identical shape a
// real team with zero open issues would return — so the only way to tell
// "empty" from "does not exist" apart is to ask Linear about the team
// directly, not to infer it from a ticket count.
const TEAM_QUERY = `
query ConcertinoLaunchPadTeam($teamKey: String!) {
  teams(filter: { key: { eq: $teamKey } }) {
    nodes { id key }
  }
}`;

// CON-21, design.md Decision 1: the TUI's first (and deliberately only)
// write mutation. `issueCreate`'s own input requires a team UUID, not the
// human-facing team key `createTicket` is called with — so this mutation is
// always preceded by the same TEAM_QUERY lookup above (see `createTicket`),
// resolving the id in one extra round trip rather than duplicating a second
// "look up a team" query. `description` is the caller's fully composed
// markdown body (title + description + acceptance criteria already folded
// in — see design.md Decision 1); this mutation has no separate
// acceptance-criteria field and does no composition of its own.
const ISSUE_CREATE_MUTATION = `
mutation ConcertinoCreateTicket($teamId: String!, $title: String!, $description: String!) {
  issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
    success
    issue { id identifier url }
  }
}`;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

// `engines` is node >=16, so global fetch is not available. node:https it is.
// The seam is a single function so tests hand in canned responses and never
// touch the network.
function httpsTransport({ url, headers, body }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(body, 'utf8');

    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: Object.assign({ 'Content-Length': String(payload.length) }, headers),
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Shared request/error handling for every GraphQL call this file makes — the
// bulk ticket fetch (post(), below) and the team-resolution lookup
// (resolveTeam(), further down) both go through this so a rejected key, a
// non-200, a non-JSON body or a GraphQL `errors` array is reported identically
// regardless of which query asked. Returns `json.data` (the caller checks for
// the connection it expects — `issues` or `teams`).
async function postRaw(transport, apiKey, query, variables) {
  const res = await transport({
    url: API_URL,
    headers: {
      'Content-Type': 'application/json',
      // Linear personal API keys go in Authorization verbatim, no Bearer prefix.
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res || typeof res.status !== 'number') throw new Error('linear: transport returned no status');

  if (res.status === 401 || res.status === 403) {
    throw new Error('linear: LINEAR_API_KEY was rejected (HTTP ' + res.status + ')');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error('linear: HTTP ' + res.status + ' — ' + snippet(res.body));
  }

  let json;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    throw new Error('linear: response was not JSON — ' + snippet(res.body));
  }

  if (json && Array.isArray(json.errors) && json.errors.length) {
    const first = json.errors[0];
    throw new Error('linear: ' + ((first && first.message) || 'GraphQL error'));
  }

  return json && json.data;
}

async function post(transport, apiKey, variables) {
  const data = await postRaw(transport, apiKey, QUERY, variables);
  if (!data || !data.issues) {
    throw new Error('linear: response had no issues connection');
  }
  return data.issues;
}

// design.md Decision 1: resolves whether `teamKey` matches any team, in
// isolation from the ticket fetch. `transport` defaults to the real network
// transport exactly like fetchTickets does, so callers that already have a
// team key in hand (refreshLaunchPad) don't need to thread it through
// themselves.
async function resolveTeam(transport, apiKey, teamKey) {
  const data = await postRaw(transport || httpsTransport, apiKey, TEAM_QUERY, { teamKey });
  if (!data || !data.teams) {
    throw new Error('linear: response had no teams connection');
  }
  return { found: Array.isArray(data.teams.nodes) && data.teams.nodes.length > 0 };
}

// CON-21, design.md Decision 1: creates one issue in Linear and returns
// `{ id, identifier, url }` on success. `transport` defaults to the real
// network transport exactly like fetchTickets/resolveTeam — the same seam
// discipline, so tests never touch the network here either.
//
// Two round trips, not one: `teamKey` (the human-facing prefix, e.g. "CON")
// has to be resolved to a team UUID before `issueCreate` will accept it —
// GraphQL cannot mix a query and a mutation in one request, so this reuses
// TEAM_QUERY (already returning `id`) rather than adding a second,
// near-duplicate lookup query. A team that does not resolve is reported the
// same way a bad ticket id would be — an explicit error, never a mutation
// attempt against an empty teamId.
async function createTicket({ apiKey, teamKey, title, description, transport } = {}) {
  const t = transport || httpsTransport;
  if (!teamKey) throw new Error('linear: teamKey is required');
  if (!apiKey) throw new Error('linear: LINEAR_API_KEY is not set');
  if (!title) throw new Error('linear: title is required');

  const teamData = await postRaw(t, apiKey, TEAM_QUERY, { teamKey });
  const teamNode = teamData && teamData.teams && Array.isArray(teamData.teams.nodes)
    ? teamData.teams.nodes[0]
    : null;
  if (!teamNode || !teamNode.id) {
    throw new Error('linear: team "' + teamKey + '" was not found');
  }

  const data = await postRaw(t, apiKey, ISSUE_CREATE_MUTATION, {
    teamId: teamNode.id,
    title,
    description: description || '',
  });

  if (!data || !data.issueCreate || data.issueCreate.success !== true || !data.issueCreate.issue) {
    throw new Error('linear: issue creation did not report success');
  }

  const issue = data.issueCreate.issue;
  return { id: issue.id || null, identifier: issue.identifier || null, url: issue.url || null };
}

function snippet(body) {
  const s = typeof body === 'string' ? body : String(body);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

// ---------------------------------------------------------------------------
// Normalisation — the boundary Linear's wire format never crosses
// ---------------------------------------------------------------------------

function toMillis(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function personName(u) {
  if (!u) return null;
  return u.displayName || u.name || null;
}

function normaliseComment(node) {
  return {
    id: node.id || null,
    author: personName(node.user),
    body: typeof node.body === 'string' ? node.body : '',
    createdAt: toMillis(node.createdAt),
  };
}

function normaliseTicket(node) {
  const commentNodes = (node.comments && node.comments.nodes) || [];
  const truncated = Boolean(node.comments && node.comments.pageInfo && node.comments.pageInfo.hasNextPage);

  return {
    id: node.id || null,
    identifier: node.identifier || null,
    number: typeof node.number === 'number' ? node.number : null,
    title: node.title || '',
    description: typeof node.description === 'string' ? node.description : '',
    url: node.url || null,
    // `state.type` is what code branches on; `state.name` is what a human reads.
    // Keeping both means the UI never has to map one back to the other.
    state: {
      name: (node.state && node.state.name) || null,
      type: (node.state && node.state.type) || null,
    },
    estimate: typeof node.estimate === 'number' ? node.estimate : null,
    // `0` is Linear's "None" — a real value, not an absence — so this must
    // never fall back with `||` (that would turn a real None into null and
    // be indistinguishable from a priority Linear never returned at all).
    priority: typeof node.priority === 'number' ? node.priority : null,
    assignee: personName(node.assignee),
    labels: (node.labels && node.labels.nodes ? node.labels.nodes : []).map((l) => l.name).filter(Boolean),
    epicId: (node.project && node.project.id) || null,
    epicName: (node.project && node.project.name) || null,
    updatedAt: toMillis(node.updatedAt),
    comments: commentNodes.map(normaliseComment),
    commentCount: commentNodes.length,
    // True when the thread is longer than COMMENT_LIMIT. The viewer must say so
    // — a silently short thread reads as a complete one.
    commentsTruncated: truncated,
  };
}

// Epics are derived from the fetched tickets rather than queried separately.
// The launch pad shows "Pipeline v2  8 open", and 8-open is a count of exactly
// the tickets in hand — asking Linear for a project's issue count would return
// completed issues too, and be wrong for the pane it feeds.
function deriveEpics(tickets) {
  const byId = new Map();

  for (const t of tickets) {
    const key = t.epicId || '';
    let epic = byId.get(key);
    if (!epic) {
      epic = { id: t.epicId || null, name: t.epicName || null, openCount: 0 };
      byId.set(key, epic);
    }
    epic.openCount++;
  }

  const epics = [];
  let unassigned = null;
  for (const epic of byId.values()) {
    if (epic.id === null) unassigned = epic;
    else epics.push(epic);
  }

  epics.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // The unassigned bucket sorts last regardless of name — it is a residue, not
  // a project, and pinning it to the bottom keeps the epic list stable as
  // tickets move in and out of it.
  if (unassigned) epics.push(unassigned);

  return epics;
}

function normalise(teamKey, nodes) {
  const tickets = nodes.map(normaliseTicket);
  tickets.sort((a, b) => String(a.identifier).localeCompare(String(b.identifier), undefined, { numeric: true }));
  return { teamKey: teamKey || null, tickets, epics: deriveEpics(tickets) };
}

// design.md Decision 2: the one dial `dashboard.launchPad.backlog` controls.
// 266 of Helio Platform's 267 open tickets were `backlog` — a project whose
// backlog dwarfs its active work can exclude it from the fetch entirely, a
// bigger lever on size than any per-fetch cap. Absent or anything but exactly
// `false` preserves today's behaviour with no config change required.
function stateTypesFromConfig(config) {
  const launchPad = (config && config.dashboard && config.dashboard.launchPad) || {};
  if (launchPad.backlog === false) {
    return OPEN_STATE_TYPES.filter((t) => t !== 'backlog');
  }
  return OPEN_STATE_TYPES;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

// Pages until Linear says there is nothing left, or until MAX_TICKETS caps the
// running total — the real bound (design.md Decision 1). A real backlog
// exceeds one page — this is not a theoretical concern.
async function fetchTickets(options) {
  const opts = options || {};
  const teamKey = opts.teamKey;
  const apiKey = opts.apiKey || process.env.LINEAR_API_KEY;
  const transport = opts.transport || httpsTransport;
  const pageSize = opts.pageSize || PAGE_SIZE;
  const commentLimit = typeof opts.commentLimit === 'number' ? opts.commentLimit : COMMENT_LIMIT;
  const stateTypes = opts.stateTypes || OPEN_STATE_TYPES;
  const maxTickets = typeof opts.maxTickets === 'number' ? opts.maxTickets : MAX_TICKETS;

  if (!teamKey) throw new Error('linear: teamKey is required');
  if (!apiKey) throw new Error('linear: LINEAR_API_KEY is not set');

  const nodes = [];
  let after = null;
  let pages = 0;
  let truncated = false;

  for (;;) {
    const conn = await post(transport, apiKey, {
      teamKey,
      states: stateTypes,
      pageSize,
      commentLimit,
      after,
    });

    for (const node of conn.nodes || []) nodes.push(node);
    pages++;

    const info = conn.pageInfo || {};

    // design.md Decisions 3/5: stop the instant the running total reaches or
    // crosses maxTickets, and slice down to exactly that many — a hard
    // ceiling, never "N plus up to one page." `truncated` is true whenever
    // real tickets were left out: either Linear still had a further page, or
    // this page's own nodes overshot the cap before slicing (the overshoot
    // case cannot happen with the shipped constants — PAGE_SIZE divides
    // MAX_TICKETS evenly — but is handled so a future change to either
    // constant alone cannot silently under-report truncation).
    if (nodes.length >= maxTickets) {
      truncated = info.hasNextPage === true || nodes.length > maxTickets;
      nodes.length = maxTickets;
      break;
    }

    if (!info.hasNextPage) break;
    if (!info.endCursor || info.endCursor === after) break; // cursor did not advance
    if (pages >= MAX_PAGES) break;
    after = info.endCursor;
  }

  const result = normalise(teamKey, nodes);
  result.pages = pages;
  result.truncated = truncated;
  return result;
}

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

// All three conditions, and the caller is told *which* one failed. A feature
// that hides itself silently is a feature the user reports as broken.
function launchPadStatus(config, env) {
  const cfg = config || {};
  const e = env || process.env;
  const dashboard = cfg.dashboard || {};
  const launchPad = dashboard.launchPad || {};
  const provider = cfg.ticketProvider || {};

  if (launchPad.enabled !== true) {
    return {
      enabled: false,
      reason: 'disabled',
      message: 'launch pad is off — set dashboard.launchPad.enabled to true in concertino.config.json',
    };
  }
  if (provider.kind !== 'linear') {
    return {
      enabled: false,
      reason: 'provider',
      message:
        'launch pad needs ticketProvider.kind "linear" — this project uses "' + (provider.kind || 'none') + '"',
    };
  }
  if (!e.LINEAR_API_KEY) {
    return {
      enabled: false,
      reason: 'no-key',
      message: 'launch pad needs LINEAR_API_KEY in the environment',
    };
  }

  return { enabled: true, reason: null, message: null };
}

// The team key is the prefix of every ticket id — CON-1 is team CON.
//
// It is tempting to derive it from `ticketProvider.idExample` and add no config
// at all, and that is wrong: `idExample` is documented as a *sample* id used in
// rendered agent prose, and Concertino's own config ships the placeholder
// "ABC-123" while the real team is CON. Deriving from it there yields team ABC,
// which fetches successfully and returns nothing — an empty launch pad with no
// error to explain it.
//
// So `ticketProvider.teamKey` is explicit, the id example is a last-resort
// guess, and the source is returned alongside the key so the UI can say where
// it got it rather than presenting a guess as a fact.
function teamKeyFromConfig(config, env) {
  const e = env || process.env;
  const provider = (config || {}).ticketProvider || {};

  if (e.LINEAR_TEAM_KEY) return { key: e.LINEAR_TEAM_KEY.toUpperCase(), source: 'env' };
  if (provider.teamKey) return { key: String(provider.teamKey).toUpperCase(), source: 'config' };

  const m = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(String(provider.idExample || '').trim());
  if (m) return { key: m[1].toUpperCase(), source: 'idExample' };

  return { key: null, source: null };
}

module.exports = {
  API_URL,
  OPEN_STATE_TYPES,
  PAGE_SIZE,
  COMMENT_LIMIT,
  MAX_PAGES,
  MAX_TICKETS,
  QUERY,
  TEAM_QUERY,
  ISSUE_CREATE_MUTATION,
  httpsTransport,
  fetchTickets,
  resolveTeam,
  createTicket,
  normalise,
  deriveEpics,
  launchPadStatus,
  teamKeyFromConfig,
  stateTypesFromConfig,
};
