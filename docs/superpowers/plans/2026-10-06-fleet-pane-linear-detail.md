# Fleet Pane Linear Detail (v1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each lane's Linear description, metadata and latest comments in the fleet pane's detail view, fetched by the CLI through a 20 s per-ticket cache.

**Architecture:** `concertino fleet --json --tickets=A,B` enriches the requested runs with `ticket_meta` from a new per-ticket cache (`lib/ui/fleet-ticket-cache.js`, `.concertino/cache/fleet-tickets.json`), refetching through a new single-issue Linear query when an entry is older than the TTL. The mod passes its shown lanes' tickets each poll and renders metadata / DESCRIPTION / COMMENTS in `render.tsx`. Linear stays CLI-side; the mod never holds the API key.

**Tech Stack:** Node ≥16 CommonJS (zero deps, `node --test`); TypeScript/TSX mod against the `claude-code` function-hooks API (`claude plugin validate/test`).

**Spec:** `docs/superpowers/specs/2026-10-06-fleet-pane-design.md`, section "Ticket detail from Linear (v1.1)" (and "Visibility").

## Global Constraints

- Zero runtime dependencies; Node `>=16`; CommonJS in `lib/`; no build/lint step. `npm test` is the only gate (`node --test test/*.test.js test/widgets/*.test.js` + script tests + `plugin-mod.test.sh`); CI matrix Node 16 and 22.
- `concertino fleet` never writes under `.concertino/runs/`; its only write is the atomic cache file `.concertino/cache/fleet-tickets.json`.
- `FLEET_TICKET_TTL_MS = 20000`, env override `CONCERTINO_FLEET_TICKET_TTL_MS` (positive integer; anything else → default). Comments: the newest 50 (`COMMENT_LIMIT`), rendered last 5, body first 6 lines. Description: first 12 non-empty lines.
- Only `ticketProvider.kind === 'linear'` (via `kindFor(config)` from `lib/ui/ticket-provider.js`) and a set `LINEAR_API_KEY` fetch; otherwise `ticket_meta: null` + `ticket_meta_error`.
- First Linear failure in an invocation stops further fetches in that invocation; the snapshot never fails because of Linear.
- The mod is read-only; hooks stay `session.start`, `command.run`, `ui.render`; ES module, relative imports; every `$.state` key declared in `types/index.d.ts`.
- Kit tests drive the plugin through engine events (`$.session.start`, `mock.clock(on)`, `$.ui.mount`, `$.command.run`) with `on(...)` hooks beneath (`state.get/set` envelopes `{ value: {...} }`); `Text` has no `key` (key Boxes); `Button` has no `color`.
- Comments cite the spec path (no ticket id assigned).

## Review Focus

1. **A ticket requested that has no Linear issue** (deleted, or a `local`-provider id in a linear repo): `fetchTicketDetail` throws "not found" → must count as the invocation's first failure, leave `ticket_meta: null`, set `ticket_meta_error`, and not poison other tickets' cache entries. → Task 3 test "a not-found ticket sets ticket_meta_error and leaves others cached".
2. **Cache file written by a newer schema** (future `schemaVersion: 2`): `read` must return empty, not throw or serve mismatched fields. → Task 2 test "schemaVersion mismatch reads as empty".
3. **Two `concertino fleet` invocations racing** (TUI + pane, or two panes): atomic temp+rename per write; a concurrent reader never sees a torn file. → Task 2 test "write is atomic (temp file then rename; no partial JSON visible)".
4. **A comment body containing `\r\n` or very long lines** (Linear markdown): rendering must still cap at 6 lines and wrap, not overflow the pane. → Task 5 test "comment body is capped at six lines and CRLF is normalised".
5. **`--tickets=` with an empty value or trailing comma** (`--tickets=`, `--tickets=CON-1,`): parse to `[]` / `['CON-1']`, never a `''` ticket lookup. → Task 3 test "parseTickets tolerates empty and trailing comma".

---

## File map

| Path | Responsibility |
|---|---|
| `lib/ui/linear.js` (modify) | `ISSUE_DETAIL_QUERY`, `fetchTicketDetail`; export `normaliseTicket` |
| `test/linear.test.js` (modify or create) | query shape + normalisation of the single-issue response |
| `lib/ui/fleet-ticket-cache.js` (new) | per-ticket cache: `read/write/get/put/isFresh/ttlFromEnv` |
| `test/fleet-ticket-cache.test.js` (new) | cache behaviour |
| `lib/cli/fleet.js` (modify) | `parseTickets`, `enrichTickets` (injectable deps), `--tickets` flag |
| `lib/cli/help.js` (modify) | `--tickets=` in the fleet usage block |
| `test/cli-fleet.test.js` (modify) | enrichment paths with an injected transport |
| `types/index.d.ts` (modify) | `TicketMeta`, `TicketComment`; `Run.ticket_meta`, `Run.ticket_meta_error` |
| `hooks/fleet-pane/snapshot.ts` (modify) | `runFleetSnapshot($, cwd, tickets)` appends `--tickets=` |
| `hooks/fleet-pane/register.tsx` (modify) | pass shown tickets; toast only shown lanes; `/fleet all` via `update(fn)` |
| `hooks/fleet-pane/lanes.ts` (modify) | fingerprint includes `ticket_meta.fetchedAt` + last comment id |
| `hooks/fleet-pane/render.tsx` (modify) | metadata line, DESCRIPTION, COMMENTS, dim error, excerpt fallback |
| `hooks/fleet-pane/{refresh,lanes,render}.test.ts` (modify) | kit tests |
| `docs/dashboard.md`, `openspec/changes/fleet-pane/**` (modify) | docs + spec deltas |

---

### Task 1: `fetchTicketDetail` in `lib/ui/linear.js`

**Files:**
- Modify: `lib/ui/linear.js` (after `ISSUE_QUERY` ~line 150; after `fetchOneTicket` ~line 318; `module.exports` ~line 564)
- Test: `test/linear.test.js` (append; create with the standard header if absent)

**Interfaces:**
- Consumes: `postRaw(transport, apiKey, query, variables)`, `normaliseTicket(node)`, `COMMENT_LIMIT`, `httpsTransport` (all existing in the file).
- Produces: `fetchTicketDetail({ apiKey, id, transport, commentLimit }) → Promise<ticket>` where `ticket` is `normaliseTicket`'s output; `ISSUE_DETAIL_QUERY` string; `normaliseTicket` exported. Throws `Error('linear: ticket "<id>" was not found')` when `data.issue` is null; propagates `postRaw`'s errors (`linear: LINEAR_API_KEY was rejected (HTTP 401)`, `linear: HTTP 429 — …`).

- [ ] **Step 1: Write the failing tests**

```js
// test/linear.test.js (append; if the file is new, start with:
// 'use strict'; const { test } = require('node:test'); const assert = require('node:assert');
// const linear = require('../lib/ui/linear');)

// v1.1 fleet pane (docs/superpowers/specs/2026-10-06-fleet-pane-design.md):
// one issue, bulk-query shape, for the per-ticket detail cache.
function detailTransport(issue, calls) {
  return async ({ body }) => {
    const parsed = JSON.parse(body);
    calls.push(parsed);
    return { status: 200, body: JSON.stringify({ data: { issue } }) };
  };
}

const ISSUE_NODE = {
  id: 'uuid-1', identifier: 'CON-231', number: 231, title: 'Add thing', description: 'Body **md**', url: 'https://linear.app/x/CON-231',
  estimate: 3, priority: 2, updatedAt: '2026-10-06T10:00:00.000Z', createdAt: '2026-10-01T10:00:00.000Z', completedAt: null,
  state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Matt', displayName: 'matt' },
  labels: { nodes: [{ name: 'agent-merge' }] }, project: null,
  comments: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'c1', body: 'hi', createdAt: '2026-10-06T11:00:00.000Z', user: { name: 'Matt', displayName: 'matt' } }] },
};

test('fetchTicketDetail: posts ISSUE_DETAIL_QUERY with the id and comment limit, returns the normalised ticket', async () => {
  const calls = [];
  const t = await linear.fetchTicketDetail({ apiKey: 'k', id: 'CON-231', transport: detailTransport(ISSUE_NODE, calls) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, linear.ISSUE_DETAIL_QUERY);
  assert.deepEqual(calls[0].variables, { id: 'CON-231', commentLimit: linear.COMMENT_LIMIT });
  assert.equal(t.identifier, 'CON-231');
  assert.equal(t.description, 'Body **md**');
  assert.deepEqual(t.state, { name: 'In Progress', type: 'started' });
  assert.equal(t.priority, 2);
  assert.deepEqual(t.labels, ['agent-merge']);
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].author, 'Matt');
  assert.equal(t.commentsTruncated, false);
});

test('fetchTicketDetail: a null issue is "not found"; a missing key is refused before any request', async () => {
  const calls = [];
  await assert.rejects(linear.fetchTicketDetail({ apiKey: 'k', id: 'CON-9', transport: detailTransport(null, calls) }), /ticket "CON-9" was not found/);
  const saved = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await assert.rejects(linear.fetchTicketDetail({ id: 'CON-9', transport: detailTransport(ISSUE_NODE, calls) }), /LINEAR_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.LINEAR_API_KEY = saved;
  }
  assert.equal(calls.length, 1);
});

test('ISSUE_DETAIL_QUERY asks for the same fields as the bulk QUERY node', () => {
  for (const field of ['description', 'url', 'estimate', 'priority', 'state { name type }', 'assignee { name displayName }', 'labels(first: 20)', 'comments(first: $commentLimit)']) {
    assert.ok(linear.ISSUE_DETAIL_QUERY.includes(field), field);
  }
  assert.equal(typeof linear.normaliseTicket, 'function');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/linear.test.js`
Expected: FAIL — `linear.fetchTicketDetail is not a function` / `ISSUE_DETAIL_QUERY` undefined.

- [ ] **Step 3: Implement**

After `ISSUE_QUERY` in `lib/ui/linear.js`:

```js
// v1.1 fleet pane (docs/superpowers/specs/2026-10-06-fleet-pane-design.md):
// one issue in the bulk query's node shape, so normaliseTicket() applies
// unchanged and the pane's detail matches what the launch pad shows.
const ISSUE_DETAIL_QUERY = `
query ConcertinoTicketDetail($id: String!, $commentLimit: Int!) {
  issue(id: $id) {
    id
    identifier
    number
    title
    description
    url
    estimate
    priority
    updatedAt
    createdAt
    completedAt
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
}`;
```

After `fetchOneTicket`:

```js
// v1.1 fleet pane: the full detail of one ticket (description, state,
// assignee, priority, labels, newest comments) for lib/cli/fleet.js's
// per-ticket cache. Same transport/auth plumbing as fetchOneTicket.
async function fetchTicketDetail({ apiKey, id, transport, commentLimit } = {}) {
  const t = transport || httpsTransport;
  const key = apiKey || process.env.LINEAR_API_KEY;
  if (!key) throw new Error('linear: LINEAR_API_KEY is not set');
  if (!id) throw new Error('linear: id is required');
  const data = await postRaw(t, key, ISSUE_DETAIL_QUERY, { id, commentLimit: commentLimit || COMMENT_LIMIT });
  if (!data || !data.issue) throw new Error('linear: ticket "' + id + '" was not found');
  return normaliseTicket(data.issue);
}
```

Add `ISSUE_DETAIL_QUERY`, `fetchTicketDetail`, `normaliseTicket` to `module.exports`.

- [ ] **Step 4: Run tests**

Run: `node --test test/linear.test.js`
Expected: PASS (all, including the pre-existing ones if the file existed).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/linear.js test/linear.test.js
git commit -m "Add fetchTicketDetail: one Linear issue in the launch-pad shape"
```

---

### Task 2: `lib/ui/fleet-ticket-cache.js`

**Files:**
- Create: `lib/ui/fleet-ticket-cache.js`
- Test: `test/fleet-ticket-cache.test.js`

**Interfaces:**
- Consumes: `fs`, `path`; mirrors `lib/ui/cache.js`'s temp+rename write.
- Produces:
  ```js
  SCHEMA_VERSION = 1; DEFAULT_TTL_MS = 20000; ENV_TTL = 'CONCERTINO_FLEET_TICKET_TTL_MS'
  cachePath(root) → '<root>/.concertino/cache/fleet-tickets.json'
  read(root) → { schemaVersion: 1, tickets: { [IDENT]: entry } }   // empty on missing/bad/other version
  write(root, cache) → void                                          // atomic
  get(cache, ident) → entry | null                                   // ident upper-cased
  put(cache, entry, now) → cache                                     // sets entry.fetchedAt = now; returns a new cache object
  isFresh(entry, now, ttlMs) → boolean
  ttlFromEnv(env) → number                                           // positive integer or DEFAULT_TTL_MS
  ```
  `entry` = `normaliseTicket` output + `fetchedAt`.

- [ ] **Step 1: Write the failing tests**

```js
// test/fleet-ticket-cache.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./support/tmp');
const cache = require('../lib/ui/fleet-ticket-cache');

const entry = (ident, over = {}) => ({ identifier: ident, title: 't', description: 'd', url: 'u', state: { name: 'Todo', type: 'unstarted' },
  assignee: null, priority: 0, estimate: null, labels: [], comments: [], commentCount: 0, commentsTruncated: false, ...over });

test('read: missing file, bad JSON and a schemaVersion mismatch all read as empty', () => {
  const root = mkTmpDir('fleet-cache-');
  assert.deepEqual(cache.read(root), { schemaVersion: 1, tickets: {} });
  fs.mkdirSync(path.join(root, '.concertino', 'cache'), { recursive: true });
  fs.writeFileSync(cache.cachePath(root), '{not json');
  assert.deepEqual(cache.read(root), { schemaVersion: 1, tickets: {} });
  fs.writeFileSync(cache.cachePath(root), JSON.stringify({ schemaVersion: 2, tickets: { 'CON-1': entry('CON-1') } }));
  assert.deepEqual(cache.read(root).tickets, {});
});

test('put/get/write/read round-trip; get is case-insensitive on the identifier', () => {
  const root = mkTmpDir('fleet-cache-');
  let c = cache.read(root);
  c = cache.put(c, entry('CON-1'), 1000);
  assert.equal(cache.get(c, 'con-1').fetchedAt, 1000);
  cache.write(root, c);
  const back = cache.read(root);
  assert.equal(back.tickets['CON-1'].fetchedAt, 1000);
  assert.equal(cache.get(back, 'CON-1').title, 't');
  assert.equal(cache.get(back, 'CON-2'), null);
});

test('isFresh: younger than ttl is fresh, equal or older is not; no fetchedAt is stale', () => {
  assert.equal(cache.isFresh({ fetchedAt: 1000 }, 20999, 20000), true);
  assert.equal(cache.isFresh({ fetchedAt: 1000 }, 21000, 20000), false);
  assert.equal(cache.isFresh({}, 0, 20000), false);
  assert.equal(cache.isFresh(null, 0, 20000), false);
});

test('ttlFromEnv: positive integer wins, anything else is the default', () => {
  assert.equal(cache.ttlFromEnv({}), 20000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: '5000' }), 5000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: '0' }), 20000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: 'soon' }), 20000);
});

test('write is atomic (temp file then rename; no partial JSON visible) and creates the cache dir', () => {
  const root = mkTmpDir('fleet-cache-');
  const c = cache.put(cache.read(root), entry('CON-1'), 1);
  const renames = [];
  const realRename = fs.renameSync;
  fs.renameSync = (a, b) => { renames.push([a, b]); return realRename(a, b); };
  try { cache.write(root, c); } finally { fs.renameSync = realRename; }
  assert.equal(renames.length, 1);
  assert.match(renames[0][0], /fleet-tickets\.json\.\d+\.tmp$/);
  assert.equal(renames[0][1], cache.cachePath(root));
  assert.deepEqual(fs.readdirSync(path.dirname(cache.cachePath(root))).filter((f) => f.endsWith('.tmp')), []);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cache.cachePath(root), 'utf8')));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/fleet-ticket-cache.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/fleet-ticket-cache'`.

- [ ] **Step 3: Implement**

```js
'use strict';

// Per-ticket Linear detail cache for `concertino fleet --tickets=…` (v1.1,
// docs/superpowers/specs/2026-10-06-fleet-pane-design.md). Separate from
// cache.js's whole-team `tickets.json` on purpose: that file has a single
// fetchedAt and a manual refresh; the pane needs a 20 s TTL per ticket.
// Never throws on read: anything that is not a well-formed cache is empty.

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 20000;
const ENV_TTL = 'CONCERTINO_FLEET_TICKET_TTL_MS';

function cachePath(root) {
  return path.join(root, '.concertino', 'cache', 'fleet-tickets.json');
}

function empty() {
  return { schemaVersion: SCHEMA_VERSION, tickets: {} };
}

function read(root) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath(root), 'utf8'));
  } catch (e) {
    return empty();
  }
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.tickets || typeof parsed.tickets !== 'object') return empty();
  return { schemaVersion: SCHEMA_VERSION, tickets: parsed.tickets };
}

// Temp file + rename, as cache.js does, so a reader never sees a torn file.
function write(root, cache) {
  const target = cachePath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, tickets: cache.tickets }), 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* not worth failing over */ }
    throw e;
  }
}

const keyOf = (ident) => String(ident).toUpperCase();

function get(cache, ident) {
  return (cache && cache.tickets && cache.tickets[keyOf(ident)]) || null;
}

function put(cache, entry, now) {
  const tickets = Object.assign({}, cache.tickets, { [keyOf(entry.identifier)]: Object.assign({}, entry, { fetchedAt: now }) });
  return { schemaVersion: SCHEMA_VERSION, tickets };
}

function isFresh(entry, now, ttlMs) {
  return !!entry && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttlMs;
}

function ttlFromEnv(env) {
  const raw = env && env[ENV_TTL];
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

module.exports = { SCHEMA_VERSION, DEFAULT_TTL_MS, ENV_TTL, cachePath, read, write, get, put, isFresh, ttlFromEnv };
```

- [ ] **Step 4: Run tests**

Run: `node --test test/fleet-ticket-cache.test.js`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/fleet-ticket-cache.js test/fleet-ticket-cache.test.js
git commit -m "Add the per-ticket Linear detail cache for concertino fleet"
```

---

### Task 3: `--tickets` enrichment in `lib/cli/fleet.js`

**Files:**
- Modify: `lib/cli/fleet.js`, `lib/cli/help.js` (fleet usage block)
- Test: `test/cli-fleet.test.js` (append)

**Interfaces:**
- Consumes: `fetchTicketDetail` (Task 1), `fleet-ticket-cache` (Task 2), `kindFor` from `lib/ui/ticket-provider.js`, `resolveConfigPath/exists/read` from `./shared`.
- Produces:
  ```js
  parseTickets(value) → string[]                      // '' | undefined → []; trims; drops empties
  enrichTickets(root, runs, requested, deps) → runs   // deps: { fetchDetail, now, env, config, cache }
  ```
  Each run gains `ticket_meta` (entry minus `epicId/epicName/number/updatedAt/createdAt/completedAt/commentCount`, with `fetchedAt`) or `null`, and `ticket_meta_error` (string | null). `buildSnapshot(root, { all, tickets, deps })` calls it. `cmdFleet` reads `--tickets`.

- [ ] **Step 1: Write the failing tests**

Append to `test/cli-fleet.test.js`:

```js
// --- v1.1: --tickets enrichment -------------------------------------------------------------------
const cacheMod = require('../lib/ui/fleet-ticket-cache');

const LINEAR_CFG = { ticketProvider: { kind: 'linear' } };
const detail = (ident, over = {}) => ({ id: 'u-' + ident, identifier: ident, number: 1, title: 'T ' + ident, description: 'Desc ' + ident, url: 'https://l/' + ident,
  state: { name: 'In Progress', type: 'started' }, estimate: 3, priority: 2, assignee: 'Matt', labels: ['x'], epicId: null, epicName: null,
  updatedAt: 1, createdAt: 1, completedAt: null, comments: [{ id: 'c1', author: 'Matt', body: 'hi', createdAt: 5 }], commentCount: 1, commentsTruncated: false, ...over });

function fakeFetch(map, calls) {
  return async ({ id }) => {
    calls.push(id);
    if (map[id] instanceof Error) throw map[id];
    if (!map[id]) throw new Error('linear: ticket "' + id + '" was not found');
    return map[id];
  };
}

test('parseTickets tolerates empty and trailing comma', () => {
  assert.deepEqual(fleet.parseTickets(undefined), []);
  assert.deepEqual(fleet.parseTickets(''), []);
  assert.deepEqual(fleet.parseTickets('CON-1,'), ['CON-1']);
  assert.deepEqual(fleet.parseTickets(' CON-1 , con-2 '), ['CON-1', 'con-2']);
});

test('enrichTickets: requested tickets are fetched once, cached, and served from cache within the TTL', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]);
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 10_000, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  let snap = fleet.buildSnapshot(root, { now: 10_000, tickets: ['CON-1'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1']);
  assert.equal(by['CON-1'].ticket_meta.description, 'Desc CON-1');
  assert.equal(by['CON-1'].ticket_meta.fetchedAt, 10_000);
  assert.equal(by['CON-1'].ticket_meta.epicId, undefined);
  assert.equal(by['CON-1'].ticket_meta_error, null);
  assert.equal(by['CON-2'].ticket_meta, null);          // not requested, nothing cached
  assert.equal(by['CON-2'].ticket_meta_error, null);
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1').fetchedAt, 10_000);
  // 15 s later: still fresh, no fetch
  snap = fleet.buildSnapshot(root, { now: 25_000, tickets: ['CON-1'], deps: { ...deps, now: 25_000 } });
  assert.deepEqual(calls, ['CON-1']);
  // 21 s later: stale, refetched
  snap = fleet.buildSnapshot(root, { now: 31_000, tickets: ['CON-1'], deps: { ...deps, now: 31_000 } });
  assert.deepEqual(calls, ['CON-1', 'CON-1']);
  assert.equal(snap.runs.find((r) => r.ticket === 'CON-1').ticket_meta.fetchedAt, 31_000);
});

test('enrichTickets: an unrequested ticket is served from cache when present, never fetched', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1'), 1));
  const calls = [];
  const snap = fleet.buildSnapshot(root, { now: 999_999, tickets: [], deps: { fetchDetail: fakeFetch({}, calls), now: 999_999, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG } });
  assert.deepEqual(calls, []);
  assert.equal(snap.runs[0].ticket_meta.fetchedAt, 1);
});

test('enrichTickets: a not-found ticket sets ticket_meta_error and leaves others cached; the first failure stops further fetches', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]); writeRun(root, 'CON-3', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-3'), 1));
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-2': detail('CON-2') }, calls), now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  const snap = fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2', 'CON-3'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1']);                    // CON-1 failed first; CON-2 and CON-3 were not fetched
  assert.equal(by['CON-1'].ticket_meta, null);
  assert.match(by['CON-1'].ticket_meta_error, /was not found/);
  assert.equal(by['CON-2'].ticket_meta, null);
  assert.match(by['CON-2'].ticket_meta_error, /was not found/); // the invocation's error is reported on every requested-but-unfetched run
  assert.equal(by['CON-3'].ticket_meta.fetchedAt, 1);    // stale cache still served
  assert.match(by['CON-3'].ticket_meta_error, /was not found/);
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1'), null);
});

test('enrichTickets: a 429 keeps the stale entry and reports it', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1', { description: 'old' }), 1));
  const calls = [];
  const snap = fleet.buildSnapshot(root, { now: 999_999, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': new Error('linear: HTTP 429 — rate limited') }, calls), now: 999_999, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG } });
  assert.equal(snap.runs[0].ticket_meta.description, 'old');
  assert.match(snap.runs[0].ticket_meta_error, /429/);
});

test('enrichTickets: non-linear provider or missing key → null meta with a one-line error, no fetch', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const calls = [];
  let snap = fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: { LINEAR_API_KEY: 'k' }, config: { ticketProvider: { kind: 'local' } } } });
  assert.equal(snap.runs[0].ticket_meta, null);
  assert.match(snap.runs[0].ticket_meta_error, /ticketProvider\.kind "local"/);
  snap = fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: {}, config: LINEAR_CFG } });
  assert.equal(snap.runs[0].ticket_meta, null);
  assert.match(snap.runs[0].ticket_meta_error, /LINEAR_API_KEY/);
  assert.deepEqual(calls, []);
});

test('enrichTickets: the TTL env override is honoured', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const calls = [];
  const env = { LINEAR_API_KEY: 'k', CONCERTINO_FLEET_TICKET_TTL_MS: '1000' };
  fleet.buildSnapshot(root, { now: 0, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 0, env, config: LINEAR_CFG } });
  fleet.buildSnapshot(root, { now: 1500, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1500, env, config: LINEAR_CFG } });
  assert.deepEqual(calls, ['CON-1', 'CON-1']);
});

test('cmdFleet --json without --tickets adds ticket_meta: null to every run and never touches Linear', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  const run = JSON.parse(out).runs[0];
  assert.equal(run.ticket_meta, null);
  assert.equal(run.ticket_meta_error, null);
});
```

Note `buildSnapshot` and `enrichTickets` are synchronous today; the fetch is async. **Decision:** `buildSnapshot` becomes `async` (returns a Promise) — update the existing tests' calls to `await fleet.buildSnapshot(...)` (there are ~10; each test callback becomes `async`). `cmdFleet` already awaits.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/cli-fleet.test.js`
Expected: FAIL — `fleet.parseTickets is not a function`, and `ticket_meta` undefined.

- [ ] **Step 3: Implement**

In `lib/cli/fleet.js` add requires:

```js
const linear = require('../ui/linear');
const ticketCache = require('../ui/fleet-ticket-cache');
const { kindFor } = require('../ui/ticket-provider');
const { resolveConfigPath, exists, read } = require('./shared');   // merge into the existing shared import
```

Add:

```js
// v1.1: `--tickets=A,B` — the pane's shown lanes, whose Linear detail is
// kept fresh through the per-ticket cache (fleet-ticket-cache.js).
function parseTickets(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Linear's launch-pad fields the pane does not need.
const META_DROP = ['epicId', 'epicName', 'number', 'updatedAt', 'createdAt', 'completedAt', 'commentCount'];
function toMeta(entry) {
  if (!entry) return null;
  const meta = Object.assign({}, entry);
  for (const k of META_DROP) delete meta[k];
  return meta;
}

function linearGate(config, env) {
  const kind = kindFor(config);
  if (kind !== 'linear') return 'ticket detail needs ticketProvider.kind "linear" (got ticketProvider.kind ' + JSON.stringify(kind == null ? null : kind) + ')';
  if (!env.LINEAR_API_KEY) return 'LINEAR_API_KEY is not set — ticket detail is unavailable';
  return null;
}

// Requested tickets: served from cache while fresh, otherwise fetched and
// cached. Unrequested: cache only. The first failure (incl. HTTP 429) stops
// further fetches this invocation; every requested-but-unfetched run carries
// the error. The snapshot itself never fails because of Linear.
async function enrichTickets(root, runs, requested, deps) {
  const env = deps.env || process.env;
  const now = deps.now != null ? deps.now : Date.now();
  const fetchDetail = deps.fetchDetail || ((opts) => linear.fetchTicketDetail(Object.assign({ apiKey: env.LINEAR_API_KEY }, opts)));
  const ttl = ticketCache.ttlFromEnv(env);
  let cache = deps.cache || ticketCache.read(root);
  const want = new Set(requested.map((t) => t.toUpperCase()));
  const gateError = linearGate(deps.config || {}, env);
  let error = gateError;
  let dirty = false;

  for (const run of runs) {
    const cached = ticketCache.get(cache, run.ticket);
    const isRequested = want.has(run.ticket.toUpperCase());
    if (isRequested && !error && !ticketCache.isFresh(cached, now, ttl)) {
      try {
        const fresh = await fetchDetail({ id: run.ticket });
        cache = ticketCache.put(cache, fresh, now);
        dirty = true;
      } catch (e) {
        error = String((e && e.message) || e);
      }
    }
    run.ticket_meta = toMeta(ticketCache.get(cache, run.ticket));
    run.ticket_meta_error = isRequested ? error : (gateError && cached ? null : (cached ? null : (isRequested ? error : null)));
  }
  // Runs not requested never carry the invocation's fetch error; the gate error is reported only on requested runs too.
  for (const run of runs) if (!want.has(run.ticket.toUpperCase())) run.ticket_meta_error = null;
  if (dirty) {
    try { ticketCache.write(root, cache); } catch (e) { /* a cache write failure is not a snapshot failure */ }
  }
  return runs;
}
```

Simplify the `ticket_meta_error` assignment to exactly: `run.ticket_meta_error = isRequested ? error : null;` (the loop below then becomes unnecessary — delete it). Keep the code minimal; the tests above pin the semantics: requested runs carry the invocation's current `error` (gate error or first fetch failure), unrequested runs carry `null`.

Make `buildSnapshot` async:

```js
async function buildSnapshot(root, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const runs = reduce(store.readAll(root), [], now)
    .filter(...)            // unchanged
    .map(...);              // unchanged
  await enrichTickets(root, runs, opts.tickets || [], opts.deps || {});
  return { generatedAt: now, root, runs };
}
```

When `opts.deps` is absent, `enrichTickets` must still produce `ticket_meta: null, ticket_meta_error: null` with no requested tickets (gate error is only reported on requested runs — so `--json` without `--tickets` never consults config or Linear beyond reading the cache). `cmdFleet`:

```js
  const config = (() => { const p = resolveConfigPath(args, dir); try { return exists(p) ? JSON.parse(read(p)) : {}; } catch (e) { return {}; } })();
  const snapshot = await buildSnapshot(root, { all: !!args.all, tickets: parseTickets(args.tickets), deps: { config } });
```

`renderTable` is unchanged. Export `parseTickets`, `enrichTickets`.

`lib/cli/help.js` fleet block: usage becomes `[--json] [--all] [--tickets=A,B] [--out=DIR]` and add the line:
```
      ${dim('--tickets=A,B')}  also attach each listed ticket's Linear detail
                     (description, state, assignee, priority, labels, newest
                     comments) as ticket_meta, cached 20 s per ticket in
                     .concertino/cache/fleet-tickets.json. Linear only; needs
                     LINEAR_API_KEY.
```

- [ ] **Step 4: Run tests**

Run: `node --test test/cli-fleet.test.js test/cli-help-flags.test.js`
Expected: PASS (existing tests updated to `await`).

- [ ] **Step 5: Commit**

```bash
git add lib/cli/fleet.js lib/cli/help.js test/cli-fleet.test.js
git commit -m "concertino fleet --tickets: attach cached Linear detail to requested runs"
```

---

### Task 4: Mod plumbing — types, `--tickets=` argv, fingerprint, toast scope, toggle

**Files:**
- Modify: `types/index.d.ts`, `hooks/fleet-pane/snapshot.ts`, `hooks/fleet-pane/register.tsx`, `hooks/fleet-pane/lanes.ts`
- Test: `hooks/fleet-pane/refresh.test.ts`, `hooks/fleet-pane/lanes.test.ts`

**Interfaces:**
- Consumes: Task 3's JSON (`ticket_meta`, `ticket_meta_error`).
- Produces: `TicketMeta`, `TicketComment` types; `Run.ticket_meta: TicketMeta | null`, `Run.ticket_meta_error: string | null`; `runFleetSnapshot($, cwd, tickets: readonly string[] = [])`; `refresh` passes the previous state's shown tickets; `fingerprint` covers `ticket_meta.fetchedAt` and last comment id; toasts only for shown lanes; `/fleet all` toggle via `update(fn)`.

- [ ] **Step 1: Types**

```ts
// types/index.d.ts — add before `export type Run`
export type TicketComment = { id: string | null; author: string | null; body: string; createdAt: number | null }
export type TicketMeta = {
  fetchedAt: number
  id: string | null
  identifier: string | null
  title: string
  description: string
  url: string | null
  state: { name: string | null; type: string | null }
  assignee: string | null
  priority: number | null
  estimate: number | null
  labels: string[]
  comments: TicketComment[]
  commentsTruncated: boolean
}
```
and in `Run`: `ticket_meta: TicketMeta | null` and `ticket_meta_error: string | null` after `currentAgent`.

- [ ] **Step 2: Write the failing tests**

`refresh.test.ts` — update `SNAP.runs[0]` to include `ticket_meta: null, ticket_meta_error: null`; the first `runFleetSnapshot` test expects argv `['concertino','fleet','--json']` when called with no tickets, and add:

```ts
test('runFleetSnapshot: appends --tickets= for the given tickets, comma-joined', async () => {
  let seen: readonly string[] = []
  const $ = fake$(async argv => { seen = argv; return result({ stdout: JSON.stringify(SNAP) }) })
  await runFleetSnapshot($, '/repo', ['CON-1', 'CON-2'])
  expect(seen).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1,CON-2'])
})
```

Poll-driven tests (using the existing `world()` harness, capturing `e.argv` in the `process.run` hook):

```ts
test('refresh: the second poll passes the previous poll\'s shown lanes as --tickets; hidden lanes are not requested', async ($, on) => {
  // SNAP has a shown lane (event at t=0, clock 2000); add a stale one
  const stale = { ...SNAP.runs[0], ticket: 'CON-9', timeline: [{ t: -3_600_000 * 2, kind: 'phase.enter' }] }
  const argvs: (readonly string[])[] = []
  const w = world(on, { stdout: JSON.stringify({ ...SNAP, runs: [SNAP.runs[0], stale] }), onRun: argv => argvs.push(argv) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await w.clock.advance(2000)
  await w.clock.advance(2000)
  expect(argvs[0]).toEqual(['concertino', 'fleet', '--json'])
  expect(argvs[1]).toEqual(['concertino', 'fleet', '--json', '--tickets=CON-1'])
})

test('refresh: toasts only for shown lanes', async ($, on) => {
  const esc = { question: 'Old?', options: [], raisedAt: 0, escalationId: 'old-1', role: 'skeptic' }
  const stale = { ...SNAP.runs[0], ticket: 'CON-9', status: 'needs-you', escalation: esc, timeline: [{ t: -3_600_000 * 2, kind: 'phase.enter' }] }
  const toasts: string[] = []
  const w = world(on, { stdout: JSON.stringify({ ...SNAP, runs: [SNAP.runs[0], stale] }), onToast: t => toasts.push(t) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await w.clock.advance(2000)
  expect(toasts).toEqual([])
})

test('/fleet all toggles through a single update(fn)', async ($, on) => {
  const sets: unknown[] = []
  world(on, { stdout: JSON.stringify(SNAP), onSet: (key, value) => { if (key === 'showAll') sets.push(value) } })
  await $.command.run({ command: 'fleet', args: 'all' })
  await $.command.run({ command: 'fleet', args: 'all' })
  expect(sets).toEqual([true, false])
})
```
(Extend `world()` with optional `onRun`, `onToast`, `onSet` callbacks if it lacks them — it already captures `state.set` writes and `process.run` calls; expose them.)

`lanes.test.ts`:

```ts
test('fingerprint: changes when ticket_meta.fetchedAt or the last comment id changes', async () => {
  const meta = (fetchedAt: number, lastId: string) => ({ fetchedAt, id: null, identifier: 'CON-1', title: '', description: '', url: null,
    state: { name: null, type: null }, assignee: null, priority: null, estimate: null, labels: [], commentsTruncated: false,
    comments: [{ id: lastId, author: null, body: '', createdAt: null }] })
  const a = correlate([run({ ticket_meta: meta(1, 'c1') })], [], new Map())
  const b = correlate([run({ ticket_meta: meta(2, 'c1') })], [], new Map())
  const c = correlate([run({ ticket_meta: meta(1, 'c2') })], [], new Map())
  expect(fingerprint(a, null)).not.toBe(fingerprint(b, null))
  expect(fingerprint(a, null)).not.toBe(fingerprint(c, null))
  expect(fingerprint(a, null)).toBe(fingerprint(correlate([run({ ticket_meta: meta(1, 'c1') })], [], new Map()), null))
})
```
(The `run()` fixture in that file gains `ticket_meta: null, ticket_meta_error: null` defaults.)

- [ ] **Step 3: Run to verify failure**

Run: `claude plugin test .`
Expected: new tests FAIL (argv lacks `--tickets=`; toast fires; fingerprint equal).

- [ ] **Step 4: Implement**

`snapshot.ts`:
```ts
export async function runFleetSnapshot($: EngineInterface, cwd: string, tickets: readonly string[] = []): Promise<SnapshotResult> {
  const argv = tickets.length ? [...FLEET_ARGV, `--tickets=${tickets.join(',')}`] : [...FLEET_ARGV]
  // … $.process.run(argv, …) as before
```

`register.tsx` `refresh`:
```ts
  const now = await $.clock.now()
  const previousShown = partition(previous.lanes, now).shown.map(l => l.run.ticket)
  const got = await runFleetSnapshot({ process: { run: (argv, init) => $.process.run(argv, init) } } as EngineInterface, cwd, previousShown)
  // … after `const { shown, hidden } = partition(lanes, now)` (reuse `now`):
  await toastNewEscalations($, shown)
```
`toastNewEscalations($, lanes: Lane[])` iterates the given lanes instead of `state.lanes`. The `/fleet all` branch:
```ts
    if (e.args.trim() === 'all') {
      let nowAll = false
      await update($, showAll, current => (nowAll = !current))
      return { text: nowAll ? 'Fleet pane: showing all lanes.' : 'Fleet pane: showing live lanes only.' }
    }
```

`lanes.ts` `fingerprint` row: append `l.run.ticket_meta?.fetchedAt ?? null, l.run.ticket_meta?.comments.at(-1)?.id ?? null, l.run.ticket_meta_error`.

- [ ] **Step 5: Run tests + validate**

Run: `claude plugin test . && claude plugin validate .`
Expected: PASS; hooks unchanged (`session.start`, `command.run`, `ui.render`).

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/fleet-pane/snapshot.ts hooks/fleet-pane/register.tsx hooks/fleet-pane/lanes.ts hooks/fleet-pane/refresh.test.ts hooks/fleet-pane/lanes.test.ts
git commit -m "Fleet pane requests Linear detail for shown lanes; toast only shown lanes"
```

---

### Task 5: Detail view — metadata line, DESCRIPTION, COMMENTS

**Files:**
- Modify: `hooks/fleet-pane/render.tsx`
- Test: `hooks/fleet-pane/render.test.ts`

**Interfaces:**
- Consumes: `TicketMeta` (Task 4), `fmtAgo`, `truncate`, `PaneModel.now`.
- Produces: helpers `metaLine(meta): string`, `descriptionLines(meta, excerpt): { title: 'DESCRIPTION' | 'TICKET'; lines: string[] }`, `commentLines(c): string[]` (CRLF → LF, first 6 non-empty lines); block keys `meta`, `ticket` (kept for the description block), `comments`, `meta-error`.

- [ ] **Step 1: Write the failing tests** (inside the existing surface loop; the `run()` fixture gains `ticket_meta: null, ticket_meta_error: null`)

```ts
  const META = {
    fetchedAt: 0, id: 'u', identifier: 'CON-1', title: 'Linear title', description: 'First line.\n\nSecond line.\n' + Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n'),
    url: 'https://linear.app/x/CON-1', state: { name: 'In Progress', type: 'started' }, assignee: 'Matt', priority: 2, estimate: 3, labels: ['agent-merge', 'follow-up'],
    comments: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, author: `A${i}`, body: `Comment ${i}\r\nline two\r\n` + 'x\n'.repeat(10), createdAt: -(7 - i) * 60_000 })),
    commentsTruncated: false,
  }

  test(`detail: metadata line, DESCRIPTION (12 lines) and COMMENTS (last 5, 6 lines each, "N more") from ticket_meta (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: META })])
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'meta' }))?.text).toMatch(/In Progress · Matt · P2 · 3 pts · labels: agent-merge, follow-up · https:\/\/linear\.app\/x\/CON-1/)
    const desc = (await ui.find({ key: 'ticket' }))?.text ?? ''
    expect(desc).toMatch(/^DESCRIPTION/)
    expect(desc).toMatch(/First line\./); expect(desc).toMatch(/L9\b/); expect(desc).not.toMatch(/L10\b/)   // 12 non-empty lines: First, Second, L0..L9
    const com = (await ui.find({ key: 'comments' }))?.text ?? ''
    expect(com).toMatch(/^COMMENTS \(7\)/)
    expect(com).not.toMatch(/Comment 1\b/); expect(com).toMatch(/Comment 2\b/); expect(com).toMatch(/Comment 6\b/)   // last 5
    expect(com).toMatch(/A6 · 1m ago/)
    expect(com).toMatch(/2 more — https:\/\/linear\.app\/x\/CON-1/)
    expect((await ui.find({ key: 'detail' }))?.text).toMatch(/CON-1  Linear title/)   // header prefers the Linear title
  })

  test(`detail: comment body is capped at six lines and CRLF is normalised (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: { ...META, comments: [META.comments[6]] } })])
    const ui = await mount($, surface)
    const com = (await ui.find({ key: 'comments' }))?.text ?? ''
    expect(com).not.toMatch(/\r/)
    expect(com.split('\n').filter(l => l === 'x').length).toBe(4)   // "Comment 6", "line two", then 4 of the 10 x-lines = 6 lines
  })

  test(`detail: without ticket_meta the TICKET excerpt is drawn, and ticket_meta_error dim under the header (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: null, ticket_meta_error: 'linear: HTTP 429 — rate limited' })])
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'ticket' }))?.text).toMatch(/^TICKET/)
    expect(await ui.find({ key: 'comments' })).toBeUndefined()
    expect((await ui.find({ key: 'meta-error' }))?.text).toMatch(/429/)
  })

  test(`detail: empty optional metadata parts are omitted (${surface})`, async ($, on) => {
    seed(on, [lane({ ticket_meta: { ...META, assignee: null, estimate: null, labels: [], priority: null, url: null } })])
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'meta' }))?.text.trim()).toBe('In Progress')
  })
```
(`mount($, surface)` is whatever helper the file already uses to mount the Pane with `requestId: 'fleet'`; `seed(on, lanes)` the existing one.)

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test .`
Expected: the four new tests FAIL (no `meta`/`comments` keys).

- [ ] **Step 3: Implement** in `render.tsx`

```tsx
export function metaLine(m: TicketMeta): string {
  const parts = [
    m.state.name,
    m.assignee,
    m.priority != null ? `P${m.priority}` : null,
    m.estimate != null ? `${m.estimate} pts` : null,
    m.labels.length ? `labels: ${m.labels.join(', ')}` : null,
    m.url,
  ].filter((p): p is string => !!p)
  return parts.join(' · ')
}

const nonEmpty = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())

export function descriptionLines(meta: TicketMeta | null, excerpt: string | null): { title: 'DESCRIPTION' | 'TICKET'; lines: string[] } {
  if (meta) return { title: 'DESCRIPTION', lines: nonEmpty(meta.description).slice(0, 12) }
  return { title: 'TICKET', lines: nonEmpty(excerpt ?? '').slice(0, 8) }
}

export const commentLines = (c: TicketComment): string[] => nonEmpty(c.body).slice(0, 6)
```

In `renderDetail`:
- header title: `` `${r.ticket}  ${r.ticket_meta?.title || r.ticket_doc.title || r.changeName || ''}  ${r.branch ?? ''}` ``
- after the phase line: `{r.ticket_meta && <Box key="meta"><Text>{truncate(metaLine(r.ticket_meta), w)}</Text></Box>}` and `{r.ticket_meta_error && <Box key="meta-error"><Text dimColor>{truncate(r.ticket_meta_error, w)}</Text></Box>}`
- replace the `TICKET` block with `const desc = descriptionLines(r.ticket_meta, r.ticket_doc.excerpt)`; draw `<Box key="ticket" …><Text bold>{desc.title}</Text><Text wrap="wrap">{desc.lines.join('\n')}</Text></Box>` when `desc.lines.length > 0`.
- after the `pr` block:
```tsx
      {r.ticket_meta && r.ticket_meta.comments.length > 0 && (() => {
        const all = r.ticket_meta.comments
        const shown = all.slice(-5)
        const more = all.length - shown.length + (r.ticket_meta.commentsTruncated ? 1 : 0)
        return (
          <Box key="comments" flexDirection="column" marginTop={1}>
            <Text bold>{`COMMENTS (${all.length}${r.ticket_meta.commentsTruncated ? '+' : ''})`}</Text>
            {shown.map((c, i) => (
              <Box key={`cm:${i}`} flexDirection="column">
                <Text dimColor>{truncate(`${c.author ?? 'someone'} · ${c.createdAt != null ? fmtAgo(model.now - c.createdAt) : ''}`.trim(), w)}</Text>
                <Text wrap="wrap">{commentLines(c).join('\n')}</Text>
              </Box>
            ))}
            {more > 0 && <Text dimColor>{truncate(`${more} more — ${r.ticket_meta.url ?? ''}`.trim(), w)}</Text>}
          </Box>
        )
      })()}
```
Import `TicketMeta`, `TicketComment` from `'../../types'`. If the validator refuses an IIFE child, compute `comments`/`more` above the `return` instead.

- [ ] **Step 4: Run tests + validate**

Run: `claude plugin test . && claude plugin validate .`
Expected: PASS on both surfaces.

- [ ] **Step 5: Commit**

```bash
git add hooks/fleet-pane/render.tsx hooks/fleet-pane/render.test.ts
git commit -m "Fleet pane detail: Linear metadata, description and latest comments"
```

---

### Task 6: Docs, OpenSpec, full suite

**Files:**
- Modify: `docs/dashboard.md` (pane section), `openspec/changes/fleet-pane/specs/fleet-snapshot-cli/spec.md`, `openspec/changes/fleet-pane/specs/fleet-pane-mod/spec.md`, `openspec/changes/fleet-pane/tasks.md`

- [ ] **Step 1: Docs** — in the pane section of `docs/dashboard.md` add: "The detail shows the ticket as Linear has it — state, assignee, priority, labels, description and the latest comments — refreshed at most every 20 s per visible lane (`CONCERTINO_FLEET_TICKET_TTL_MS` overrides); needs `LINEAR_API_KEY` and `ticketProvider.kind: linear`." In the CLI paragraph mention `--tickets=A,B`.
- [ ] **Step 2: OpenSpec** — `fleet-snapshot-cli/spec.md`: add `### Requirement: Linear detail for requested tickets` with scenarios "fresh cache served", "stale entry refetched", "first failure stops further fetches", "non-linear provider → null + error". `fleet-pane-mod/spec.md`: add `### Requirement: Detail shows Linear metadata, description and comments` with scenarios "metadata line", "excerpt fallback", "last five comments with N more". `tasks.md`: add a "v1.1" list of this plan's six tasks, ticked. Run `openspec validate "fleet-pane" --type change` → valid.
- [ ] **Step 3: Full suite** — `npm test` (foreground) → exit 0.
- [ ] **Step 4: Commit**

```bash
git add docs/dashboard.md openspec/changes/fleet-pane
git commit -m "Document Linear ticket detail in the fleet pane and CLI"
```

---

## Self-review notes

- Spec coverage: seam + `--tickets` (T3), fields = `normaliseTicket` minus launch-pad fields (T3 `META_DROP`), provider/key gate (T3), new query (T1), per-ticket cache with TTL/env/atomic write (T2), first-failure stop + 429 (T3), mod argv/fingerprint/toast scope/toggle (T4), metadata line / DESCRIPTION 12 / COMMENTS 5×6 / `N more` / excerpt fallback / dim error (T5), docs + OpenSpec (T6). Error-table row: T3 (stale served) + T5 (dim error, excerpt fallback).
- Type consistency: `ticket_meta` / `ticket_meta_error` spelled the same in T3 JSON, T4 types, T5 render; `TicketMeta.comments[].createdAt` is ms (normaliseComment's `toMillis`) — `fmtAgo(now - createdAt)` matches.
- Review Focus pins: #1 T3 "not-found"; #2 T2 "schemaVersion mismatch"; #3 T2 "atomic"; #4 T5 "CRLF/six lines"; #5 T3 "parseTickets".
- Known risk: `buildSnapshot` becoming async changes ~10 existing tests to `await` (T3 says so explicitly).
