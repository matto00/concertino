# TUI Lazygit-Style Layout Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every existing TUI screen's layout to a lazygit-style shell — a persistent 1-line top bar, a bottom command bar pinned to the terminal's actual last row, unified scrolling (exactly two patterns, shared implementations), a numbered panel-jump convention extended from fleet to drill-down, and a new fleet METRICS panel — without changing any existing keybinding's meaning.

**Architecture:** The top bar and escalation banner move into one fixed region composed once in `watch.js`'s `draw()` (mirroring how the banner is already composed today), so every screen gets both for free without per-screen plumbing. Two shared scroll primitives replace five bespoke implementations: `layout.js`'s new `selectionWindow()` for selection-driven lists (fleet runs, launch pad epics/tickets, drill-down EVIDENCE), and `docview.js`'s existing `scrollDelta`/`clampScroll`/`bodyBox` for read-only text (drill-down TICKET/TIMELINE/GATES, launch plan's ticket list, escalation's context block). Each screen's own render function grows its primary panel to absorb leftover vertical space via `layout.box()`'s existing `height` option.

**Tech Stack:** Node.js (`node --test`), zero npm dependencies, existing `lib/ui/*` module structure.

## Global Constraints

- Zero new npm dependencies (`package.json` has none today and keeps none).
- No behavior change to what any keybinding *does* — this is a layout/rendering pass. New bindings are additive only (drill-down panel jump/focus, new scroll keys on previously-uncapped panels).
- Target terminal: 100+ cols, 30+ rows, with `layout.degrade()`'s existing flat-fallback for anything smaller — unchanged, no new narrow-terminal affordances.
- Every new/changed render function stays pure: `(state, opts) -> string`, no I/O, no held state — matching every existing screen module.
- Full `npm test` must stay green after every task (`node --test` plus the shell test suites already wired into the `test` script).
- Spec: `docs/superpowers/specs/2026-07-30-tui-lazygit-layout-design.md`.

---

## Phase 1: Shared primitives & shell wiring

### Task 1: `layout.js` — `selectionWindow()` helper

**Files:**
- Modify: `lib/ui/layout.js` (add function, extend `module.exports`)
- Test: `test/layout.test.js` (new file — `layout.js` has no dedicated test file today; its behavior is currently only exercised indirectly through screen tests)

**Interfaces:**
- Produces: `selectionWindow(total, selectedIndex, maxVisible, currentOffset) -> { start, count, offset }` — `start`/`count` describe the visible slice `[start, start+count)` of a `total`-length list; `offset` is the (possibly re-clamped) scroll offset the caller should persist for the next call. Pure, no side effects.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { selectionWindow } = require('../lib/ui/layout');

test('selectionWindow shows everything when total fits within maxVisible', () => {
  const w = selectionWindow(3, 0, 5, 0);
  assert.deepEqual(w, { start: 0, count: 3, offset: 0 });
});

test('selectionWindow keeps offset 0 while the selection is still within the first window', () => {
  const w = selectionWindow(20, 4, 10, 0);
  assert.deepEqual(w, { start: 0, count: 10, offset: 0 });
});

test('selectionWindow scrolls forward the minimum amount to keep a selection past the window visible', () => {
  const w = selectionWindow(20, 12, 10, 0);
  // selectedIndex 12 must be the last visible row: start = 12 - 10 + 1 = 3
  assert.deepEqual(w, { start: 3, count: 10, offset: 3 });
});

test('selectionWindow scrolls backward when the selection moves above the current window', () => {
  const w = selectionWindow(20, 2, 10, 8);
  assert.deepEqual(w, { start: 2, count: 10, offset: 2 });
});

test('selectionWindow clamps offset so the window never runs past the end of the list', () => {
  const w = selectionWindow(12, 11, 10, 0);
  // last possible start is 12 - 10 = 2
  assert.deepEqual(w, { start: 2, count: 10, offset: 2 });
});

test('selectionWindow with a stale offset still resolves to a window containing the selection', () => {
  const w = selectionWindow(20, 0, 10, 15);
  assert.deepEqual(w, { start: 0, count: 10, offset: 0 });
});

test('selectionWindow with zero total returns an empty window', () => {
  const w = selectionWindow(0, 0, 10, 0);
  assert.deepEqual(w, { start: 0, count: 0, offset: 0 });
});

test('selectionWindow floors maxVisible at 1 to avoid a zero-row window with a non-empty list', () => {
  const w = selectionWindow(5, 2, 0, 0);
  assert.deepEqual(w, { start: 2, count: 1, offset: 2 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — `selectionWindow is not a function` (not yet exported).

- [ ] **Step 3: Implement `selectionWindow`**

Add to `lib/ui/layout.js`, above `module.exports`:

```js
// The one shared "keep a selection visible inside a scrolling window"
// implementation — replaces fleet.js's own scrollOffset arithmetic
// (visibleWindow), launchpad.js's windowStart, and drilldown.js's
// evidenceWindow, each of which computed this same property a different way.
// Pure: given the list's total length, the current selection, how many rows
// can be shown at once, and the caller's last-known scroll offset, returns
// the window to render this frame PLUS the offset to persist for next time
// (re-clamped so a shrunk list, or a selection that jumped, never leaves a
// stale window).
function selectionWindow(total, selectedIndex, maxVisible, currentOffset) {
  const t = Math.max(0, total || 0);
  if (t === 0) return { start: 0, count: 0, offset: 0 };

  const max = Math.max(1, maxVisible || 0);
  const count = Math.min(t, max);
  const maxStart = Math.max(0, t - count);

  let start = Math.max(0, Math.min(currentOffset || 0, maxStart));
  const sel = Math.max(0, Math.min(selectedIndex || 0, t - 1));
  if (sel < start) {
    start = sel;
  } else if (sel > start + count - 1) {
    start = sel - count + 1;
  }
  start = Math.max(0, Math.min(start, maxStart));

  return { start, count, offset: start };
}
```

- [ ] **Step 4: Export it**

Modify `lib/ui/layout.js`'s final line:

```js
module.exports = { box, hsplit, degrade, selectionWindow, BORDERS, MIN_BOX_WIDTH, MIN_BOX_HEIGHT };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS (8/8).

- [ ] **Step 6: Commit**

```bash
git add lib/ui/layout.js test/layout.test.js
git commit -m "layout: add shared selectionWindow() helper for scrolling lists"
```

---

### Task 2: `lib/ui/topbar.js` — the persistent top-bar line

**Files:**
- Create: `lib/ui/topbar.js`
- Test: `test/topbar.test.js`

**Interfaces:**
- Consumes: a `state`-shaped object with `runs` (array of reducer `Run` objects — `status`, `.project`) and `queueState` (`{ pending: string[], inFlight: Set, maxConcurrent: number } | null`), plus a `screenLabel` string.
- Produces: `buildTopBarLine(state, screenLabel, opts) -> string` — one already-`f.truncate`d line, ANSI-coloured via `f.bold`/`f.dim`, matching the visual style of fleet.js's existing header line (`f.bold('concertino') + f.dim(' · ' + project) + ...`).

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTopBarLine } = require('../lib/ui/topbar');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({ ticket: 'HEL-1', project: 'helio', status: 'running' }, over);
}

test('names the project and screen', () => {
  const out = plain(buildTopBarLine({ runs: [run({})], queueState: null }, 'FLEET', { cols: 80 }));
  assert.match(out, /helio/);
  assert.match(out, /FLEET/);
});

test('counts runs and needs-you separately', () => {
  const out = plain(buildTopBarLine({
    runs: [run({ status: 'needs-you' }), run({ ticket: 'HEL-2', status: 'running' })],
    queueState: null,
  }, 'FLEET', { cols: 80 }));
  assert.match(out, /2 runs/);
  assert.match(out, /1 needs you/);
});

test('omits the needs-you clause entirely when nothing needs attention', () => {
  const out = plain(buildTopBarLine({ runs: [run({})], queueState: null }, 'FLEET', { cols: 80 }));
  assert.doesNotMatch(out, /needs you/);
});

test('names an active queue, omits the clause when there is none', () => {
  const withQueue = plain(buildTopBarLine({
    runs: [], queueState: { pending: ['HEL-9'], inFlight: new Set(), maxConcurrent: 1 },
  }, 'FLEET', { cols: 80 }));
  assert.match(withQueue, /queue: 1 pending/);

  const withoutQueue = plain(buildTopBarLine({ runs: [], queueState: null }, 'FLEET', { cols: 80 }));
  assert.doesNotMatch(withoutQueue, /queue:/);
});

test('an empty fleet still names the project and screen', () => {
  const out = plain(buildTopBarLine({ runs: [], queueState: null }, 'DRILL-DOWN', { cols: 80 }));
  assert.match(out, /DRILL-DOWN/);
});

test('stays within cols at a narrow width', () => {
  const { visibleLength } = require('../lib/ui/format');
  const out = buildTopBarLine({
    runs: [run({ project: 'a-very-long-project-name-indeed' })], queueState: null,
  }, 'LAUNCH PLAN', { cols: 40 });
  assert.ok(visibleLength(out) <= 40);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/topbar.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/topbar'`.

- [ ] **Step 3: Implement `topbar.js`**

```js
'use strict';

// The one persistent, always-first line every screen renders — project
// identity plus fleet-wide state (run counts, active queue) regardless of
// which screen is currently on top. Pure: (state, screenLabel, opts) ->
// string. Composed once, centrally, in watch.js's draw() (mirroring how
// banner.js's cross-screen notice is already composed today) rather than
// duplicated per screen — every screen's render(state, opts) already
// receives the full state (runs, queueState), so no new data plumbing is
// needed to call this from watch.js.

const f = require('./format');

function buildTopBarLine(state, screenLabel, opts) {
  const cols = Math.max(20, (opts && opts.cols) || 80);
  const runs = (state && state.runs) || [];
  const queueState = state && state.queueState;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you').length;
  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou ? ` · ${needsYou} needs you` : '');

  const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
  const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
  const queueLabel = (pendingCount || inFlightCount)
    ? ` · queue: ${pendingCount} pending${inFlightCount ? `, ${inFlightCount} running` : ''}`
    : '';

  const left = f.bold('concertino') + f.dim(' · ' + project) + '  ' + f.dim('· ' + screenLabel);
  const right = f.dim(countLabel + queueLabel);
  return f.truncate(left + '  ' + right, cols);
}

module.exports = { buildTopBarLine };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/topbar.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/topbar.js test/topbar.test.js
git commit -m "ui: add shared persistent top-bar line builder"
```

---

### Task 3: Wire the top bar + banner into `watch.js`'s fixed frame region

**Files:**
- Modify: `lib/ui/watch.js` (`computeScreenRows`, `draw()`'s frame-composition block, and the `mode -> screen label` mapping)
- Test: `test/watch.test.js`

**Interfaces:**
- Consumes: `topbar.buildTopBarLine(state, screenLabel, opts)` (Task 2).
- Produces: every frame `watch.js` writes now begins with the top-bar line, then the banner (if any live escalation exists), then the screen's own content — and `computeScreenRows()` reserves 1 additional row for the top bar on top of its existing banner reservation, so every screen's own `rows` budget already accounts for it.

- [ ] **Step 1: Locate the current banner-composition code to extend**

Read `lib/ui/watch.js` around `computeScreenRows` (search for `bannerLines`) and the `draw()` frame-composition block (search for `const rendered = (bannerText ? bannerText + '\n' : '')`). Confirm the exact current text before editing — this task's diff below assumes:

```js
function computeScreenRows() {
  // ... existing banner-lines computation ...
  return totalRows > 0 ? Math.max(0, totalRows - bannerLines) : 0;
}
```

and, later in `draw()`:

```js
const rendered = (bannerText ? bannerText + '\n' : '') + screenText + '\n';
```

- [ ] **Step 2: Write the failing integration test**

Add to `test/watch.test.js`, alongside the existing `screenOf(written)` helper used by the CON-6/CON-27 scroll/resize tests:

```js
test('every frame begins with the persistent top bar naming the project and current screen', async () => {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-topbar-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ kind: 'run.start', t: 1, project: 'helio', branch: 'feature/x/HEL-1' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return []; }, capture() { return ''; },
    captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
  };
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });
    const frame = screenOf(written);
    const firstLine = frame.split('\n')[0];
    assert.match(firstLine, /helio/);
    assert.match(firstLine, /FLEET/);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/watch.test.js`
Expected: FAIL — the first line is the existing `concertino · helio  1 run` header, with no `FLEET` label.

- [ ] **Step 4: Implement the wiring**

In `lib/ui/watch.js`, add the require near the other screen/module requires:

```js
const topbar = require('./topbar');
```

Add a `mode -> screen label` map near the top of the file, alongside the other module-level constants:

```js
// The top bar's own screen-name label — deliberately distinct from
// router.js's SCREENS keys (those are internal mode strings; these are the
// human-facing names topbar.js prints, matching each screen's own on-
// screen title where one exists, e.g. drilldown's own header rows vs. this
// short label).
const SCREEN_LABELS = {
  fleet: 'FLEET',
  escalation: 'ESCALATION',
  drilldown: 'DRILL-DOWN',
  launchpad: 'LAUNCH PAD',
  ticketview: 'TICKET',
  launchplan: 'LAUNCH PLAN',
  docview: 'EVIDENCE',
};
```

Modify `computeScreenRows()` to reserve one more row for the top bar, on top of its existing banner reservation:

```js
function computeScreenRows() {
  // ... existing banner-lines computation producing `bannerLines` ...
  const reserved = bannerLines + 1; // +1 for the persistent top bar
  return totalRows > 0 ? Math.max(0, totalRows - reserved) : 0;
}
```

Modify the frame-composition block in `draw()`:

```js
const topBarLine = topbar.buildTopBarLine(currentState(), SCREEN_LABELS[mode] || mode.toUpperCase(), {
  cols: process.stdout.columns || 80,
});
const rendered = topBarLine + '\n' + (bannerText ? bannerText + '\n' : '') + screenText + '\n';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/watch.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite to check for regressions from the reserved row**

Run: `npm test`
Expected: PASS — the CON-27 resize tests and CON-6 scroll tests already compute their own row budgets from `computeScreenRows()`'s output, so a smaller returned value should not break them, but confirm no fixture assumed the raw terminal height equalled the available screen rows.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/watch.js test/watch.test.js
git commit -m "ui: pin the persistent top bar above the banner and every screen"
```

---

## Phase 2: Fleet view

### Task 4: `[N]` panel-number labels in fleet section titles

**Files:**
- Modify: `lib/ui/screens/fleet.js:729-822` (the `renderFleet` per-section render loop)
- Test: `test/fleet.test.js`

**Interfaces:**
- No new exported functions — purely a title-string change inside `renderFleet`'s existing loop.

- [ ] **Step 1: Write the failing test**

Add to `test/fleet.test.js`:

```js
test('a rendered section title is prefixed with its digit-jump number', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ], OPTS));
  assert.match(out, /\[1\] NEEDS YOU/);
  assert.match(out, /\[2\] RUNNING/);
});

test('section numbering skips sections that are not on screen this frame, matching sectionJumpTargets', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS));
  // NEEDS YOU and RUNNING are both empty (never rendered) — DONE is the
  // first (and only) section on screen, so it must be numbered [1], not
  // whatever position it holds in buildSections' own full list.
  assert.match(out, /\[1\] DONE/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — titles render without a `[N]` prefix.

- [ ] **Step 3: Implement the numbering**

In `lib/ui/screens/fleet.js`, inside `renderFleet` (around line 729, just before `sections.forEach`), add a counter:

```js
  const out = head.slice();
  let index = 0;
  let jumpNumber = 0;
  sections.forEach((s, i) => {
    const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
```

Then, immediately after the early-return checks (both the `forceRender`-empty branch's `return` and the fully-collapsed `w.shown === 0` branch's `return` must NOT increment the counter — only sections that actually draw a titled box do), increment and build the numbered title once, right before it is first used. Concretely: after the `if (!s.group.length) { if (!s.forceRender) return; ... }` block's early return, and after the `if (w.shown === 0) { ...; return; }` block's early return, insert:

```js
    jumpNumber += 1;
    const numberedTitle = `[${jumpNumber}] ${s.title}`;
```

Then replace every remaining `colourTitle(s.title)` call in this function (the `forceRender`-empty box, and the normal box — both the `layout.degrade()` fallback and the `layout.box()` call) with `colourTitle(numberedTitle)`. Leave the `w.shown === 0` "… and N more X" line (`s.title.toLowerCase()`) and the collapsed-fallback title lines (`out.push('  ' + colourTitle(s.title))` inside `layout.degrade()` branches) — replace those too, for consistency, EXCEPT the lowercase "and N more" text, which reads oddly with a bracket prefix and should keep using the raw `s.title`.

The exact placement: `jumpNumber` must increment once per section that survives BOTH early-returns (i.e., once per section actually drawn as its own box or degraded-flat block) — this is exactly the same population `sectionJumpTargets` already numbers (Task 5 confirms they never diverge).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS, and no other existing test's title-matching regex (e.g. `assert.match(out, /DONE/)`) breaks — `/DONE/` still matches inside `[N] DONE`.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "fleet: label each section's title with its digit-jump number"
```

---

### Task 5: Assert `renderFleet`'s title numbering never disagrees with `sectionJumpTargets`

**Files:**
- Modify: `test/fleet.test.js` (add a property test, no production code change)

**Interfaces:**
- Consumes: `sectionJumpTargets` (already exported), `renderFleet`.

- [ ] **Step 1: Write the test**

```js
test('the [N] shown in a title always equals the digit that actually jumps to it', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
    run({ ticket: 'HEL-4', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  const targets = sectionJumpTargets(runs, null, false);
  const out = plain(renderFleet(runs, OPTS));
  targets.forEach((t, i) => {
    const n = i + 1;
    assert.match(out, new RegExp(`\\[${n}\\] ${t.section.title.replace(/[[\]()]/g, '\\$&')}`));
  });
});
```

`sectionJumpTargets` needs to be in this test file's import — confirm it already is (it is: `require('../lib/ui/screens/fleet')` destructures it already for other existing tests in this file; if not already imported, add it to the destructure at the top).

- [ ] **Step 2: Run to verify it passes**

Run: `node --test test/fleet.test.js`
Expected: PASS immediately (Task 4 already made this true) — this step exists to lock the invariant down as a regression test, not to drive new implementation.

- [ ] **Step 3: Commit**

```bash
git add test/fleet.test.js
git commit -m "fleet: pin down that title numbering never disagrees with digit-jump"
```

---

### Task 6: DONE/FAILED rows collapse to 1 line

**Files:**
- Modify: `lib/ui/screens/fleet.js` — `buildSections` (`linesPerRow` for FAILED/DONE entries, ~line 325-326) and a new row renderer
- Test: `test/fleet.test.js`

**Interfaces:**
- Produces: `renderFinishedRow(run, opts, avgDoneMs) -> string[]` — always exactly 1 line, sibling to the existing `renderRun` (2-line, still used for NEEDS YOU/RUNNING).

- [ ] **Step 1: Write the failing tests**

```js
test('a DONE row renders as exactly one line', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  const lines = out.split('\n').filter((l) => /HEL-1/.test(l));
  assert.equal(lines.length, 1);
});

test('a FAILED row renders as exactly one line', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  const lines = out.split('\n').filter((l) => /HEL-2/.test(l));
  assert.equal(lines.length, 1);
});

test('a DONE row names the ticket, branch, end status and elapsed time on its single line', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', changeName: 'add-retry', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS));
  assert.match(out, /HEL-1/);
  assert.match(out, /add-retry/);
  assert.match(out, /delivered/);
  assert.match(out, /1m/);
});

test('NEEDS YOU and RUNNING rows are unaffected — still two lines', () => {
  const out = renderFleet([run({ ticket: 'HEL-3', status: 'running' })], OPTS);
  const lines = out.split('\n').filter((l) => /HEL-3|▓|░/.test(l) || l.includes('running'));
  // The bar/status line is a SEPARATE line from the ticket line — assert
  // both are present rather than collapsed onto one.
  const ticketLine = out.split('\n').find((l) => l.includes('HEL-3'));
  const idx = out.split('\n').indexOf(ticketLine);
  const nextLine = out.split('\n')[idx + 1];
  assert.notEqual(nextLine.trim(), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — DONE/FAILED rows currently render 2 lines each (the existing `renderRun`, still used via `linesPerRow: 2`).

- [ ] **Step 3: Implement `renderFinishedRow` and wire it in**

Add near `renderRun` (after it, ~line 189):

```js
// A finished (DONE/FAILED) run's progress bar/phase/gates detail is no
// longer LIVE information — collapsing it to one line roughly doubles how
// much history fits on screen (design.md's "dense, glanceable" trait).
// NEEDS YOU/RUNNING keep renderRun's 2-line shape; that bar IS live there.
function renderFinishedRow(run, opts, selected) {
  const marker = selected ? '▸' : ' ';
  const name = run.changeName || f.dim('(no branch yet)');
  const statusColour = f.STATUS_COLOUR[run.status] || f.dim;
  const endLabel = run.endStatus || (run.status === 'failed' ? 'window exited' : run.status);
  let durPart = f.dur(run.elapsedMs);
  if (run.status === 'done' && opts.avgDoneMs != null && run.elapsedMs != null) {
    if (run.elapsedMs > opts.avgDoneMs) durPart += ' ' + f.red('▲');
    else if (run.elapsedMs < opts.avgDoneMs) durPart += ' ' + f.green('▼');
  }
  const left = `  ${marker} ${f.bold(f.padTo(run.ticket, 9))} ${name}`;
  const right = statusColour(endLabel) + '  ' + f.dim(durPart);
  const gap = Math.max(2, opts.cols - f.visibleLength(left) - f.visibleLength(right));
  return [f.truncate(left + ' '.repeat(gap) + right, opts.cols)];
}
```

Change `buildSections`' FAILED/DONE entries (~line 325-326) from `linesPerRow: 2` to `linesPerRow: 1`:

```js
  sections.push(
    { title: 'FAILED', group: buckets.failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 1, kind: 'failed' },
    { title: 'DONE',   group: buckets.done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 1, kind: 'done' },
  );
```

In `renderFleet`'s row-render loop (~line 795-798), dispatch FAILED/DONE to the new renderer instead of `renderRun`:

```js
      } else if (s.kind === 'failed' || s.kind === 'done') {
        const rowIndex = sectionStartIndex + k;
        for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs }, rowIndex === selected)) contentLines.push(line);
      } else {
        const rowIndex = sectionStartIndex + k;
        for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs }, rowIndex === selected)) contentLines.push(line);
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS. Check the full file's existing tests too — several DONE/FAILED-related assertions (e.g. the "a delivered run and a failed run render under different headings" test, the arrow tests from the earlier delivery-time feature) assert on *content* (ticket id, "delivered", arrow glyphs), which `renderFinishedRow` still emits — but re-run the full file to catch any test asserting on exact 2-line row structure for DONE/FAILED specifically (e.g. `manyFinished()`-based height-budget tests) and adjust their expected row counts.

Run: `node --test test/fleet.test.js` again after any fixes.
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "fleet: collapse DONE/FAILED rows to one line each"
```

---

### Task 7: Refactor fleet's scroll math onto `layout.selectionWindow`

**Files:**
- Modify: `lib/ui/screens/fleet.js` — `visibleWindow` (~line 528-679, the non-pinned-section windowing loop)
- Test: `test/fleet.test.js` (existing scroll tests — this is a behavior-preserving refactor; the tests should NOT need new assertions, only need to keep passing)

**Interfaces:**
- Consumes: `layout.selectionWindow` (Task 1).

- [ ] **Step 1: Confirm the existing scroll test suite is the safety net**

Run: `node --test test/fleet.test.js -- --test-name-pattern="scroll|jump|window"`
Expected: PASS (baseline, before refactor) — note the passing count to compare after.

- [ ] **Step 2: Refactor the per-section windowing loop**

In `visibleWindow` (~line 528), the loop that computes `startOffset`/`shown` per non-pinned, non-unselectable section currently walks `remaining`/`globalIndex` by hand. Replace the per-section branch that computes a scrollable section's window with a call to `layout.selectionWindow`. Concretely, where the function currently does (for a non-pinned, non-unselectable section):

```js
    } else if (remaining > 0) {
      startOffset = remaining;
      shown = Math.min(s.cap, groupLen - startOffset);
      remaining = 0;
    } else {
      shown = Math.min(s.cap, groupLen);
    }
```

this whole scrolling-offset resolution (plus the `remaining >= groupLen` "entirely scrolled past" branch above it) is exactly what `selectionWindow(groupLen, /* the selection's local index if inside this section, else 0 */, s.cap, /* the section's own share of `remaining` */)` computes in one call — but because `visibleWindow`'s `scrollOffset` is a single FLEET-WIDE offset spanning multiple sections back-to-back (not one offset per section), this refactor is scoped to the parts of the loop that are genuinely per-section-local: replace the `remaining > 0`/`else` branches above with a `layout.selectionWindow`-based equivalent that produces the identical `{ startOffset, shown }` pair, keeping the cross-section `remaining` bookkeeping (which section absorbs how much of the fleet-wide scrollOffset) as `visibleWindow`'s own concern — `selectionWindow` is not a drop-in replacement for the WHOLE function, only for the "given this section's own local offset and cap, what window shows" arithmetic each branch already computes independently. Extract that shared computation into a small local helper backed by `selectionWindow`:

```js
    } else if (remaining > 0) {
      const win = layout.selectionWindow(groupLen, remaining, s.cap, remaining);
      startOffset = win.start;
      shown = win.count;
      remaining = 0;
    } else {
      const win = layout.selectionWindow(groupLen, 0, s.cap, 0);
      shown = win.count;
    }
```

Require `layout` is already imported at the top of `fleet.js` (`const layout = require('../layout');`) — no new require needed.

- [ ] **Step 3: Run the scroll test suite to verify it still passes byte-for-byte**

Run: `node --test test/fleet.test.js -- --test-name-pattern="scroll|jump|window"`
Expected: PASS, same count as Step 1's baseline — if any test now fails, the refactor changed observable behavior, which this task must NOT do; fix the call site (not the test) until the baseline count matches again.

- [ ] **Step 4: Run the full fleet test file**

Run: `node --test test/fleet.test.js`
Expected: PASS (full file, unchanged pass count from before this task).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js
git commit -m "fleet: route section scrolling through the shared selectionWindow helper"
```

---

### Task 8: Fleet sections grow to fill available height

**Files:**
- Modify: `lib/ui/screens/fleet.js` — `renderFleet` (the per-section box-drawing loop, ~line 802-821) and `visibleWindow`'s height-budget block (~line 630-660, the trim-from-bottom loop)
- Test: `test/fleet.test.js`

**Interfaces:**
- No new exported functions — `renderFleet`'s existing `opts.rows` contract is extended: when actual content is shorter than the budget, the LAST rendered section's box height grows (via `layout.box()`'s existing `height` option) to consume the slack, so the trailing hint line lands on `rows - 1`.

- [ ] **Step 1: Write the failing test**

```js
test('with vertical space to spare, the last section grows to push the footer to the last row', () => {
  const out = renderFleet([run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })],
    { cols: 78, selected: 0, rows: 30 });
  const lines = out.split('\n');
  // rows: 30 reserves the trailing-newline row (fleet.js's existing `rows -
  // 1` convention — see visibleWindow's own `budget` comment), so the footer
  // line must be at index 28 (0-based), the last CONTENT row this frame can
  // use.
  assert.match(lines[28], /attach/);
});

test('with no rows budget given (0/absent), rendering is unbounded exactly as before this change', () => {
  const out = renderFleet([run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })],
    { cols: 78, selected: 0 });
  const lines = out.split('\n');
  assert.ok(lines.length < 20, 'unbounded render must stay tight to content, not pad out to some default height');
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `node --test test/fleet.test.js`
Expected: FAIL — today's `renderFleet` never pads; the footer lands right after the last section's content, well above row 28.

- [ ] **Step 3: Implement grow-to-fill**

In `renderFleet`, after the `sections.forEach(...)` loop finishes building `out` (right before `for (const line of tail) out.push(line);`, ~line 824), compute the slack and pad the LAST section's box height before it was pushed — this requires restructuring the loop slightly to know, ahead of drawing each section's box, whether it is the last one actually rendered. Concretely: first compute how many rows every OTHER part of the frame will cost (head, tail, every section except the last rendered one), then give the last rendered section's `layout.box()` call an explicit `height` at least as large as its natural content requires, topped up by the leftover budget:

```js
  const budget = (opts && opts.rows) > 0 ? opts.rows - 1 : 0;
  // Index of the LAST section that will actually render this frame (passes
  // both early-return checks) — computed once, up front, so the loop below
  // knows which section is the one that should absorb any leftover height.
  const renderableIndices = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.group.length > 0 || s.forceRender)
    .map(({ i }) => i);
  const lastRenderableIndex = renderableIndices.length ? renderableIndices[renderableIndices.length - 1] : -1;
```

Then, inside the loop, where each section's `boxHeight` is computed (both the `forceRender`-empty branch, ~line 739, and the normal branch, ~line 802), grow ONLY when `i === lastRenderableIndex` and a budget is given:

```js
    const naturalBoxHeight = contentLines.length + 2;
    let boxHeight = naturalBoxHeight;
    if (budget > 0 && i === lastRenderableIndex) {
      const usedSoFar = out.length + tail.length;
      boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
    }
```

replacing the existing plain `const boxHeight = contentLines.length + 2;` assignments in both branches with this block, and passing `boxHeight` (not `naturalBoxHeight`) to both the `layout.degrade(cols, boxHeight)` check and the `layout.box(contentLines, { width: cols, height: boxHeight, title: ..., focused: false })` call in the normal branch (the `forceRender`-empty branch's `layout.box` call must also gain `height: boxHeight`, since today it omits `height` entirely and lets `box()` infer it from content).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS (both new tests), and re-run the FULL file — several existing height-budget tests (`visibleWindow`'s trim tests, the "a long history renders a bounded number of rows" test) assert on exact row counts when the fleet OVERFLOWS the budget; confirm none of them accidentally pass `rows` large enough to trigger the new grow path where they didn't expect padding, and adjust any fixture that now gets extra blank rows it wasn't asserting on (most of those tests use `assert.match`/`assert.ok(... indexOf ...)`, which tolerate extra trailing blank rows; if any uses a strict `assert.equal(lines.length, N)`, update `N`).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "fleet: grow the last section to fill available height, pinning the footer"
```

---

### Task 9: Fleet METRICS panel

**Files:**
- Modify: `lib/ui/screens/fleet.js` — new `metricsFor()` helper, `buildSections`, `renderFleet` (thread `now`), `sectionJumpTargets`'s digit-jump `switch` in `handleKey`
- Test: `test/fleet.test.js`

**Interfaces:**
- Produces: `metricsFor(runs, now) -> { avgMs: number|null, deliveredToday: number, deliveredWeek: number, escalationsToday: number }`. "Today" is a UTC calendar-day boundary (`Math.floor(now / DAY_MS) * DAY_MS`); "this week" is a rolling 7-day window (`now - 7 * DAY_MS`), not a calendar week — chosen for determinism (no timezone/DST dependence) over calendar-week semantics.

- [ ] **Step 1: Write the failing tests**

```js
const { metricsFor } = require('../lib/ui/screens/fleet'); // add to the existing destructured import

const DAY_MS = 24 * 60 * 60 * 1000;

test('metricsFor computes the average delivery time across done runs with elapsedMs', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', elapsedMs: 60000 }),
    run({ ticket: 'HEL-2', status: 'done', elapsedMs: 120000 }),
  ], 1000000);
  assert.equal(m.avgMs, 90000);
});

test('metricsFor.avgMs is null with no done runs at all', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.equal(m.avgMs, null);
});

test('metricsFor counts deliveries within today\'s UTC calendar day', () => {
  const now = 10 * DAY_MS + 3600000; // 1h into day 10
  const todayStart = 10 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart + 1000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 1000, elapsedMs: 1000 }), // yesterday
  ], now);
  assert.equal(m.deliveredToday, 1);
});

test('metricsFor counts deliveries within the rolling 7-day window for "this week"', () => {
  const now = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: now - 3 * DAY_MS, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: now - 8 * DAY_MS, elapsedMs: 1000 }), // outside window
  ], now);
  assert.equal(m.deliveredWeek, 1);
});

test('metricsFor counts escalation.raised events across every run\'s own event log, today only', () => {
  const now = 5 * DAY_MS + 1000;
  const todayStart = 5 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'needs-you', events: [
      { kind: 'escalation.raised', t: todayStart + 10 },
      { kind: 'escalation.raised', t: todayStart - 10 }, // yesterday
    ] }),
  ], now);
  assert.equal(m.escalationsToday, 1);
});

test('the fleet view shows a METRICS section after DONE with real numbers', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], { ...OPTS, now: 100000 }));
  assert.match(out, /METRICS/);
  assert.match(out, /avg delivery/);
  assert.match(out, /delivered today/);
});

test('pressing the METRICS section\'s own digit is a no-op, not a broken jump', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  // DONE is [1], METRICS is [2] (both always render — DONE has one entry,
  // METRICS is forceRender: true).
  assert.equal(handleKey('2', state({ runs })), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `metricsFor` is not exported; no METRICS section renders; `handleKey('2', ...)` currently falls through to `{ type: 'jump', index: null }` via the digit-jump switch's `default` case, not `null`.

- [ ] **Step 3: Implement `metricsFor`**

Add near the top of `lib/ui/screens/fleet.js`, after the existing constants block:

```js
const DAY_MS = 24 * 60 * 60 * 1000;

// Fleet-wide roll-up for the METRICS panel — a pure function of `runs` and
// `now`, reusing the exact avg-delivery-time computation renderFleet already
// does inline for the DONE-row arrows (folded in here as the one shared
// implementation rather than kept as two). "Today" is a UTC calendar-day
// boundary; "this week" is a rolling 7-day window, not a calendar week —
// deterministic across timezones/DST, good enough for a glanceable summary.
function metricsFor(runs, now) {
  const done = (runs || []).filter((r) => r.status === 'done');
  const withElapsed = done.filter((r) => r.elapsedMs != null);
  const avgMs = withElapsed.length
    ? withElapsed.reduce((sum, r) => sum + r.elapsedMs, 0) / withElapsed.length
    : null;

  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const weekStart = now - 7 * DAY_MS;
  const deliveredToday = done.filter((r) => r.endedAt != null && r.endedAt >= todayStart).length;
  const deliveredWeek = done.filter((r) => r.endedAt != null && r.endedAt >= weekStart).length;

  let escalationsToday = 0;
  for (const r of runs || []) {
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised' && ev.t >= todayStart) escalationsToday++;
    }
  }

  return { avgMs, deliveredToday, deliveredWeek, escalationsToday };
}
```

- [ ] **Step 4: Refactor the existing inline avgDoneMs computation to reuse `metricsFor`**

In `renderFleet` (~line 715-721), replace:

```js
  const doneWithElapsed = buckets.done.filter((r) => r.elapsedMs != null);
  const avgDoneMs = doneWithElapsed.length
    ? doneWithElapsed.reduce((sum, r) => sum + r.elapsedMs, 0) / doneWithElapsed.length
    : null;
```

with:

```js
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const metrics = metricsFor(runs, now);
  const avgDoneMs = metrics.avgMs;
```

(`buckets.done` is no longer needed for this specific computation, but is still used elsewhere in the function — leave `buckets` itself in place.)

- [ ] **Step 5: Add the METRICS section to `buildSections`**

In `buildSections` (~line 324, right after the FAILED/DONE `sections.push(...)` call), add a new entry reusing the exact `forceRender`/`emptyHint` mechanism QUICK START already established — always shown, one summary line, no selectable rows:

```js
  const metrics = o.metrics;
  if (metrics) {
    const avgText = metrics.avgMs != null ? f.dur(metrics.avgMs) : 'n/a';
    sections.push({
      title: 'METRICS',
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyHint: `avg delivery ${avgText} · delivered today ${metrics.deliveredToday} · ` +
        `this week ${metrics.deliveredWeek} · escalations today ${metrics.escalationsToday}`,
    });
  }
```

`buildSections` needs `f` (already imported at the top of the file) and `o.metrics` threaded through every one of its 3 call sites' `opts` argument. `renderFleet` already forwards its own `opts` object to `buildSections(buckets, queueState, opts)` (Task from the CON-40 merge) — add `metrics` onto that same object right before the call:

```js
  const sections = buildSections(buckets, queueState, Object.assign({}, opts, { metrics }));
```

`sectionJumpTargets` and `visibleWindow` also call `buildSections` — thread `metrics` through their own `opts` the same way `quickStartVisible` already is (both already forward `opts` in full to `buildSections` per the CON-40 merge, so `visibleWindow(runs, opts)` needs `opts.metrics` set by whoever calls it — that is `render(state, opts)`, updated in the next step). `sectionJumpTargets(runs, queueState, quickStartVisible)` does NOT currently forward a `metrics` value at all (it builds its own narrow `{ quickStartVisible }` opts object) — extend its signature and internal call:

```js
function sectionJumpTargets(runs, queueState, quickStartVisible, metrics) {
  const sections = buildSections(bucketRuns(runs), queueState, { quickStartVisible, metrics })
    .filter((s) => s.group.length > 0 || s.forceRender);
```

and update its one call site inside `handleKey`'s digit-jump branch:

```js
    const targets = sectionJumpTargets(runs, queueState, quickStartVisible, state && state.metrics);
```

- [ ] **Step 6: Thread `now`/`metrics` through `render(state, opts)`**

`render(state, opts)` (~line 1092) currently calls `renderFleet(state.runs, Object.assign({}, opts, {...}))`. `renderFleet` itself now computes `metrics` internally (Step 4) from `runs`/`now` — no new field needs to flow INTO `renderFleet` from `render()` for the panel to show up, since `renderFleet` builds `metrics` itself and threads it into ITS OWN `buildSections`/`visibleWindow` calls. The one gap: `visibleWindow(runs, opts)` is called separately, with `opts` as received by `renderFleet` (not the `Object.assign` with `metrics` used for the `buildSections` call) — `visibleWindow` also needs `metrics` in its own `opts` for its internal `buildSections` call's height-budget accounting to include the METRICS row. Update the `visibleWindow` call site inside `renderFleet` to pass the same augmented opts:

```js
  const augmentedOpts = Object.assign({}, opts, { metrics });
  const win = visibleWindow(runs, augmentedOpts);
```

and use `buildSections(buckets, queueState, augmentedOpts)` for the `sections` computation right after it, replacing the `Object.assign` inline from Step 5 with a reference to this one shared `augmentedOpts` variable (avoid building the same object twice). Note `metrics` itself must be computed (Step 4) BEFORE this point in the function, which it already is (Step 4's edit sits above `visibleWindow`'s call site — if not, move Step 4's block up).

`handleKey`'s digit-jump branch (Step 5's `sectionJumpTargets` call) reads `state && state.metrics` — this means `watch.js`'s `currentState()` does not need a `metrics` field at all, since `handleKey` only needs `metrics` to know whether the METRICS section is ON SCREEN (always true — `forceRender: true` unconditionally, no gating flag the way `quickStartVisible` gates QUICK START). Simplify: drop the `state.metrics` plumbing entirely and instead pass a fixed truthy sentinel, since METRICS' presence is unconditional (unlike QUICK START, which can be toggled off):

```js
    const targets = sectionJumpTargets(runs, queueState, quickStartVisible, true);
```

(and `metricsFor` is never actually consulted by `sectionJumpTargets` — only whether the section is INCLUDED matters there, not its content — so the 4th parameter can be renamed `metricsVisible` for clarity):

```js
function sectionJumpTargets(runs, queueState, quickStartVisible, metricsVisible) {
  const sections = buildSections(bucketRuns(runs), queueState, {
    quickStartVisible,
    metrics: metricsVisible ? {} : null,
  }).filter((s) => s.group.length > 0 || s.forceRender);
```

(passing `{}` rather than real numbers is sufficient here — `buildSections`' METRICS branch only checks truthiness of `o.metrics` to decide inclusion; the actual displayed text is built by `renderFleet`'s own call, which always has real `metrics`).

- [ ] **Step 7: Handle the METRICS digit explicitly (no-op, not a broken jump)**

In `handleKey`'s digit-jump `switch (target.section.kind)` (from the CON-40 merge), add an explicit case so METRICS never falls through to `default: return { type: 'jump', index: target.startIndex }` with a `null` index:

```js
    switch (target.section.kind) {
      case 'queued': return { type: 'focus-queue', index: 0 };
      case 'quickstart': return { type: 'focus-quickstart', index: 0 };
      case 'metrics': return null;
      default: return { type: 'jump', index: target.startIndex };
    }
```

- [ ] **Step 8: Export `metricsFor`**

The tests in Step 1 `require` it via the file's existing destructured import — add it to `lib/ui/screens/fleet.js`'s `module.exports`:

```js
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, sectionJumpTargets, buildSections,
  QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor,
};
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS (all new tests), then run the full file to confirm no regression — in particular, any test constructing `queueState`/section-count expectations by hand (e.g. `sectionJumpTargets` tests, digit-numbering tests from Task 4/5) now has ONE MORE section (METRICS) always present, shifting expected digit numbers for FAILED/DONE/etc. by one in any test that lists out every section's expected position. Update those fixtures' expected numbers.

- [ ] **Step 10: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "fleet: add METRICS panel (avg delivery time, throughput, escalations)"
```

---

## Phase 3: Drill-down

### Task 10: Four-panel focus model (TICKET/TIMELINE/GATES/EVIDENCE), numbered `[1]`-`[4]`, `\t` cycle

**Files:**
- Modify: `lib/ui/screens/drilldown.js` (`pane()` calls' `focused` argument, `handleKey`, `render`), `lib/ui/watch.js` (`drillFocus` semantics, currently `null | 'evidence'`)
- Test: `test/drilldown.test.js`, `test/watch.test.js`

**Interfaces:**
- `drillFocus` widens from `null | 'evidence'` to `'ticket' | 'timeline' | 'gates' | 'evidence'` (never `null` once this lands — always defaults to `'ticket'`, the first panel, matching how `focus` on the fleet screen always has a value rather than an absent state).
- `handleKey(key, state)` gains digit (`1`-`4`) and `\t` (cycle) handling; existing `\t`-toggles-EVIDENCE-only behavior is replaced, not layered on top.

- [ ] **Step 1: Write the failing tests**

```js
test('drillFocus defaults to ticket, the first panel, not evidence', () => {
  const r = run({ status: 'running' });
  const out = plain(renderDrillDown(r, { cols: 78 }));
  assert.match(out, /\[1\] TICKET/);
});

test('digit 1-4 jump directly to each panel', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(handleKey('1', { run: r, drillFocus: 'evidence' }), { type: 'switch-drill-focus', focus: 'ticket' });
  assert.deepEqual(handleKey('2', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'timeline' });
  assert.deepEqual(handleKey('3', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'gates' });
  assert.deepEqual(handleKey('4', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'evidence' });
});

test('tab cycles ticket -> timeline -> gates -> evidence -> ticket', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'timeline' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'timeline' }), { type: 'switch-drill-focus', focus: 'gates' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'gates' }), { type: 'switch-drill-focus', focus: 'evidence' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'evidence' }), { type: 'switch-drill-focus', focus: 'ticket' });
});

test('the focused panel renders with the heavy border, the other three plain', () => {
  const r = run({ status: 'running', gates: [{ name: 'test', status: 'pass', durationMs: 100 }] });
  const out = renderDrillDown(r, { cols: 100, drillFocus: 'gates' });
  const lines = out.split('\n');
  const gatesTitleLine = lines.find((l) => l.includes('GATES'));
  assert.match(gatesTitleLine, /┏|┃/);
  const ticketTitleLine = lines.find((l) => l.includes('TICKET'));
  assert.doesNotMatch(ticketTitleLine, /┏/);
});

test('j/k move the run selection is inert on this screen — while a panel is focused, j/k scroll or select that panel instead', () => {
  const r = run({ status: 'running', events: Array.from({ length: 20 }, (_, i) => ({ kind: 'note', t: i, msg: 'x' })) });
  assert.deepEqual(handleKey('j', { run: r, drillFocus: 'timeline' }), { type: 'drill-panel-scroll', panel: 'timeline', delta: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/drilldown.test.js`
Expected: FAIL — `\t` currently only toggles EVIDENCE on/off (`null <-> 'evidence'`); digits 1-4 are unbound; titles carry no `[N]` prefix; only EVIDENCE ever gets the focused border.

- [ ] **Step 3: Implement the panel-focus model**

In `lib/ui/screens/drilldown.js`, add a panel order constant near the top (after `PHASE_ORDER` import):

```js
// The drill-down's own panel order — index 0-3 maps to digit keys 1-4 and
// is what \t cycles through. Distinct from fleet.js's PHASE_ORDER; this is
// a fixed 4-entry list, never derived from run data.
const DRILL_PANELS = ['ticket', 'timeline', 'gates', 'evidence'];
```

In `renderDrillDown`, change the default (currently `drillFocus` only ever compared against `'evidence'`):

```js
  const drillFocus = (opts && opts.drillFocus) || 'ticket';
  const evidenceFocused = drillFocus === 'evidence';
```

Number and focus-style each of the four `pane(...)` calls — TICKET (~line 442), TIMELINE (~line 508), GATES (~line 510), EVIDENCE (~line 512):

```js
  for (const line of pane(ticketContent,
    { width: cols, height: ticketContent.length + 2, title: '[1] TICKET', focused: drillFocus === 'ticket' })) out.push(line);
```

```js
  const timelineBox = pane(timelineContent,
    { width: leftPaneWidth, height: targetHeight, title: '[2] ' + timelineTitle, focused: drillFocus === 'timeline' });
  const gatesBox = pane(gatesContent,
    { width: rightPaneWidth, height: gatesBoxHeight, title: '[3] ' + gatesTitle, focused: drillFocus === 'gates' });
  const evidenceBox = pane(evidenceContent,
    { width: rightPaneWidth, height: evidenceBoxHeight, title: '[4] EVIDENCE', focused: evidenceFocused });
```

(`timelineTitle`/`gatesTitle` already carry their own dynamic suffixes — e.g. `TIMELINE  ▲ 2 malformed` — prepend the `[N]` rather than replacing.)

The footer hint block (~line 542-548) currently special-cases `evidenceFocused` alone; extend it to cover all four panels, since TICKET/TIMELINE/GATES now scroll too:

```js
  const live = isLive(run);
  if (confirm) {
    // ... unchanged ...
  } else if (drillFocus === 'evidence') {
    out.push(f.dim('  1-4 jump   tab cycle   j/k select   ↵ open   esc back'));
  } else {
    out.push(f.dim('  1-4 jump   tab cycle   j/k scroll   ↵ attach' +
      (live ? '   k kill   r restart' : '') + '   esc back'));
  }
```

Replace `handleKey`'s existing `\t` block (currently `if (!items.length) return null; return { type: 'switch-drill-focus', focus: drillFocus === 'evidence' ? null : 'evidence' };`) and the `drillFocus === 'evidence'` reinterpretation block with:

```js
  const drillFocus = (state && state.drillFocus) || 'ticket';

  if (key.length === 1 && key >= '1' && key <= '4') {
    return { type: 'switch-drill-focus', focus: DRILL_PANELS[parseInt(key, 10) - 1] };
  }

  if (key === '\t') {
    const idx = DRILL_PANELS.indexOf(drillFocus);
    return { type: 'switch-drill-focus', focus: DRILL_PANELS[(idx + 1) % DRILL_PANELS.length] };
  }

  if (drillFocus === 'evidence') {
    // ... existing j/k/Enter EVIDENCE-selection body, unchanged ...
  }

  if (drillFocus === 'ticket' || drillFocus === 'timeline' || drillFocus === 'gates') {
    if (key === 'j' || key === '\x1b[B') return { type: 'drill-panel-scroll', panel: drillFocus, delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'drill-panel-scroll', panel: drillFocus, delta: -1 };
    // Page up/down use a fixed 5-line jump rather than a viewport-relative
    // one — docview.js's own page-jump is viewport-sized, but that requires
    // a precomputed viewport-rows value threaded through state per panel
    // (docview.js's own `docViewportRows` precedent); a fixed size avoids
    // that plumbing for a v1 pass and is still a clear improvement over no
    // page key at all.
    if (key === '\x1b[5~') return { type: 'drill-panel-scroll', panel: drillFocus, delta: -5 };
    if (key === '\x1b[6~') return { type: 'drill-panel-scroll', panel: drillFocus, delta: 5 };
    return null;
  }
```

placed so digit/`\t` handling comes BEFORE the `if (confirm)` early-return's sibling checks but AFTER the `confirm`/`\x1b` gates already at the top of `handleKey` (mirroring fleet.js's own gate-ordering discipline — confirmation prompts intercept everything first). `↵`/`k`/`r` (attach/kill/restart) remain bound only when NO panel-specific handling claims the key — i.e., only reachable when `drillFocus` is none of the four scrollable/selectable states, which after this change is never true; attach/kill/restart move to being available regardless of panel focus (they operate on the RUN, not a panel), so keep the existing `if (key === '\r') return { type: 'attach', ... }` and the `isLive(run)` kill/restart block AFTER the panel-dispatch blocks above, unchanged in position relative to each other, just now unreachable only while `drillFocus === 'evidence'` (EVIDENCE's own block already `return`s before reaching them, exactly as it does today).

- [ ] **Step 4: Update `render`/`routeHandleKey`**

`render(state, opts)` (~line 635) already forwards `drillFocus: state.drillFocus` — no change needed (the widened value type flows through unchanged). `routeHandleKey` similarly needs no signature change.

- [ ] **Step 5: Update `watch.js`'s `drillFocus` initial value and reset**

`watch.js` currently initializes `let drillFocus = null;` (search for it near the other drill-down state vars). Change the default to `'ticket'`:

```js
let drillFocus = 'ticket';
```

Wherever `backToFleet()`/opening the drill-down resets `drillFocus` to `null` today, change that reset target to `'ticket'` too, so re-entering drill-down on a different run always starts on the first panel rather than carrying over a stale focus (matches the existing "opening a screen starts at a sane default" convention already used elsewhere, e.g. `openLaunchPad`'s gate-status-computed-once-on-first-open pattern).

Add the `switch-drill-focus` and `drill-panel-scroll` cases to `applyAction`'s switch (near the existing `switch-drill-focus`/`move-drill-evidence` cases):

```js
        case 'switch-drill-focus':
          drillFocus = action.focus;
          return true;
```

(This case already exists today for the binary `null | 'evidence'` toggle — confirm its current body just does `drillFocus = action.focus; return true;` and needs no further change beyond the wider value range now flowing through it.)

`drill-panel-scroll` is implemented in the next task (Task 11), once TICKET/TIMELINE gain real scroll state to scroll — for now (this task), add a no-op-safe placeholder that does NOT drop the action silently mismatched:

Do not add a `case 'drill-panel-scroll':` yet — Task 11 adds it. Confirm `applyAction`'s `default: return false;` handles the as-yet-unimplemented action gracefully (returns `false`, meaning "no redraw", which is correct until Task 11 gives it real scroll state to touch).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/drilldown.test.js test/watch.test.js`
Expected: PASS for the new tests. Run the FULL `test/drilldown.test.js` — every existing test that asserted `drillFocus: null` behavior (the old "EVIDENCE not focused" default) needs its fixture updated from `null`/absent to the implicit `'ticket'` default, and any test asserting the OLD `\t`-toggles-in-and-out-of-evidence-only behavior needs rewriting to the new digit/cycle model. Update those fixtures/assertions to match.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/screens/drilldown.js lib/ui/watch.js test/drilldown.test.js test/watch.test.js
git commit -m "drilldown: four-panel focus model, numbered 1-4, tab cycles"
```

---

### Task 11: TICKET and TIMELINE panels gain free-scroll (replace hard caps)

**Files:**
- Modify: `lib/ui/screens/drilldown.js` (`ticketPanelLines`/`TICKET_MAX_LINES`, `timelineLines`/`MAX_TIMELINE`), `lib/ui/watch.js` (scroll offsets, `drill-panel-scroll` handler)
- Test: `test/drilldown.test.js`, `test/watch.test.js`

**Interfaces:**
- Consumes: `docview.bodyBox`, `docview.scrollDelta`, `docview.clampScroll` (all already exported).
- `renderDrillDown`'s `opts` gains `ticketScroll`/`timelineScroll` (numbers, default 0).

- [ ] **Step 1: Write the failing tests**

```js
const docview = require('../lib/ui/screens/docview'); // for direct scroll-key assertions if needed — drilldown.js itself will require this

test('a TICKET description longer than the panel height scrolls instead of hard-capping at 5 lines', () => {
  const longDescription = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n\n');
  const r = run({ status: 'running' });
  const out = renderDrillDown(r, { cols: 100, rows: 40, ticketText: { title: 't', description: longDescription } });
  assert.match(out, /showing 1-/);
});

test('a TIMELINE with more than 14 events scrolls instead of silently dropping older ones', () => {
  const r = run({ status: 'running', events: Array.from({ length: 30 }, (_, i) => ({ kind: 'note', t: i, msg: 'x' })) });
  const out = renderDrillDown(r, { cols: 100, rows: 40, drillFocus: 'timeline' });
  assert.match(out, /showing/);
});

test('j/k scroll the focused TICKET panel by one line', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(
    handleKey('j', { run: r, drillFocus: 'ticket' }),
    { type: 'drill-panel-scroll', panel: 'ticket', delta: 1 },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/drilldown.test.js`
Expected: FAIL — TICKET still hard-caps at `TICKET_MAX_LINES` with a "… N more lines" count (no "showing X-Y of N"); TIMELINE still hard-caps at `MAX_TIMELINE`.

- [ ] **Step 3: Replace the hard caps with `docview.bodyBox`**

Add the require near the top of `lib/ui/screens/drilldown.js`:

```js
const docview = require('./docview');
```

Replace `ticketPanelLines` (currently truncates the wrapped description to `TICKET_MAX_LINES` and appends a "… N more lines" row) — this function now only WRAPS the text; windowing moves to the render call site via `docview.bodyBox`:

```js
// Wraps the ticket description to `width` — no longer caps or windows the
// result itself (docview.bodyBox, at the call site, does that now, with
// real scroll instead of a hard, unreachable cut).
function ticketPanelLines(ticketText, width) {
  const description = ticketText && typeof ticketText.description === 'string' ? ticketText.description.trim() : '';
  if (!description) {
    return [f.yellow('ticket text unavailable')];
  }
  return textwrap.wrap(markdown.toPlainText(description), width);
}
```

Remove the now-unused `TICKET_MAX_LINES` constant (still exported today — check `module.exports` at the bottom and remove it from there too, along with checking no other module imports it: `grep -rn "TICKET_MAX_LINES" lib/ test/` before removing, and update/remove any test asserting the old cap-at-5 behavior).

`docview.bodyBox` deliberately draws NO title (per its own header comment — this codebase's "single-pane screens have no title" convention, distinct from `layout.box()`'s own `title` option that multi-panel screens like this one use). TICKET needs a titled box, so this task does not call `bodyBox` directly for the outer frame — instead it exports `bodyBox`'s internal windowing function (`windowBody`, already defined but not exported) and windows the content itself, handing the windowed lines to this file's own `pane()` helper (which already supports `title`).

In `lib/ui/screens/docview.js`, add `windowBody` to `module.exports` (it is already defined, just not exported):

```js
module.exports = {
  bodyBox, renderDocView, clampScroll, scrollDelta, handleKey,
  computeViewportRows, render, routeHandleKey, windowBody,
};
```

Add a `test/docview.test.js` case confirming this (if `test/docview.test.js` exists — check with `ls test/docview.test.js`; if absent, add the assertion to whichever file already tests `docview.js`'s exports, or create `test/docview.test.js` mirroring the existing pattern):

```js
test('windowBody is exported for callers that need windowing without bodyBox\'s own box chrome', () => {
  const { windowBody } = require('../lib/ui/screens/docview');
  const out = windowBody(['a', 'b', 'c'], 2, 0);
  assert.equal(out.length, 2);
});
```

Now in `drilldown.js`, use `windowBody` + this file's own `pane()` for TICKET's titled box:

```js
  const ticketInnerWidth = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
  const ticketLines = ticketPanelLines(ticketText, ticketInnerWidth);
  const ticketFocused = drillFocus === 'ticket';
  const ticketViewportRows = Math.min(ticketLines.length || 1, 8);
  const ticketWindowed = ticketLines.length <= ticketViewportRows
    ? ticketLines
    : docview.windowBody(ticketLines, ticketViewportRows, (opts && opts.ticketScroll) || 0);
  for (const line of pane(ticketWindowed,
    { width: cols, height: ticketWindowed.length + 2, title: '[1] TICKET', focused: ticketFocused })) out.push(line);
```

Apply the identical pattern to TIMELINE: replace `timelineLines`'s current hard cap (`MAX_TIMELINE`, the "… N earlier events" row) with a plain wrap (no cap), and window it the same way at the TIMELINE call site, using `opts.timelineScroll`. Remove `MAX_TIMELINE` from `module.exports` if present (check first) after confirming no other file imports it.

```js
function timelineLines(run, width) {
  const events = run.events || [];
  if (!events.length) {
    return [f.yellow('no events recorded — this run cannot be seen into')];
  }
  const lines = [];
  for (const ev of events) {
    const role = ev.role || 'script';
    const colour = f.ROLE_COLOUR[role] || f.dim;
    const roleCol = f.padTo(colour(role), 12);
    const time = hhmm(ev.t) || '--:--';
    const { label, detail } = describeEvent(ev);
    let line = time + '  ' + roleCol + '  ' + label;
    if (detail) line += '  ' + f.dim(detail);
    lines.push(f.truncate(line, width));
  }
  return lines;
}
```

and at TIMELINE's call site (where `targetHeight`/`timelineBox` are built), window via `docview.windowBody` before handing content to `pane()`, using `targetHeight - 2` as the viewport row budget (matching the existing height-reconciliation math already in place) and `opts.timelineScroll`.

- [ ] **Step 4: Wire `drill-panel-scroll` in `watch.js`**

Add two new state vars near `drillFocus`:

```js
let drillTicketScroll = 0;
let drillTimelineScroll = 0;
```

Add both to `currentState()`, forwarded as `ticketScroll`/`timelineScroll` to `render()`'s `opts` (in `drilldown.js`'s own `render(state, opts)`, add `ticketScroll: state.drillTicketScroll, timelineScroll: state.drillTimelineScroll` to the `Object.assign` call).

Add the `drill-panel-scroll` case to `applyAction`:

```js
        case 'drill-panel-scroll': {
          if (action.panel === 'ticket') {
            drillTicketScroll = Math.max(0, drillTicketScroll + action.delta);
          } else if (action.panel === 'timeline') {
            drillTimelineScroll = Math.max(0, drillTimelineScroll + action.delta);
          }
          // GATES scrolling lands in Task 12 — its own state var is added
          // there; this branch is a no-op for 'gates' until then.
          return true;
        }
```

(Upper-bound clamping to the panel's real content length happens naturally the next `draw()` — `docview.windowBody`'s own internal use of `clampScroll` re-bounds any offset past the end, so an unclamped-here increment cannot scroll past the content; this mirrors how `drillEvidenceIndex` is similarly clamped lazily elsewhere in this file rather than at the point of increment.)

- [ ] **Step 5: Reset scroll state when opening a different run's drill-down**

Wherever `watch.js` sets `mode = 'drilldown'` / `drillTicket = ...` (opening the screen), reset `drillTicketScroll = 0; drillTimelineScroll = 0;` alongside the existing `drillFocus = 'ticket'` reset from Task 10 — a fresh run should always start scrolled to the top.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/drilldown.test.js test/watch.test.js test/docview.test.js`
Expected: PASS. Run the full `test/drilldown.test.js` file — every existing test asserting the OLD "… N more lines"/"… N earlier events" truncation strings needs updating to the new "showing X-Y of N" convention `docview.windowBody`'s sibling `bodyBox` already uses elsewhere in the codebase (match the exact wording `windowBody` itself produces — confirm by reading `docview.js`'s `windowBody` implementation, unchanged by this task).

- [ ] **Step 7: Commit**

```bash
git add lib/ui/screens/drilldown.js lib/ui/screens/docview.js lib/ui/watch.js test/drilldown.test.js test/watch.test.js test/docview.test.js
git commit -m "drilldown: TICKET and TIMELINE panels scroll instead of hard-capping"
```

---

### Task 12: GATES panel gains defensive free-scroll; TIMELINE becomes the flex panel

**Files:**
- Modify: `lib/ui/screens/drilldown.js` (GATES call site), `lib/ui/watch.js` (`drillGatesScroll`, `drill-panel-scroll`'s `gates` branch)
- Test: `test/drilldown.test.js`, `test/watch.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('a GATES panel with many gates scrolls rather than growing the box unboundedly', () => {
  const manyGates = Array.from({ length: 20 }, (_, i) => ({ name: 'gate-' + i, status: 'pass', durationMs: 100 }));
  const r = run({ status: 'running', gates: manyGates });
  const out = renderDrillDown(r, { cols: 100, rows: 25, drillFocus: 'gates' });
  const lines = out.split('\n');
  assert.ok(lines.length <= 25, 'GATES must not push the whole frame past the terminal height');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/drilldown.test.js`
Expected: FAIL — today's `gatesLines`/`rightContentWidth` size the GATES box to its full content unconditionally.

- [ ] **Step 3: Implement**

Add `drillGatesScroll` state to `watch.js` alongside the two from Task 11, forward it as `gatesScroll` in `render()`. In `drilldown.js`, at the GATES call site (currently `pane(gatesContent, { width: rightPaneWidth, height: gatesBoxHeight, title: gatesTitle, focused: false })`), cap the viewport when focused-and-overflowing using the same `docview.windowBody` pattern as Task 11, bounded to a reasonable max (e.g. 10 rows) when NOT focused (unfocused GATES still shows its natural size up to that cap, matching how TIMELINE/TICKET behaved pre-scroll):

```js
  const gatesFocused = drillFocus === 'gates';
  const gatesViewportCap = 10;
  const gatesWindowed = gatesContent.length <= gatesViewportCap
    ? gatesContent
    : docview.windowBody(gatesContent, gatesViewportCap, (opts && opts.gatesScroll) || 0);
  const gatesBox = pane(gatesWindowed,
    { width: rightPaneWidth, height: gatesWindowed.length + 2, title: '[3] ' + gatesTitle, focused: gatesFocused });
```

(This changes `gatesBoxHeight`'s source of truth from `gatesContent.length + 2` to `gatesWindowed.length + 2` — update the height-reconciliation math just above this block, which currently reads `gatesContent.length`, to read `gatesWindowed.length` instead, so TIMELINE's own flex-height calculation — see Step 4 — stays correct.)

Add the `gates` branch to `applyAction`'s `drill-panel-scroll` case (from Task 11, currently a no-op comment placeholder for `gates`):

```js
          } else if (action.panel === 'gates') {
            drillGatesScroll = Math.max(0, drillGatesScroll + action.delta);
          }
```

- [ ] **Step 4: Make TIMELINE the flex panel — both against its own column AND against the outer terminal height**

TIMELINE already absorbs height-reconciliation slack via the existing `targetHeight = Math.max(leftNaturalHeight, rightTotalHeight)` logic (~line 505) — this balances the LEFT column (TIMELINE) against the RIGHT column (GATES+EVIDENCE), but neither column grows against the terminal's own remaining rows the way fleet.js's Task 8 grows its last section. Add that outer growth here, right after `targetHeight` is computed:

```js
  const rows = (opts && opts.rows) || 0;
  if (rows > 0) {
    const budget = rows - 1;
    // Rows this frame will cost BELOW the TIMELINE/GATES/EVIDENCE row: the
    // blank line after it, any notice, the confirm/footer block — all
    // already pushed onto `out` by the time this row is laid out, except
    // the two rows (blank + footer) that come after it. `out.length` at
    // this point already includes every header row, the phase pipeline,
    // and the TICKET panel above.
    const belowRow = 2;
    const outerBudget = budget - out.length - belowRow;
    targetHeight = Math.max(targetHeight, outerBudget);
  }
```

(`targetHeight` is declared `const` today — change to `let` for this reassignment.) This makes TIMELINE (and, via the existing `evidenceBoxHeight` padding, the right column too) grow to consume the terminal's own leftover rows, pinning drill-down's footer to `rows - 1` exactly the way Task 8 pins fleet's.

- [ ] **Step 5: Write the failing test for outer-frame growth**

```js
test('with vertical space to spare, TIMELINE/GATES/EVIDENCE grow to push the footer to the last row', () => {
  const r = run({ status: 'running', gates: [{ name: 'test', status: 'pass', durationMs: 100 }] });
  const out = renderDrillDown(r, { cols: 100, rows: 35 });
  const lines = out.split('\n');
  assert.match(lines[33], /attach|jump/);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/drilldown.test.js test/watch.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/screens/drilldown.js lib/ui/watch.js test/drilldown.test.js
git commit -m "drilldown: GATES panel scrolls defensively instead of growing unbounded"
```

---

### Task 13: EVIDENCE panel refactor onto `layout.selectionWindow`

**Files:**
- Modify: `lib/ui/screens/drilldown.js` — `evidenceWindow` (~line 256-263)
- Test: `test/drilldown.test.js` (existing EVIDENCE scroll tests are the safety net — behavior-preserving refactor)

- [ ] **Step 1: Run the existing EVIDENCE test suite as a baseline**

Run: `node --test test/drilldown.test.js -- --test-name-pattern="[Ee]vidence"`
Expected: PASS (note the count).

- [ ] **Step 2: Refactor `evidenceWindow` to delegate to `layout.selectionWindow`**

Replace the current hand-rolled implementation:

```js
function evidenceWindow(total, selectedIndex, focused) {
  if (!focused) {
    return { start: 0, count: Math.min(total, EVIDENCE_MAX_VISIBLE) };
  }
  const win = layout.selectionWindow(total, selectedIndex, EVIDENCE_MAX_VISIBLE, selectedIndex);
  return { start: win.start, count: win.count };
}
```

(`layout` is already required at the top of `drilldown.js`.) Note the unfocused branch is preserved exactly as-is — `selectionWindow` is only used for the FOCUSED, selection-tracking case, matching its intended use (an unfocused list showing its leading N is a distinct, simpler policy `selectionWindow` doesn't need to model).

- [ ] **Step 3: Run the EVIDENCE test suite to verify it still passes byte-for-byte**

Run: `node --test test/drilldown.test.js -- --test-name-pattern="[Ee]vidence"`
Expected: PASS, same count as Step 1.

- [ ] **Step 4: Commit**

```bash
git add lib/ui/screens/drilldown.js
git commit -m "drilldown: route EVIDENCE's focused scroll through selectionWindow"
```

---

## Phase 4: Launch pad & launch plan

### Task 14: Launch pad — `selectionWindow` refactor + grow-to-fill

**Files:**
- Modify: `lib/ui/screens/launchpad.js` — `windowStart` (~line 48-44), `renderLaunchPad` (pane heights)
- Test: `test/launchpad.test.js`

- [ ] **Step 1: Run the existing scroll/window test suite as a baseline**

Run: `node --test test/launchpad.test.js -- --test-name-pattern="windowStart|scroll"`
Expected: PASS (note the count).

- [ ] **Step 2: Refactor `windowStart` onto `layout.selectionWindow`**

`windowStart(index, total, max)` currently returns just a start offset (centring `index` within a window of `max` over `total`). `layout.selectionWindow`'s contract is start-at-edge (not centred) — CONFIRM this is an intentional behavior difference before refactoring: launch pad's existing centring behavior (`windowStart` centres the selection in the MIDDLE of the visible window, not just keeping it in-bounds) is a genuinely different policy than fleet/drill-down's edge-anchored scrolling, and changing it would be a real UX regression the design spec did NOT ask for. **Do not refactor `windowStart` onto `selectionWindow`** — leave it as its own, deliberately-different implementation (centring, not edge-anchoring). Update the spec's own architecture claim if it implied otherwise, and note this as a scoped exception in this task rather than performing the refactor.

- [ ] **Step 3: Add grow-to-fill for the EPICS/TICKETS panes and detail preview**

In `renderLaunchPad`, the pane heights are currently `const paneHeight = Math.max(leftContent.length, rightContent.length) + 2;` (epics/tickets) and the detail pane's own `desiredDetailHeight`/`availableForDetail` computation. Add a grow step after `paneHeight` is computed, using the same `budget`-vs-`usedSoFar` pattern as fleet.js's Task 8:

```js
  const rows = (opts && opts.rows) || 0;
  const headTailRows = out.length; // header line(s) already pushed before this point
  const reservedBelowPanes = 3; // blank line + selected/mode line + hints line, unchanged from today
  if (rows > 0) {
    const budget = rows - 1;
    const naturalRemaining = budget - headTailRows - reservedBelowPanes;
    // Only grow the epics/tickets row's height here; the detail pane below
    // already has its own `availableForDetail` budget logic that consumes
    // whatever this row does NOT use — growing both would double-count the
    // same slack.
  }
```

Concretely, change `paneHeight`'s assignment to:

```js
  let paneHeight = Math.max(leftContent.length, rightContent.length) + 2;
  const rows = (opts && opts.rows) || 0;
  if (rows > 0) {
    const budget = rows - 1;
    const usedBeforePanes = out.length;
    const reservedAfterPanes = 3; // blank + selected/mode line + hints line
    const maxPaneHeight = Math.max(paneHeight, budget - usedBeforePanes - reservedAfterPanes);
    // Cap growth to leave room for a non-trivial detail pane — an epics/
    // tickets row that ate the WHOLE budget would leave nothing for
    // ticket detail, defeating design.md's "detail pane" requirement.
    paneHeight = Math.min(maxPaneHeight, paneHeight + Math.floor((maxPaneHeight - paneHeight) / 2));
  }
```

placed where `paneHeight` is currently declared (`const` becomes `let`), before `leftBoxOpts`/`rightBoxOpts` are built (both already consume `paneHeight`, no further change needed there).

- [ ] **Step 4: Write the failing test for growth**

```js
test('with vertical space to spare, the epics/tickets panes grow beyond their natural content height', () => {
  const out = renderLaunchPad(lp({}), [], { ...OPTS, rows: 40 });
  const lines = out.split('\n');
  // Natural content is well under 10 rows (1 epic, 1 ticket) — with rows: 40
  // the panes must visibly grow (more blank interior rows) rather than
  // leaving a wide gap between the panes and the detail pane below.
  const boxTop = lines.findIndex((l) => /EPICS|┌|┏/.test(l));
  const boxBottom = lines.findIndex((l, i) => i > boxTop && /└|┗/.test(l));
  assert.ok(boxBottom - boxTop > 6, `expected a grown box, got ${boxBottom - boxTop} rows`);
});
```

- [ ] **Step 5: Run tests**

Run: `node --test test/launchpad.test.js`
Expected: PASS (new test), and the Step 1 baseline count unchanged for the `windowStart`/scroll suite (confirming Step 2's decision to leave it alone caused no regression).

- [ ] **Step 6: Commit**

```bash
git add lib/ui/screens/launchpad.js test/launchpad.test.js
git commit -m "launchpad: epics/tickets panes grow to fill available height"
```

---

### Task 15: Launch plan — ticket list gains free-scroll + grow-to-fill

**Files:**
- Modify: `lib/ui/screens/launchplan.js` — `renderLaunchPlan` (the ticket-list box, ~line 198-201)
- Test: `test/launchplan.test.js`

**Interfaces:**
- Consumes: `docview.bodyBox` (new require in `launchplan.js`).

- [ ] **Step 1: Write the failing test**

```js
test('a batch larger than the terminal scrolls the ticket list instead of overflowing it', () => {
  const bigPlan = plan({
    tickets: Array.from({ length: 30 }, (_, i) => ticket('CON-' + (100 + i), 'ticket-' + i)),
  });
  const out = renderLaunchPlan(bigPlan, 0, { cols: 78, rows: 25 });
  const lines = out.split('\n');
  assert.ok(lines.length <= 25, `render must respect the row budget, got ${lines.length} lines`);
  assert.match(out, /showing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/launchplan.test.js`
Expected: FAIL — today's `boxContent`/`boxHeight` (~line 199-200) size the box to ALL tickets unconditionally, with no `rows` awareness at all.

- [ ] **Step 3: Implement**

Add the require near the top of `lib/ui/screens/launchplan.js`:

```js
const docview = require('./docview');
```

Replace the ticket-list box block (currently `const boxContent = plan.tickets.map(...); const boxHeight = boxContent.length + 2; for (const line of pane(boxContent, {...})) out.push(line);`):

```js
  const boxContent = plan.tickets.map((t, i) => ticketRow(i + 1, t, plan, i));
  const rows = (opts && opts.rows) || 0;
  let boxViewportRows = boxContent.length;
  if (rows > 0) {
    // Reserve the rows everything ELSE in this render costs: what's already
    // in `out` above this box, plus the fixed rows below it (blank, "each
    // runs"/"worktrees" lines, optional active-count warning, blank,
    // footer).
    const belowBoxRows = 2 + (activeCount > 0 ? 2 : 0) + 2;
    boxViewportRows = Math.max(3, (rows - 1) - out.length - belowBoxRows);
  }
  const boxWindowed = boxContent.length <= boxViewportRows
    ? boxContent
    : docview.windowBody(boxContent, boxViewportRows, (opts && opts.ticketListScroll) || 0);
  for (const line of pane(boxWindowed, { width: boxWidth, height: boxWindowed.length + 2, focused: false })) out.push(line);
```

(`activeCount` is already a parameter of `renderLaunchPlan(plan, activeCount, opts)` — no new plumbing needed for the `belowBoxRows` estimate.)

- [ ] **Step 4: Add scroll-key handling**

In `handleKey(key, state)`, add scroll delegation using `docview.scrollDelta` (via the module-scope `docview` require added in Step 3) near the existing `if (key === 'c') return { type: 'cycle-concurrency' };` line:

```js
  const scrollKey = docview.scrollDelta(key, 10);
  if (scrollKey) return { type: 'scroll-launchplan-tickets', delta: scrollKey.lines };
```

- [ ] **Step 5: Wire the new scroll state in `watch.js`**

Add `let launchPlanTicketScroll = 0;` near `launchPlan`'s own declaration, reset to `0` wherever `launchPlan` is (re)built (the `'open-launchplan'` case), add it to `currentState()`, forward as `ticketListScroll` in `launchplan.js`'s `render(state, opts)`, and add the `applyAction` case:

```js
        case 'scroll-launchplan-tickets':
          launchPlanTicketScroll = Math.max(0, launchPlanTicketScroll + action.delta);
          return true;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/launchplan.test.js test/watch.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/screens/launchplan.js lib/ui/watch.js test/launchplan.test.js
git commit -m "launchplan: ticket list scrolls instead of rendering fully unbounded"
```

---

## Phase 5: Escalation, ticket viewer, doc viewer

### Task 16: Escalation — context block wraps and scrolls

**Files:**
- Modify: `lib/ui/screens/escalation.js` — `renderEscalation` (the context-rendering block, ~line 105-113), `handleKey`
- Test: `test/escalation.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('long escalation context wraps and scrolls instead of truncating each raw line', () => {
  const longLine = 'x'.repeat(500);
  const out = renderEscalation(run({
    status: 'needs-you',
    escalation: { question: 'q?', options: ['a'], raisedAt: 1, context: longLine },
  }), { cols: 78, rows: 30 });
  assert.doesNotMatch(out, /x{78}…/, 'a mid-word hard truncation with no wrap means this task is not done yet');
});
```

(`run()` here refers to whatever fixture helper `test/escalation.test.js` already defines for constructing a run — confirm its exact name/shape by reading the top of the existing test file before writing this.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/escalation.test.js`
Expected: FAIL — today's context block does `String(esc.context).split('\n')` then `f.truncate` each raw line independently, no wrap.

- [ ] **Step 3: Implement**

Add the require near the top of `lib/ui/screens/escalation.js`:

```js
const textwrap = require('../textwrap');
const docview = require('./docview');
```

Replace the context block (currently the `if (esc.context) { for (const line of String(esc.context).split('\n')) { boxContent.push(f.truncate(line, innerWidth)); } ... }`):

```js
  if (esc.context) {
    const wrapped = textwrap.wrap(String(esc.context), innerWidth);
    const contextViewportRows = Math.min(wrapped.length, 10);
    const contextWindowed = wrapped.length <= contextViewportRows
      ? wrapped
      : docview.windowBody(wrapped, contextViewportRows, (opts && opts.contextScroll) || 0);
    for (const line of contextWindowed) boxContent.push(line);
    if (esc.contextTruncated && esc.contextRef) {
      boxContent.push(f.dim(f.truncate('full context: ' + esc.contextRef, innerWidth)));
    }
    boxContent.push('');
  }
```

Add scroll-key handling to `handleKey`, using the module-scope `docview` require added above, inside the existing `if (esc && !run.escalationStale) { ... }` block, before the `if (key === 't') return { type: 'open-reply' };` line:

```js
    const scrollKey = docview.scrollDelta(key, 10);
    if (scrollKey) return { type: 'scroll-escalation-context', delta: scrollKey.lines };
```

placed before the existing `if (key === 't') return { type: 'open-reply' };` check, inside the `if (esc && !run.escalationStale) { ... }` block already there.

- [ ] **Step 4: Wire scroll state in `watch.js`**

Add `let escalationContextScroll = 0;`, reset on `backToFleet()` and whenever a new escalation screen opens, add to `currentState()`, forward as `contextScroll` in `escalation.js`'s `render(state, opts)`, and add the `applyAction` case:

```js
        case 'scroll-escalation-context':
          escalationContextScroll = Math.max(0, escalationContextScroll + action.delta);
          return true;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/escalation.test.js test/watch.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/screens/escalation.js lib/ui/watch.js test/escalation.test.js
git commit -m "escalation: context block wraps and scrolls instead of truncating raw lines"
```

---

### Task 17: Ticket viewer / doc viewer — verify grow-to-fill, no scroll regressions

**Files:**
- Modify: `lib/ui/screens/ticketview.js`, `lib/ui/screens/docview.js` (only if Step 1 finds a gap — likely no production change needed)
- Test: `test/ticketview.test.js`, `test/docview.test.js`

- [ ] **Step 1: Audit whether these two already grow to fill under the new shell**

Both `renderTicketView` and `renderDocView` already size their `bodyBox` call via `computeViewportRows(rows)`, which derives the box's row budget FROM `rows` already — meaning, once Task 3's top-bar row reservation reduces the `rows` value `watch.js` passes in, these two screens automatically get a slightly smaller (correctly smaller) viewport with no code change. Write a test confirming this end-to-end rather than assuming it:

```js
test('the ticket viewer box viewport shrinks by exactly the top bar\'s reserved row', () => {
  const withoutTopBarRow = require('../lib/ui/screens/ticketview').computeViewportRows(30, false);
  const withTopBarRow = require('../lib/ui/screens/ticketview').computeViewportRows(29, false);
  assert.equal(withoutTopBarRow - withTopBarRow, 1);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test test/ticketview.test.js`
Expected: PASS immediately — `computeViewportRows` is already a pure, monotonic function of `rows`; this test locks the property down rather than driving new code.

- [ ] **Step 3: Confirm via the full integration suite that nothing regresses**

Run: `node --test test/ticketview.test.js test/docview.test.js test/watch.test.js`
Expected: PASS — if any test fails, it is because `computeScreenRows()` (Task 3) now returns a value these screens were not written to tolerate (e.g. a fixture that assumed the pre-top-bar row count exactly); fix the FIXTURE's expected numbers, not `computeViewportRows` itself.

- [ ] **Step 4: Commit**

```bash
git add test/ticketview.test.js
git commit -m "ticketview/docview: lock down that the top bar's row reservation flows through"
```

---

## Final verification

- [ ] **Run the entire suite**

Run: `npm test`
Expected: PASS — every `node --test` file plus every shell test suite (`test/scripts/*.test.sh`) already wired into `package.json`'s `test` script.

- [ ] **Manual smoke test**

Run: `bin/concertino watch --config=concertino.config.json` in a real terminal, resize it while on each of: fleet (press `1`-`7` to jump sections, confirm `[N]` labels match), drill-down (open a run, press `1`-`4` and `\t`, scroll each panel), launch pad, launch plan (queue a large batch if possible), escalation (if a live escalation exists). Confirm the bottom hint bar stays pinned to the last terminal row at every size, and the top bar is always the first line.
