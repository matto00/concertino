'use strict';

// The launch pad's ticket source. Read-only against Linear — Concertino never
// writes ticket state from the TUI, because the orchestrator already owns that
// transition.
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

// Comments are the one unbounded axis in the payload: a ticket's description is
// written once, but its comment thread grows without limit. We take the first
// N and record `commentCount` / `commentsTruncated` so the viewer can say
// "showing 50 of 214" rather than silently pretending it has the whole thread.
const COMMENT_LIMIT = 50;

// A cursor that fails to advance would otherwise spin forever against a broken
// or changed API. 200 pages at PAGE_SIZE 50 is 10k tickets — far past any real
// team, and a hard stop rather than a hang.
const MAX_PAGES = 200;

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

async function post(transport, apiKey, variables) {
  const res = await transport({
    url: API_URL,
    headers: {
      'Content-Type': 'application/json',
      // Linear personal API keys go in Authorization verbatim, no Bearer prefix.
      Authorization: apiKey,
    },
    body: JSON.stringify({ query: QUERY, variables }),
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
  if (!json || !json.data || !json.data.issues) {
    throw new Error('linear: response had no issues connection');
  }

  return json.data.issues;
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

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

// Pages until Linear says there is nothing left. A real backlog exceeds one
// page — this is not a theoretical concern.
async function fetchTickets(options) {
  const opts = options || {};
  const teamKey = opts.teamKey;
  const apiKey = opts.apiKey || process.env.LINEAR_API_KEY;
  const transport = opts.transport || httpsTransport;
  const pageSize = opts.pageSize || PAGE_SIZE;
  const commentLimit = typeof opts.commentLimit === 'number' ? opts.commentLimit : COMMENT_LIMIT;
  const stateTypes = opts.stateTypes || OPEN_STATE_TYPES;

  if (!teamKey) throw new Error('linear: teamKey is required');
  if (!apiKey) throw new Error('linear: LINEAR_API_KEY is not set');

  const nodes = [];
  let after = null;
  let pages = 0;

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
    if (!info.hasNextPage) break;
    if (!info.endCursor || info.endCursor === after) break; // cursor did not advance
    if (pages >= MAX_PAGES) break;
    after = info.endCursor;
  }

  const result = normalise(teamKey, nodes);
  result.pages = pages;
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
  QUERY,
  httpsTransport,
  fetchTickets,
  normalise,
  deriveEpics,
  launchPadStatus,
  teamKeyFromConfig,
};
