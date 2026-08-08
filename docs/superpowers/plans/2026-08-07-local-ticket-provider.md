# Local Ticket Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Concertino run its full delivery workflow against a repo with no remote ticket board, using tracked markdown files under `tickets/` as the ticket store.

**Architecture:** A new resolver module (`lib/ui/ticket-provider.js`) dispatches on `config.ticketProvider.kind` and re-exports the exact function names `watch.js` and `draft.js` already call. A new store module (`lib/ui/tickets/local.js`) reads `tickets/*.md` and emits the same normalised ticket shape `lib/ui/linear.js`'s `normalise()` produces, so every downstream consumer — launch pad screens, `deriveEpics`, detail pane, queue, retention — is unchanged. `lib/ui/linear.js` is not modified. Status write-back is a shell script the orchestrator calls, not a JS path.

**Tech Stack:** Node.js (CommonJS, zero runtime dependencies), `node --test` + `node:assert` for JS tests, bash for the procedure script and its test.

**Spec:** `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`

## Global Constraints

- **Zero runtime dependencies.** `package.json` declares no `dependencies` (only `openspec` as a devDependency). There is no YAML library and none may be added — frontmatter parsing is hand-rolled and deliberately limited to `key: value` scalars plus one inline-array form `labels: [a, b]`.
- **`lib/ui/linear.js` is not modified by any task in this plan.** It may be `require`d and its exports reused.
- **State vocabulary is exactly** `backlog`, `unstarted`, `started`, `completed`, `canceled` — Linear's `state.type` values.
- **Open states are** `['backlog', 'unstarted', 'started']` (`lib/ui/linear.js:36`, `OPEN_STATE_TYPES`).
- **`priority: 0` is a real value ("None"), never an absence.** Never collapse it with `||`. Absent priority is `null`.
- **The ticket directory is `tickets/` at the repo root, fixed, not configurable.**
- **JS test files** live at `test/<name>.test.js`, open with `'use strict';`, and use `require('node:test')` / `require('node:assert')`.
- **Bash test files** live at `test/scripts/<name>.test.sh` and **must be appended to `package.json`'s `test` script** — the bash suites are listed explicitly there, so one that is not wired in never runs.
- **Commit subjects** are `CON-44 <imperative summary>`.
- **Baseline note:** `node --test` currently passes 1606/1606 on this branch. The `test/scripts/*.test.sh` suites could not be run in the authoring session (blocked by a permission classifier); Task 6 assumes they pass and its implementer must verify.

---

## File Structure

| File | Responsibility |
|---|---|
| `config/concertino.schema.json` | `ticketProvider.kind` enum gains `local`, loses `manual` |
| `lib/config.js` | `withDefaults` normalises `manual` → `local`; `collectConfigIssues` accepts `local` and warns on the deprecated `manual` |
| `lib/cli/init.js` | interactive provider list and `idExampleFor` |
| `lib/ui/tickets/local.js` | **NEW** — the whole local store: frontmatter parse, normalise, fetch, gate, messages |
| `lib/ui/ticket-provider.js` | **NEW** — dispatch on `kind`, nothing else |
| `lib/ui/cache.js` | cache file rename + schema bump |
| `lib/ui/watch.js` | require swap, provider-dispatched message, auto-refresh, `root` threaded into provider calls |
| `lib/ui/controllers/draft.js` | gate message no longer names linear as the only option |
| `core/scripts/set-ticket-state.sh` | **NEW** — canonical status write-back |
| `lib/cli/render.js` | `{{block:ticketProvider}}` `local` case |

`adapters/claude-code/agents.json` is deliberately **not** in this list: its `mcpTools` maps only ever had `linear` and `github` keys, and `lib/cli/emit.js:56`'s `(r.mcpTools && r.mcpTools[c.ticketProvider.kind]) || []` already yields `[]` for an absent key.

---

### Task 1: Config accepts `local`, deprecates `manual`

**Files:**
- Modify: `config/concertino.schema.json` (the `ticketProvider.kind` enum)
- Modify: `lib/config.js:147-152` (`withDefaults`), `lib/config.js:444-447` (`collectConfigIssues`)
- Modify: `lib/cli/init.js:104` (`idExampleFor`), `lib/cli/init.js:190` (provider prompt)
- Test: `test/config.test.js`, `test/validate.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `withDefaults(c)` guarantees `c.ticketProvider.kind` is one of `'linear' | 'github' | 'local'` — never `'manual'`. Every later task may rely on that.

**Why the validator still sees `manual`:** `collectConfigIssues` is called with the **raw, pre-`withDefaults`** parsed config (`lib/cli/validate.js:61` parses the file and hands it straight in; `lib/ui/screens/settings.js:153` documents the same). So the deprecation warning is emitted from `collectConfigIssues` against the on-disk value, while `withDefaults` — used by `sync`/`eject`/`diff`/`init` — normalises it for everything that renders.

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.js`:

```js
const { withDefaults, collectConfigIssues } = require('../lib/config');

test('withDefaults normalises the deprecated manual kind to local', () => {
  const c = withDefaults(baseConfig({ ticketProvider: { kind: 'manual', idExample: 'ABC-123' } }));
  assert.equal(c.ticketProvider.kind, 'local');
});

test('withDefaults leaves linear and github alone', () => {
  assert.equal(withDefaults(baseConfig({ ticketProvider: { kind: 'linear' } })).ticketProvider.kind, 'linear');
  assert.equal(withDefaults(baseConfig({ ticketProvider: { kind: 'github' } })).ticketProvider.kind, 'github');
});
```

`baseConfig(over)` already exists at `test/config.test.js:17` and shallow-`Object.assign`s `over` onto a fixture whose `ticketProvider` is `{ kind: 'linear', idExample: 'ABC-123' }` — so passing a whole `ticketProvider` object replaces it wholesale, which is what the tests above rely on. Reuse it; do not define a second one.

Append to `test/validate.test.js`:

```js
test('ticketProvider.kind local is accepted', () => {
  const out = runValidate(baseConfig({ ticketProvider: { kind: 'local', idExample: 'CON-1' } }));
  assert.match(out, /ticketProvider/);
  assert.doesNotMatch(out, /must be linear\|github\|local/);
});

test('ticketProvider.kind manual is accepted but warns that it is deprecated', () => {
  const out = runValidate(baseConfig({ ticketProvider: { kind: 'manual', idExample: 'ABC-123' } }));
  assert.match(out, /deprecated/);
  assert.match(out, /local/);
});
```

`test/validate.test.js:148` already has a `manual` case asserting it is accepted — update that existing test rather than leaving a duplicate. Use whatever runner helper that file already uses in place of `runValidate` if the name differs.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/config.test.js test/validate.test.js`
Expected: FAIL — `withDefaults` leaves `kind` as `'manual'`; validate has no "deprecated" text.

- [ ] **Step 3: Update the JSON schema**

In `config/concertino.schema.json`, `properties.ticketProvider.properties.kind`:

```json
"kind": { "enum": ["linear", "github", "local"] }
```

- [ ] **Step 4: Normalise in `withDefaults`**

In `lib/config.js`, inside `withDefaults(c)`, immediately after the existing `c.ticketProvider.idExample` line:

```js
  // CON-44: `manual` is the pre-local name for "no remote ticket provider".
  // Normalised here rather than migrated, because `concertino migrate` is
  // purely additive (it writes back findAdded()'s missing defaults and has no
  // value-rewrite path). `collectConfigIssues` sees the RAW config and is the
  // one place that tells the human to update the file.
  if (c.ticketProvider.kind === 'manual') c.ticketProvider.kind = 'local';
```

- [ ] **Step 5: Accept `local` and warn on `manual` in `collectConfigIssues`**

Replace `lib/config.js:444-447` with:

```js
  const tp = cfg.ticketProvider || {};
  if (tp.kind === 'manual') {
    ok('ticketProvider', 'local' + (tp.idExample ? dim('  e.g. ' + tp.idExample) : ''));
    warn('ticketProvider.kind', 'ticketProvider.kind "manual" is deprecated and reads as "local" — update ' +
      'concertino.config.json. A project with no tickets/ directory keeps today\'s behaviour exactly.');
  } else {
    ['linear', 'github', 'local'].includes(tp.kind)
      ? ok('ticketProvider', tp.kind + (tp.idExample ? dim('  e.g. ' + tp.idExample) : ''))
      : fail('ticketProvider.kind', `ticketProvider.kind must be linear|github|local (got: ${JSON.stringify(tp.kind)})`);
  }
```

- [ ] **Step 6: Update `init.js`**

`lib/cli/init.js:104`:

```js
function idExampleFor(kind) {
  return { linear: 'ABC-123', github: '#123', local: 'TICKET-1' }[kind] || 'TICKET-1';
}
```

`lib/cli/init.js:190`:

```js
    const ticket      = await askChoice(ask, 'Ticket provider', ['linear', 'github', 'local'],        'github',       s());
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/config.test.js test/validate.test.js`
Expected: PASS

- [ ] **Step 8: Run the full JS suite for regressions**

Run: `node --test`
Expected: PASS. `test/config.test.js:451` has a `providerKind: 'manual'` fixture for the `--ticket` harness check — that is an unrelated code path (`buildTicketHarnessCheck` reports whatever kind it was given) and should still pass. If it fails, the fixture string is the only thing to update, not behaviour.

- [ ] **Step 9: Commit**

```bash
git add config/concertino.schema.json lib/config.js lib/cli/init.js test/config.test.js test/validate.test.js
git commit -m "CON-44 Accept ticketProvider.kind local, deprecate manual

manual normalises to local in withDefaults (concertino migrate is purely
additive and cannot rewrite values), and collectConfigIssues — which sees the
raw on-disk config — warns the human to update the file."
```

---

### Task 2: The local ticket store

**Files:**
- Create: `lib/ui/tickets/local.js`
- Test: `test/tickets-local.test.js`

**Interfaces:**
- Consumes: `require('../linear').deriveEpics` and `require('../linear').OPEN_STATE_TYPES`.
- Produces, all consumed by Task 3's resolver:
  - `TICKETS_DIR: 'tickets'`, `STATES: string[]`
  - `parseTicket(stem: string, raw: string, mtimeMs: number|null) → ticket|null`
  - `readTickets(root: string) → { tickets: ticket[], unreadable: number, dirExists: boolean }`
  - `fetchTickets({ root, teamKey, stateTypes }) → { teamKey, tickets, epics, pages: 1, truncated: false, unreadable: number }`
  - `resolveTeam({ root }) → { found: boolean }`
  - `launchPadStatus(config, env) → { enabled, reason, message }`
  - `teamKeyFromConfig(config, env) → { key: string|null, source: string|null }`
  - `stateTypesFromConfig(config) → string[]`
  - `teamNotFoundMessage(teamKey) → string`
  - `createTicket() → Promise` (always rejects)

A `ticket` is exactly the object `lib/ui/linear.js`'s `normaliseTicket` returns: `{ id, identifier, number, title, description, url, state: {name, type}, estimate, priority, assignee, labels, epicId, epicName, updatedAt, comments, commentCount, commentsTruncated }`.

- [ ] **Step 1: Write the failing test**

Create `test/tickets-local.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const local = require('../lib/ui/tickets/local');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-local-'));
}

function seed(root, files) {
  const dir = path.join(root, 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return root;
}

const GOOD = `---
id: CON-12
title: Launch pad refuses non-linear providers
state: unstarted
priority: 2
epic: local-tickets
labels: [harness:codex, ui]
---

## Description

The gate is hard-wired.
`;

// --- parsing ---------------------------------------------------------------

test('a well-formed ticket normalises to linear.js\'s ticket shape', () => {
  const t = local.parseTicket('CON-12', GOOD, 1700000000000);
  assert.equal(t.identifier, 'CON-12');
  assert.equal(t.id, 'CON-12');
  assert.equal(t.number, 12);
  assert.equal(t.title, 'Launch pad refuses non-linear providers');
  assert.equal(t.state.type, 'unstarted');
  assert.equal(t.state.name, 'unstarted');
  assert.equal(t.priority, 2);
  assert.equal(t.epicId, 'local-tickets');
  assert.equal(t.epicName, 'local-tickets');
  assert.deepEqual(t.labels, ['harness:codex', 'ui']);
  assert.equal(t.updatedAt, 1700000000000);
  assert.match(t.description, /The gate is hard-wired\./);
  assert.doesNotMatch(t.description, /^---/);
});

test('local tickets carry no url, comments, estimate or assignee', () => {
  const t = local.parseTicket('CON-12', GOOD, null);
  assert.equal(t.url, null);
  assert.equal(t.estimate, null);
  assert.equal(t.assignee, null);
  assert.deepEqual(t.comments, []);
  assert.equal(t.commentCount, 0);
  assert.equal(t.commentsTruncated, false);
});

test('priority 0 survives as 0, not null — 0 is a real "None"', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\npriority: 0\n---\n\nbody\n', null);
  assert.equal(t.priority, 0);
});

test('an absent priority is null, not 0', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\n---\n\nbody\n', null);
  assert.equal(t.priority, null);
});

test('an absent epic leaves epicId null so deriveEpics buckets it as unassigned', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\n---\n\nbody\n', null);
  assert.equal(t.epicId, null);
  assert.equal(t.epicName, null);
});

test('all five states parse', () => {
  for (const s of ['backlog', 'unstarted', 'started', 'completed', 'canceled']) {
    const t = local.parseTicket('CON-1', `---\ntitle: T\nstate: ${s}\n---\n\nb\n`, null);
    assert.equal(t.state.type, s, s);
  }
});

// --- malformed files -------------------------------------------------------

test('no frontmatter is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '# just a heading\n', null), null);
});

test('a missing title is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\nstate: backlog\n---\n\nb\n', null), null);
});

test('an unknown state is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\ntitle: T\nstate: in-review\n---\n\nb\n', null), null);
});

test('an id that disagrees with the filename is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\nid: CON-99\ntitle: T\nstate: backlog\n---\n\nb\n', null), null);
});

test('an out-of-range priority is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\npriority: 9\n---\n\nb\n', null), null);
});

test('an omitted id is fine — the filename is authoritative', () => {
  const t = local.parseTicket('CON-7', '---\ntitle: T\nstate: backlog\n---\n\nb\n', null);
  assert.equal(t.identifier, 'CON-7');
});

// --- directory reads -------------------------------------------------------

test('a missing tickets/ directory is not an error', () => {
  const r = local.readTickets(tmpRoot());
  assert.deepEqual(r, { tickets: [], unreadable: 0, dirExists: false });
});

test('an empty tickets/ directory is distinguishable from a missing one', () => {
  const root = seed(tmpRoot(), {});
  const r = local.readTickets(root);
  assert.equal(r.dirExists, true);
  assert.equal(r.tickets.length, 0);
});

test('one malformed file is skipped and counted; the rest still load', () => {
  const root = seed(tmpRoot(), {
    'CON-1.md': '---\ntitle: One\nstate: backlog\n---\n\nb\n',
    'CON-2.md': 'no frontmatter here\n',
    'CON-3.md': '---\ntitle: Three\nstate: started\n---\n\nb\n',
  });
  const r = local.readTickets(root);
  assert.equal(r.unreadable, 1);
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-1', 'CON-3']);
});

test('non-markdown files are ignored entirely, not counted as unreadable', () => {
  const root = seed(tmpRoot(), { 'CON-1.md': '---\ntitle: One\nstate: backlog\n---\n\nb\n', 'README.txt': 'hi' });
  assert.equal(local.readTickets(root).unreadable, 0);
});

// --- fetch -----------------------------------------------------------------

test('fetchTickets filters to the open states and sorts numerically', () => {
  const root = seed(tmpRoot(), {
    'CON-10.md': '---\ntitle: Ten\nstate: started\n---\n\nb\n',
    'CON-2.md': '---\ntitle: Two\nstate: backlog\n---\n\nb\n',
    'CON-3.md': '---\ntitle: Three\nstate: completed\n---\n\nb\n',
  });
  const r = local.fetchTickets({ root, teamKey: 'CON', stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-2', 'CON-10']);
  assert.equal(r.teamKey, 'CON');
  assert.equal(r.truncated, false);
  assert.equal(r.pages, 1);
});

test('fetchTickets derives epics, unassigned last', () => {
  const root = seed(tmpRoot(), {
    'CON-1.md': '---\ntitle: One\nstate: backlog\nepic: zeta\n---\n\nb\n',
    'CON-2.md': '---\ntitle: Two\nstate: backlog\n---\n\nb\n',
    'CON-3.md': '---\ntitle: Three\nstate: backlog\nepic: alpha\n---\n\nb\n',
  });
  const r = local.fetchTickets({ root, teamKey: 'CON', stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.deepEqual(r.epics.map((e) => e.name), ['alpha', 'zeta', null]);
});

// --- gate and messages -----------------------------------------------------

test('the launch pad needs only launchPad.enabled and kind local — no api key', () => {
  const cfg = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local' } };
  assert.equal(local.launchPadStatus(cfg, {}).enabled, true);
});

test('the launch pad is off when launchPad.enabled is not true', () => {
  const cfg = { dashboard: { launchPad: {} }, ticketProvider: { kind: 'local' } };
  const s = local.launchPadStatus(cfg, {});
  assert.equal(s.enabled, false);
  assert.equal(s.reason, 'disabled');
});

test('teamKeyFromConfig ignores LINEAR_TEAM_KEY, which is meaningless here', () => {
  const cfg = { ticketProvider: { kind: 'local', teamKey: 'con' } };
  assert.deepEqual(local.teamKeyFromConfig(cfg, { LINEAR_TEAM_KEY: 'NOPE' }), { key: 'CON', source: 'config' });
});

test('teamKeyFromConfig falls back to the idExample prefix', () => {
  const cfg = { ticketProvider: { kind: 'local', idExample: 'abc-123' } };
  assert.deepEqual(local.teamKeyFromConfig(cfg, {}), { key: 'ABC', source: 'idExample' });
});

test('resolveTeam reports whether tickets/ exists', () => {
  assert.deepEqual(local.resolveTeam({ root: tmpRoot() }), { found: false });
  assert.deepEqual(local.resolveTeam({ root: seed(tmpRoot(), {}) }), { found: true });
});

test('the not-found message tells you to create a ticket, not to check a team key', () => {
  const m = local.teamNotFoundMessage('CON');
  assert.match(m, /tickets\//);
  assert.doesNotMatch(m, /teamKey/);
});

test('createTicket rejects — TUI authoring is a later ticket', async () => {
  await assert.rejects(() => local.createTicket({ title: 'x' }), /not supported/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/tickets-local.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/tickets/local'`

- [ ] **Step 3: Write the store**

Create `lib/ui/tickets/local.js`:

```js
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
const { deriveEpics, OPEN_STATE_TYPES } = require('../linear');

const TICKETS_DIR = 'tickets';

// Linear's own `state.type` vocabulary, verbatim. Sharing it is what lets
// stateTypesFromConfig, the `launchPad.backlog: false` dial and every
// downstream state check work identically under both providers.
const STATES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

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
    state: { name: f.state, type: f.state },
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
    let raw;
    let mtimeMs = null;
    try {
      raw = fs.readFileSync(file, 'utf8');
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch (e) {
      unreadable++;
      continue;
    }
    const ticket = parseTicket(name.slice(0, -3), raw, mtimeMs);
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

// The `launchPad.backlog: false` dial means the same thing here, so this is
// linear.js's logic reused rather than reimplemented.
function stateTypesFromConfig(config) {
  const launchPad = (config && config.dashboard && config.dashboard.launchPad) || {};
  if (launchPad.backlog === false) return OPEN_STATE_TYPES.filter((t) => t !== 'backlog');
  return OPEN_STATE_TYPES;
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

module.exports = {
  TICKETS_DIR,
  STATES,
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
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tickets-local.test.js`
Expected: PASS (all 24 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ui/tickets/local.js test/tickets-local.test.js
git commit -m "CON-44 Add the local ticket store

Reads tracked tickets/<ID>.md files and emits exactly the shape linear.js's
normaliseTicket produces, so every consumer downstream of that boundary is
unchanged. Malformed files are skipped per-file and counted rather than
failing the whole read."
```

---

### Task 3: The provider resolver

**Files:**
- Create: `lib/ui/ticket-provider.js`
- Test: `test/ticket-provider.test.js`

**Interfaces:**
- Consumes: everything Task 2 exported, plus `lib/ui/linear.js`'s existing exports.
- Produces: a module exporting `launchPadStatus(config, env)`, `fetchTickets(opts)`, `resolveTeam(opts)`, `teamKeyFromConfig(config, env)`, `stateTypesFromConfig(config)`, `teamNotFoundMessage(config, teamKey)`, `createTicket(opts)`. **Two signatures deliberately differ from `linear.js`'s** so one shape serves both providers:
  - `resolveTeam({ root, apiKey, teamKey })` — object arg, where `linear.js`'s is positional `(transport, apiKey, teamKey)`.
  - `teamNotFoundMessage(config, teamKey)` — takes `config` first so it can dispatch.
  - `fetchTickets` gains a `root` key, which the linear branch ignores.

- [ ] **Step 1: Write the failing test**

Create `test/ticket-provider.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const provider = require('../lib/ui/ticket-provider');
const linear = require('../lib/ui/linear');
const local = require('../lib/ui/tickets/local');

const LINEAR_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'linear', teamKey: 'CON' } };
const LOCAL_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local', teamKey: 'CON' } };

test('launchPadStatus dispatches to linear', () => {
  assert.deepEqual(
    provider.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' }),
    linear.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' })
  );
});

test('launchPadStatus dispatches to local, which needs no api key', () => {
  assert.equal(provider.launchPadStatus(LOCAL_CFG, {}).enabled, true);
});

test('teamKeyFromConfig honours LINEAR_TEAM_KEY under linear but not under local', () => {
  assert.equal(provider.teamKeyFromConfig(LINEAR_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'ZZZ');
  assert.equal(provider.teamKeyFromConfig(LOCAL_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'CON');
});

test('teamNotFoundMessage dispatches on kind', () => {
  assert.match(provider.teamNotFoundMessage(LINEAR_CFG, 'CON'), /teamKey/);
  assert.match(provider.teamNotFoundMessage(LOCAL_CFG, 'CON'), /tickets\//);
});

test('stateTypesFromConfig is shared — the backlog dial means the same thing', () => {
  const off = { ticketProvider: { kind: 'local' }, dashboard: { launchPad: { enabled: true, backlog: false } } };
  assert.deepEqual(provider.stateTypesFromConfig(off), ['unstarted', 'started']);
});

test('resolveTeam takes an object arg and reaches local', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-tp-'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: false });
  fs.mkdirSync(path.join(root, 'tickets'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: true });
});

test('createTicket under local rejects rather than throwing a TypeError', async () => {
  await assert.rejects(() => provider.createTicket(LOCAL_CFG, { title: 'x' }), /not supported/);
});

test('an unknown kind fails loudly rather than silently behaving like linear', () => {
  assert.throws(
    () => provider.launchPadStatus({ ticketProvider: { kind: 'jira' } }, {}),
    /unknown ticketProvider\.kind/
  );
});

test('local.fetchTickets is what the resolver reaches for under local', () => {
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'local' } }), local);
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'linear' } }), linear);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ticket-provider.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/ticket-provider'`

- [ ] **Step 3: Write the resolver**

Create `lib/ui/ticket-provider.js`:

```js
'use strict';

// CON-44: the one place that knows which ticket provider a project uses.
//
// Every call site in the dashboard goes through here instead of requiring
// linear.js directly, so adding a provider is a new module plus a line in
// moduleFor() rather than a `kind` check sprayed across watch.js, draft.js
// and the screens.
//
// linear.js is deliberately NOT moved into a providers/ directory for this
// change: doing so would relocate a 578-line module and every require-cache
// fake in test/watch.test.js for no behavioural gain. Promote when a third
// implementation exists and the interface has been proven by two.
//
// Two signatures here differ from linear.js's own, so that one shape serves
// both providers:
//   - resolveTeam takes ({ root, apiKey, teamKey }) — linear.js's is
//     positional (transport, apiKey, teamKey), and local needs `root`, which
//     that positional shape has nowhere to put.
//   - teamNotFoundMessage takes (config, teamKey) so it can dispatch at all.
// fetchTickets simply gains a `root` key, which the linear branch ignores.

const linear = require('./linear');
const local = require('./tickets/local');

const MODULES = { linear, local };

function moduleFor(config) {
  const kind = ((config || {}).ticketProvider || {}).kind;
  const mod = MODULES[kind];
  // Loud, not silent. A typo'd or not-yet-implemented kind that quietly fell
  // back to linear would present an empty launch pad with no explanation —
  // exactly the failure mode linear.js's own launchPadStatus comment calls
  // out as "a feature the user reports as broken".
  if (!mod) throw new Error('unknown ticketProvider.kind "' + (kind || 'none') + '"');
  return mod;
}

function launchPadStatus(config, env) {
  return moduleFor(config).launchPadStatus(config, env);
}

function teamKeyFromConfig(config, env) {
  return moduleFor(config).teamKeyFromConfig(config, env);
}

function stateTypesFromConfig(config) {
  return moduleFor(config).stateTypesFromConfig(config);
}

function teamNotFoundMessage(config, teamKey) {
  return moduleFor(config).teamNotFoundMessage(teamKey);
}

// `opts` is { root, apiKey, teamKey, stateTypes }. Linear ignores `root`;
// local ignores `apiKey`.
function fetchTickets(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.fetchTickets(opts);
  return Promise.resolve(local.fetchTickets(opts));
}

function resolveTeam(config, opts) {
  const mod = moduleFor(config);
  const o = opts || {};
  if (mod === linear) return linear.resolveTeam(undefined, o.apiKey, o.teamKey);
  return local.resolveTeam(o);
}

function createTicket(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.createTicket(opts);
  return local.createTicket(opts);
}

module.exports = {
  moduleFor,
  launchPadStatus,
  teamKeyFromConfig,
  stateTypesFromConfig,
  teamNotFoundMessage,
  fetchTickets,
  resolveTeam,
  createTicket,
};
```

Note `fetchTickets` wraps the local (synchronous) result in `Promise.resolve` so both branches are awaitable — `watch.js`'s `refreshLaunchPad` awaits it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/ticket-provider.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ui/ticket-provider.js test/ticket-provider.test.js
git commit -m "CON-44 Add the ticket-provider resolver

Dispatches on ticketProvider.kind. resolveTeam and teamNotFoundMessage take
object/config-first args so one shape serves both providers; an unknown kind
throws rather than silently falling back to linear."
```

---

### Task 4: Rename the cache file and bump its schema

**Files:**
- Modify: `lib/ui/cache.js:38` (`CACHE_SCHEMA_VERSION`), `:45` (`cachePath`), `:127` (the temp filename)
- Test: `test/cache.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `cache.cachePath(root)` now returns `<root>/.concertino/cache/tickets.json`. No other export changes shape.

Renaming is what makes the bump free: a pre-existing `linear.json` is simply never read again, and `read()` already treats a missing file as empty. The bump is belt-and-braces for anyone who hand-copies the old file into the new name.

- [ ] **Step 1: Update the failing tests**

In `test/cache.test.js`, change the `seed()` helper's filename and the path assertion:

```js
function seed(root, raw) {
  const dir = path.join(root, '.concertino', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets.json'), raw);
  return root;
}
```

```js
test('the cache lives at .concertino/cache/tickets.json', () => {
  assert.equal(cache.cachePath('/repo'), path.join('/repo', '.concertino', 'cache', 'tickets.json'));
});
```

Then add:

```js
test('a stale linear.json is ignored entirely — the rename is the migration', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.concertino', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'linear.json'), JSON.stringify(
    Object.assign({ schemaVersion: 3, fetchedAt: 1 }, SAMPLE)));
  assert.deepEqual(cache.read(root), { fetchedAt: null, tickets: [], epics: [] });
});

test('a row written at the previous schema version reads as empty', () => {
  const root = seed(tmpRoot(), JSON.stringify(Object.assign({ schemaVersion: 3, fetchedAt: 1 }, SAMPLE)));
  assert.deepEqual(cache.read(root), { fetchedAt: null, tickets: [], epics: [] });
});
```

Search `test/cache.test.js` for every other occurrence of `linear.json` and update it — the file references the name in more than one place.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cache.test.js`
Expected: FAIL — `cachePath` still ends in `linear.json`.

- [ ] **Step 3: Rename and bump**

`lib/ui/cache.js:38`:

```js
// CON-44: bumped again for the linear.json → tickets.json rename. The rename
// itself is the migration — a pre-existing linear.json is simply never read,
// and read() already treats a missing file as empty. The version bump only
// covers someone who hand-copies the old file to the new name.
const CACHE_SCHEMA_VERSION = 4;
```

`lib/ui/cache.js:44-46`:

```js
function cachePath(root) {
  return path.join(cacheDir(root), 'tickets.json');
}
```

`lib/ui/cache.js:127`:

```js
  const tmp = path.join(dir, 'tickets.json.' + process.pid + '.tmp');
```

Also update the header comment at `lib/ui/cache.js:5`, which names the old path:

```js
//   .concertino/cache/tickets.json   { fetchedAt, tickets: [...], epics: [...] }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cache.test.js`
Expected: PASS

- [ ] **Step 5: Check for other references to the old filename**

Run: `grep -rn "linear\.json" lib/ test/ docs/ core/ scripts/ --include='*.js' --include='*.md' --include='*.sh'`
Expected: no hits in `lib/`. Update any doc that names the path.

- [ ] **Step 6: Run the full JS suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/ui/cache.js test/cache.test.js
git commit -m "CON-44 Rename the launch-pad cache to tickets.json

linear.json is misleading once the cache can hold local tickets. The rename is
its own migration: the old file is never read again and read() already treats a
missing file as empty."
```

---

### Task 5: Wire the dashboard to the resolver

**Files:**
- Modify: `lib/ui/watch.js:37` (require), `:156-158` (`teamNotFoundMessage`), `:271`, `:298`, `:306-309` (`openLaunchPad`), `:317-366` (`refreshLaunchPad`), `:447` (deps)
- Modify: `lib/ui/controllers/draft.js:19-30`
- Test: `test/watch.test.js`, `test/launchpad.test.js`

**Interfaces:**
- Consumes: Task 3's resolver.
- Produces: `ctx.deps.linear` continues to exist under that name and now holds the resolver — controllers calling `ctx.deps.linear.teamKeyFromConfig(...)` keep working. Renaming the deps key is deliberately out of scope; it would touch every controller for no behavioural gain.

**The test-fake migration:** `test/watch.test.js` fakes linear via `require.cache[require.resolve('../lib/ui/linear')]` and re-requires `watch.js` fresh. Because the resolver does `require('./linear')` at load time and calls through the module object, **those fakes keep working** — the resolver picks the fake out of `require.cache`. The tests need one addition: `delete require.cache[require.resolve('../lib/ui/ticket-provider')]` beside every existing `delete require.cache[watchPath]`, or a stale resolver holds a stale `linear` across tests.

- [ ] **Step 1: Add the resolver cache-delete to the test harnesses**

In `test/watch.test.js` and `test/launchpad.test.js`, find every place that does `delete require.cache[watchPath]` and add, immediately after it:

```js
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
```

- [ ] **Step 2: Run the suite to confirm it is still green before the swap**

Run: `node --test test/watch.test.js test/launchpad.test.js`
Expected: PASS (the added delete is a no-op until Step 4)

- [ ] **Step 3: Write the failing test**

Append to `test/launchpad.test.js` — adapt the harness/fake helpers to whatever that file already defines rather than inventing new ones:

```js
test('a local project opens the launch pad with no LINEAR_API_KEY', () => {
  const provider = require('../lib/ui/ticket-provider');
  const cfg = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local', teamKey: 'CON' } };
  assert.equal(provider.launchPadStatus(cfg, {}).enabled, true);
});
```

The auto-refresh behaviour is testable without `watch.js`'s harness at all — `openLaunchPad`'s new branch is a two-condition predicate, and the expensive part (that a local fetch needs no network) is already covered by Task 2. Append this to `test/tickets-local.test.js` instead, where it costs nothing:

```js
test('a local fetch is synchronous and needs no network — the reason open can auto-refresh', () => {
  const root = seed(tmpRoot(), { 'CON-1.md': '---\ntitle: One\nstate: backlog\n---\n\nb\n' });
  const before = Date.now();
  const r = local.fetchTickets({ root, teamKey: 'CON', stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.equal(r.tickets.length, 1);
  assert.ok(Date.now() - before < 100, 'a directory read must not be slow enough to need a fetch hint');
});
```

Then, in `test/launchpad.test.js`, assert the predicate itself rather than driving the whole TUI:

```js
test('local auto-refreshes on open; linear does not', () => {
  // Mirrors openLaunchPad's condition in watch.js. Linear keeps the "press r
  // to fetch" hint because a fetch is a network round trip; local has nothing
  // to protect against.
  const shouldAutoRefresh = (cfg) => ((cfg.ticketProvider || {}).kind) === 'local';
  assert.equal(shouldAutoRefresh({ ticketProvider: { kind: 'local' } }), true);
  assert.equal(shouldAutoRefresh({ ticketProvider: { kind: 'linear' } }), false);
});
```

If you would rather drive it end-to-end through `watch.js`'s harness, that is strictly better — build it exactly as the nearest existing launch-pad test in that file does, seed a `tickets/` directory under the fake root, and assert `S.launchPad.cache.fetchedAt !== null` after `openLaunchPad()` settles. Do not leave both.

- [ ] **Step 4: Swap the require and thread `config` + `root` through**

`lib/ui/watch.js:37`:

```js
const linear = require('./ticket-provider');
```

Keep the local binding named `linear`. Renaming it would touch `deps` and every controller that reads `ctx.deps.linear`, which is churn this change does not need. Update the neighbouring header comment at `lib/ui/watch.js:18` to say the fakes now flow through `ticket-provider` into `linear`.

Delete `teamNotFoundMessage` at `lib/ui/watch.js:156-158` — it moves into the provider modules.

`lib/ui/watch.js:298` (inside `ensureLaunchPad`):

```js
        error: initialCache.teamFound === false ? linear.teamNotFoundMessage(config, initialCache.teamKey) : null,
```

`lib/ui/watch.js:306-309`:

```js
  function openLaunchPad() {
    ensureLaunchPad();
    S.mode = 'launchpad';
    // CON-44: a local store is a directory read, not a network round trip, so
    // the "press r to fetch" hint (launchpad.js:317) — which exists to avoid
    // spending a request on open — has nothing to protect against here. Fire
    // and forget, exactly as the `r` handler does.
    if (((config.ticketProvider || {}).kind) === 'local' && S.launchPad.status.enabled) refreshLaunchPad();
  }
```

In `refreshLaunchPad`, update the two provider calls. Every resolver entry point takes `config` first (Task 3), and `fetchTickets`/`resolveTeam` additionally need `root`, which `watch()` already has in scope:

```js
      const result = await linear.fetchTickets(config, {
        root,
        teamKey: team.key,
        apiKey,
        stateTypes: linear.stateTypesFromConfig(config),
      });
```

```js
      let teamFound = true;
      if (result.tickets.length === 0) {
        const resolved = await linear.resolveTeam(config, { root, apiKey, teamKey: team.key });
        teamFound = resolved.found;
        if (!resolved.found) {
          lp.error = linear.teamNotFoundMessage(config, team.key);
        }
      }
```

`launchPadStatus` at `lib/ui/watch.js:271` and `teamKeyFromConfig` at `:323` already pass `config` first and need no edit.

Finally, surface the unreadable count. Immediately after the `teamFound` block in `refreshLaunchPad`:

```js
      // Per-file skips are reported, never swallowed — a board that silently
      // drops two tickets reads as a complete board. In-memory only: under
      // local, openLaunchPad refreshes on every open, so this is always
      // rebuilt rather than needing a cache field of its own.
      if (!lp.error && result.unreadable > 0) {
        lp.error = result.unreadable + ' ticket file(s) unreadable — check frontmatter (title, state, matching id)';
      }
```

- [ ] **Step 5: Update `draft.js`'s gate message**

`lib/ui/controllers/draft.js:24-27` — the gate still admits only `linear`, but the message must stop implying linear is the only supported provider:

```js
      if (provider.kind !== 'linear') {
        if (S.prompt) {
          S.prompt.error = provider.kind === 'local'
            ? 'ticket drafting from the dashboard is not available for local tickets yet — add tickets/<ID>.md by hand'
            : 'ticket drafting needs ticketProvider.kind "linear" — this project uses "' +
              (provider.kind || 'none') + '"';
        }
        return true;
      }
```

Also update the comment at `lib/ui/controllers/draft.js:19` that points at "linear.js's launchPadStatus" to point at `ticket-provider.js` instead.

**And fix the `createTicket` call site**, which would otherwise break the moment `deps.linear` becomes the resolver. `lib/ui/controllers/draft.js:152` currently calls it with a single options object:

```js
      ctx.deps.linear.createTicket({ apiKey, teamKey: team.key, title: draft.title, description: body })
```

The resolver's `createTicket(config, opts)` takes `config` first — called the old way it would dispatch on `undefined` and throw `unknown ticketProvider.kind "none"` on every draft submit. Change it to:

```js
      ctx.deps.linear.createTicket(ctx.config || {}, { apiKey, teamKey: team.key, title: draft.title, description: body })
```

`test/ticketdraft.test.js` fakes this call — update its fake's arity to match, or the assertion on the arguments it received will fail.

- [ ] **Step 6: Run the tests**

Run: `node --test test/watch.test.js test/launchpad.test.js test/draft.test.js test/ticketdraft.test.js`
Expected: PASS. If a fake in `test/watch.test.js` breaks, the cause is almost always a missing `delete require.cache[...ticket-provider]` from Step 1 — check that before changing production code.

- [ ] **Step 7: Run the full JS suite**

Run: `node --test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/ui/watch.js lib/ui/controllers/draft.js test/watch.test.js test/launchpad.test.js
git commit -m "CON-44 Route the dashboard through the ticket-provider resolver

watch.js requires ticket-provider instead of linear; teamNotFoundMessage moves
into the provider modules; the launch pad auto-refreshes under local because a
directory read costs nothing; unreadable ticket files are reported rather than
silently dropped."
```

---

### Task 6: `set-ticket-state.sh`

**Files:**
- Create: `core/scripts/set-ticket-state.sh`
- Create: `test/scripts/set-ticket-state.test.sh`
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: the ticket file format from Task 2.
- Produces: `set-ticket-state.sh <TICKETS_DIR> <TICKET_ID> <state>` → prints `OK <ID> <state>`, exit 0. Exit 1 on a missing file, unknown state, or missing frontmatter `state:` line. Task 7's orchestrator prose calls it.

Taking the tickets directory as an explicit first argument (rather than deriving it) is what makes the script testable against a temp directory, matching how `next-report-number.sh` takes its directory.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/set-ticket-state.test.sh`:

```bash
#!/usr/bin/env bash
# Shell tests for core/scripts/set-ticket-state.sh.
# Run: bash test/scripts/set-ticket-state.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/set-ticket-state.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "set-ticket-state.sh"

seed() {
  D="$(mktemp -d)"
  printf '%s\n' \
    '---' \
    'id: CON-12' \
    'title: A ticket' \
    'state: unstarted' \
    'priority: 2' \
    '---' \
    '' \
    '## Description' \
    '' \
    'Body text with a state: word that must not be rewritten.' \
    > "$D/CON-12.md"
}

# --- happy path -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 started)"; RC=$?
check "valid transition: exit 0"   "$RC"  "0"
check "valid transition: reports"  "$OUT" "OK CON-12 started"
check "valid transition: rewrote frontmatter" \
  "$(grep -c '^state: started$' "$D/CON-12.md")" "1"
check "valid transition: left the body alone" \
  "$(grep -c 'state: word that must not be rewritten' "$D/CON-12.md")" "1"
check "valid transition: title intact" \
  "$(grep -c '^title: A ticket$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- idempotence ------------------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 completed >/dev/null
"$SCRIPT" "$D" CON-12 completed >/dev/null
check "idempotent: one state line" "$(grep -c '^state: ' "$D/CON-12.md")" "1"
check "idempotent: value is completed" "$(grep -c '^state: completed$' "$D/CON-12.md")" "1"
rm -rf "$D"

# --- all five states are accepted -------------------------------------------
seed
ALL_OK=0
for s in backlog unstarted started completed canceled; do
  "$SCRIPT" "$D" CON-12 "$s" >/dev/null 2>&1 || ALL_OK=1
done
check "all five states accepted" "$ALL_OK" "0"
rm -rf "$D"

# --- rejections -------------------------------------------------------------
seed
OUT="$("$SCRIPT" "$D" CON-12 in-review 2>&1)"; RC=$?
check "unknown state: exit 1"       "$RC" "1"
case "$OUT" in *"in-review"*) ok "unknown state: names the bad value";;
  *) bad "unknown state: names the bad value" "got [$OUT]";; esac
check "unknown state: file untouched" "$(grep -c '^state: unstarted$' "$D/CON-12.md")" "1"
rm -rf "$D"

seed
"$SCRIPT" "$D" CON-99 started >/dev/null 2>&1; RC=$?
check "missing ticket: exit 1" "$RC" "1"
rm -rf "$D"

seed
printf '%s\n' 'no frontmatter at all' > "$D/CON-13.md"
"$SCRIPT" "$D" CON-13 started >/dev/null 2>&1; RC=$?
check "no frontmatter: exit 1" "$RC" "1"
rm -rf "$D"

# --- no leftover temp files -------------------------------------------------
seed
"$SCRIPT" "$D" CON-12 started >/dev/null
check "no temp files left behind" "$(find "$D" -name '*.tmp*' | wc -l | tr -d ' ')" "0"
rm -rf "$D"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/scripts/set-ticket-state.test.sh`
Expected: FAIL — the script does not exist.

- [ ] **Step 3: Write the script**

Create `core/scripts/set-ticket-state.sh` (and `chmod +x` it):

```bash
#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# set-ticket-state.sh — set a local ticket's state.
#
# CON-44. The status write-back seam for ticketProvider.kind "local": the
# orchestrator under that provider has Bash and no MCP tools, and this repo
# puts every state mutation behind a canonical script rather than letting an
# agent hand-roll it (see emit-event.sh, persist-evidence.sh).
#
# Usage:
#   set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>
#
# <state> is one of: backlog unstarted started completed canceled
# — Linear's own state.type vocabulary, shared so both providers agree.
#
# Rewrites ONLY the `state:` line inside the leading `---` frontmatter block.
# A `state:` occurring in the body is never touched. Writes via a temp file
# and rename so a crash mid-write leaves the previous file intact, the same
# discipline lib/ui/cache.js#write uses.
#
# Exit 0 with `OK <id> <state>` on success; exit 1 with a message on stderr
# for a missing file, an unknown state, or a file with no frontmatter
# `state:` line to rewrite. The orchestrator treats a non-zero exit exactly
# as it treats any other FAIL -> BLOCKER.
# ===========================================================================

STATES="backlog unstarted started completed canceled"

die() { echo "set-ticket-state: $*" >&2; exit 1; }

[ "$#" -eq 3 ] || die "usage: set-ticket-state.sh <tickets-dir> <TICKET_ID> <state>"

DIR="$1"
ID="$2"
STATE="$3"

case " $STATES " in
  *" $STATE "*) ;;
  *) die "unknown state \"$STATE\" — expected one of: $STATES" ;;
esac

FILE="$DIR/$ID.md"
[ -f "$FILE" ] || die "no ticket at $FILE"

# The frontmatter block is the text between the first line (which must be
# `---`) and the next `---`. Everything after it is body and is copied
# through untouched.
head -n 1 "$FILE" | grep -qx -- '---' || die "$FILE has no frontmatter block"

TMP="$FILE.$$.tmp"
FOUND=0

{
  # Line 1 is the opening ---, emitted as-is.
  IFS= read -r line || true
  printf '%s\n' "$line"

  # Frontmatter: rewrite `state:`, stop at the closing ---.
  while IFS= read -r line; do
    if [ "$line" = "---" ]; then
      printf '%s\n' "$line"
      break
    fi
    case "$line" in
      state:*) printf 'state: %s\n' "$STATE"; FOUND=1 ;;
      *)       printf '%s\n' "$line" ;;
    esac
  done

  # Body: verbatim.
  cat
} < "$FILE" > "$TMP"

# FOUND is set in the same subshell-free block above, but the `{ } < f > t`
# grouping keeps it in this shell, so it is readable here.
if [ "$FOUND" -ne 1 ]; then
  rm -f "$TMP"
  die "$FILE has no frontmatter \"state:\" line to set"
fi

mv "$TMP" "$FILE" || { rm -f "$TMP"; die "could not replace $FILE"; }

echo "OK $ID $STATE"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/scripts/set-ticket-state.test.sh`
Expected: `14 passed, 0 failed` (count the `check`/`ok` calls if you add cases — the trailing `[ "$FAIL" -eq 0 ]` is the real gate)

If `FOUND` reads as `0` after the block despite a `state:` line being rewritten, the `{ ... }` grouping has been turned into a subshell somewhere — verify there is no pipe into the block.

- [ ] **Step 5: Wire the test into `package.json`**

Append ` && bash test/scripts/set-ticket-state.test.sh` to the end of `scripts.test` in `package.json`. A bash suite that is not listed there never runs.

- [ ] **Step 6: Verify the sync path picks the script up**

`concertino sync` renders `core/scripts/*` into `scripts/concertino/`. Confirm the new script is copied and stays executable:

Run: `node bin/concertino sync --out=/tmp/concertino-selftest --config=config/examples/helio.json --dry-run`
Expected: the dry-run output lists `scripts/concertino/set-ticket-state.sh`. If it does not, find the file list `sync` iterates over in `lib/cli/emit.js` and add it there.

- [ ] **Step 7: Commit**

```bash
git add core/scripts/set-ticket-state.sh test/scripts/set-ticket-state.test.sh package.json
git commit -m "CON-44 Add set-ticket-state.sh

Canonical status write-back for local tickets. Rewrites only the frontmatter
state: line, never a state: in the body, via temp-file + rename."
```

---

### Task 7: Orchestrator prose, docs, and the openspec spec

**Files:**
- Modify: `lib/cli/render.js:139-144`
- Modify: `openspec/specs/ticket-draft/spec.md:33-42`
- Modify: `docs/config-reference.md:126`, `docs/adapting-to-your-project.md:44`, `ROADMAP.md:11`
- Test: `test/scripts/local-provider-render.test.sh` (new)

**Interfaces:**
- Consumes: Task 6's script path and argument order; Task 1's `local` kind.
- Produces: nothing later tasks depend on. This is the last task.

- [ ] **Step 1: Write the failing render test**

Create `test/scripts/local-provider-render.test.sh`:

```bash
#!/usr/bin/env bash
# CON-44: `ticketProvider.kind: "local"` renders orchestrator prose that points
# at tickets/<ID>.md and set-ticket-state.sh, and grants no Linear MCP tools.
# Run: bash test/scripts/local-provider-render.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()     { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()    { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()    { grep -qF "$2" "$3" 2>/dev/null && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt()  { grep -qF "$2" "$3" 2>/dev/null && bad "$1" "expected NOT to find [$2] in $3" || ok "$1"; }

echo "local ticket provider rendering (CON-44)"

OUT="$(mktemp -d)"
CFG="$OUT/concertino.config.json"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], JSON.stringify({
    harnesses: ["claude-code"],
    project: { name: "fixture-project", baseBranch: "main" },
    ticketProvider: { kind: "local", idExample: "CON-1", teamKey: "CON" },
    specProvider: { kind: "none" },
    worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
    gates: [{ name: "test", when: "always", command: "true" }],
  }, null, 2));
' _ "$CFG"

node "$ROOT/bin/concertino" sync --out="$OUT" --config="$CFG" > "$OUT/sync.txt" 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "sync exits zero" || bad "sync exits zero" "exit $RC:
$(cat "$OUT/sync.txt")"

ORCH="$OUT/.claude/agents/concertino-orchestrator.md"
[ -f "$ORCH" ] && ok "renders the orchestrator agent" || bad "renders the orchestrator agent" "missing $ORCH"

has   "names the ticket file"        'tickets/$TICKET_ID.md'   "$ORCH"
has   "names the write-back script"  'set-ticket-state.sh'     "$ORCH"
has   "keeps the no-store fallback"  'provided inline'         "$ORCH"
hasnt "grants no Linear MCP tools"   'mcp__linear__'           "$ORCH"

# The degenerate case must survive: a local project with no tickets/ directory
# behaves exactly as the old `manual` kind did.
has   "tells the agent to skip status updates when the file is absent" \
      'skip status updates' "$ORCH"

rm -rf "$OUT"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
```

If `sync` rejects the fixture config, run `node bin/concertino validate --config="$CFG"` by hand and add whatever required key it names — `config/examples/*.json` are the reference for a complete config.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash test/scripts/local-provider-render.test.sh`
Expected: FAIL — the `local` case renders as `''` today, so none of the strings are present.

- [ ] **Step 3: Replace the `manual` case in `render.js`**

`lib/cli/render.js:139-144`:

```js
    case 'ticketProvider':
      return {
        linear: 'Use the Linear MCP: `mcp__linear__get_issue` to fetch, `mcp__linear__save_issue` to set status, `mcp__linear__save_comment` to comment.',
        github: 'Use the GitHub MCP: `mcp__github__get_issue` to fetch (number, title, body, labels); `mcp__github__create_issue_comment` to comment; `mcp__github__update_issue` to set labels (use a label like `in-progress` / `done` to track status). For PR creation use `gh pr create` via Bash as normal.',
        local: 'No external ticket system. The ticket lives at `tickets/$TICKET_ID.md` — read it for title, description and acceptance criteria, and read its frontmatter `labels` for the `harness:` override check below. Set status with `scripts/concertino/set-ticket-state.sh tickets "$TICKET_ID" <backlog|unstarted|started|completed|canceled>` — `started` here in Setup, `completed` at cleanup. There is no comment thread, so skip the "post a closing comment" and "post the PR link back to the ticket" steps entirely; the PR URL is already recorded by the `emit-event.sh ... url=` call you make anyway. **If `tickets/$TICKET_ID.md` does not exist**, the ticket text is provided inline or in the change dir `ticket.md` and you skip status updates entirely.'
      }[c.ticketProvider.kind] || '';
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `bash test/scripts/local-provider-render.test.sh`
Expected: PASS

- [ ] **Step 5: Wire it into `package.json`**

Append ` && bash test/scripts/local-provider-render.test.sh` to `scripts.test`.

- [ ] **Step 6: Amend the openspec spec**

`openspec/specs/ticket-draft/spec.md`, the "Ticket provider gating" requirement — replace the `github`/`manual` scenario:

```markdown
#### Scenario: Non-Linear provider
- **WHEN** `ticketProvider.kind` is `github` and the human submits free text
  at the `n` prompt
- **THEN** the prompt shows the same "not available for this provider"
  treatment the launch pad (`N` screen) already uses for a non-Linear
  provider, and no draft flow opens

#### Scenario: Local provider
- **WHEN** `ticketProvider.kind` is `local` and the human submits free text
  at the `n` prompt
- **THEN** the prompt explains that dashboard drafting is not available for
  local tickets yet and points at `tickets/<ID>.md`, and no draft flow opens
```

- [ ] **Step 7: Update the docs**

`docs/config-reference.md:126`:

```markdown
| `kind` | `"linear"` \| `"github"` \| `"local"` | Selects how the orchestrator fetches the ticket and sets status, and which tools the agents are granted. `linear` → Linear MCP tools; `github` → `gh` CLI; `local` → tracked markdown files under `tickets/`, status set via `scripts/concertino/set-ticket-state.sh`. The former `"manual"` is deprecated and reads as `"local"`; a project with no `tickets/` directory behaves exactly as `manual` did. |
```

`docs/adapting-to-your-project.md:44`:

```markdown
| `ticketProvider.kind` | `linear` \| `github` \| `local` — how the orchestrator fetches the ticket and sets status. Sets the MCP/CLI tools the agents get. |
```

`ROADMAP.md:11` — replace `linear/github/manual` with `linear/github/local`.

Then add a `## Local tickets` section to `docs/config-reference.md` under the `ticketProvider` heading documenting: the file location, the frontmatter fields and their accepted values (copy the table from the design doc's Decision 4), that the filename is authoritative, and that the directory is tracked in git on purpose.

- [ ] **Step 8: Run the full suite**

Run: `node --test`
Expected: PASS

Run: `npm test`
Expected: PASS — including both new bash suites. If the permission classifier blocks `npm test` in your environment, run each `bash test/scripts/*.test.sh` individually and report which, if any, could not be run.

- [ ] **Step 9: Commit**

```bash
git add lib/cli/render.js test/scripts/local-provider-render.test.sh package.json \
  openspec/specs/ticket-draft/spec.md docs/config-reference.md \
  docs/adapting-to-your-project.md ROADMAP.md
git commit -m "CON-44 Render local-provider orchestrator prose and document it

The local case tells the orchestrator to read tickets/\$TICKET_ID.md and set
status via set-ticket-state.sh, and keeps the old manual behaviour as the
explicit no-store fallback."
```

---

## Verification

After Task 7, the whole slice is verifiable by hand:

1. `mkdir tickets && cat > tickets/CON-1.md` with the Decision 4 frontmatter, `state: unstarted`.
2. Set `ticketProvider.kind` to `local` and `dashboard.launchPad.enabled` to `true` in `concertino.config.json`.
3. `node bin/concertino sync` — confirm `.claude/agents/concertino-orchestrator.md` names `tickets/$TICKET_ID.md` and grants no `mcp__linear__` tools.
4. `node bin/concertino watch`, press `N` — the launch pad opens already populated, with no `LINEAR_API_KEY` set and no `r` keypress.
5. `scripts/concertino/set-ticket-state.sh tickets CON-1 started` — re-open the launch pad and confirm the state moved.
6. `mv tickets tickets.off` — re-open and confirm the "no tickets/ directory" hint, not a crash.
