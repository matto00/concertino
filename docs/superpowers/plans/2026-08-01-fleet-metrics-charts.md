# Fleet METRICS charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the concertino fleet page's METRICS box from one plain summary line into five lines: the existing delivery/count summary, a success-rate bar, a 7-day throughput sparkline, and two gate/verdict pass-rate breakdowns — all derived from data already in the reducer's `run` model, no new event kinds.

**Architecture:** `metricsFor(runs, now)` (`lib/ui/screens/fleet.js`) gains four new derived fields computed from `run.events`/`run.gates`/`run.status`/`run.endedAt`. Two new small, reusable rendering helpers (`layout.fitSegments`, `format.sparkline`) let `buildSections`' METRICS entry pack percentage/bar segments into fixed-width lines without ever character-truncating mid-bar. The existing single-line `forceRender`/`emptyHint` box mechanism (shared with QUICK START) is generalized to `emptyLines: string[]` so METRICS can render N lines instead of exactly 1.

**Tech Stack:** Plain Node.js (no runtime dependencies — this repo has none), `node:test` + `node:assert` for tests, matching every existing file in `lib/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-01-fleet-metrics-charts-design.md`

## Global Constraints

- Zero new runtime dependencies (this repo has none today — do not add any).
- Reuse `format.js`'s existing `bar()` function directly for every inline percentage bar (glyphs `▪`/`░`) — do not invent a second bar-drawing function ("microBar") that duplicates its fill logic.
- `GATE_NAMES` (the 8 canonical gate names) must be defined exactly once, built from the already-imported `PHASE_ORDER` (`lib/ui/reducer.js`), and reused by both `metricsFor`'s `gateRates` aggregation and `buildSections`' gates line — never a second hardcoded copy.
- All four new `metricsFor` fields are computed over **all** of `runs` (full on-disk history), matching `avgMs`'s existing precedent — **except** `throughput`, which is explicitly the trailing 7 calendar days.
- Every new rendering code path must degrade gracefully (no crash, no `NaN`/`undefined` leaking into rendered text) when `o.metrics` is the bare `{}` stand-in `sectionJumpTargets()` (`fleet.js:1051-1060`) deliberately passes when it only needs to know METRICS is *included*, not what it says — this is an existing, documented, real call site, not a hypothetical.
- Never character-truncate a `label ██████░░░░ XX%`-shaped segment mid-bar — dropped segments are whole segments, via `fitSegments`.

---

## File Structure

- **`lib/ui/screens/fleet.js`** (modify) — `metricsFor` gains `successRate`, `throughput`, `verdictRates`, `gateRates`; a new module-level `GATE_NAMES` constant; `buildSections`' METRICS entry builds 5 lines via `emptyLines` instead of 1 via `emptyHint`; `visibleWindow`'s `sectionHeight` and `renderFleet`'s content-line construction generalize from a hardcoded single `emptyHint` line to `emptyLines.length` lines.
- **`lib/ui/layout.js`** (modify) — new exported `fitSegments(segments, maxWidth, sep)` helper, alongside the existing `box`/`degrade`/`selectionWindow`.
- **`lib/ui/format.js`** (modify) — new exported `sparkline(values)` helper, alongside the existing `bar()`.
- **`test/fleet.test.js`** (modify) — new tests for `metricsFor`'s 4 new fields, the METRICS box's 5 rendered lines, narrow-width segment-dropping, the `sectionJumpTargets`/`{}`-stand-in crash guard, and an update to one existing test whose row-count assumptions change now that METRICS costs more fixed rows.
- **`test/layout.test.js`** (modify) — new tests for `fitSegments`.
- **`test/format.test.js`** (modify) — new tests for `sparkline`.

No new files. This stays inside the existing module boundaries — `fleet.js` already owns METRICS end to end (per the 2026-07-30 lazygit-layout design that introduced it), and `layout.js`/`format.js` already own generic rendering primitives other screens reuse.

---

### Task 1: `metricsFor` — success rate, throughput, verdict rates, gate rates

**Files:**
- Modify: `lib/ui/screens/fleet.js:47-75` (add `GATE_NAMES` after `DAY_MS`; replace `metricsFor`)
- Test: `test/fleet.test.js` (insert after line 549, before the existing `'the fleet view shows a METRICS section...'` test at line 551)

**Interfaces:**
- Consumes: `PHASE_ORDER` (already imported at `fleet.js:32` from `../reducer`), `DAY_MS` (already defined at `fleet.js:47`).
- Produces: `metricsFor(runs, now)` now returns `{ avgMs, deliveredToday, deliveredWeek, escalationsToday, successRate: { today: {rate, done, total}, week: {rate, done, total} }, throughput: number[7], verdictRates: { evaluator: number|null, skeptic: number|null, auditor: number|null }, gateRates: Record<string, number> }`. `rate` fields are `null` when their denominator is 0. `gateRates` omits any gate name no run has ever reported (never a `0` placeholder). Task 5 depends on all of these exact shapes.

- [ ] **Step 1: Write the failing tests**

Insert into `test/fleet.test.js` right after line 549 (after the existing `escalationsToday` test, before the `'the fleet view shows a METRICS section...'` test):

```javascript
test('metricsFor.successRate.today is the done/(done+failed) ratio for terminal runs ending today', () => {
  const now = 10 * DAY_MS + 3600000; // 1h into day 10
  const todayStart = 10 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart + 1000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart + 2000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'failed', endedAt: todayStart + 3000 }),
    run({ ticket: 'HEL-4', status: 'done', endedAt: todayStart - 1000, elapsedMs: 1000 }), // yesterday, excluded
    run({ ticket: 'HEL-5', status: 'running' }), // in flight, excluded (no endedAt)
  ], now);
  assert.deepEqual(m.successRate.today, { rate: 2 / 3, done: 2, total: 3 });
});

test('metricsFor.successRate.today.rate is null with no terminal runs today', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.equal(m.successRate.today.rate, null);
  assert.equal(m.successRate.today.total, 0);
  assert.equal(m.successRate.today.done, 0);
});

test('metricsFor.successRate.week uses the same rolling 7-day window as deliveredWeek', () => {
  const now = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: now - 3 * DAY_MS, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: now - 8 * DAY_MS }), // outside window
  ], now);
  assert.deepEqual(m.successRate.week, { rate: 1, done: 1, total: 1 });
});

test('metricsFor.throughput buckets done runs into the last 7 UTC days, oldest first', () => {
  const now = 20 * DAY_MS;
  const todayStart = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart, elapsedMs: 1000 }), // today
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 3 * DAY_MS, elapsedMs: 1000 }), // 3 days ago
    run({ ticket: 'HEL-3', status: 'done', endedAt: todayStart - 8 * DAY_MS, elapsedMs: 1000 }), // outside the 7-day window
  ], now);
  assert.equal(m.throughput.length, 7);
  assert.equal(m.throughput[6], 1, 'index 6 is today');
  assert.equal(m.throughput[3], 1, 'index 3 is 3 days ago');
  assert.equal(m.throughput.reduce((a, b) => a + b, 0), 2, 'the 8-day-old delivery must not be counted');
});

test('metricsFor.throughput is seven zeroes with no delivery history', () => {
  const m = metricsFor([], 1000000);
  assert.deepEqual(m.throughput, [0, 0, 0, 0, 0, 0, 0]);
});

test('metricsFor.verdictRates computes each role\'s pass-rate from verdict events across all runs', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', events: [
      { kind: 'verdict', role: 'evaluator', verdict: 'PASS' },
      { kind: 'verdict', role: 'evaluator', verdict: 'FAIL' },
      { kind: 'verdict', role: 'skeptic', verdict: 'CONFIRM' },
    ] }),
    run({ ticket: 'HEL-2', events: [
      { kind: 'verdict', role: 'evaluator', verdict: 'PASS' },
    ] }),
  ], 1000000);
  assert.equal(m.verdictRates.evaluator, 2 / 3);
  assert.equal(m.verdictRates.skeptic, 1);
  assert.equal(m.verdictRates.auditor, null, 'a role with zero verdict events must be null, not 0');
});

test('metricsFor.gateRates computes each gate\'s pass-rate from the latest per-run result, omitting gates no run has ever reported', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', gates: [
      { name: 'phase:Setup', status: 'pass' },
      { name: 'server:backend', status: 'fail' },
    ] }),
    run({ ticket: 'HEL-2', gates: [
      { name: 'phase:Setup', status: 'pass' },
    ] }),
  ], 1000000);
  assert.equal(m.gateRates['phase:Setup'], 1);
  assert.equal(m.gateRates['server:backend'], 0);
  assert.ok(!('phase:Planning' in m.gateRates), 'a gate no run ever reported must be omitted, not 0%');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `m.successRate`, `m.throughput`, `m.verdictRates`, `m.gateRates` are all `undefined` (`metricsFor` does not return them yet), so every new assertion throws or fails.

- [ ] **Step 3: Add `GATE_NAMES` and rewrite `metricsFor`**

In `lib/ui/screens/fleet.js`, right after the existing `const DAY_MS = 24 * 60 * 60 * 1000;` (line 47), add:

```javascript
// The full canonical set of gate names any run can report: the 6 phase
// gates assert-phase.sh emits plus the 2 server gates start-servers.sh
// emits. Shared between metricsFor's gateRates aggregation and
// buildSections' METRICS gates line so the two can never drift apart —
// built from the same PHASE_ORDER vocabulary reducer.js already owns,
// never a second hardcoded phase list.
const GATE_NAMES = PHASE_ORDER.map((p) => `phase:${p}`).concat(['server:backend', 'server:frontend']);
```

Then replace the entire existing `metricsFor` function (lines 55-75 — from `function metricsFor(runs, now) {` through its closing `}`) with:

```javascript
function metricsFor(runs, now) {
  const list = runs || [];
  const done = list.filter((r) => r.status === 'done');
  const withElapsed = done.filter((r) => r.elapsedMs != null);
  const avgMs = withElapsed.length
    ? withElapsed.reduce((sum, r) => sum + r.elapsedMs, 0) / withElapsed.length
    : null;

  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const weekStart = now - 7 * DAY_MS;
  const deliveredToday = done.filter((r) => r.endedAt != null && r.endedAt >= todayStart).length;
  const deliveredWeek = done.filter((r) => r.endedAt != null && r.endedAt >= weekStart).length;

  let escalationsToday = 0;
  for (const r of list) {
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised' && ev.t >= todayStart) escalationsToday++;
    }
  }

  // Success rate: of every run that reached a TERMINAL state (done or
  // failed) with endedAt inside the window, what fraction were 'done' — a
  // failed run and a done run both "used up" a delivery attempt, so both
  // count toward the denominator; a run still in flight has no verdict yet
  // and is excluded (the same "endedAt != null" gate deliveredToday/
  // deliveredWeek already use).
  const terminal = list.filter((r) => (r.status === 'done' || r.status === 'failed') && r.endedAt != null);
  const rateFor = (windowStart) => {
    const inWindow = terminal.filter((r) => r.endedAt >= windowStart);
    const total = inWindow.length;
    if (!total) return { rate: null, done: 0, total: 0 };
    const doneCount = inWindow.filter((r) => r.status === 'done').length;
    return { rate: doneCount / total, done: doneCount, total };
  };
  const successRate = { today: rateFor(todayStart), week: rateFor(weekStart) };

  // Throughput: exactly 7 daily buckets of delivered ('done') runs, oldest
  // first, ending at today — always 7 entries regardless of how much
  // history exists (a young project just gets leading zeroes), so
  // sparkline() always has a fixed-width array to render.
  const throughput = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    throughput.push(done.filter((r) => r.endedAt != null && r.endedAt >= dayStart && r.endedAt < dayEnd).length);
  }

  // Verdict pass-rates per role, over ALL history (same "walk the full runs
  // array" precedent avgMs already established) — PASS/CONFIRM/MERGE is
  // each role's own "good" outcome per core/roles/{evaluator,skeptic,
  // auditor}.md's documented verdict vocabulary; every other value (FAIL,
  // REFUTE, ESCALATE, BLOCKER) counts against the rate. null (not 0) when a
  // role has never reported at all — a role that's never run is different
  // from one that always fails.
  const VERDICT_PASS_VALUE = { evaluator: 'PASS', skeptic: 'CONFIRM', auditor: 'MERGE' };
  const verdictRates = {};
  for (const role of Object.keys(VERDICT_PASS_VALUE)) {
    let total = 0;
    let passed = 0;
    for (const r of list) {
      for (const ev of r.events || []) {
        if (ev.kind === 'verdict' && ev.role === role) {
          total++;
          if (ev.verdict === VERDICT_PASS_VALUE[role]) passed++;
        }
      }
    }
    verdictRates[role] = total ? passed / total : null;
  }

  // Gate pass-rates per gate name, over ALL history — reads each run's
  // already-deduped `run.gates` (latest result per name per run,
  // reducer.js's gate.result fold), so a run that retried a gate only
  // counts its FINAL outcome, not every attempt. A gate name absent from
  // every run's history is omitted from the map entirely, never reported
  // as a misleading 0%.
  const gateRates = {};
  for (const name of GATE_NAMES) {
    let total = 0;
    let passed = 0;
    for (const r of list) {
      const g = (r.gates || []).find((x) => x.name === name);
      if (g) {
        total++;
        if (g.status === 'pass') passed++;
      }
    }
    if (total) gateRates[name] = passed / total;
  }

  return {
    avgMs, deliveredToday, deliveredWeek, escalationsToday,
    successRate, throughput, verdictRates, gateRates,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS — every test in the file, including all 7 new ones and the pre-existing `metricsFor`/METRICS tests (their assertions are unaffected: `avgMs`/`deliveredToday`/`deliveredWeek`/`escalationsToday` keep their exact prior behavior, this change only adds fields).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "feat: add success rate, throughput, verdict rate, and gate rate to metricsFor"
```

---

### Task 2: `layout.fitSegments` — pack whole segments, never truncate mid-bar

**Files:**
- Modify: `lib/ui/layout.js`
- Test: `test/layout.test.js` (append near the end, or alongside other pure-helper tests)

**Interfaces:**
- Consumes: `f.visibleLength` (already required as `f` at `layout.js:10`).
- Produces: `fitSegments(segments: string[], maxWidth: number, sep?: string): string`. Joins as many leading segments as fit within `maxWidth` visible columns (using `sep`, default `' · '`), appending a trailing `' …'` if any were dropped. Returns `''` when `maxWidth <= 0`. Task 5 depends on this exact signature and the "never mid-bar-truncate" guarantee.

- [ ] **Step 1: Write the failing tests**

Append to `test/layout.test.js`:

```javascript
test('fitSegments joins every segment when they all fit', () => {
  assert.equal(layout.fitSegments(['a 10%', 'b 20%'], 20), 'a 10% · b 20%');
});

test('fitSegments drops trailing segments and appends an ellipsis when they do not all fit', () => {
  const result = layout.fitSegments(['aaaa 10%', 'bbbb 20%', 'cccc 30%'], 12);
  assert.equal(result, 'aaaa 10% …');
});

test('fitSegments never returns a partial segment — a segment that cannot fit at all becomes a bare ellipsis', () => {
  const result = layout.fitSegments(['aaaaaaaaaaaaaaaaaaaa'], 5);
  assert.equal(result, '…');
});

test('fitSegments respects a custom separator', () => {
  assert.equal(layout.fitSegments(['a', 'b'], 10, ' | '), 'a | b');
});

test('fitSegments returns an empty string for a non-positive max width', () => {
  assert.equal(layout.fitSegments(['a'], 0), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL with `TypeError: layout.fitSegments is not a function`.

- [ ] **Step 3: Implement `fitSegments`**

In `lib/ui/layout.js`, add near `degrade()` (after its closing `}`, before `selectionWindow`/`box`):

```javascript
// Packs whole segments (never a character-truncated one) into maxWidth,
// dropping trailing segments and appending a trailing ellipsis marker when
// not everything fits. Used by fleet.js's METRICS panel, which packs
// several "label ██████░░░░ XX%"-shaped segments into one line and must
// never render a half-drawn bar just because the terminal is narrow.
function fitSegments(segments, maxWidth, sep) {
  const joiner = sep != null ? sep : ' · ';
  if (maxWidth <= 0) return '';
  for (let n = segments.length; n > 0; n--) {
    const suffix = n < segments.length ? ' …' : '';
    const candidate = segments.slice(0, n).join(joiner) + suffix;
    if (f.visibleLength(candidate) <= maxWidth) return candidate;
  }
  return f.visibleLength('…') <= maxWidth ? '…' : '';
}
```

Then update the exports line at the end of the file from:

```javascript
module.exports = { box, hsplit, degrade, selectionWindow, BORDERS, MIN_BOX_WIDTH, MIN_BOX_HEIGHT };
```

to:

```javascript
module.exports = { box, hsplit, degrade, selectionWindow, fitSegments, BORDERS, MIN_BOX_WIDTH, MIN_BOX_HEIGHT };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS — all 5 new tests, plus every pre-existing `layout.test.js` test unaffected.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/layout.js test/layout.test.js
git commit -m "feat: add layout.fitSegments for width-aware, whole-segment line packing"
```

---

### Task 3: `format.sparkline` — 7-value block-character trend line

**Files:**
- Modify: `lib/ui/format.js`
- Test: `test/format.test.js` (append after the existing `bar` test)

**Interfaces:**
- Consumes: nothing new (pure function).
- Produces: `sparkline(values: number[]): string` — one of `▁▂▃▄▅▆▇█` per input value, scaled against the max value in the array; an all-zero (or empty-of-signal) array renders as all `▁`. Length of the returned string always equals `values.length`. Task 5 depends on this signature.

- [ ] **Step 1: Write the failing tests**

Append to `test/format.test.js`, right after the existing `test('bar renders a proportional progress bar', ...)` block (after line 124):

```javascript
test('sparkline maps each value to a block character scaled against the max', () => {
  assert.equal(sparkline([0, 7]), '▁█');
  assert.equal(sparkline([1, 2, 3, 4, 5, 6, 7]), '▂▃▄▅▆▇█');
});

test('sparkline renders an all-minimum line for an all-zero array, without dividing by zero', () => {
  assert.equal(sparkline([0, 0, 0, 0, 0, 0, 0]), '▁▁▁▁▁▁▁');
});

test('sparkline\'s output length always equals the input length', () => {
  assert.equal(sparkline([]).length, 0);
  assert.equal(sparkline([3]).length, 1);
  assert.equal(sparkline([3, 1, 4, 1, 5, 9, 2, 6]).length, 8);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/format.test.js`
Expected: FAIL — `sparkline` is not exported/defined yet (the destructured import at the top of the test file will need updating in the next step; until then this fails with `sparkline is not a function` or a `ReferenceError`).

First, update the import line at the top of `test/format.test.js` (line 4) from:

```javascript
const { dur, truncate, padTo, bar, visibleLength, stripUnsafeControls } = require('../lib/ui/format');
```

to:

```javascript
const { dur, truncate, padTo, bar, sparkline, visibleLength, stripUnsafeControls } = require('../lib/ui/format');
```

Then re-run — now it fails with `TypeError: sparkline is not a function`.

- [ ] **Step 3: Implement `sparkline`**

In `lib/ui/format.js`, add right after the `bar()` function (after line 309, before `bgFill`):

```javascript
// The 8-level block-character ramp a sparkline maps values onto — same
// "block density represents magnitude" idea as bar() above, just one
// character per data point instead of one bar for a single value.
const SPARK_LEVELS = '▁▂▃▄▅▆▇█';
function sparkline(values) {
  const arr = values || [];
  const max = arr.reduce((m, v) => Math.max(m, v || 0), 0);
  if (max === 0) return SPARK_LEVELS[0].repeat(arr.length);
  return arr.map((v) => {
    const idx = Math.round((Math.max(0, v || 0) / max) * (SPARK_LEVELS.length - 1));
    return SPARK_LEVELS[idx];
  }).join('');
}
```

Then update `module.exports` (lines 328-331) from:

```javascript
module.exports = {
  dur, truncate, padTo, bar, visibleLength, stripUnsafeControls,
  bold, dim, red, green, yellow, blue, magenta, cyan, ROLE_COLOUR, STATUS_COLOUR, bgFill,
};
```

to:

```javascript
module.exports = {
  dur, truncate, padTo, bar, sparkline, visibleLength, stripUnsafeControls,
  bold, dim, red, green, yellow, blue, magenta, cyan, ROLE_COLOUR, STATUS_COLOUR, bgFill,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/format.test.js`
Expected: PASS — all 3 new tests, plus every pre-existing `format.test.js` test unaffected.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/format.js test/format.test.js
git commit -m "feat: add format.sparkline for a fixed-length block-character trend line"
```

---

### Task 4: Generalize the forceRender box from one `emptyHint` line to N `emptyLines`

**Files:**
- Modify: `lib/ui/screens/fleet.js:693`, `lib/ui/screens/fleet.js:877-879`

**Interfaces:**
- Consumes: nothing new.
- Produces: any `forceRender`-flagged, zero-group section may now set `emptyLines: string[]` instead of (or in addition to) `emptyHint: string`; `emptyLines` wins when both are absent-vs-present is checked (`s.emptyLines || [s.emptyHint || '']`). QUICK START (`fleet.js:365-380`) keeps using `emptyHint` unchanged — this is additive. Task 5 depends on `emptyLines` being read here.

This task is a pure mechanical generalization with no new test file additions of its own — its correctness is proven by re-running the full existing suite, which already contains two tests that pin down the exact height/content contract being generalized: `'sectionHeight costs a forceRender-empty QUICK START exactly 3 rows...'` (`test/fleet.test.js:1837`) and `'the fleet view shows a METRICS section after DONE with real numbers'` (`test/fleet.test.js:551`).

- [ ] **Step 1: Confirm the two guard-rail tests currently pass (baseline)**

Run: `node --test test/fleet.test.js -t "sectionHeight costs a forceRender-empty QUICK START"`
Run: `node --test test/fleet.test.js -t "the fleet view shows a METRICS section"`
Expected: both PASS (this is the pre-change baseline — Task 1 already landed and does not touch these code paths yet).

- [ ] **Step 2: Generalize the height calculation**

In `lib/ui/screens/fleet.js`, find (around line 693):

```javascript
    if (!s.group.length) return s.forceRender ? 3 : 0;
```

Replace with:

```javascript
    // The lazygit-layout pass established 3 = one emptyHint content line +
    // 2-row border. Generalized here to N content lines via `emptyLines` —
    // METRICS now uses 5; QUICK START still passes a single `emptyHint`
    // string, covered by the `[s.emptyHint]` fallback (additive, not a
    // breaking rename — see fleet.js:365-380).
    if (!s.group.length) return s.forceRender ? (s.emptyLines || [s.emptyHint]).length + 2 : 0;
```

- [ ] **Step 3: Generalize the rendered content lines**

In the same file, find (around lines 877-879):

```javascript
      const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
      const contentLines = [f.truncate(s.emptyHint || '', innerCols)];
      const naturalBoxHeight = contentLines.length + 2;
```

Replace with:

```javascript
      const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
      // METRICS pre-fits its own lines (segment-aware, via layout.fitSegments)
      // against this same innerCols budget when buildSections builds
      // `emptyLines` — this truncate is a no-op safety net for those lines,
      // and the only truncation QUICK START's plain `emptyHint` string ever
      // gets.
      const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
      const naturalBoxHeight = contentLines.length + 2;
```

- [ ] **Step 4: Run the full test suite to verify nothing regressed**

Run: `node --test`
Expected: PASS — every test, including the two guard-rail tests named in Step 1 (QUICK START's `emptyHint` path is untouched by this generalization: `s.emptyLines` is `undefined` for it, so `s.emptyLines || [s.emptyHint]` evaluates to `[s.emptyHint]`, identical to the old hardcoded behavior). METRICS itself still only ever produces `emptyHint` at this point (Task 5 hasn't switched it to `emptyLines` yet), so its own rendering is also still byte-identical.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js
git commit -m "refactor: generalize the forceRender box from one emptyHint line to N emptyLines"
```

---

### Task 5: Wire the 5 METRICS lines, and fix the one existing test whose row-budget assumptions change

**Files:**
- Modify: `lib/ui/screens/fleet.js:407-421` (the `if (o.metrics) { ... }` block inside `buildSections`)
- Modify: `test/fleet.test.js:640-660` (the existing `'the total-height cap holds with all four sections populated...'` test)
- Test: `test/fleet.test.js` (new render-level tests)

**Interfaces:**
- Consumes: `metricsFor`'s new fields (Task 1), `layout.fitSegments` (Task 2), `f.sparkline`/`f.bar` (Task 3 / existing), the `emptyLines` mechanism (Task 4), `GATE_NAMES` (Task 1).
- Produces: the rendered METRICS box, 5 content lines instead of 1.

**Important — a real existing call site must not crash:** `sectionJumpTargets()` (`fleet.js:1051-1060`) calls `buildSections` with `metrics: {}` (a bare empty object — see that function's own comment: it only needs to know METRICS is *included*, not what it says). The old code got away with this because `{}.avgMs` etc. are merely `undefined`, not a throw. The new code must not dereference `m.successRate.today` (etc.) directly on a possibly-`{}` `m`, or it throws `Cannot read properties of undefined`. Default each nested field group before use.

- [ ] **Step 1: Write the failing crash-guard test first**

Insert into `test/fleet.test.js` right after the existing test at line 1865 (`'sectionJumpTargets includes a forceRender-empty QUICK START when visible'`):

```javascript
test('sectionJumpTargets never throws when metricsVisible passes the bare {} stand-in buildSections only checks for truthiness', () => {
  const targets = sectionJumpTargets([run({ status: 'running' })], null, false, true);
  const kinds = targets.map((t) => t.section.kind);
  assert.ok(kinds.includes('metrics'), `expected 'metrics' among ${kinds.join(',')}`);
});
```

Run: `node --test test/fleet.test.js -t "bare {} stand-in"`
Expected: FAIL — once Step 2 below is implemented without the defensive defaults, this throws `TypeError: Cannot read properties of undefined (reading 'today')`. (If you implement Step 2 with the defaults already in place, this test passes immediately — either order is fine as long as it's verified red-then-green or at minimum run once you understand why it would have failed.)

- [ ] **Step 2: Write the remaining failing render-level tests**

Insert into `test/fleet.test.js` right after the existing test at line 558 (`'the fleet view shows a METRICS section after DONE with real numbers'`):

```javascript
test('the METRICS box renders five content lines with real numbers', () => {
  const now = 100000;
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000,
      events: [{ kind: 'verdict', role: 'evaluator', verdict: 'PASS' }],
      gates: [{ name: 'phase:Setup', status: 'pass' }] }),
  ], { ...OPTS, now }));
  assert.match(out, /METRICS/);
  assert.match(out, /avg delivery/);
  assert.match(out, /success\s+today/);
  assert.match(out, /throughput \(7d\)/);
  assert.match(out, /verdicts\s+evaluator/);
  assert.match(out, /gates\s+Setup/);
});

test('the METRICS verdicts and gates lines say "no data yet" with no verdict/gate history', () => {
  const now = 100000;
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], { ...OPTS, now }));
  assert.match(out, /verdicts\s+no data yet/);
  assert.match(out, /gates\s+no data yet/);
});

test('the METRICS gates line drops trailing segments (with an ellipsis) instead of corrupting the box at a narrow width', () => {
  const now = 100000;
  const manyGates = PHASE_ORDER.map((p) => ({ name: `phase:${p}`, status: 'pass' }))
    .concat([{ name: 'server:backend', status: 'pass' }, { name: 'server:frontend', status: 'pass' }]);
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000, gates: manyGates }),
  ], { ...OPTS, cols: 40, now }));
  const gatesLine = out.split('\n').find((l) => l.includes('gates'));
  assert.ok(gatesLine, 'a gates line must render');
  assert.match(gatesLine, /…/);
  const labels = ['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup', 'backend', 'frontend'];
  const presentCount = labels.filter((l) => gatesLine.includes(l)).length;
  assert.ok(presentCount < labels.length, 'not every gate label should fit at 40 cols');
  assert.ok(f.visibleLength(gatesLine) <= 40, 'the rendered line must not exceed the box width');
});
```

`PHASE_ORDER` is not yet imported into `test/fleet.test.js` — add it to the existing `require('../lib/ui/reducer')` destructure on line 9. Change:

```javascript
const { reduce } = require('../lib/ui/reducer');
```

to:

```javascript
const { reduce, PHASE_ORDER } = require('../lib/ui/reducer');
```

Run: `node --test test/fleet.test.js`
Expected: FAIL — METRICS still renders only its old single line, so `/success\s+today/`, `/throughput \(7d\)/`, `/verdicts\s+evaluator/`, `/gates\s+Setup/`, and the "no data yet"/narrow-width tests all fail to match.

- [ ] **Step 3: Wire the 5 METRICS lines in `buildSections`**

In `lib/ui/screens/fleet.js`, replace the entire existing block (lines 407-421):

```javascript
  if (o.metrics) {
    const avgText = o.metrics.avgMs != null ? f.dur(o.metrics.avgMs) : 'n/a';
    sections.push({
      title: icons.metrics + ' METRICS',
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyHint: `avg delivery ${avgText} · delivered today ${o.metrics.deliveredToday} · ` +
        `this week ${o.metrics.deliveredWeek} · escalations today ${o.metrics.escalationsToday}`,
    });
  }
```

with:

```javascript
  if (o.metrics) {
    const m = o.metrics;
    const boxCols = Math.max(40, o.cols || 80);
    const innerCols = Math.max(0, boxCols - BOX_BORDER_PADDING_COLS);

    // `sectionJumpTargets()` (below) deliberately passes `{}` for `o.metrics`
    // when it only needs to know METRICS is included, not what it says — the
    // old single-scalar-field emptyHint tolerated that for free (`{}.avgMs`
    // is just `undefined`); these nested shapes do not, so default them
    // explicitly rather than dereferencing straight into `m.successRate.today`.
    const successRate = m.successRate || {
      today: { rate: null, done: 0, total: 0 },
      week: { rate: null, done: 0, total: 0 },
    };
    const throughput = m.throughput || [0, 0, 0, 0, 0, 0, 0];
    const verdictRates = m.verdictRates || {};
    const gateRates = m.gateRates || {};

    const avgText = m.avgMs != null ? f.dur(m.avgMs) : 'n/a';
    const line1 = `avg delivery ${avgText} · delivered today ${m.deliveredToday} · ` +
      `this week ${m.deliveredWeek}`;

    const rateSegment = (label, r) => r.rate == null
      ? `${label} n/a`
      : `${label} ${f.bar(r.rate, 10)} ${Math.round(r.rate * 100)}% (${r.done}/${r.total})`;
    const line2Prefix = 'success  ';
    const line2Segments = [
      rateSegment('today', successRate.today),
      rateSegment('week', successRate.week),
      `escalations today ${m.escalationsToday}`,
    ];
    const line2 = line2Prefix + layout.fitSegments(line2Segments, innerCols - line2Prefix.length);

    const throughputAvg = (throughput.reduce((a, b) => a + b, 0) / 7).toFixed(1);
    const throughputPeak = Math.max(...throughput);
    const line3 = `throughput (7d)  ${f.sparkline(throughput)}  avg ${throughputAvg}/day · peak ${throughputPeak}`;

    const line4Prefix = 'verdicts  ';
    const verdictSegments = ['evaluator', 'skeptic', 'auditor']
      .filter((role) => verdictRates[role] != null)
      .map((role) => `${role} ${f.bar(verdictRates[role], 10)} ${Math.round(verdictRates[role] * 100)}%`);
    const line4 = verdictSegments.length
      ? line4Prefix + layout.fitSegments(verdictSegments, innerCols - line4Prefix.length)
      : line4Prefix + 'no data yet';

    const line5Prefix = 'gates  ';
    const gateSegments = GATE_NAMES
      .filter((name) => gateRates[name] != null)
      .map((name) => `${name.replace(/^phase:|^server:/, '')} ${Math.round(gateRates[name] * 100)}%`);
    const line5 = gateSegments.length
      ? line5Prefix + layout.fitSegments(gateSegments, innerCols - line5Prefix.length)
      : line5Prefix + 'no data yet';

    sections.push({
      title: icons.metrics + ' METRICS',
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyLines: [line1, line2, line3, line4, line5],
    });
  }
```

- [ ] **Step 4: Run the fleet tests to verify Steps 1-2's new tests now pass**

Run: `node --test test/fleet.test.js`
Expected: mostly PASS, but the existing test `'the total-height cap holds with all four sections populated (plus the always-on METRICS panel)'` (currently around line 640) now FAILS — METRICS' fixed forceRender cost grew from 3 rows (1 content line + 2 border) to 7 rows (5 content lines + 2 border), and that test's smallest `rows` values (14, 16) are no longer enough to hold NEEDS YOU (pinned, 4 rows) + METRICS (now fixed at 7 rows) + the 3-row floor of each of RUNNING/FAILED/DONE once fully collapsed + the 3-row head/tail — a combined floor of 3+4+1+1+1+7 = 17 rows, i.e. `rows` must be at least 18 for the `rows - 1` budget to reach 17. This is expected — fix it in the next step, not by changing the implementation.

- [ ] **Step 5: Update the existing row-budget test for METRICS' new fixed cost**

In `test/fleet.test.js`, find the comment and test starting around line 628 (`// Two populated sections were never enough...` through the test body ending around line 660). Replace the comment block:

```javascript
// The lazygit-layout pass's METRICS panel is unconditional (forceRender,
// exactly like QUICK START's own untrimmable floor) — this fixture is now
// really FIVE sections (NEEDS YOU/RUNNING/FAILED/DONE/METRICS), which shifts
// the smallest terminal height it can hold everything in up accordingly
// (rows:14, not rows:10).
```

with:

```javascript
// The lazygit-layout pass's METRICS panel is unconditional (forceRender,
// exactly like QUICK START's own untrimmable floor) — this fixture is now
// really FIVE sections (NEEDS YOU/RUNNING/FAILED/DONE/METRICS), which shifts
// the smallest terminal height it can hold everything in up accordingly.
// The METRICS charts pass (2026-08-01) grew METRICS' own untrimmable floor
// from 3 rows (1 emptyHint line + 2-row border) to 7 rows (5 emptyLines +
// 2-row border) — even with RUNNING/FAILED/DONE each collapsed to their own
// 1-row floor, the combined untrimmable minimum is now head+tail(3) +
// NEEDS YOU(4) + RUNNING(1) + FAILED(1) + DONE(1) + METRICS(7) = 17 rows,
// so the smallest `rows` that can hold it is 18 (rows - 1 == 17), not 14.
```

And replace the `for (const rows of [14, 16, 18, 20, 24, 28])` line with:

```javascript
  for (const rows of [18, 20, 24, 28]) {
```

- [ ] **Step 6: Run the fleet tests again to confirm the fix**

Run: `node --test test/fleet.test.js`
Expected: PASS — every test in the file. If the updated test still fails at `rows:18`, do not guess further — add a one-off `console.log` of `out.split('\n').length` at `rows:18` inside the test, run it once to see the actual line count, and adjust the smallest value in the list (and the arithmetic explained in the comment above it) to match reality before removing the debug line. The arithmetic above is a careful hand-derivation from reading `sectionHeight`/the trim loop directly, not a guess, but it must still be confirmed against real output before this task is considered done.

- [ ] **Step 7: Run the entire project test suite**

Run: `node --test`
Expected: PASS — all tests across every file (1114+ before this plan's changes, plus every test this plan added).

- [ ] **Step 8: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "feat: render the METRICS box as 5 lines — success rate, throughput sparkline, verdict/gate breakdowns"
```

---

## Final verification

- [ ] Run `node --test` one more time from the repo root and confirm 0 failures.
- [ ] Manually sanity-check rendering: run `node -e "const {renderFleet}=require('./lib/ui/screens/fleet'); console.log(renderFleet([], {cols:100, rows:30}))"` and confirm a METRICS box with 5 lines appears (all "n/a"/"no data yet" for an empty `runs` array) and nothing throws.
