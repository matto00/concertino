# Fleet Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a driver session's concertino lanes in a docked Claude Code pane, fed by a new read-only `concertino fleet --json` snapshot.

**Architecture:** A new CLI subcommand folds `.concertino/runs/*/events.jsonl` with the existing pure reducer and prints one JSON snapshot. A Claude Code mod (the repo root is already the plugin) polls that command every 2 s, correlates runs with the session's `Agent` calls for liveness, keeps the result in `$.state`, and draws a pane plus a status line. Pure logic (`lanes.ts`, `render.tsx`) is separated from the hooks module so both halves are unit-testable.

**Tech Stack:** Node ≥ 16 CommonJS for the CLI (zero deps, `node --test`); TypeScript/TSX ES module for the mod against the `claude-code` function-hooks API (`claude plugin validate`, `claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-06-fleet-pane-design.md`

## Global Constraints

- Zero runtime dependencies; Node `>=16`; no build step, no lint/format tooling (CONTRIBUTING.md).
- `npm test` is the only gate: `node --test` over `test/*.test.js` plus every `test/scripts/*.test.sh` listed explicitly in `package.json`.
- The CLI subcommand **never writes** under `.concertino/`; the mod is **strictly read-only** (no `fs.write`, no `tool.call`/`prompt.*` hooks; `claude plugin validate .` lists no gating hooks).
- Poll interval 2000 ms; CLI timeout 5000 ms; `ticket_doc.excerpt` ≤ 1024 chars; `timeline` ≤ 20 events per run; detail pane shows last 8 timeline rows and first 8 excerpt lines.
- Lane order: `needs-you`, then `running`/`unknown`, then `failed`; `done` excluded by default.
- Liveness vocabulary: `running | external | stalled | ended`.
- Hooks modules are ES modules; a file of the plugin is imported with a relative `import`; no `require`, no `import()`.
- Every `$.state` key the module names must be declared in `types/index.d.ts` under `interface PluginState { concertino: … }`.
- Inline code comments cite the ticket when one exists (`// CON-nnn: …`); none is assigned yet, so comments reference the spec path instead.

## Review Focus

Inputs the spec implies but no acceptance line names; each has a test pinned to the task that owns the code:

1. **A worktree cwd.** `concertino fleet` run from `.concertino/worktrees/<type>/<change>/<T>` must find the *main* checkout's runs, not look for `.concertino/runs` inside the worktree. → Task 1 test "resolves the main checkout from a worktree".
2. **An `escalation.raised` with `options` absent and `sub_questions` set.** The reducer yields `options: []` and `subQuestions: [...]`; the pane must render the sub-question blocks and not an empty `a)` line. → Task 7 test "renders sub-questions when options are empty".
3. **Two `Agent` calls for the same ticket** (the driver re-drove a failed lane). The newest call's `agentId` must win; the stale one's `completed` status must not mark the lane `stalled`. → Task 5 test "newest Agent call wins for a ticket".
4. **`concertino` exits 0 but prints nothing** (e.g. a wrapper script swallowing output). `JSON.parse('')` throws; the mod must record an error and keep the previous lanes, not crash the timer. → Task 4 test "empty stdout is an error, lanes are kept".
5. **A pane narrower than a lane row.** With `bodyColumns` of 40 every row must still be a single truncated line (no wrap pushing rows off-screen). → Task 7 test "truncates every row to bodyColumns".

---

## File map

| Path | Responsibility |
|---|---|
| `lib/cli/fleet.js` (new) | `cmdFleet(args)`: root resolution, snapshot building (`buildSnapshot`), table/JSON output |
| `bin/concertino` (modify) | dispatch `fleet` |
| `lib/cli/help.js` (modify) | `USAGE.fleet`, `USAGE_ORDER` |
| `test/cli-fleet.test.js` (new) | snapshot unit tests + one subprocess smoke test |
| `hooks/hooks.json` (new) | names the module |
| `hooks/fleet-pane/snapshot.ts` (new) | `runFleetSnapshot($, cwd)`: process call, parse, typed result; `fingerprint(lanes)` |
| `hooks/fleet-pane/lanes.ts` (new) | pure: `correlate(runs, agents, messages) → Lane[]`, `orderLanes`, `summarize` |
| `hooks/fleet-pane/render.tsx` (new) | pure: `renderPane(els, model) → tree`, `phaseBar`, `truncate`, `fmtElapsed` |
| `hooks/fleet-pane/register.tsx` (new) | hooks: `session.start`, `command.run`, `ui.render`; the poll (`refresh`) |
| `hooks/fleet-pane/{lanes,render,refresh}.test.ts` (new) | `claude plugin test .` |
| `types/index.d.ts` (new) | `Run`, `Snapshot`, `Lane`, `FleetState`; `PluginState.concertino` |
| `.claude-plugin/plugin.json` (modify) | `"types": "./types/index.d.ts"` |
| `tsconfig.json` (new, repo root) | type-checks `hooks/` + `types/` (extends the engine-written one when present) |
| `package.json` (modify) | `files` += `hooks/`, `types/`; `test` += plugin validate/test runner |
| `test/scripts/plugin-mod.test.sh` (new) | runs `claude plugin validate .` + `claude plugin test .`; skips when `claude` is absent |
| `docs/dashboard.md` (modify) | "Fleet pane (Claude Code)" section |
| `openspec/changes/fleet-pane/…` (new) | proposal, design pointer, spec delta for `fleet-snapshot-cli` |

Tasks 1–3 are PR 1 (`concertino fleet`). Tasks 4–10 are PR 2 (the mod).

---

### Task 1: `buildSnapshot` — fold runs into the JSON contract

**Files:**
- Create: `lib/cli/fleet.js`
- Test: `test/cli-fleet.test.js`

**Interfaces:**
- Consumes: `store.listTickets/readAll/readAnswerFileRaw/runDir` (`lib/ui/store.js`), `reduce` + `PHASE_ORDER` (`lib/ui/reducer.js`), `isTerminalRunEnd` (`lib/ui/run-terminal.js`).
- Produces: `buildSnapshot(root, { now, all }) → { generatedAt, root, runs }` and `resolveRoot(cwdOrOut, { execFileSync }) → string`. Each run is the reducer's `Run` plus `ticket_doc`, `pendingAnswer`, `timeline`, `currentAgent`. Task 2 wraps these in `cmdFleet`; Task 4's `snapshot.ts` types mirror this shape exactly.

- [ ] **Step 1: Write the failing tests for the fold**

```js
// test/cli-fleet.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./support/tmp');
const fleet = require('../lib/cli/fleet');

// `concertino fleet` (docs/superpowers/specs/2026-10-06-fleet-pane-design.md):
// a read-only JSON snapshot of .concertino/runs for the Claude Code fleet
// pane. buildSnapshot is the pure-ish core (fs reads, no writes); the CLI
// wrapper is exercised once as a subprocess at the bottom of this file.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const T0 = 1_700_000_000_000;

function writeRun(root, ticket, events, extra = {}) {
  const dir = path.join(root, '.concertino', 'runs', ticket);
  fs.mkdirSync(dir, { recursive: true });
  const lines = events.map((e, i) => JSON.stringify({
    t: T0 + i * 1000, project: 'p', ticket, role: 'script', ...e,
  }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n') + '\n');
  if (extra.ticketMd != null) {
    fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'ticket.md'), extra.ticketMd);
  }
  if (extra.answer != null) {
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(extra.answer));
  }
  return dir;
}

const START = { kind: 'run.start', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', harness: 'claude-code' };

test('buildSnapshot: live run carries reducer fields plus ticket_doc, pendingAnswer, timeline, currentAgent', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [
    START,
    { kind: 'phase.enter', phase: 'Execution', cycle: 1 },
    { kind: 'agent.spawn', agent: 'executor', cycle: 1 },
    { kind: 'gate.result', gate: 'phase:setup', status: 'pass', duration_ms: 10 },
  ], { ticketMd: '# Add the thing\n\nBody line one.\nBody line two.\n' });

  const snap = fleet.buildSnapshot(root, { now: T0 + 60_000 });
  assert.equal(snap.root, root);
  assert.equal(typeof snap.generatedAt, 'number');
  assert.equal(snap.runs.length, 1);
  const run = snap.runs[0];
  assert.equal(run.ticket, 'CON-1');
  assert.equal(run.phase, 'Execution');
  assert.equal(run.cycle, 1);
  assert.equal(run.changeName, 'thing');
  assert.equal(run.status, 'unknown');            // no tmux windows: liveness is the mod's job
  assert.deepEqual(run.ticket_doc, { title: 'Add the thing', excerpt: 'Body line one.\nBody line two.' });
  assert.equal(run.pendingAnswer, null);
  assert.equal(run.currentAgent, 'executor');
  assert.equal(run.timeline.length, 4);
  assert.deepEqual(run.timeline[1], { t: T0 + 1000, kind: 'phase.enter', phase: 'Execution', cycle: 1 });
  assert.deepEqual(run.timeline[3], { t: T0 + 3000, kind: 'gate.result', gate: 'phase:setup', status: 'pass' });
});

test('buildSnapshot: ticket_doc is null fields when evidence/ticket.md is missing; excerpt is capped at 1024 chars', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  writeRun(root, 'CON-2', [START], { ticketMd: '# Big\n' + 'x'.repeat(5000) });
  const byTicket = Object.fromEntries(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].ticket_doc, { title: null, excerpt: null });
  assert.equal(byTicket['CON-2'].ticket_doc.title, 'Big');
  assert.equal(byTicket['CON-2'].ticket_doc.excerpt.length, 1024);
});

test('buildSnapshot: pendingAnswer passes answer.json through, single and multi-part', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START], { answer: { answer: 'b' } });
  writeRun(root, 'CON-2', [START], { answer: { subAnswers: ['a', null], total: 2, complete: false } });
  const byTicket = Object.fromEntries(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].pendingAnswer, { answer: 'b' });
  assert.deepEqual(byTicket['CON-2'].pendingAnswer, { subAnswers: ['a', null], total: 2, complete: false });
});

test('buildSnapshot: timeline keeps the last 20 events and only whitelisted fields', () => {
  const root = mkTmpDir('concertino-fleet-');
  const events = [START];
  for (let i = 0; i < 30; i++) events.push({ kind: 'gate.result', gate: 'g' + i, status: 'pass', first_error: 'noise' });
  writeRun(root, 'CON-1', events);
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.timeline.length, 20);
  assert.equal(run.timeline[19].gate, 'g29');
  assert.equal(run.timeline[19].first_error, undefined);
});

test('buildSnapshot: done runs are excluded by default and included with all:true', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'delivered' }]);
  writeRun(root, 'CON-2', [START]);
  assert.deepEqual(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => r.ticket), ['CON-2']);
  assert.deepEqual(
    fleet.buildSnapshot(root, { now: T0, all: true }).runs.map((r) => r.ticket).sort(),
    ['CON-1', 'CON-2'],
  );
});

test('buildSnapshot: a failed run (run.end status != delivered) stays in the default view', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'abandoned-stale' }]);
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.status, 'failed');
});

test('buildSnapshot: no .concertino/runs directory yields runs: []', () => {
  const root = mkTmpDir('concertino-fleet-');
  assert.deepEqual(fleet.buildSnapshot(root, { now: T0 }).runs, []);
});

test('buildSnapshot: a malformed events.jsonl line is skipped, not thrown', () => {
  const root = mkTmpDir('concertino-fleet-');
  const dir = writeRun(root, 'CON-1', [START]);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{not json\n');
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.malformed, 1);
});

test('resolveRoot: resolves the main checkout from a worktree', () => {
  const root = mkTmpDir('concertino-fleet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const wt = path.join(root, '.concertino', 'worktrees', 'feature', 'thing', 'CON-1');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: root });
  assert.equal(fs.realpathSync(fleet.resolveRoot(wt)), fs.realpathSync(root));
});

test('resolveRoot: outside a git repo returns the directory itself', () => {
  const dir = mkTmpDir('concertino-fleet-');
  assert.equal(fleet.resolveRoot(dir), dir);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cli-fleet.test.js`
Expected: FAIL — `Cannot find module '../lib/cli/fleet'`.

- [ ] **Step 3: Implement `lib/cli/fleet.js` (core only; `cmdFleet` arrives in Task 2)**

```js
'use strict';

// `concertino fleet` — a read-only snapshot of .concertino/runs for the Claude
// Code fleet pane (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
// Folds every run with lib/ui/reducer.js exactly as the dashboard does, but
// with NO tmux windows: liveness for driver-session lanes is the mod's job
// (it correlates runs with the session's own Agent calls), so a live run here
// reads `unknown` (or `needs-you` with an open escalation). Never writes.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('../ui/store');
const { reduce } = require('../ui/reducer');

const EXCERPT_MAX = 1024;
const TIMELINE_MAX = 20;
// Fields a timeline entry keeps besides {t, kind}: enough for the pane's
// TIMELINE block, nothing that can carry a large payload (context, first_error).
const TIMELINE_FIELDS = ['phase', 'cycle', 'agent', 'role', 'verdict', 'gate', 'status', 'url', 'label'];

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

function readTicketDoc(root, ticket) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(store.runDir(root, ticket), 'evidence', 'ticket.md'), 'utf8');
  } catch (e) {
    return { title: null, excerpt: null };
  }
  const lines = raw.split('\n');
  const headingAt = lines.findIndex((l) => /^#\s+/.test(l));
  const title = headingAt >= 0 ? lines[headingAt].replace(/^#\s+/, '').trim() : null;
  const body = lines.slice(headingAt >= 0 ? headingAt + 1 : 0).join('\n').trim();
  return { title, excerpt: body ? body.slice(0, EXCERPT_MAX) : null };
}

function readPendingAnswer(root, ticket) {
  // readAnswerFileRaw is not exported; the same defensive read inline.
  try {
    return JSON.parse(fs.readFileSync(store.answerPath(root, ticket), 'utf8'));
  } catch (e) {
    return null;
  }
}

function timelineOf(events) {
  return events.slice(-TIMELINE_MAX).map((ev) => {
    const row = { t: ev.t, kind: ev.kind };
    for (const f of TIMELINE_FIELDS) if (ev[f] != null) row[f] = ev[f];
    return row;
  });
}

function currentAgentOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if ((ev.kind === 'agent.spawn' || ev.kind === 'agent.resume') && ev.agent) return ev.agent;
  }
  return null;
}

function buildSnapshot(root, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const runs = reduce(store.readAll(root), [], now)
    .filter((run) => opts.all || run.status !== 'done')
    .map((run) => {
      const events = run.events;
      // `events` is the full fold input and can be large; the snapshot ships
      // the bounded timeline instead.
      const { events: _dropped, ...rest } = run;
      return {
        ...rest,
        ticket_doc: readTicketDoc(root, run.ticket),
        pendingAnswer: readPendingAnswer(root, run.ticket),
        timeline: timelineOf(events),
        currentAgent: currentAgentOf(events),
      };
    });
  return { generatedAt: now, root, runs };
}

module.exports = { buildSnapshot, resolveRoot, readTicketDoc, EXCERPT_MAX, TIMELINE_MAX };
```

Check first that `store.answerPath` is exported (it is: `module.exports` in `lib/ui/store.js` lists `answerPath`). Node 16 supports object rest in destructuring.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/cli-fleet.test.js`
Expected: all `buildSnapshot`/`resolveRoot` tests PASS. (The subprocess test is added in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add lib/cli/fleet.js test/cli-fleet.test.js
git commit -m "Add buildSnapshot for concertino fleet

Folds .concertino/runs with the dashboard reducer (no tmux windows) and adds
ticket_doc, pendingAnswer, a bounded timeline and currentAgent per run."
```

---

### Task 2: `cmdFleet` — CLI wrapper, dispatch, help

**Files:**
- Modify: `lib/cli/fleet.js` (add `cmdFleet`, `renderTable`)
- Modify: `bin/concertino` (header comment + dispatch)
- Modify: `lib/cli/help.js` (`USAGE.fleet`, `USAGE_ORDER`)
- Test: `test/cli-fleet.test.js` (append)

**Interfaces:**
- Consumes: `buildSnapshot`, `resolveRoot` (Task 1); `hasHelpFlag`, `resolveOut`, `dim`, `yellow`, `red` from `lib/cli/shared.js`; `printUsage` from `lib/cli/help.js`.
- Produces: `concertino fleet [--json] [--all] [--out=DIR]` on stdout; exit 0 with `runs: []` when there is nothing. `cmdFleet(args)` is `async` for symmetry with the other `await`ed commands.

- [ ] **Step 1: Write the failing tests**

Append to `test/cli-fleet.test.js`:

```js
function runFleet(cwd, args) {
  try {
    const out = execFileSync('node', [BIN, 'fleet'].concat(args), { cwd, encoding: 'utf8' });
    return { out, status: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  }
}

test('cmdFleet --json: prints the snapshot for the cwd root and exits 0', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'phase.enter', phase: 'Planning', cycle: 1 }]);
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  const snap = JSON.parse(out);
  assert.equal(snap.runs[0].ticket, 'CON-1');
  assert.equal(snap.runs[0].phase, 'Planning');
});

test('cmdFleet --json: empty root prints runs: [] and exits 0', () => {
  const root = mkTmpDir('concertino-fleet-');
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(out).runs, []);
});

test('cmdFleet (table): one line per run with ticket, status, phase, cycle, gates', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [
    START,
    { kind: 'phase.enter', phase: 'Execution', cycle: 2 },
    { kind: 'gate.result', gate: 'a', status: 'pass' },
    { kind: 'gate.result', gate: 'b', status: 'fail' },
  ]);
  const { out, status } = runFleet(root, []);
  assert.equal(status, 0);
  assert.match(out, /CON-1\s+unknown\s+Execution\s+c2\s+1\/2/);
});

test('cmdFleet: --out=DIR overrides the cwd', () => {
  const root = mkTmpDir('concertino-fleet-');
  const elsewhere = mkTmpDir('concertino-fleet-cwd-');
  writeRun(root, 'CON-9', [START]);
  const { out } = runFleet(elsewhere, ['--json', '--out=' + root]);
  assert.equal(JSON.parse(out).runs[0].ticket, 'CON-9');
});

test('cmdFleet --help prints the usage block', () => {
  const { out, status } = runFleet(process.cwd(), ['--help']);
  assert.equal(status, 0);
  assert.match(out, /concertino fleet/);
  assert.match(out, /--json/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/cli-fleet.test.js`
Expected: the five `cmdFleet` tests FAIL (unknown subcommand prints `help()`; `--json` output is not JSON).

- [ ] **Step 3: Add `renderTable` and `cmdFleet` to `lib/cli/fleet.js`**

Add after `buildSnapshot`, and extend `module.exports`:

```js
const { hasHelpFlag, resolveOut, dim, yellow, red } = require('./shared');
const { printUsage } = require('./help');

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

async function cmdFleet(args) {
  if (hasHelpFlag(args)) { printUsage('fleet'); return; }
  const root = resolveRoot(resolveOut(args));
  const snapshot = buildSnapshot(root, { all: !!args.all });
  if (args.json) {
    process.stdout.write(JSON.stringify(snapshot) + '\n');
    return;
  }
  console.log(renderTable(snapshot));
}

module.exports = { cmdFleet, buildSnapshot, resolveRoot, readTicketDoc, renderTable, EXCERPT_MAX, TIMELINE_MAX };
```

Note `require('./help')` at module top would be circular only if `help.js` required `fleet.js`; it does not. Keep both `require`s at the top of the file with the others.

- [ ] **Step 4: Wire dispatch in `bin/concertino`**

In the header comment, after the `answer` usage line add:
```
 *   concertino fleet [--json] [--all] [--out=DIR]
```
After `const { cmdReport } = require('../lib/cli/report');` add:
```js
const { cmdFleet } = require('../lib/cli/fleet');
```
After the `report` dispatch line add:
```js
    else if (cmd === 'fleet')      await cmdFleet(args);
```

- [ ] **Step 5: Add the usage block to `lib/cli/help.js`**

After the `report:` entry in `USAGE`, add:

```js
  fleet: `  ${cyan('concertino fleet')} ${dim('[--json] [--all] [--out=DIR]')}
      Read-only snapshot of every active run under .concertino/runs: ticket,
      status, phase, cycle, gates, elapsed, current agent. Runs with a
      terminal run.end are hidden unless ${dim('--all')}. Never writes.
      ${dim('--json')} prints the full snapshot (the reducer's run model plus
      ticket_doc, pendingAnswer, a 20-event timeline and currentAgent) — the
      feed for the Claude Code fleet pane. Resolves the main checkout from a
      worktree cwd, so it works from inside a run's worktree too.`,
```

And add `'fleet'` to `USAGE_ORDER` after `'report'`.

- [ ] **Step 6: Run the tests**

Run: `node --test test/cli-fleet.test.js && node --test test/cli-help-flags.test.js`
Expected: PASS. (`cli-help-flags.test.js` asserts help parity; if it enumerates commands, add `fleet` where it lists them.)

- [ ] **Step 7: Run the full suite**

Run: `npm test 2>&1 | tail -15`
Expected: all pass. The `completion` test may enumerate subcommands — if `test/completion.test.js` fails, add `fleet` to the subcommand list in `lib/cli/completion.js` the same way `report` appears there.

- [ ] **Step 8: Commit**

```bash
git add lib/cli/fleet.js bin/concertino lib/cli/help.js test/cli-fleet.test.js lib/cli/completion.js
git commit -m "Add concertino fleet subcommand

Table and --json views over buildSnapshot; --all includes done runs; --out
overrides the cwd; worktree cwd resolves to the main checkout."
```

---

### Task 3: OpenSpec change + docs for the CLI (closes PR 1)

**Files:**
- Create: `openspec/changes/fleet-pane/proposal.md`, `openspec/changes/fleet-pane/design.md`, `openspec/changes/fleet-pane/tasks.md`, `openspec/changes/fleet-pane/specs/fleet-snapshot-cli/spec.md`
- Modify: `docs/dashboard.md` (after the "Where the data lives" section)

**Interfaces:** none (documentation).

- [ ] **Step 1: Look at an archived change for the exact frontmatter/format**

Run: `ls openspec/changes/archive | tail -3 && cat openspec/changes/archive/$(ls openspec/changes/archive | tail -1)/specs/*/spec.md | head -40`
Match the `## ADDED Requirements` / `### Requirement:` / `#### Scenario:` structure you see.

- [ ] **Step 2: Write `specs/fleet-snapshot-cli/spec.md`**

```markdown
## ADDED Requirements

### Requirement: Fleet snapshot command
The CLI SHALL provide `concertino fleet [--json] [--all] [--out=DIR]` that reads `.concertino/runs/*/events.jsonl` under the resolved main checkout and prints every run folded by the dashboard reducer, with no tmux window data. The command SHALL NOT write any file or emit any event.

#### Scenario: JSON snapshot
- **WHEN** `concertino fleet --json` runs in a repo with active runs
- **THEN** stdout is one JSON object `{ generatedAt, root, runs[] }` where each run is the reducer's run model without `events`, plus `ticket_doc { title, excerpt }`, `pendingAnswer`, `timeline` (last 20 events, fields `t, kind, phase, cycle, agent, role, verdict, gate, status, url, label`) and `currentAgent`

#### Scenario: Done runs hidden by default
- **WHEN** a run has a terminal `run.end` with status `delivered`
- **THEN** it is absent from the output unless `--all` is given

#### Scenario: Worktree cwd
- **WHEN** the command runs from `.concertino/worktrees/<type>/<change>/<T>`
- **THEN** `root` is the main checkout and its runs are listed

#### Scenario: No runs
- **WHEN** `.concertino/runs` does not exist
- **THEN** the command exits 0 with `runs: []` (`--json`) or a dim "no active runs" line
```

- [ ] **Step 3: Write `proposal.md`, `design.md`, `tasks.md`**

`proposal.md`: Why (driver sessions bypass the TUI; it cannot see their liveness), What changes (new `fleet` subcommand; a Claude Code mod shipped from the repo root plugin), Impact (`lib/cli/fleet.js`, `bin/concertino`, `help.js`, `hooks/`, `types/`, `package.json`). `design.md`: one paragraph pointing at `docs/superpowers/specs/2026-10-06-fleet-pane-design.md` as the authoritative design and restating the two decisions: reuse `reduce()` through the CLI rather than re-fold in the mod; liveness from the session's Agent calls. `tasks.md`: this plan's task list as checkboxes (1–10).

- [ ] **Step 4: Validate**

Run: `npx openspec validate fleet-pane 2>&1 | tail -5` (or `openspec validate` if installed globally — check `scripts/concertino/` or `package.json` for how the repo invokes it; `test/scripts/openspec-validate-cmd.test.sh` shows the exact command).
Expected: valid.

- [ ] **Step 5: Add the docs section**

In `docs/dashboard.md`, immediately before `## The cross-screen escalation banner`, insert:

```markdown
## Fleet pane (Claude Code)

When you drive runs from a Claude Code session instead of tmux (the
`concertino-fleet-driver` skill), the dashboard cannot see them. The
concertino plugin ships a docked **Fleet** pane for that session instead:
lanes with phase, cycle, gates, elapsed time and agent liveness, and a detail
view (ticket, escalation, timeline, PR) for the selected lane. It follows the
transcript: open an orchestrator's transcript from the tasks list and the
detail switches to that lane.

Install the plugin once:

```
/plugin install concertino --marketplace matto00/concertino
```

or, from a checkout, `claude --plugin-dir ~/Development/concertino`. `/fleet`
opens the pane (it also opens itself at 144 columns or wider); `/fleet off`
closes it. The pane is read-only in this release — answer escalations and
steer lanes by talking to the driver.

The pane is fed by `concertino fleet --json`, a read-only snapshot you can
run yourself: `concertino fleet` prints one line per active run.
```

- [ ] **Step 6: Commit**

```bash
git add openspec/changes/fleet-pane docs/dashboard.md
git commit -m "Add fleet-pane OpenSpec change and dashboard docs"
```

Open PR 1 here (`concertino fleet` + spec + docs). PR 2 branches from it or from `main` after merge.

---

### Task 4: Mod scaffold, type contract, `snapshot.ts`

**Files:**
- Create: `hooks/hooks.json`, `hooks/fleet-pane/snapshot.ts`, `hooks/fleet-pane/register.tsx` (minimal), `types/index.d.ts`, `tsconfig.json`
- Modify: `.claude-plugin/plugin.json`, `package.json` (`files`)
- Test: `hooks/fleet-pane/refresh.test.ts` (first test only)

**Interfaces:**
- Consumes: Task 2's JSON shape.
- Produces (for Tasks 5–8):
  - `types/index.d.ts`: `Run`, `Snapshot`, `Lane`, `Liveness`, `FleetState`, `PluginState.concertino`.
  - `snapshot.ts`: `runFleetSnapshot($, cwd): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; error: string }>`; `FLEET_ARGV = ['concertino', 'fleet', '--json']`; `POLL_MS = 2000`; `CLI_TIMEOUT_MS = 5000`.

- [ ] **Step 1: Write the type contract**

```ts
// types/index.d.ts
// The fleet pane's state contract (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
import type { AgentStatus } from 'claude-code'

export type RunStatus = 'needs-you' | 'failed' | 'running' | 'unknown' | 'done'

export type Gate = { name: string; status: string; durationMs: number | null; firstError: string | null }

export type SubQuestion = { question: string; options: string[] }

export type Escalation = {
  question: string
  options: string[]
  subQuestions?: SubQuestion[]
  raisedAt: number
  escalationId: string | null
  role: string | null
}

export type TimelineEvent = {
  t: number
  kind: string
  phase?: string
  cycle?: number
  agent?: string
  role?: string
  verdict?: string
  gate?: string
  status?: string
  url?: string
  label?: string
}

export type PendingAnswer =
  | { answer: string }
  | { subAnswers: unknown[]; total: number; complete: boolean }
  | null

/** One run as `concertino fleet --json` prints it: the reducer's model minus `events`. */
export type Run = {
  ticket: string
  changeName: string | null
  branch: string | null
  worktree: string | null
  phase: string | null
  cycle: number | null
  gates: Gate[]
  lastVerdict: { role: string; verdict: string; ref: string | null } | null
  escalation: Escalation | null
  costUsd: number | null
  startedAt: number | null
  endedAt: number | null
  endStatus: string | null
  elapsedMs: number | null
  status: RunStatus
  malformed: number
  ticket_doc: { title: string | null; excerpt: string | null }
  pendingAnswer: PendingAnswer
  timeline: TimelineEvent[]
  currentAgent: string | null
}

export type Snapshot = { generatedAt: number; root: string; runs: Run[] }

export type Liveness = 'running' | 'external' | 'stalled' | 'ended'

export type Lane = {
  run: Run
  agentId?: string
  agentStatus?: AgentStatus
  liveness: Liveness
}

export type FleetState = {
  lanes: Lane[]
  error: string | null
  fingerprint: string
  generatedAt: number
  root: string
}

declare module 'claude-code' {
  interface PluginState {
    concertino: {
      fleet: FleetState
      selected: string | null
      seenEscalations: string[]
    }
  }
}
```

- [ ] **Step 2: Manifest, hooks.json, tsconfig, package.json**

`.claude-plugin/plugin.json` — add `"types": "./types/index.d.ts"` after `"version"`.

`hooks/hooks.json`:
```json
{ "modules": ["./fleet-pane/register.tsx"] }
```

`tsconfig.json` (repo root):
```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types"]
}
```
(`.claude-plugin/types/` is written by the engine when the mod loads; `tsc -p .` only works after a first load — see Task 9. Add `.claude-plugin/types/` to `.gitignore`.)

`package.json` `files`: add `"hooks/"` and `"types/"` after `".claude-plugin/"`.

- [ ] **Step 3: Write the failing refresh test**

```ts
// hooks/fleet-pane/refresh.test.ts
import { test, expect } from 'claude-code/testing'
import { runFleetSnapshot } from './snapshot'

const SNAP = {
  generatedAt: 1, root: '/r',
  runs: [{ ticket: 'CON-1', changeName: 'x', branch: 'feature/x/CON-1', worktree: '/w', phase: 'Planning', cycle: 1,
    gates: [], lastVerdict: null, escalation: null, costUsd: null, startedAt: 0, endedAt: null, endStatus: null,
    elapsedMs: 5, status: 'unknown', malformed: 0, ticket_doc: { title: 'X', excerpt: null }, pendingAnswer: null,
    timeline: [], currentAgent: null }],
}

test('runFleetSnapshot: parses the CLI output and passes cwd + timeout', async ($, on) => {
  let seen: { argv: readonly string[]; cwd?: string; timeoutMs?: number } | null = null
  on('process.run', async (_$, e) => {
    seen = { argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs }
    return { exitCode: 0, stdout: JSON.stringify(SNAP), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  })
  const got = await runFleetSnapshot($, '/repo')
  expect(seen).toEqual({ argv: ['concertino', 'fleet', '--json'], cwd: '/repo', timeoutMs: 5000 })
  expect(got).toEqual({ ok: true, snapshot: SNAP })
})

test('runFleetSnapshot: non-zero exit is an error carrying the stderr tail', async ($, on) => {
  on('process.run', async () => ({ exitCode: 127, stdout: '', stderr: 'bash: concertino: command not found', isStdoutTruncated: false, isStderrTruncated: false }))
  const got = await runFleetSnapshot($, '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/exit 127.*command not found/)
})

test('runFleetSnapshot: empty stdout is an error, lanes are kept', async ($, on) => {
  on('process.run', async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }))
  const got = await runFleetSnapshot($, '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/no output/)
})

test('runFleetSnapshot: a rejected process call is an error, not a throw', async ($, on) => {
  on('process.run', async () => { throw new Error('spawn ENOENT') })
  const got = await runFleetSnapshot($, '/repo')
  expect(got.ok).toBe(false)
  if (!got.ok) expect(got.error).toMatch(/ENOENT/)
})
```

(Keeping previous lanes on error is `refresh`'s job — Task 8 asserts it against state; this test pins that the snapshot layer reports rather than throws.)

- [ ] **Step 4: Minimal `register.tsx` so the plugin loads**

```tsx
// hooks/fleet-pane/register.tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate OK; test FAILS — `./snapshot` not found.

- [ ] **Step 6: Implement `snapshot.ts`**

```ts
// hooks/fleet-pane/snapshot.ts
import type { EngineInterface } from 'claude-code'
import type { Snapshot } from '../../types'

export const FLEET_ARGV = ['concertino', 'fleet', '--json'] as const
export const POLL_MS = 2000
export const CLI_TIMEOUT_MS = 5000

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; error: string }

const tail = (s: string, n = 200) => s.trim().split('\n').slice(-3).join(' ').slice(-n)

/** Runs `concertino fleet --json` in `cwd`; never throws. */
export async function runFleetSnapshot($: EngineInterface, cwd: string): Promise<SnapshotResult> {
  let ran
  try {
    ran = await $.process.run([...FLEET_ARGV], { cwd, timeoutMs: CLI_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, error: `concertino: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (ran.exitCode !== 0) return { ok: false, error: `concertino: exit ${ran.exitCode} ${tail(ran.stderr)}`.trim() }
  if (!ran.stdout.trim()) return { ok: false, error: 'concertino: no output' }
  try {
    const parsed = JSON.parse(ran.stdout) as Snapshot
    if (!parsed || !Array.isArray(parsed.runs)) return { ok: false, error: 'concertino: unexpected JSON shape' }
    return { ok: true, snapshot: parsed }
  } catch (e) {
    return { ok: false, error: `concertino: bad JSON ${tail(ran.stdout, 80)}` }
  }
}
```

- [ ] **Step 7: Run validate + test**

Run: `claude plugin validate . && claude plugin test .`
Expected: PASS (4 tests). If `test` reports that the module could not be loaded because `types/index.d.ts` imports from `'claude-code'`, that import is type-only and allowed; check the message for the real cause.

- [ ] **Step 8: Commit**

```bash
git add hooks types tsconfig.json .claude-plugin/plugin.json package.json .gitignore
git commit -m "Scaffold the fleet-pane mod: manifest, state contract, snapshot runner"
```

---

### Task 5: `lanes.ts` — correlation, liveness, ordering, summary

**Files:**
- Create: `hooks/fleet-pane/lanes.ts`
- Test: `hooks/fleet-pane/lanes.test.ts`

**Interfaces:**
- Consumes: `Run`, `Lane`, `Liveness` (Task 4); `AgentInfo`, `SessionMessage` from `'claude-code'`.
- Produces:
  - `agentIdsByTicket(messages: readonly SessionMessage[]): Map<string, string>` — newest Agent call per `TICKET_ID`.
  - `correlate(runs: Run[], agents: readonly AgentInfo[], byTicket: Map<string, string>): Lane[]` — ordered.
  - `summarize(lanes: Lane[]): string | undefined` — the status-line text.
  - `fingerprint(lanes: Lane[], error: string | null): string`.
  - `ORDER: Record<RunStatus, number>`.

- [ ] **Step 1: Write the failing tests**

```ts
// hooks/fleet-pane/lanes.test.ts
import { test, expect } from 'claude-code/testing'
import type { AgentInfo, SessionMessage } from 'claude-code'
import type { Run } from '../../types'
import { agentIdsByTicket, correlate, summarize, fingerprint } from './lanes'

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: null, branch: null, worktree: null, phase: null, cycle: null, gates: [],
  lastVerdict: null, escalation: null, costUsd: null, startedAt: null, endedAt: null, endStatus: null,
  elapsedMs: null, status: 'unknown', malformed: 0, ticket_doc: { title: null, excerpt: null },
  pendingAnswer: null, timeline: [], currentAgent: null, ...over,
})

const agentCall = (id: string, ticket: string): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id,
    input: { subagent_type: 'concertino-orchestrator', description: 'deliver ' + ticket,
      prompt: `TICKET_ID=${ticket} AGENT_MERGE_OVERRIDE= SPEED=` } }],
})

const agent = (id: string, status: AgentInfo['status']): AgentInfo =>
  ({ id, description: 'd', type: 'concertino-orchestrator', status })

test('agentIdsByTicket: maps TICKET_ID in an Agent prompt to its agentId; newest Agent call wins for a ticket', async () => {
  const map = agentIdsByTicket([
    agentCall('a-old', 'CON-1'),
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: { command: 'echo TICKET_ID=CON-9' } }] },
    agentCall('a-new', 'CON-1'),
    agentCall('b', 'CON-2'),
  ])
  expect([...map.entries()]).toEqual([['CON-1', 'a-new'], ['CON-2', 'b']])
})

test('correlate: liveness is running for a live agent, external with no match, stalled when the agent ended but the run did not, ended when the run has a terminal run.end', async () => {
  const byTicket = new Map([['CON-1', 'a'], ['CON-3', 'c'], ['CON-4', 'd']])
  const lanes = correlate(
    [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' }), run({ ticket: 'CON-3' }),
     run({ ticket: 'CON-4', endStatus: 'failed', status: 'failed' })],
    [agent('a', 'running'), agent('c', 'completed'), agent('d', 'completed')],
    byTicket,
  )
  const by = Object.fromEntries(lanes.map(l => [l.run.ticket, l]))
  expect(by['CON-1']).toMatchObject({ agentId: 'a', agentStatus: 'running', liveness: 'running' })
  expect(by['CON-2']).toMatchObject({ liveness: 'external' })
  expect(by['CON-2'].agentId).toBeUndefined()
  expect(by['CON-3']).toMatchObject({ agentId: 'c', liveness: 'stalled' })
  expect(by['CON-4']).toMatchObject({ liveness: 'ended' })
})

test('correlate: a matched agentId missing from agent.list is external (the engine dropped its task)', async () => {
  const [lane] = correlate([run({})], [], new Map([['CON-1', 'gone']]))
  expect(lane).toMatchObject({ agentId: 'gone', liveness: 'external' })
  expect(lane?.agentStatus).toBeUndefined()
})

test('correlate: orders needs-you, then running/unknown, then failed; ties keep input order', async () => {
  const lanes = correlate([
    run({ ticket: 'F', status: 'failed' }), run({ ticket: 'U1', status: 'unknown' }),
    run({ ticket: 'N', status: 'needs-you' }), run({ ticket: 'R', status: 'running' }), run({ ticket: 'U2', status: 'unknown' }),
  ], [], new Map())
  expect(lanes.map(l => l.run.ticket)).toEqual(['N', 'U1', 'R', 'U2', 'F'])
})

test('summarize: counts running and needs-you; undefined with no lanes', async () => {
  expect(summarize([])).toBeUndefined()
  const lanes = correlate([
    run({ ticket: 'A', status: 'needs-you' }), run({ ticket: 'B' }), run({ ticket: 'C' }),
  ], [agent('b', 'running')], new Map([['B', 'b']]))
  expect(summarize(lanes)).toBe('fleet: 2 running · 1 needs you')
})

test('summarize: singular and failed', async () => {
  const lanes = correlate([run({ ticket: 'A' }), run({ ticket: 'B', status: 'failed' })], [], new Map())
  expect(summarize(lanes)).toBe('fleet: 1 running · 1 failed')
})

test('fingerprint: stable across identical input, changes on phase, escalation, liveness, answer', async () => {
  const base = correlate([run({ phase: 'Planning' })], [], new Map())
  expect(fingerprint(base, null)).toBe(fingerprint(correlate([run({ phase: 'Planning' })], [], new Map()), null))
  expect(fingerprint(correlate([run({ phase: 'Execution' })], [], new Map()), null)).not.toBe(fingerprint(base, null))
  expect(fingerprint(correlate([run({ phase: 'Planning', pendingAnswer: { answer: 'a' } })], [], new Map()), null)).not.toBe(fingerprint(base, null))
  expect(fingerprint(base, 'boom')).not.toBe(fingerprint(base, null))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test .`
Expected: `lanes.test.ts` FAILS — `./lanes` not found.

- [ ] **Step 3: Implement `lanes.ts`**

```ts
// hooks/fleet-pane/lanes.ts
// Pure: snapshot runs + the session's agents + its transcript → ordered lanes.
// No `$`, no I/O, so `claude plugin test` can pin every branch.
import type { AgentInfo, SessionMessage } from 'claude-code'
import type { Lane, Liveness, Run, RunStatus } from '../../types'

export const ORDER: Record<RunStatus, number> = { 'needs-you': 0, running: 1, unknown: 1, failed: 2, done: 3 }

const TICKET_RE = /\bTICKET_ID=(\S+)/
const ENDED: ReadonlySet<AgentInfo['status']> = new Set(['completed', 'failed', 'killed'])

/** Newest `Agent` tool use per ticket, read off the main transcript. */
export function agentIdsByTicket(messages: readonly SessionMessage[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const message of messages) {
    for (const use of message.toolUses) {
      if (use.tool !== 'Agent' || !use.agentId) continue
      const prompt = typeof use.input.prompt === 'string' ? use.input.prompt : ''
      const m = TICKET_RE.exec(prompt)
      if (m?.[1]) {
        out.delete(m[1])          // re-insert so the newest wins and iteration order follows it
        out.set(m[1], use.agentId)
      }
    }
  }
  return out
}

function livenessOf(run: Run, status: AgentInfo['status'] | undefined, matched: boolean): Liveness {
  if (run.endStatus) return 'ended'
  if (!matched || status === undefined) return 'external'
  if (ENDED.has(status)) return 'stalled'
  return 'running'
}

export function correlate(runs: Run[], agents: readonly AgentInfo[], byTicket: Map<string, string>): Lane[] {
  const statusById = new Map(agents.map(a => [a.id, a.status]))
  const lanes: Lane[] = runs.map(run => {
    const agentId = byTicket.get(run.ticket)
    const agentStatus = agentId ? statusById.get(agentId) : undefined
    const lane: Lane = { run, liveness: livenessOf(run, agentStatus, agentId !== undefined) }
    if (agentId) lane.agentId = agentId
    if (agentStatus) lane.agentStatus = agentStatus
    return lane
  })
  return lanes
    .map((lane, i) => ({ lane, i }))
    .sort((a, b) => (ORDER[a.lane.run.status] - ORDER[b.lane.run.status]) || (a.i - b.i))
    .map(x => x.lane)
}

export function summarize(lanes: Lane[]): string | undefined {
  if (!lanes.length) return undefined
  const needsYou = lanes.filter(l => l.run.status === 'needs-you').length
  const failed = lanes.filter(l => l.run.status === 'failed').length
  const running = lanes.length - needsYou - failed
  const parts = [`${running} running`]
  if (needsYou) parts.push(`${needsYou} needs you`)
  if (failed) parts.push(`${failed} failed`)
  return 'fleet: ' + parts.join(' · ')
}

export function fingerprint(lanes: Lane[], error: string | null): string {
  const rows = lanes.map(l => [
    l.run.ticket, l.run.status, l.run.phase, l.run.cycle, l.run.gates.length,
    l.liveness, l.run.escalation?.escalationId ?? l.run.escalation?.raisedAt ?? null,
    l.run.timeline.at(-1)?.t ?? null, l.run.pendingAnswer !== null, l.run.currentAgent,
  ])
  return JSON.stringify([error, rows])
}
```

- [ ] **Step 4: Run tests**

Run: `claude plugin test .`
Expected: PASS. If `toolUses[].input` is typed `Record<string, unknown>` the `prompt` guard above compiles; if `agentId` is not on `ToolUseSummary` in this build, grep `.claude-plugin/types/claude-code/index.d.ts` for `agentId` under `ToolUseSummary` and adjust the property name.

- [ ] **Step 5: Commit**

```bash
git add hooks/fleet-pane/lanes.ts hooks/fleet-pane/lanes.test.ts
git commit -m "Add fleet-pane lane correlation, ordering, summary and fingerprint"
```

---

### Task 6: `render.tsx` — the lane list

**Files:**
- Create: `hooks/fleet-pane/render.tsx`
- Modify: `hooks/fleet-pane/register.tsx` (render hook + state atoms, so the pane can be mounted in tests)
- Test: `hooks/fleet-pane/render.test.ts`

**Interfaces:**
- Consumes: `Lane`, `FleetState` (Task 4); `summarize` (Task 5); `$.ui.resolve(e)` elements for `Pane`.
- Produces:
  - `render.tsx`: `renderPane(els, model: PaneModel)`, `PaneModel = { fleet: FleetState; selected: string | null; viewAgentId?: string; bodyColumns: number; placement: 'dock' | 'inline'; now: number; onSelect: (ticket: string) => void }`; helpers `truncate(s, n)`, `phaseBar(phase)`, `fmtElapsed(ms)`, `fmtAgo(ms)`, `pickDetail(model): Lane | undefined`.
  - `register.tsx`: atoms `fleet`, `selected`, `seenEscalations` (`{ plugin: 'concertino', key }`), `PANE = 'fleet'`, and the `ui.render` hook.
  - Element keys used by tests: lane rows `lane:<ticket>`, header `header`, error `error`, empty `empty`, detail blocks `detail`, `escalation`, `ticket`, `timeline`, `pr`.

- [ ] **Step 1: Write the failing list tests**

```ts
// hooks/fleet-pane/render.test.ts
import { test, expect } from 'claude-code/testing'
import type { Lane, Run } from '../../types'

const PANE = { title: 'Fleet', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FLEET = { plugin: 'concertino', key: 'fleet' } as const
const SELECTED = { plugin: 'concertino', key: 'selected' } as const

const run = (over: Partial<Run>): Run => ({
  ticket: 'CON-1', changeName: 'thing', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', phase: 'Execution', cycle: 1,
  gates: [{ name: 'a', status: 'pass', durationMs: null, firstError: null }, { name: 'b', status: 'fail', durationMs: null, firstError: null }],
  lastVerdict: null, escalation: null, costUsd: 1.84, startedAt: 0, endedAt: null, endStatus: null,
  elapsedMs: 12 * 60_000, status: 'unknown', malformed: 0, ticket_doc: { title: 'Add the thing', excerpt: 'Line one.\nLine two.' },
  pendingAnswer: null, timeline: [{ t: 0, kind: 'phase.enter', phase: 'Execution', cycle: 1 }], currentAgent: 'executor', ...over,
})
const lane = (over: Partial<Run>, liveness: Lane['liveness'] = 'running'): Lane => ({ run: run(over), liveness })

async function seed($: any, lanes: Lane[], error: string | null = null, selected: string | null = null) {
  await $.state.set(FLEET, { lanes, error, fingerprint: 'f', generatedAt: 0, root: '/r' })
  await $.state.set(SELECTED, selected)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`list: empty state names the runs dir (${surface})`, async $ => {
    await seed($, [])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    expect((await ui.find({ key: 'empty' }))?.text).toMatch(/No concertino runs under \/r\/\.concertino\/runs/)
  })

  test(`list: one row per lane with ticket, status, phase, cycle, gates, elapsed, agent (${surface})`, async $ => {
    await seed($, [lane({ ticket: 'CON-231', status: 'needs-you', phase: 'Evaluation', cycle: 2, currentAgent: 'skeptic' }),
                   lane({ ticket: 'CON-228' }), lane({ ticket: 'CON-219' }, 'external')])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map(r => r.key)).toEqual(['lane:CON-231', 'lane:CON-228', 'lane:CON-219'])
    expect(rows[0]?.text).toMatch(/CON-231\s+needs-you\s+Evaluation\s+c2\s+\S+ 1\/2\s+12m\s+skeptic/)
    expect(rows[2]?.text).toMatch(/external$/)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/2 running · 1 needs you/)
  })

  test(`list: stalled lane is labelled (${surface})`, async $ => {
    await seed($, [lane({}, 'stalled')])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    expect((await ui.find({ key: 'lane:CON-1' }))?.text).toMatch(/stalled/)
  })

  test(`list: pressing a row selects it (${surface})`, async $ => {
    await seed($, [lane({ ticket: 'A' }), lane({ ticket: 'B' })])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    await ui.press({ key: 'lane:B' })
    expect((await $.state.get(SELECTED)).value).toBe('B')
  })

  test(`list: an error line is drawn above stale lanes (${surface})`, async $ => {
    await seed($, [lane({})], 'concertino: exit 127 command not found')
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    expect((await ui.find({ key: 'error' }))?.text).toMatch(/exit 127/)
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
  })

  test(`list: truncates every row to bodyColumns (${surface})`, async $ => {
    await seed($, [lane({ ticket: 'CON-123456', currentAgent: 'evaluator' })])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: { ...PANE, bodyColumns: 40 }, requestId: 'fleet' })
    const row = await ui.find({ key: 'lane:CON-123456' })
    expect(row?.text.length).toBeLessThanOrEqual(40)
    expect(row?.text).not.toMatch(/\n/)
  })
}
```

(Check `expect` has `toBeLessThanOrEqual` in `Matchers`; if not, use `expect((row?.text.length ?? 0) <= 40).toBe(true)`.)

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test .`
Expected: render tests FAIL — the pane draws nothing / no `ui.render` hook.

- [ ] **Step 3: Implement `render.tsx` (list part)**

```tsx
// hooks/fleet-pane/render.tsx
// Pure drawing: a PaneModel in, a tree out. `els` is `$.ui.resolve(e)`.
import type { Elements, RenderElement } from 'claude-code'
import type { FleetState, Lane } from '../../types'
import { summarize } from './lanes'

export type PaneModel = {
  fleet: FleetState
  selected: string | null
  viewAgentId?: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  onSelect: (ticket: string) => void
}

export const PHASE_ORDER = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']

export const truncate = (s: string, n: number) => (s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…')

export function phaseBar(phase: string | null): string {
  const i = phase ? PHASE_ORDER.indexOf(phase) : -1
  return PHASE_ORDER.map((_, j) => (j <= i ? '■' : '□')).join('')
}

export function fmtElapsed(ms: number | null): string {
  if (ms == null) return '-'
  const m = Math.floor(ms / 60000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtAgo = (ms: number) => fmtElapsed(Math.max(0, ms)) + ' ago'

function agentLabel(lane: Lane): string {
  if (lane.liveness === 'stalled') return `${lane.run.currentAgent ?? ''} stalled`.trim()
  if (lane.liveness === 'external') return 'external'
  return lane.run.currentAgent ?? ''
}

export function laneRow(lane: Lane): string {
  const r = lane.run
  const passed = r.gates.filter(g => g.status === 'pass').length
  return [
    r.ticket.padEnd(9), r.status.padEnd(10), (r.phase ?? '-').padEnd(10),
    `c${r.cycle ?? '-'}`.padEnd(3), `${phaseBar(r.phase)} ${passed}/${r.gates.length}`.padEnd(11),
    fmtElapsed(r.elapsedMs).padEnd(5), agentLabel(lane),
  ].join(' ').trimEnd()
}

export function pickDetail(model: PaneModel): Lane | undefined {
  const { lanes } = model.fleet
  if (model.viewAgentId) {
    const inView = lanes.find(l => l.agentId === model.viewAgentId)
    if (inView) return inView
  }
  return lanes.find(l => l.run.ticket === model.selected) ?? lanes[0]
}

const colourOf = (lane: Lane) =>
  lane.run.status === 'needs-you' ? 'yellow' : lane.run.status === 'failed' ? 'red' : undefined

export function renderPane(els: Elements<'Pane'>, model: PaneModel): RenderElement {
  const { Box, Text, Button } = els
  const { fleet, bodyColumns: w } = model
  const detail = pickDetail(model)
  const rule = '─'.repeat(Math.max(1, w))
  return (
    <Box flexDirection="column">
      <Text key="header" bold>{truncate(`Fleet · concertino  ${summarize(fleet.lanes)?.replace(/^fleet: /, '') ?? ''}`, w)}</Text>
      <Text dimColor>{rule}</Text>
      {fleet.error && <Text key="error" color="red">{truncate(fleet.error, w)}</Text>}
      {fleet.lanes.length === 0 && !fleet.error && (
        <Text key="empty" dimColor>{truncate(`No concertino runs under ${fleet.root}/.concertino/runs`, w)}</Text>
      )}
      {fleet.lanes.map((lane, i) => (
        <Button
          key={`lane:${lane.run.ticket}`}
          plain
          hotkey={i < 9 ? String(i + 1) : undefined}
          dimColor={lane.liveness === 'external' || lane.liveness === 'stalled' || lane.run.status === 'unknown'}
          label={truncate(`${detail === lane ? '▶ ' : '  '}${laneRow(lane)}`, w)}
          onPress={() => model.onSelect(lane.run.ticket)}
        />
      ))}
      {model.placement === 'dock' && detail && renderDetail(els, model, detail, rule)}
    </Box>
  )
}

export function renderDetail(els: Elements<'Pane'>, model: PaneModel, lane: Lane, rule: string): RenderElement {
  const { Box, Text } = els
  return <Box key="detail" flexDirection="column"><Text dimColor>{rule}</Text></Box>
}
```

Check the exact name of the element-table type in `.claude-plugin/types/claude-code/index.d.ts` (grep `resolve: <`): the spec's reference calls it `Elements`; if the return type of `$.ui.resolve` is named differently (e.g. `ElementsOf<P>`), use `ReturnType<EngineInterface['ui']['resolve']>` instead and drop the `Elements` import. Colour on `Button` is applied through `Text` on surfaces where `Button` takes no `color`; if `Button` has no `color` prop, wrap nothing — rely on `dimColor` and the yellow/red `Text` in the detail header (Task 7). `renderDetail` is a stub until Task 7.

- [ ] **Step 4: Add atoms and the render hook to `register.tsx`**

```tsx
// hooks/fleet-pane/register.tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { FleetState } from '../../types'
import { renderPane } from './render'

export const PANE = 'fleet'
const EMPTY: FleetState = { lanes: [], error: null, fingerprint: '', generatedAt: 0, root: '' }

export const fleet = atom({ plugin: 'concertino', key: 'fleet' } as const, EMPTY)
export const selected = atom({ plugin: 'concertino', key: 'selected' } as const, null)
export const seenEscalations = atom({ plugin: 'concertino', key: 'seenEscalations' } as const, [])

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const model = {
      fleet: await read($, fleet),
      selected: await read($, selected),
      viewAgentId: e.props.view.agentId,
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      now: await $.clock.now(),
      onSelect: (ticket: string) => { void update($, selected, () => ticket) },
    }
    return renderPane(els, model)
  })
}
```

- [ ] **Step 5: Run validate + tests**

Run: `claude plugin validate . && claude plugin test .`
Expected: PASS. A `ui.render (Pane) refused:` line means the tree did not validate — the reason names the prop; fix it (common: `hotkey={undefined}` must be omitted rather than passed; spread `{...(i < 9 ? { hotkey: String(i + 1) } : {})}`).

- [ ] **Step 6: Commit**

```bash
git add hooks/fleet-pane/render.tsx hooks/fleet-pane/render.test.ts hooks/fleet-pane/register.tsx
git commit -m "Draw the fleet pane lane list"
```

---

### Task 7: `render.tsx` — the detail view

**Files:**
- Modify: `hooks/fleet-pane/render.tsx` (`renderDetail`)
- Test: `hooks/fleet-pane/render.test.ts` (append)

**Interfaces:**
- Consumes: `PaneModel`, `pickDetail`, helpers (Task 6).
- Produces: detail block keys `detail`, `escalation`, `ticket`, `timeline`, `pr`.

- [ ] **Step 1: Write the failing detail tests**

Append inside the `for (const surface …)` loop in `render.test.ts`:

```ts
  test(`detail: header, phase line, ticket excerpt, timeline tail, PR and cost (${surface})`, async $ => {
    await seed($, [lane({ timeline: Array.from({ length: 12 }, (_, i) => ({ t: i * 60_000, kind: 'gate.result', gate: 'g' + i, status: 'pass' }))
      .concat([{ t: 13 * 60_000, kind: 'pr', url: 'https://github.com/x/y/pull/148', label: 'pr' }]) })])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    const detail = await ui.find({ key: 'detail' })
    expect(detail?.text).toMatch(/CON-1\s+Add the thing\s+feature\/thing\/CON-1/)
    expect(detail?.text).toMatch(/Phase Execution · cycle 1 · agent running · worktree \/w\/CON-1/)
    expect((await ui.find({ key: 'ticket' }))?.text).toMatch(/Line one\.\s+Line two\./)
    const timeline = (await ui.find({ key: 'timeline' }))?.text ?? ''
    expect(timeline).toMatch(/g11/)
    expect(timeline).not.toMatch(/g3\b/)          // last 8 only
    expect(timeline).toMatch(/pr/)
    expect((await ui.find({ key: 'pr' }))?.text).toMatch(/https:\/\/github.com\/x\/y\/pull\/148.*\$1\.84/)
  })

  test(`detail: escalation block with lettered options and the recorded answer (${surface})`, async $ => {
    await seed($, [lane({ status: 'needs-you',
      escalation: { question: 'Include unverifiable gates?', options: ['include', 'exclude', 'separate class'], raisedAt: 0, escalationId: 'e1', role: 'skeptic' },
      pendingAnswer: { answer: 'b' } })])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    const esc = (await ui.find({ key: 'escalation' }))?.text ?? ''
    expect(esc).toMatch(/ESCALATION \(skeptic/)
    expect(esc).toMatch(/Include unverifiable gates\?/)
    expect(esc).toMatch(/a\) include\s+b\) exclude\s+c\) separate class/)
    expect(esc).toMatch(/answered: b/)
  })

  test(`detail: renders sub-questions when options are empty (${surface})`, async $ => {
    await seed($, [lane({ status: 'needs-you',
      escalation: { question: 'Two decisions', options: [], raisedAt: 0, escalationId: 'e2', role: 'orchestrator',
        subQuestions: [{ question: 'Schema?', options: ['v1', 'v2'] }, { question: 'Flag?', options: ['on', 'off'] }] } })])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: PANE, requestId: 'fleet' })
    const esc = (await ui.find({ key: 'escalation' }))?.text ?? ''
    expect(esc).toMatch(/1\. Schema\?\s+a\) v1\s+b\) v2/)
    expect(esc).toMatch(/2\. Flag\?\s+a\) on\s+b\) off/)
    expect(esc).not.toMatch(/\ba\)\s*$/m)        // no empty top-level option line
  })

  test(`detail: follows view.agentId over the selection (${surface})`, async $ => {
    await seed($, [{ ...lane({ ticket: 'A' }), agentId: 'ag-a' }, { ...lane({ ticket: 'B', ticket_doc: { title: 'Bee', excerpt: null } }), agentId: 'ag-b' }], null, 'A')
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: { ...PANE, view: { agentId: 'ag-b' } }, requestId: 'fleet' })
    expect((await ui.find({ key: 'detail' }))?.text).toMatch(/^B\s+Bee/)
    await ui.redraw(PANE)
    expect((await ui.find({ key: 'detail' }))?.text).toMatch(/^A\s+Add the thing/)
  })

  test(`detail: inline placement draws the list only (${surface})`, async $ => {
    await seed($, [lane({})])
    const ui = await $.ui.mount({ plugin: 'concertino', surface, component: 'Pane', props: { ...PANE, placement: 'inline' }, requestId: 'fleet' })
    expect(await ui.find({ key: 'lane:CON-1' })).toBeDefined()
    expect(await ui.find({ key: 'detail' })).toBeUndefined()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test .`
Expected: the five `detail:` tests FAIL (stub detail has no text; `ticket`/`timeline`/`pr`/`escalation` keys missing).

- [ ] **Step 3: Implement `renderDetail`**

Replace the stub in `render.tsx`:

```tsx
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const lettered = (options: string[]) => options.map((o, i) => `${LETTERS[i] ?? '?'}) ${o}`).join('   ')

function answeredLine(lane: Lane): string | null {
  const a = lane.run.pendingAnswer
  if (!a) return null
  if ('answer' in a) return `answered: ${a.answer}`
  return `answered: ${a.subAnswers.filter(x => x != null).length}/${a.total}${a.complete ? '' : ' (in progress)'}`
}

function timelineLine(ev: TimelineEvent, w: number): string {
  const d = new Date(ev.t)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const rest = [ev.kind, ev.agent, ev.role && ev.kind === 'verdict' ? ev.role : undefined, ev.verdict, ev.phase, ev.gate,
    ev.status, ev.cycle != null ? `c${ev.cycle}` : undefined, ev.label].filter(Boolean).join(' ')
  return truncate(`${hhmm} ${rest}`, w)
}

export function renderDetail(els: Elements<'Pane'>, model: PaneModel, lane: Lane, rule: string): RenderElement {
  const { Box, Text } = els
  const w = model.bodyColumns
  const r = lane.run
  const colour = colourOf(lane)
  const pr = r.timeline.filter(ev => ev.kind === 'pr' && ev.url).at(-1)
  const excerptLines = (r.ticket_doc.excerpt ?? '').split('\n').filter(l => l.trim()).slice(0, 8)
  const esc = r.escalation
  const answered = answeredLine(lane)
  return (
    <Box key="detail" flexDirection="column">
      <Text dimColor>{rule}</Text>
      <Text bold color={colour}>{truncate(`${r.ticket}  ${r.ticket_doc.title ?? r.changeName ?? ''}  ${r.branch ?? ''}`, w)}</Text>
      <Text>{truncate(`Phase ${r.phase ?? '-'} · cycle ${r.cycle ?? '-'} · agent ${lane.liveness} · worktree ${r.worktree ?? '-'}`, w)}</Text>
      {esc && (
        <Box key="escalation" flexDirection="column" marginTop={1}>
          <Text bold color="yellow">{truncate(`ESCALATION (${esc.role ?? 'unknown'}, ${fmtAgo(model.now - esc.raisedAt)})`, w)}</Text>
          <Text wrap="wrap">{esc.question}</Text>
          {esc.options.length > 0 && <Text wrap="wrap">{lettered(esc.options)}</Text>}
          {(esc.subQuestions ?? []).map((sq, i) => (
            <Box flexDirection="column" key={`sq:${i}`}>
              <Text wrap="wrap">{`${i + 1}. ${sq.question}`}</Text>
              <Text wrap="wrap">{'   ' + lettered(sq.options)}</Text>
            </Box>
          ))}
          {answered && <Text dimColor>{truncate(answered, w)}</Text>}
        </Box>
      )}
      {excerptLines.length > 0 && (
        <Box key="ticket" flexDirection="column" marginTop={1}>
          <Text bold>TICKET</Text>
          {excerptLines.map((l, i) => <Text key={`tk:${i}`} wrap="wrap">{l}</Text>)}
        </Box>
      )}
      {r.timeline.length > 0 && (
        <Box key="timeline" flexDirection="column" marginTop={1}>
          <Text bold>TIMELINE</Text>
          {r.timeline.slice(-8).map((ev, i) => <Text key={`tl:${i}`} dimColor>{timelineLine(ev, w)}</Text>)}
        </Box>
      )}
      {(pr || r.costUsd != null) && (
        <Text key="pr" marginTop={1}>{truncate(`${pr ? `PR  ${pr.url}` : ''}${r.costUsd != null ? `   cost $${r.costUsd.toFixed(2)}` : ''}`.trim(), w)}</Text>
      )}
    </Box>
  )
}
```

Add `TimelineEvent` to the type import from `'../../types'`. `Text` may not accept `marginTop`; if the validator refuses it, wrap that `Text` in `<Box key="pr" marginTop={1}>` and move the key to the Box. The `pr` row text assertion then reads the Box's text, which the kit concatenates.

- [ ] **Step 4: Run tests**

Run: `claude plugin test .`
Expected: PASS for both surfaces. `view.agentId` follow test: `ui.redraw(PANE)` redraws with the original props (no `agentId`) and the detail returns to the selection.

- [ ] **Step 5: Commit**

```bash
git add hooks/fleet-pane/render.tsx hooks/fleet-pane/render.test.ts
git commit -m "Draw the fleet pane detail view: escalation, ticket, timeline, PR"
```

---

### Task 8: The poll — `refresh`, status line, toast, `/fleet`, `session.start`

**Files:**
- Modify: `hooks/fleet-pane/register.tsx`
- Test: `hooks/fleet-pane/refresh.test.ts` (append)

**Interfaces:**
- Consumes: `runFleetSnapshot`, `POLL_MS` (Task 4); `agentIdsByTicket`, `correlate`, `summarize`, `fingerprint` (Task 5); atoms (Task 6).
- Produces: exported `refresh($)` for tests; `/fleet` and `/fleet off`.

- [ ] **Step 1: Write the failing tests**

Append to `refresh.test.ts`:

```ts
import { mock } from 'claude-code/testing'
import type { AgentInfo, SessionMessage } from 'claude-code'
import { refresh, PANE } from './register'

const FLEET = { plugin: 'concertino', key: 'fleet' } as const
const SEEN = { plugin: 'concertino', key: 'seenEscalations' } as const

const okRun = (stdout: string) => async () =>
  ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

function world(on: any, opts: { stdout: string; agents?: AgentInfo[]; messages?: SessionMessage[] }) {
  on('process.run', okRun(opts.stdout))
  on('agent.list', async () => opts.agents ?? [])
  on('session.messages', async () => opts.messages ?? [])
}

const agentCall = (id: string, ticket: string): SessionMessage => ({
  role: 'assistant', text: '',
  toolUses: [{ tool_use_id: 'tu-' + id, tool: 'Agent', agentId: id, input: { prompt: `TICKET_ID=${ticket}` } }],
})

test('refresh: writes correlated lanes to state and sets the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => { statuses.push(e.text); return undefined })
  world(on, { stdout: JSON.stringify(SNAP), agents: [{ id: 'a', description: '', type: 'concertino-orchestrator', status: 'running' }],
    messages: [agentCall('a', 'CON-1')] })
  await refresh($)
  const { value } = await $.state.get(FLEET)
  expect(value?.lanes).toHaveLength(1)
  expect(value?.lanes[0]).toMatchObject({ agentId: 'a', liveness: 'running' })
  expect(value?.error).toBeNull()
  expect(value?.root).toBe('/r')
  expect(statuses.at(-1)).toBe('fleet: 1 running')
})

test('refresh: an identical snapshot does not rewrite state', async ($, on) => {
  world(on, { stdout: JSON.stringify(SNAP) })
  await refresh($)
  const first = await $.state.get(FLEET)
  await refresh($)
  expect((await $.state.get(FLEET)).version).toBe(first.version)
})

test('refresh: on CLI failure keeps the last lanes, records the error, clears the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => { statuses.push(e.text); return undefined })
  let fail = false
  on('process.run', async () => fail
    ? { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }
    : okRun(JSON.stringify(SNAP))())
  on('agent.list', async () => [])
  on('session.messages', async () => [])
  await refresh($)
  fail = true
  await refresh($)
  const { value } = await $.state.get(FLEET)
  expect(value?.lanes).toHaveLength(1)
  expect(value?.error).toMatch(/exit 1 boom/)
  expect(statuses.at(-1)).toBeUndefined()
})

test('refresh: toasts once per new escalation_id', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => { toasts.push(e.text); return undefined })
  const withEsc = { ...SNAP, runs: [{ ...SNAP.runs[0], status: 'needs-you',
    escalation: { question: 'Which schema?', options: ['a', 'b'], raisedAt: 0, escalationId: 'esc-1', role: 'skeptic' } }] }
  world(on, { stdout: JSON.stringify(withEsc) })
  await refresh($)
  await refresh($)
  expect(toasts).toEqual(['CON-1 needs you: Which schema?'])
  expect((await $.state.get(SEEN)).value).toEqual(['esc-1'])
})

test('refresh: denied session.messages still renders lanes as external', async ($, on) => {
  on('process.run', okRun(JSON.stringify(SNAP)))
  on('agent.list', async () => [])
  on('session.messages', async () => ({ deny: 'no' }))
  await refresh($)
  expect((await $.state.get(FLEET)).value?.lanes[0]?.liveness).toBe('external')
})

test('session.start registers /fleet, opens the pane and polls every 2 s', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  let runs = 0
  on('ui.open', async (_$, e) => { opened.push(e.id); return { isPlaced: true } })
  on('command.register', async (_$, e) => ({ command: e.name }))
  on('process.run', async () => { runs++; return okRun(JSON.stringify(SNAP))() })
  on('agent.list', async () => [])
  on('session.messages', async () => [])
  await $.session.start({ source: 'startup' } as any)
  expect(opened).toEqual([PANE])
  await clock.advance(2000)
  expect(runs).toBe(1)
  await clock.advance(4000)
  expect(runs).toBe(3)
})

test('/fleet opens the pane; /fleet off closes it', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', async (_$, e) => { opened.push(e.id); return { isPlaced: true } })
  on('ui.close', async (_$, e) => { closed.push(e.id); return undefined })
  await $.command.run({ command: 'fleet', args: '' } as any)
  expect(opened).toEqual([PANE])
  await $.command.run({ command: 'fleet', args: 'off' } as any)
  expect(closed).toEqual([PANE])
})
```

Check in the kit's `Engine` type how a test raises `session.start` and `command.run` (`$.session.start(...)` vs `$.classic.SessionStart(...)`): grep `.claude-plugin/types/claude-code/index.d.ts` for `EngineNoun<'session'>`. Use the form it has; the `as any` casts are placeholders for the engine's required envelope fields and should be replaced by the minimal real fields the type lists.

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test .`
Expected: FAIL — `refresh` is not exported; `session.start` opens nothing.

- [ ] **Step 3: Implement the poll and hooks in `register.tsx`**

Replace the file's `register` with the full module (keep the atoms and the `ui.render` hook from Task 6):

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'
import type { FleetState } from '../../types'
import { renderPane } from './render'
import { runFleetSnapshot, POLL_MS } from './snapshot'
import { agentIdsByTicket, correlate, summarize, fingerprint } from './lanes'

export const PANE = 'fleet'
const EMPTY: FleetState = { lanes: [], error: null, fingerprint: '', generatedAt: 0, root: '' }

export const fleet = atom({ plugin: 'concertino', key: 'fleet' } as const, EMPTY)
export const selected = atom({ plugin: 'concertino', key: 'selected' } as const, null)
export const seenEscalations = atom({ plugin: 'concertino', key: 'seenEscalations' } as const, [])

async function mainMessages($: EngineInterface): Promise<readonly SessionMessage[]> {
  try {
    const found = await $.session.messages()
    return Array.isArray(found) ? found : []
  } catch {
    return []
  }
}

/** One poll. Never throws: a failure is recorded in state, the last lanes stay. */
export async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.root()
  const previous = await read($, fleet)
  const got = await runFleetSnapshot($, cwd)
  if (!got.ok) {
    $.ui.status(undefined)
    if (previous.error !== got.error) await update($, fleet, f => ({ ...f, error: got.error }))
    return
  }
  const [agents, messages] = await Promise.all([$.agent.list().catch(() => []), mainMessages($)])
  const lanes = correlate(got.snapshot.runs, agents, agentIdsByTicket(messages))
  const next: FleetState = {
    lanes, error: null, fingerprint: fingerprint(lanes, null),
    generatedAt: got.snapshot.generatedAt, root: got.snapshot.root,
  }
  $.ui.status(summarize(lanes))
  if (next.fingerprint !== previous.fingerprint) await update($, fleet, () => next)
  await toastNewEscalations($, next)
}

async function toastNewEscalations($: EngineInterface, state: FleetState): Promise<void> {
  const seen = await read($, seenEscalations)
  const fresh = state.lanes
    .filter(l => l.run.escalation?.escalationId && !seen.includes(l.run.escalation.escalationId))
  if (!fresh.length) return
  for (const lane of fresh) {
    const esc = lane.run.escalation!
    $.ui.toast(`${lane.run.ticket} needs you: ${esc.question.slice(0, 80)}`)
  }
  await update($, seenEscalations, s => [...s, ...fresh.map(l => l.run.escalation!.escalationId!)].slice(-200))
}

async function openPane($: EngineInterface, focus?: true): Promise<void> {
  const isUp = (await $.ui.panes()).some(p => p.id === PANE)
  if (!isUp || focus) await $.ui.open(focus ? { id: PANE, title: 'Fleet', focus } : { id: PANE, title: 'Fleet' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fleet', description: 'Show concertino lanes in a pane (`/fleet off` closes it)', argumentHint: '[off]' })
    void openPane($)
    $.clock.every(POLL_MS, () => { void refresh($).catch(() => undefined) })
    return next(e)
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      await $.ui.close({ id: PANE })
      return { text: 'Fleet pane closed.' }
    }
    await openPane($, true)
    return { text: 'Fleet pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    return renderPane(els, {
      fleet: await read($, fleet),
      selected: await read($, selected),
      viewAgentId: e.props.view.agentId,
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      now: await $.clock.now(),
      onSelect: ticket => { void update($, selected, () => ticket) },
    })
  })
}
```

- [ ] **Step 4: Validate and test**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate lists hooks `session.start`, `command.run`, `ui.render` and **no gating hooks**; all tests PASS. If `$.session.messages()` returns a `{ deny }` object rather than throwing, `Array.isArray` already handles it.

- [ ] **Step 5: Commit**

```bash
git add hooks/fleet-pane/register.tsx hooks/fleet-pane/refresh.test.ts
git commit -m "Poll concertino fleet every 2s: lanes in state, status line, escalation toasts, /fleet"
```

---

### Task 9: Wire plugin validate/test into `npm test`; type-check

**Files:**
- Create: `test/scripts/plugin-mod.test.sh`
- Modify: `package.json` (`test` script)
- Modify: `.gitignore` (`.claude-plugin/types/` — done in Task 4 if not already)

**Interfaces:** none.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Runs the Claude Code mod's own checks (claude plugin validate/test) as part
# of `npm test`. Skips — exit 0 with a note — when the `claude` CLI is not on
# PATH, so CI without Claude Code still passes; a machine with it installed
# gets the full gate. See docs/superpowers/specs/2026-10-06-fleet-pane-design.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v claude >/dev/null 2>&1; then
  echo "plugin-mod.test.sh: skipped (claude CLI not on PATH)"
  exit 0
fi
cd "$ROOT"
claude plugin validate . --strict
claude plugin test .
echo "plugin-mod.test.sh: ok"
```

`chmod +x test/scripts/plugin-mod.test.sh`.

- [ ] **Step 2: Run it alone**

Run: `bash test/scripts/plugin-mod.test.sh`
Expected: `--strict` passes (if it flags the `types` field or `hooks/hooks.json` as unrecognised on this build, drop `--strict` and note why in the script comment); tests pass; `ok`.

- [ ] **Step 3: Append to `package.json` `test`**

Add ` && bash test/scripts/plugin-mod.test.sh` at the end of the `test` script string.

- [ ] **Step 4: Type-check once the engine has laid the types**

Run: `claude --plugin-dir . -p 'say ok' >/dev/null 2>&1; ls .claude-plugin/types/ && npx -y typescript@5 tsc -p . 2>&1 | head -30`
Expected: `.claude-plugin/types/claude-code/index.d.ts` exists after the load; `tsc` reports no errors. Fix any type errors (most likely: element-table type name, `Button` props, `SessionMessage` import). `npx` is a dev-time check only — do not add TypeScript to `package.json`.

- [ ] **Step 5: Full suite**

Run: `npm test 2>&1 | tail -8`
Expected: everything passes including `plugin-mod.test.sh: ok`.

- [ ] **Step 6: Commit**

```bash
git add test/scripts/plugin-mod.test.sh package.json .gitignore
git commit -m "Run claude plugin validate/test in npm test (skipped without the CLI)"
```

---

### Task 10: Manual verification and PR 2

**Files:** none new (fix-ups only).

- [ ] **Step 1: Load the mod in a repo with live runs**

In a terminal, in a repo that has `.concertino/runs` (this repo after a run, or helio/rama):
```bash
claude --plugin-dir ~/Development/concertino
```
Then `/fleet`. Expected: the pane docks (≥110 cols) with lanes; status line shows `fleet: …`; the transcript carries no `concertino: ui.render (Pane) refused` line.

- [ ] **Step 2: Follow-the-transcript check**

With a driver session running an orchestrator: open the orchestrator's transcript from the tasks list. Expected: the detail switches to that lane; returning to the main transcript restores the selection.

- [ ] **Step 3: Failure path**

Run `PATH=/usr/bin claude --plugin-dir ~/Development/concertino` (so `concertino` is not found) and open `/fleet`. Expected: a red `concertino: exit 127 …` line, no crash, pane stays open; the status line is empty.

- [ ] **Step 4: Record what was verified**

Add the three results as checkboxes under "Manual" in `openspec/changes/fleet-pane/tasks.md` and commit:
```bash
git add openspec/changes/fleet-pane/tasks.md
git commit -m "Record fleet pane manual verification"
```

- [ ] **Step 5: Open PR 2**

Title: `Add the Claude Code fleet pane mod`. Body: link the spec, list the three manual checks, note the install line. Follow `superpowers:finishing-a-development-branch`.

---

## Self-review notes

- Spec coverage: CLI contract (T1–T3), mod files/state/lanes/poll/pane/`/fleet`/status/toast (T4–T8), error table (T4 snapshot errors, T5 external fallback, T8 kept lanes + status clear, T6 inline placement), testing (T1–T2 node, T4–T8 plugin tests, T9 wiring), shipping (T3 docs/OpenSpec, T4 `files`, T10 PR). Hot-reload reopen guard: `openPane` checks `$.ui.panes()` (T8).
- Type consistency: `Lane.liveness` values, `FleetState` fields, `PANE = 'fleet'`, atom refs `{ plugin: 'concertino', key }`, element keys (`lane:<ticket>`, `header`, `error`, `empty`, `detail`, `escalation`, `ticket`, `timeline`, `pr`) are the same in T4–T8.
- Known build-dependent names called out where they must be checked against the engine-written `.d.ts`: element-table type (`Elements`), `ToolUseSummary.agentId`, how a test raises `session.start`/`command.run`, `Text`/`Button` prop acceptance (`marginTop`, `color`, `hotkey` undefined).
