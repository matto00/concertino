# Fleet page two-column grid layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the concertino fleet page so NEEDS YOU and FAILED render as full-width banners at the top, RUNNING/QUICK START/QUEUED/DONE stack in a fixed-width left column, and METRICS becomes a full-height right column with richer content — on terminals wide enough to support it; narrower terminals keep today's single-column stack byte-for-byte.

**Architecture:** Reuses every existing rendering primitive (`layout.box`, `layout.hsplit`, `layout.selectionWindow`, `renderRun`/`renderFinishedRow`/`renderQueuedRow`/`renderQuickStartRow`) rather than inventing new ones. The one structural change with wide blast radius — moving FAILED to render right after NEEDS YOU in `buildSections()`'s canonical order — is done early (Task 2) so every later task's index/numbering arithmetic is simple by construction instead of needing special-case translation.

**Tech Stack:** Plain Node.js, `node:test`, no new dependencies (matches the codebase's existing zero-dependency constraint).

## Global Constraints

- `GRID_MIN_COLS = 110` — the two-column layout only engages at `cols >= 110`; below that, `renderFleet` is 100% today's existing single-column code path, unchanged.
- `COLUMN_ONE_WIDTH = 70` — column 1's fixed width in grid mode, regardless of total terminal width.
- METRICS' expanded content tier requires **both** `cols >= 80` (its own column width) **and** `contentRows >= 11` — below either, METRICS renders its compact 5-line box even while the page is otherwise in two-column mode.
- `buildSections()`'s canonical section order becomes: NEEDS YOU, FAILED, RUNNING, [QUICK START if visible], [QUEUED if pending], DONE, [METRICS if included] — FAILED moves from its current position (between QUEUED and DONE) to right after NEEDS YOU. This applies globally, to both single-column and grid rendering — there is only ever one canonical order.
- In grid mode, FAILED renders as a static banner: capped at `MAX_FINISHED`, but — unlike every other scrollable section — never scroll-adjusted and never further trimmed by the height budget. This is the same "always shows, never adjusts" treatment NEEDS YOU already gets today, just extended to a second section. Accepted trade-off, not solved further (matches the design doc's own stance on edge cases).
- Every new function is a pure function of its arguments (no I/O, no held state) — matching every existing function in `lib/ui/screens/fleet.js` and `lib/ui/layout.js`.
- Full design context: `docs/superpowers/specs/2026-08-01-fleet-metrics-grid-design.md`.

---

### Task 1: `metricsFor` — 30-day throughput, duration distribution, recent escalations

**Files:**
- Modify: `lib/ui/screens/fleet.js:70-167` (`metricsFor`)
- Test: `test/fleet.test.js` (new tests near the existing `metricsFor.throughput` tests, ~line 592)

**Interfaces:**
- Produces: `metricsFor(runs, now)` return value gains three fields — `throughput30d: number[]` (30 entries, same zero-filled/oldest-first shape as the existing `throughput`), `durationBuckets: { under10: number, from10to30: number, over30: number }`, `recentEscalations: Array<{ ticket, role, question, raisedAt }>` (sorted newest-first, uncapped). Later tasks (3, 4) consume these exact field names.

- [ ] **Step 1: Write the failing tests**

Add to `test/fleet.test.js`, right after the existing `'metricsFor.throughput is seven zeroes with no delivery history'` test (~line 597):

```javascript
test('metricsFor.throughput30d buckets done runs into the last 30 UTC days, oldest first', () => {
  const now = 40 * DAY_MS;
  const todayStart = 40 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart, elapsedMs: 1000 }), // today
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 20 * DAY_MS, elapsedMs: 1000 }), // 20 days ago
    run({ ticket: 'HEL-3', status: 'done', endedAt: todayStart - 31 * DAY_MS, elapsedMs: 1000 }), // outside the 30-day window
  ], now);
  assert.equal(m.throughput30d.length, 30);
  assert.equal(m.throughput30d[29], 1, 'index 29 is today');
  assert.equal(m.throughput30d[9], 1, 'index 9 is 20 days ago');
  assert.equal(m.throughput30d.reduce((a, b) => a + b, 0), 2, 'the 31-day-old delivery must not be counted');
});

test('metricsFor.throughput30d is thirty zeroes with no delivery history', () => {
  const m = metricsFor([], 1000000);
  assert.deepEqual(m.throughput30d, new Array(30).fill(0));
});

test('metricsFor.durationBuckets counts done runs with a known elapsedMs into three ranges', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', elapsedMs: 5 * 60000 }),      // under10
    run({ ticket: 'HEL-2', status: 'done', elapsedMs: 9 * 60000 + 59000 }), // under10 (just below 10m)
    run({ ticket: 'HEL-3', status: 'done', elapsedMs: 10 * 60000 }),     // from10to30 (exactly 10m)
    run({ ticket: 'HEL-4', status: 'done', elapsedMs: 25 * 60000 }),     // from10to30
    run({ ticket: 'HEL-5', status: 'done', elapsedMs: 30 * 60000 }),     // over30 (exactly 30m)
    run({ ticket: 'HEL-6', status: 'done', elapsedMs: 45 * 60000 }),     // over30
    run({ ticket: 'HEL-7', status: 'running' }),                        // no elapsedMs to count — excluded
  ], 1000000);
  assert.deepEqual(m.durationBuckets, { under10: 2, from10to30: 2, over30: 2 });
});

test('metricsFor.durationBuckets is all zero with no done-run history', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.deepEqual(m.durationBuckets, { under10: 0, from10to30: 0, over30: 0 });
});

test('metricsFor.recentEscalations collects every escalation.raised event across all runs, newest first', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', events: [
      { kind: 'escalation.raised', t: 100, ticket: 'HEL-1', role: 'orchestrator', question: 'add zod?' },
    ] }),
    run({ ticket: 'HEL-2', events: [
      { kind: 'escalation.raised', t: 300, ticket: 'HEL-2', role: 'evaluator', question: 'drop the column?' },
      { kind: 'escalation.raised', t: 200, ticket: 'HEL-2', role: null, question: 'retry?' },
    ] }),
  ], 1000000);
  assert.equal(m.recentEscalations.length, 3);
  assert.deepEqual(m.recentEscalations.map((e) => e.raisedAt), [300, 200, 100], 'newest first');
  assert.deepEqual(m.recentEscalations[0], { ticket: 'HEL-2', role: 'evaluator', question: 'drop the column?', raisedAt: 300 });
  assert.equal(m.recentEscalations[1].role, null, 'a missing role stays null, not a made-up default');
});

test('metricsFor.recentEscalations is empty with no escalation history', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'done' })], 1000000);
  assert.deepEqual(m.recentEscalations, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `m.throughput30d`/`m.durationBuckets`/`m.recentEscalations` are all `undefined`.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, replace the `throughput` block (current lines 106-115) with:

```javascript
  // Throughput: daily buckets of delivered ('done') runs, oldest first,
  // ending at today — a fixed-width array regardless of how much history
  // exists (a young project just gets leading zeroes), so sparkline()
  // always has a fixed-width array to render. Generalized to a `days`
  // parameter so the compact METRICS tier's 7-day window and the expanded
  // tier's 30-day window share one implementation.
  const buildThroughput = (days) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = todayStart - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      out.push(done.filter((r) => r.endedAt != null && r.endedAt >= dayStart && r.endedAt < dayEnd).length);
    }
    return out;
  };
  const throughput = buildThroughput(7);
  const throughput30d = buildThroughput(30);

  // Run-duration distribution: the same `withElapsed` list `avgMs` already
  // computes (done runs with a known elapsedMs), bucketed into three ranges.
  // Boundaries: [0, 10m) / [10m, 30m) / [30m, +inf) — no existing bucketing
  // helper in the codebase to reuse (confirmed by research before this plan
  // was written), so this is new, self-contained code.
  const durationBuckets = { under10: 0, from10to30: 0, over30: 0 };
  for (const r of withElapsed) {
    if (r.elapsedMs < 10 * 60000) durationBuckets.under10++;
    else if (r.elapsedMs < 30 * 60000) durationBuckets.from10to30++;
    else durationBuckets.over30++;
  }

  // Every escalation.raised event across all history, newest first — NOT
  // capped here; the METRICS rendering layer decides how many rows it has
  // room to show (a terminal's available height, not this function's
  // business).
  const recentEscalations = [];
  for (const r of list) {
    for (const ev of r.events || []) {
      if (ev.kind === 'escalation.raised') {
        recentEscalations.push({ ticket: ev.ticket, role: ev.role || null, question: ev.question || '', raisedAt: ev.t });
      }
    }
  }
  recentEscalations.sort((a, b) => b.raisedAt - a.raisedAt);
```

Then update the `return` statement (current lines 163-166) to:

```javascript
  return {
    avgMs, deliveredToday, deliveredWeek, escalationsToday,
    successRate, throughput, throughput30d, verdictRates, gateRates,
    durationBuckets, recentEscalations,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fleet.test.js`
Expected: PASS — all new tests green, and every pre-existing test still green (this step is purely additive to `metricsFor`'s return shape).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Add throughput30d, durationBuckets, recentEscalations to metricsFor"
```

---

### Task 2: Reorder `buildSections()` — FAILED moves to right after NEEDS YOU

**Why this is its own task, done early:** every later task's index arithmetic (which row `selected` points at, which digit jumps where, how much height column 1 vs. the FAILED/NEEDS YOU banners consume) is only simple to get right if the canonical section order already has NEEDS YOU and FAILED adjacent at the front. Doing this reorder now, before any grid-mode code exists, means Tasks 5-8 never have to reason about FAILED sitting in the middle of column 1's index space.

**Files:**
- Modify: `lib/ui/screens/fleet.js:447-491` (`buildSections`)
- Test: `test/fleet.test.js`

**Interfaces:**
- Produces: `buildSections()`'s returned array order is now `[NEEDS YOU, FAILED, RUNNING, QUICK START?, QUEUED?, DONE, METRICS?]`. Every later task that reasons about "the canonical section order" (Tasks 6-8) uses this order.

- [ ] **Step 1: Write the failing test**

Add to `test/fleet.test.js`, near the existing ordering test at line ~392-396:

```javascript
test('buildSections lists FAILED right after NEEDS YOU, ahead of RUNNING — the canonical order every grid-mode task depends on', () => {
  const sections = buildSections(
    { needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [run({ ticket: 'HEL-2', status: 'failed' })], done: [] },
    null,
    {},
  );
  const kinds = sections.map((s) => s.kind);
  assert.deepEqual(kinds, ['needs-you', 'failed', 'running', 'done']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fleet.test.js`
Expected: FAIL — today's order is `['needs-you', 'running', 'failed', 'done']`.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, `buildSections` currently reads (lines 447-491):

```javascript
function buildSections(buckets, queueState, opts) {
  const o = opts || {};
  const sections = [
    { title: 'NEEDS YOU', group: buckets.needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true, linesPerRow: 2, kind: 'needs-you' },
    { title: 'RUNNING',   group: buckets.active,   statusKey: 'running',   cap: Infinity, linesPerRow: 2, kind: 'running' },
  ];
  // CON-40: positioned after RUNNING, before the (already-conditional)
  // QUEUED entry (design.md Decision 2) — "what's wrong" -> "what's
  // happening" -> "what you could start" -> "what's about to start" ->
  // history.
  if (o.quickStartVisible) {
    ...
  }
  // Positioned after RUNNING (and QUICK START, if shown), before FAILED:
  // pending, not finished, but not yet actionable either (nothing to attach
  // to).
  if (queueState && queueState.pending && queueState.pending.length) {
    ...
  }
  sections.push(
    { title: 'FAILED', group: buckets.failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 1, kind: 'failed' },
    { title: 'DONE',   group: buckets.done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 1, kind: 'done' },
  );
  ...
```

Change it to (moving FAILED into the initial array, dropping it from the later `sections.push`, and updating the two comments that describe relative position):

```javascript
function buildSections(buckets, queueState, opts) {
  const o = opts || {};
  // fleet-metrics-grid design: FAILED sits right after NEEDS YOU — both are
  // "something needs your attention" categories, grouped together so the
  // grid-mode renderer (Task 8) can lay them out as adjacent full-width
  // banners without any index-space translation between this canonical
  // order and where things actually render on screen. This is also why
  // FAILED moved: it used to sit between QUEUED and DONE.
  const sections = [
    { title: 'NEEDS YOU', group: buckets.needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true, linesPerRow: 2, kind: 'needs-you' },
    { title: 'FAILED', group: buckets.failed, statusKey: 'failed', cap: MAX_FINISHED, linesPerRow: 1, kind: 'failed' },
    { title: 'RUNNING',   group: buckets.active,   statusKey: 'running',   cap: Infinity, linesPerRow: 2, kind: 'running' },
  ];
  // CON-40: positioned after RUNNING, before the (already-conditional)
  // QUEUED entry (design.md Decision 2) — "what's wrong" -> "what's
  // happening" -> "what you could start" -> "what's about to start" ->
  // history.
  if (o.quickStartVisible) {
    ...unchanged...
  }
  // Positioned after RUNNING (and QUICK START, if shown): pending, not
  // finished, but not yet actionable either (nothing to attach to).
  if (queueState && queueState.pending && queueState.pending.length) {
    ...unchanged...
  }
  sections.push(
    { title: 'DONE',   group: buckets.done,   statusKey: 'done',   cap: MAX_FINISHED, linesPerRow: 1, kind: 'done' },
  );
  ...
```

(Everything inside the `if (o.quickStartVisible)` and `if (queueState...)` blocks, and the METRICS block below `sections.push(DONE)`, is unchanged — only the FAILED entry moved and the trailing `sections.push` lost its first argument.)

- [ ] **Step 4: Run the full suite and fix every test whose expectations depended on the old order**

Run: `node --test`

This reorder has a wide, mechanical blast radius — every test that asserts FAILED renders after RUNNING/QUEUED, or asserts a specific digit-jump number for FAILED/DONE/RUNNING when multiple sections are present, will fail. Go through each failure and update its expectation to match the new order (NEEDS YOU, FAILED, RUNNING, [QUICK START], [QUEUED], DONE, METRICS) — the underlying behavior (what each section shows, how many rows, how trimming/scrolling works) is unchanged, only *position* moved. Known affected tests (search `test/fleet.test.js` for each):

- The ordering test at ~line 392-396 (`'HEL-2 under FAILED'` / `'FAILED section comes first'`) — its assertions about FAILED-vs-DONE order still hold, but any assertion mixing in RUNNING's position needs re-checking.
- The digit-jump tests at ~line 1644-1656 (`'digit jump lands on the first row of the target section when NEEDS YOU/RUNNING/FAILED are all present'`, `'numbering skips empty sections — digit 2 reaches DONE when NEEDS YOU/FAILED are empty'`) — the comment-documented digit numbers (e.g. "FAILED (1 row, index 3)") change; update both the numbers and the run() fixtures' `assert` targets to match where FAILED now sits.
- The heading-icon test at ~line 2297-2307 (asserts `/\[3\] FAILED/`) — FAILED's number changes.
- The height-budget/scroll tests referencing "NEEDS YOU + FAILED + DONE" row-count math at ~lines 810-816, 1065-1066, 1146-1170, 1195-1238 — the row *counts* these compute are unaffected by section *order* (each section's own height formula is unchanged), but any test that also asserts *which section trims first* under budget pressure must be re-verified against the new order (FAILED now sits earlier in the array, so the Stage B trim loop — which iterates from the end — reaches it later than before).
- The pinned/non-pinned QUEUED-vs-FAILED/DONE test at ~line 164 — re-verify its ordering assumptions.

For each failure: read what changed, confirm the NEW output is correct per the new canonical order (not just "make the assertion match whatever came out" — the previous design's Task 5 established this discipline: verify the new floor/order is actually right, not merely convenient), then update the assertion.

Expected after fixes: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Reorder buildSections: FAILED renders right after NEEDS YOU"
```

---

### Task 3: Extract `metricsColumnLines` (compact tier)

**Files:**
- Modify: `lib/ui/screens/fleet.js` (new function `metricsColumnLines`, `buildSections`' `if (o.metrics)` block simplified to call it)
- Test: `test/fleet.test.js`

**Interfaces:**
- Produces: `metricsColumnLines(m, opts)` — `opts: { cols }` — returns `string[]`, the same 5 lines `buildSections`' inline block builds today. Exported from the module. Task 4 adds a second tier to this same function; Task 8 calls it directly (bypassing `buildSections`) for the grid-mode METRICS column.

- [ ] **Step 1: Write the failing test**

Add to `test/fleet.test.js`, right after the `metricsFor` tests (~line 634):

```javascript
const { metricsColumnLines } = require('../lib/ui/screens/fleet');

test('metricsColumnLines returns the same 5 compact lines buildSections used to build inline', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000,
      events: [{ kind: 'verdict', role: 'evaluator', verdict: 'PASS' }],
      gates: [{ name: 'phase:setup', status: 'pass' }] }),
  ], 100000);
  const lines = metricsColumnLines(m, { cols: 76 });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /avg delivery/);
  assert.match(lines[1], /success\s+today/);
  assert.match(lines[2], /throughput \(7d\)/);
  assert.match(lines[3], /verdicts\s+evaluator/);
  assert.match(lines[4], /gates\s+setup/);
});
```

(This import line replaces the bare `metricsFor` destructure at the top of the file's `metricsFor` test section if one already exists there — if `metricsColumnLines` needs adding to the top-level `require` at line 4-8 instead of a local one, do that instead; either is fine as long as it compiles once Step 3 exports the function.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `metricsColumnLines` is not exported / not defined.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, add a new function right before `buildSections` (after `metricsFor`, ~line 168):

```javascript
// The METRICS column's content — a pure function of the metrics object
// metricsFor() returns and how much room is available. Extracted out of
// buildSections' inline `if (o.metrics)` block (lazygit-layout /
// fleet-metrics-charts passes) so the grid-mode renderer (Task 8) can call
// it directly with a DIFFERENT `cols`/`contentRows` than the single-column
// METRICS box gets, without duplicating this construction. `opts.cols` is
// the box's INNER width (same convention buildSections' block already
// used — the caller has already subtracted BOX_BORDER_PADDING_COLS).
function metricsColumnLines(m, opts) {
  const o = opts || {};
  const cols = Math.max(0, o.cols || 0);

  // Defensive defaults: sectionJumpTargets() (below) deliberately passes
  // `{}` for `o.metrics` when it only needs to know METRICS is included,
  // not what it says — these nested shapes do not tolerate dereferencing
  // straight into e.g. `m.successRate.today` the way the old single-scalar
  // `avgMs` field did.
  const successRate = m.successRate || {
    today: { rate: null, done: 0, total: 0 },
    week: { rate: null, done: 0, total: 0 },
  };
  const throughput = m.throughput || [0, 0, 0, 0, 0, 0, 0];
  const verdictRates = m.verdictRates || {};
  const gateRates = m.gateRates || {};

  // `escalations today` lives on line 1, not packed into line 2's
  // fitSegments call — see the fleet-metrics-charts design doc for why
  // (it was the first thing fitSegments dropped at a standard 80-column
  // terminal when tried on line 2).
  const avgText = m.avgMs != null ? f.dur(m.avgMs) : 'n/a';
  const line1 = `avg delivery ${avgText} · delivered today ${m.deliveredToday ?? 0} · ` +
    `this week ${m.deliveredWeek ?? 0} · escalations today ${m.escalationsToday ?? 0}`;

  const rateSegment = (label, r) => r.rate == null
    ? `${label} n/a`
    : `${label} ${f.bar(r.rate, 10)} ${Math.round(r.rate * 100)}% (${r.done}/${r.total})`;
  const line2Prefix = 'success  ';
  const line2Segments = [rateSegment('today', successRate.today), rateSegment('week', successRate.week)];
  const line2 = line2Prefix + layout.fitSegments(line2Segments, cols - line2Prefix.length);

  const throughputAvg = (throughput.reduce((a, b) => a + b, 0) / throughput.length).toFixed(1);
  const throughputPeak = Math.max(...throughput);
  const line3 = `throughput (7d)  ${f.sparkline(throughput)}  avg ${throughputAvg}/day · peak ${throughputPeak}`;

  const line4Prefix = 'verdicts  ';
  const verdictSegments = ['evaluator', 'skeptic', 'auditor']
    .filter((role) => verdictRates[role] != null)
    .map((role) => `${role} ${f.bar(verdictRates[role], 10)} ${Math.round(verdictRates[role] * 100)}%`);
  const line4 = verdictSegments.length
    ? line4Prefix + layout.fitSegments(verdictSegments, cols - line4Prefix.length)
    : line4Prefix + 'no data yet';

  const line5Prefix = 'gates  ';
  const gateSegments = Object.keys(gateRates)
    .sort((a, b) => {
      const ia = GATE_NAME_ORDER.indexOf(a);
      const ib = GATE_NAME_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a < b ? -1 : a > b ? 1 : 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((name) => `${name.replace(/^phase:|^server:/, '')} ${Math.round(gateRates[name] * 100)}%`);
  const line5 = gateSegments.length
    ? line5Prefix + layout.fitSegments(gateSegments, cols - line5Prefix.length)
    : line5Prefix + 'no data yet';

  return [line1, line2, line3, line4, line5];
}
```

Then replace `buildSections`' `if (o.metrics)` block (the whole block that builds `line1`...`line5` inline and pushes the METRICS section) with:

```javascript
  if (o.metrics) {
    const boxCols = Math.max(40, o.cols || 80);
    const innerCols = Math.max(0, boxCols - BOX_BORDER_PADDING_COLS);
    sections.push({
      title: icons.metrics + ' METRICS',
      group: [],
      statusKey: 'metrics',
      cap: 1,
      unselectable: true,
      linesPerRow: 1,
      kind: 'metrics',
      forceRender: true,
      emptyLines: metricsColumnLines(o.metrics, { cols: innerCols }),
    });
  }
```

Finally, add `metricsColumnLines` to `module.exports` (~line 1489-1492):

```javascript
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, sectionJumpTargets, buildSections,
  QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor, metricsColumnLines,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — the new test, and every pre-existing METRICS test (lines ~636-732), unchanged, since this is a byte-identical-output refactor.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Extract metricsColumnLines from buildSections' inline METRICS block"
```

---

### Task 4: `metricsColumnLines` — expanded tier

**Files:**
- Modify: `lib/ui/screens/fleet.js` (`metricsColumnLines`)
- Test: `test/fleet.test.js`

**Interfaces:**
- Consumes: `metricsFor`'s `throughput30d`/`durationBuckets`/`recentEscalations` (Task 1).
- Produces: `metricsColumnLines(m, opts)` now reads `opts.contentRows` too. When `opts.cols >= 80 && opts.contentRows >= 11`, returns the expanded content (up to 10 lines: the original 5, a blank separator, a duration-distribution line, a blank separator, a "recent escalations" header, and as many escalation rows as fit `contentRows`). Otherwise returns the same 5 compact lines as before. Task 8 calls this with the grid mode's real `cols`/`contentRows`.

- [ ] **Step 1: Write the failing tests**

Add to `test/fleet.test.js`, right after the Task 3 test:

```javascript
function metricsFixtureExpanded() {
  return {
    avgMs: 90000, deliveredToday: 2, deliveredWeek: 5, escalationsToday: 1,
    successRate: { today: { rate: 1, done: 2, total: 2 }, week: { rate: 0.8, done: 4, total: 5 } },
    throughput: [0, 0, 0, 0, 0, 1, 1],
    throughput30d: new Array(30).fill(0).map((_, i) => (i >= 28 ? 1 : 0)),
    verdictRates: { evaluator: 0.9, skeptic: null, auditor: null },
    gateRates: { 'phase:setup': 1 },
    durationBuckets: { under10: 3, from10to30: 1, over30: 0 },
    recentEscalations: [
      { ticket: 'CON-9', role: 'orchestrator', question: 'retry?', raisedAt: 5000 },
      { ticket: 'CON-8', role: 'evaluator', question: 'looks risky, proceed?', raisedAt: 4000 },
    ],
  };
}

test('metricsColumnLines stays compact when the column is narrower than 80 cols, even with plenty of rows', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 60, contentRows: 40 });
  assert.equal(lines.length, 5);
});

test('metricsColumnLines stays compact when contentRows is too small, even with a wide column', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 100, contentRows: 5 });
  assert.equal(lines.length, 5);
});

test('metricsColumnLines expands when both cols>=80 and contentRows>=11: 30-day throughput, duration line, escalations', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 90, contentRows: 20 });
  assert.match(lines[2], /throughput \(30d\)/);
  const durationLine = lines.find((l) => l.startsWith('duration'));
  assert.ok(durationLine, 'a duration line must render');
  assert.match(durationLine, /<10m 75%/);
  assert.match(durationLine, /10-30m 25%/);
  assert.match(durationLine, /30m\+ 0%/);
  assert.ok(lines.includes('recent escalations'), 'a recent-escalations header must render');
  const escLine = lines.find((l) => l.includes('CON-9'));
  assert.ok(escLine, 'the newest escalation must render');
  assert.match(escLine, /retry\?/);
});

test('metricsColumnLines\' expanded tier shows only as many escalation rows as contentRows allows', () => {
  const m = metricsFixtureExpanded();
  m.recentEscalations = Array.from({ length: 20 }, (_, i) => ({
    ticket: `CON-${i}`, role: 'orchestrator', question: 'q', raisedAt: 20 - i,
  }));
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 13 }); // 8 fixed + header + 1 room for 3 more? see below
  // fixedLines = [line1,line2,line3,line4,line5,'',durationLine,''] = 8 lines.
  // remaining = contentRows - 8. header consumes 1, the rest go to escalation rows.
  const remaining = 13 - 8;
  const escalationRowCount = lines.length - 8 - 1; // minus the 8 fixed lines and the header
  assert.equal(escalationRowCount, remaining - 1);
});

test('metricsColumnLines\' expanded tier says "no escalations yet" when the list is empty but there is room', () => {
  const m = metricsFixtureExpanded();
  m.recentEscalations = [];
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 20 });
  assert.ok(lines.some((l) => l.includes('no escalations yet')));
});

test('metricsColumnLines\' expanded-tier duration line says "no data yet" with no duration history', () => {
  const m = metricsFixtureExpanded();
  m.durationBuckets = { under10: 0, from10to30: 0, over30: 0 };
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 20 });
  const durationLine = lines.find((l) => l.startsWith('duration'));
  assert.match(durationLine, /no data yet/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `metricsColumnLines` doesn't read `contentRows` yet, and always returns 5 lines regardless of width.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, modify `metricsColumnLines` (from Task 3). Change the signature line and add the tier decision right after the existing defaults:

```javascript
function metricsColumnLines(m, opts) {
  const o = opts || {};
  const cols = Math.max(0, o.cols || 0);
  const contentRows = o.contentRows != null ? o.contentRows : 5;
  const expanded = cols >= 80 && contentRows >= 11;

  const successRate = m.successRate || {
    today: { rate: null, done: 0, total: 0 },
    week: { rate: null, done: 0, total: 0 },
  };
  const throughput = m.throughput || [0, 0, 0, 0, 0, 0, 0];
  const throughput30d = m.throughput30d || new Array(30).fill(0);
  const verdictRates = m.verdictRates || {};
  const gateRates = m.gateRates || {};
  const durationBuckets = m.durationBuckets || { under10: 0, from10to30: 0, over30: 0 };
  const recentEscalations = m.recentEscalations || [];
  ...
```

Change line3's construction (from Task 3's `const throughputAvg = ...` through `const line3 = ...`) to pick the window based on `expanded`:

```javascript
  const throughputData = expanded ? throughput30d : throughput;
  const throughputWindowLabel = expanded ? '30d' : '7d';
  const throughputAvg = (throughputData.reduce((a, b) => a + b, 0) / throughputData.length).toFixed(1);
  const throughputPeak = Math.max(...throughputData);
  const line3 = `throughput (${throughputWindowLabel})  ${f.sparkline(throughputData)}  avg ${throughputAvg}/day · peak ${throughputPeak}`;
```

Then, at the end of the function (where Task 3 has `return [line1, line2, line3, line4, line5];`), replace with:

```javascript
  const compactLines = [line1, line2, line3, line4, line5];
  if (!expanded) return compactLines;

  // Expanded tier: the fixed blocks below always cost the same 8 lines for
  // a given terminal; whatever's left goes to "recent escalations" — see
  // the design doc for why that specific block is the one that absorbs
  // leftover vertical space (it's the only unbounded-length real data
  // METRICS has).
  const durationTotal = durationBuckets.under10 + durationBuckets.from10to30 + durationBuckets.over30;
  const durationPrefix = 'duration  ';
  const line7 = durationTotal
    ? durationPrefix + layout.fitSegments([
        `<10m ${Math.round(durationBuckets.under10 / durationTotal * 100)}%`,
        `10-30m ${Math.round(durationBuckets.from10to30 / durationTotal * 100)}%`,
        `30m+ ${Math.round(durationBuckets.over30 / durationTotal * 100)}%`,
      ], cols - durationPrefix.length)
    : durationPrefix + 'no data yet';

  const fixedLines = [line1, line2, line3, line4, line5, '', line7, ''];
  const remaining = Math.max(0, contentRows - fixedLines.length);
  if (remaining === 0) return fixedLines;

  const escalationLines = ['recent escalations'];
  const rowsForList = remaining - 1;
  if (rowsForList > 0) {
    if (!recentEscalations.length) {
      escalationLines.push('  no escalations yet');
    } else {
      for (const esc of recentEscalations.slice(0, rowsForList)) {
        const time = new Date(esc.raisedAt).toISOString().slice(11, 16);
        const rolePart = esc.role ? esc.role + '  ' : '';
        escalationLines.push(f.truncate(`  ${time}  ${esc.ticket}  ${rolePart}"${esc.question}"`, cols));
      }
    }
  }
  return fixedLines.concat(escalationLines);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — new tests green, Task 3's compact-tier test still green (its `{ cols: 76 }` call has no `contentRows`, defaults to `5`, which is `< 11`, so it stays compact), every pre-existing METRICS test still green (same reason — none of them pass `contentRows`).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Add metricsColumnLines' expanded tier: 30d throughput, duration line, recent escalations"
```

---

### Task 5: Extract `computeWindow` from `visibleWindow`

**Files:**
- Modify: `lib/ui/screens/fleet.js:795-957` (`visibleWindow`)
- Test: `test/fleet.test.js`

**Interfaces:**
- Produces: `computeWindow(runs, sections, opts)` — the Stage A/B trim-loop core of today's `visibleWindow`, now taking a pre-built `sections` array as a parameter instead of deriving it internally, plus a new `opts.includeHeadTail` flag (default `true`) that, when `false`, skips adding the page header/footer row count into the height budget. Same return shape as `visibleWindow` today: `{ sections: [{shown,startOffset,hidden}, ...], firstVisibleIndex, lastVisibleIndex, maxScrollOffset }`. `visibleWindow(runs, opts)` becomes a thin wrapper: `bucketRuns` + `buildSections` + `computeWindow`. Task 7's `visibleWindowGrid` is the reason this exists — it calls `computeWindow` directly with a restricted, grid-mode-only section list and `includeHeadTail: false` (since the grid renderer computes the column area's budget itself, already net of head/tail).

- [ ] **Step 1: Write the failing test**

Add to `test/fleet.test.js`, near the existing `visibleWindow` tests:

```javascript
const { computeWindow } = require('../lib/ui/screens/fleet');

test('computeWindow produces the identical result visibleWindow already returns, given the same buildSections output', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done' })];
  const sections = buildSections(
    { needsYou: [], active: [runs[0]], failed: [], done: [runs[1]] },
    null, {},
  );
  const direct = computeWindow(runs, sections, { rows: 30, selected: 0, scrollOffset: 0 });
  const viaWrapper = visibleWindow(runs, { rows: 30, selected: 0, scrollOffset: 0 });
  assert.deepEqual(direct, viaWrapper);
});

test('computeWindow with includeHeadTail:false does not subtract the page header/footer row count from the budget', () => {
  const runs = manyFinished(20, 'done');
  const sections = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {});
  const withHeadTail = computeWindow(runs, sections, { rows: 10, selected: 0, scrollOffset: 0, includeHeadTail: true });
  const withoutHeadTail = computeWindow(runs, sections, { rows: 10, selected: 0, scrollOffset: 0, includeHeadTail: false });
  // Excluding head/tail leaves more of the same 10-row budget for content,
  // so at least as many (and, with real head/tail content present, more)
  // DONE rows survive the trim.
  assert.ok(withoutHeadTail.sections[0].shown >= withHeadTail.sections[0].shown);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `computeWindow` is not exported / not defined.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, replace the whole body of `visibleWindow` (lines 795-957) with two functions:

```javascript
// The Stage A/B trim-loop core of visibleWindow (below), extracted so
// grid-mode rendering (visibleWindowGrid, Task 7) can run the identical
// scroll/trim arithmetic over a DIFFERENT, restricted section list (just
// column 1's own sections) and a DIFFERENT row budget (the column area's
// height, not the whole terminal) — without a second, drifting
// implementation of this trim loop. See visibleWindow's own header comment
// for what Stage A/B actually do; nothing about that logic changed here,
// only which `sections`/`runs` it's handed and whether it accounts for
// the page header/footer.
//
// `opts.includeHeadTail` (default true): when false, skips buildHeadTail's
// row count entirely — used by grid mode, which has already netted out
// the header/footer when it computed the column area's own height budget,
// and would otherwise double-subtract them.
function computeWindow(runs, sections, opts) {
  const rows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const includeHeadTail = !(opts && opts.includeHeadTail === false);

  let remaining = scrollOffset;
  let globalIndex = 0;
  const win = sections.map((s) => {
    const groupLen = s.group.length;
    if (s.unselectable) {
      const shown = Math.min(groupLen, s.cap);
      return { shown, startOffset: 0, hidden: groupLen - shown, sectionStartIndex: null };
    }
    const sectionStartIndex = globalIndex;
    let startOffset = 0;
    let shown;
    if (s.pinned) {
      shown = groupLen;
    } else if (remaining >= groupLen) {
      remaining -= groupLen;
      shown = 0;
      startOffset = groupLen;
    } else if (remaining > 0) {
      const w = layout.selectionWindow(groupLen, remaining, s.cap, remaining);
      startOffset = w.start;
      shown = w.count;
      remaining = 0;
    } else {
      const w = layout.selectionWindow(groupLen, 0, s.cap, 0);
      shown = w.count;
    }
    globalIndex += groupLen;
    return { shown, startOffset, hidden: groupLen - shown, sectionStartIndex };
  });

  const headTailRows = includeHeadTail ? (() => {
    const { head, tail } = buildHeadTail(runs, opts);
    return head.length + tail.length;
  })() : 0;
  const sectionHeight = (s, w) => {
    if (!s.group.length) return s.forceRender ? (s.emptyLines || [s.emptyHint]).length + 2 : 0;
    if (w.shown === 0) return 1;
    return 2 + s.linesPerRow * w.shown + (s.group.length > w.shown ? 1 : 0);
  };
  const totalHeight = () => headTailRows +
    sections.reduce((h, s, i) => h + sectionHeight(s, win[i]), 0);

  const budget = rows > 0 ? rows - 1 : 0;
  if (budget > 0) {
    for (let i = sections.length - 1; i >= 0 && totalHeight() > budget; i--) {
      if (sections[i].pinned) continue;
      const s = sections[i];
      const w = win[i];
      const containsSelected = !s.unselectable && w.sectionStartIndex !== null &&
        selected >= w.sectionStartIndex + w.startOffset &&
        selected < w.sectionStartIndex + w.startOffset + w.shown;

      while (w.shown > 0 && totalHeight() > budget) {
        if (containsSelected) {
          const localSelected = selected - w.sectionStartIndex;
          const distFromHead = localSelected - w.startOffset;
          const distFromTail = (w.startOffset + w.shown - 1) - localSelected;
          if (distFromTail >= distFromHead) {
            w.shown--;
          } else {
            w.startOffset++;
            w.shown--;
          }
        } else {
          w.shown--;
        }
        w.hidden = s.group.length - w.shown;
      }
    }
  }

  let firstVisibleIndex = null;
  let lastVisibleIndex = null;
  sections.forEach((s, i) => {
    if (s.unselectable || s.pinned) return;
    const w = win[i];
    if (w.shown > 0) {
      const start = w.sectionStartIndex + w.startOffset;
      const end = w.sectionStartIndex + w.startOffset + w.shown - 1;
      if (firstVisibleIndex === null) firstVisibleIndex = start;
      lastVisibleIndex = end;
    }
  });
  if (firstVisibleIndex === null) firstVisibleIndex = 0;
  if (lastVisibleIndex === null) lastVisibleIndex = Math.max(0, runs.length - 1);

  const scrollable = sections.filter((s) => !s.unselectable && !s.pinned);
  let maxScrollOffset = 0;
  const lastNonEmpty = scrollable.slice().reverse().find((s) => s.group.length > 0);
  if (lastNonEmpty) {
    const totalScrollableRows = scrollable.reduce((n, s) => n + s.group.length, 0);
    const windowAtEnd = Math.min(lastNonEmpty.cap, lastNonEmpty.group.length);
    maxScrollOffset = Math.max(0, totalScrollableRows - windowAtEnd);
  }

  return {
    sections: win.map((w) => ({ shown: w.shown, startOffset: w.startOffset, hidden: w.hidden })),
    firstVisibleIndex,
    lastVisibleIndex,
    maxScrollOffset,
  };
}

function visibleWindow(runs, opts) {
  const queueState = (opts && opts.queueState) || null;
  const buckets = bucketRuns(runs);
  const sections = buildSections(buckets, queueState, opts);
  return computeWindow(runs, sections, opts);
}
```

(Every doc comment that used to sit directly above `visibleWindow` describing Stage A/B — the large comment block at lines 767-794 — stays exactly where it is, now describing `computeWindow`'s logic; only the function boundary moved.)

Add `computeWindow` to `module.exports`:

```javascript
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, computeWindow, sectionJumpTargets, buildSections,
  QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor, metricsColumnLines,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — the two new tests, and every pre-existing `visibleWindow` test in the file (there are many, covering scroll/trim/pinned behavior) unchanged, since `visibleWindow`'s own behavior is byte-identical (pure extraction).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Extract computeWindow from visibleWindow for grid-mode reuse"
```

---

### Task 6: `renderStackedSection` — shared box-rendering helper for grid mode

**Files:**
- Modify: `lib/ui/screens/fleet.js` (new function)
- Test: `test/fleet.test.js`

**Interfaces:**
- Consumes: a section object from `buildSections()` (with `.title`, `.group`, `.statusKey`, `.kind`, `.unselectable`, `.forceRender`, `.emptyLines`/`.emptyHint`), a `window` object shaped `{shown, startOffset, hidden}` (Task 5's `computeWindow`/Task 7's `visibleWindowGrid` output), and a context object.
- Produces: `renderStackedSection(s, jumpNumber, w, ctx)` → `string[]`, a fully-rendered (bordered or degraded) box for exactly one section, at its own natural height — **no grow-to-fill**, unlike `renderFleet`'s existing per-section loop. Deliberately a new function, not extracted from `renderFleet`'s forEach body: grid mode's banners and column-1 sections never grow to absorb leftover space (only the two-column area as a whole does, via `hsplit` padding — see the design doc), so this needed different behavior from day one, not just a different call site. `ctx`: `{ cols, avgDoneMs, selected, sectionStartIndex, queuedTitles, queueFocus, quickStartFocus, focus, queueLaunchInfo }`. Task 8 is the only caller.

- [ ] **Step 1: Write the failing tests**

Add to `test/fleet.test.js`:

```javascript
const { renderStackedSection } = require('../lib/ui/screens/fleet');

test('renderStackedSection renders a non-empty section as a bordered box at its natural height, with the given jump number', () => {
  const sections = buildSections({ needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [], done: [] }, null, {});
  const running = sections.find((s) => s.kind === 'running');
  const w = { shown: 1, startOffset: 0, hidden: 0 };
  const lines = renderStackedSection(running, 3, w, { cols: 70, avgDoneMs: null, selected: 0, sectionStartIndex: 0 });
  assert.match(lines[0], /\[3\] RUNNING/);
  assert.match(plain(lines.join('\n')), /HEL-1/);
  assert.equal(lines[lines.length - 1][0], '└', 'a natural-height box always closes with its own bottom border');
});

test('renderStackedSection renders a forceRender-empty section (e.g. METRICS-shaped) from its emptyLines', () => {
  const s = { title: 'X', group: [], statusKey: 'x', kind: 'x', unselectable: true, forceRender: true, emptyLines: ['one', 'two'] };
  const lines = renderStackedSection(s, 1, { shown: 0, startOffset: 0, hidden: 0 }, { cols: 40 });
  assert.match(plain(lines.join('\n')), /one/);
  assert.match(plain(lines.join('\n')), /two/);
});

test('renderStackedSection renders nothing for an ordinary empty, non-forceRender section', () => {
  const s = { title: 'X', group: [], statusKey: 'x', kind: 'x', forceRender: false };
  const lines = renderStackedSection(s, 1, { shown: 0, startOffset: 0, hidden: 0 }, { cols: 40 });
  assert.deepEqual(lines, []);
});

test('renderStackedSection never grows past its natural height, even when told about a larger box budget elsewhere on the page', () => {
  const sections = buildSections({ needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [], done: [] }, null, {});
  const running = sections.find((s) => s.kind === 'running');
  const w = { shown: 1, startOffset: 0, hidden: 0 };
  const lines = renderStackedSection(running, 1, w, { cols: 70, avgDoneMs: null, selected: 0, sectionStartIndex: 0 });
  // 1 run row (2 lines per row) + 2 border lines = 4, regardless of how
  // much vertical space the page has elsewhere (unlike renderFleet's
  // single-column loop, this function has no budget/grow-to-fill concept
  // at all).
  assert.equal(lines.length, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `renderStackedSection` is not exported / not defined.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, add (near `renderFleet`, since it mirrors that function's per-section rendering):

```javascript
// Grid mode's per-section box renderer (fleet-metrics-grid design) — used
// for NEEDS YOU/FAILED banners and column 1's RUNNING/QUICK START/QUEUED/
// DONE boxes. Deliberately NOT shared with renderFleet's own per-section
// loop below: that loop's last-section grow-to-fill behavior does not
// apply here (only the two-column area as a WHOLE grows, via
// layout.hsplit padding column 1 out to METRICS' height — see the design
// doc) — every section this function draws is always at its own natural
// height. `w`: `{shown, startOffset, hidden}` for this section (from
// computeWindow/visibleWindowGrid). `ctx`: `{ cols, avgDoneMs, selected,
// sectionStartIndex, queuedTitles, queueFocus, quickStartFocus, focus,
// queueLaunchInfo }`.
function renderStackedSection(s, jumpNumber, w, ctx) {
  const cols = ctx.cols;
  const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
  const numberedTitle = `[${jumpNumber}] ${s.title}`;
  const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);

  if (!s.group.length) {
    if (!s.forceRender) return [];
    const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
    if (layout.degrade(cols, contentLines.length + 2)) {
      return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
    }
    return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
  }

  if (w.shown === 0) {
    return ['      ' + f.dim(`… and ${w.hidden} more ${s.title.toLowerCase()}`)];
  }

  const contentLines = [];
  for (let k = w.startOffset; k < w.startOffset + w.shown; k++) {
    const rowIndex = ctx.sectionStartIndex + k;
    if (s.kind === 'queued') {
      const ticket = s.group[k];
      const title = ctx.queuedTitles ? ctx.queuedTitles.get(ticket) : null;
      const focused = ctx.focus === 'queue' && ctx.queueFocus === k;
      for (const line of renderQueuedRow(ticket, k + 1, title, innerCols, {
        focused, speed: ctx.queueLaunchInfo && ctx.queueLaunchInfo.speed,
        agentMerge: ctx.queueLaunchInfo ? ctx.queueLaunchInfo.agentMerge : null,
      })) contentLines.push(line);
    } else if (s.kind === 'quickstart') {
      const ticket = s.group[k];
      const focused = ctx.focus === 'quickstart' && ctx.quickStartFocus === k;
      for (const line of renderQuickStartRow(ticket, focused, innerCols)) contentLines.push(line);
    } else if (s.kind === 'failed' || s.kind === 'done') {
      for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs }, rowIndex === ctx.selected)) contentLines.push(line);
    } else {
      for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs }, rowIndex === ctx.selected)) contentLines.push(line);
    }
  }
  if (w.hidden) contentLines.push('      ' + f.dim(`… and ${w.hidden} more`));

  if (layout.degrade(cols, contentLines.length + 2)) {
    return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
  }
  return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
}
```

Add `renderStackedSection` to `module.exports`:

```javascript
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, computeWindow, sectionJumpTargets, buildSections,
  QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor, metricsColumnLines, renderStackedSection,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Add renderStackedSection: grid mode's natural-height per-section box renderer"
```

---

### Task 7: `visibleWindowGrid`

**Files:**
- Modify: `lib/ui/screens/fleet.js` (new function)
- Test: `test/fleet.test.js`

**Interfaces:**
- Consumes: `computeWindow` (Task 5), `buildSections`, `buildHeadTail`, `layout.selectionWindow`.
- Produces: `visibleWindowGrid(runs, opts)` — same public shape as `visibleWindow(runs, opts)` PLUS one extra field: `{ sections, firstVisibleIndex, lastVisibleIndex, maxScrollOffset, columnAreaHeight }` (one `sections` entry per `buildSections()` section, same order), computed under grid-mode's layout rules: NEEDS YOU shows in full (unchanged from `pinned` behavior), FAILED shows a static top-`cap` window (never scroll-adjusted, never trimmed), RUNNING/QUICK START/QUEUED/DONE are windowed via `computeWindow` bounded to `columnAreaHeight`, METRICS is a `{shown:0,startOffset:0,hidden:0}` placeholder (it never participates in the row-list model — its content comes from `metricsColumnLines` instead, called separately by Task 8's renderer). `columnAreaHeight` (the two-column area's actual height budget, already net of the header/footer/banners and the "-1 for the trailing newline" convention) is exposed specifically so Task 8's renderer sizes METRICS' box against the exact value that decided column 1's own trim, rather than recomputing it a second, potentially-drifting way. Task 8 calls this from both `renderFleet`'s grid branch and `watch.js`'s two scroll-related call sites.

- [ ] **Step 1: Write the failing tests**

Add to `test/fleet.test.js`:

```javascript
const { visibleWindowGrid } = require('../lib/ui/screens/fleet');

test('visibleWindowGrid shows NEEDS YOU in full, exactly like visibleWindow\'s pinned treatment', () => {
  const runs = Array.from({ length: 5 }, (_, i) => run({ ticket: `HEL-${i}`, status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }));
  const win = visibleWindowGrid(runs, { rows: 15, selected: 0, cols: 150 });
  const idx = buildSections({ needsYou: runs, active: [], failed: [], done: [] }, null, {}).findIndex((s) => s.kind === 'needs-you');
  assert.equal(win.sections[idx].shown, 5);
});

test('visibleWindowGrid caps FAILED at MAX_FINISHED and never scroll-adjusts it', () => {
  const runs = manyFinished(12, 'failed');
  const win1 = visibleWindowGrid(runs, { rows: 30, selected: 0, scrollOffset: 0, cols: 150 });
  const win2 = visibleWindowGrid(runs, { rows: 30, selected: 0, scrollOffset: 10, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: runs, done: [] }, null, {}).findIndex((s) => s.kind === 'failed');
  assert.equal(win1.sections[idx].shown, 5);
  assert.equal(win1.sections[idx].startOffset, 0);
  assert.deepEqual(win1.sections[idx], win2.sections[idx], 'scrollOffset must not change FAILED\'s window in grid mode');
});

test('visibleWindowGrid windows DONE against the column area\'s own height, not the full terminal', () => {
  const runs = manyFinished(20, 'done');
  const winShort = visibleWindowGrid(runs, { rows: 12, selected: 0, scrollOffset: 0, cols: 150 });
  const winTall = visibleWindowGrid(runs, { rows: 40, selected: 0, scrollOffset: 0, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {}).findIndex((s) => s.kind === 'done');
  assert.ok(winTall.sections[idx].shown >= winShort.sections[idx].shown);
});

test('visibleWindowGrid\'s maxScrollOffset reflects only RUNNING/QUICK START/QUEUED/DONE, not FAILED', () => {
  // DONE has 12 items capped at MAX_FINISHED=5, so up to 7 can be scrolled
  // through; FAILED must not add to this even though it also has surplus.
  const done = manyFinished(12, 'done');
  const failed = manyFinished(12, 'failed');
  const runs = failed.concat(done);
  const win = visibleWindowGrid(runs, { rows: 0, selected: 0, scrollOffset: 0, cols: 150 });
  assert.equal(win.maxScrollOffset, 7);
});

test('visibleWindowGrid with rows:0 returns an unbounded (untrimmed) window, matching visibleWindow\'s own structural-query contract', () => {
  const runs = manyFinished(20, 'done');
  const win = visibleWindowGrid(runs, { rows: 0, selected: 0, scrollOffset: 0, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {}).findIndex((s) => s.kind === 'done');
  assert.equal(win.sections[idx].shown, 5, 'DONE still caps at MAX_FINISHED even untrimmed — cap and height-budget trim are different things');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `visibleWindowGrid` is not exported / not defined.

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, add right after `visibleWindow`:

```javascript
// The grid-mode counterpart to visibleWindow (fleet-metrics-grid design):
// NEEDS YOU and FAILED render as full-width banners above a two-column
// area (column 1: RUNNING/QUICK START/QUEUED/DONE stacked at a fixed
// width; column 2: METRICS filling the rest), so height/scroll accounting
// can no longer be one flat sequential sum the way visibleWindow's is —
// METRICS renders BESIDE column 1, not below it, and FAILED (now a
// banner, not part of column 1's own scrollable stack) is capped but
// never scrolled or trimmed, the same "always shows, never adjusts"
// treatment NEEDS YOU already gets. Same public shape as visibleWindow —
// one entry per buildSections() section, same order — so callers
// (renderFleet's grid branch, watch.js's scroll logic) can use either
// function interchangeably depending on `opts.cols`.
function visibleWindowGrid(runs, opts) {
  const totalRows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const queueState = (opts && opts.queueState) || null;

  const buckets = bucketRuns(runs);
  const allSections = buildSections(buckets, queueState, opts);

  const needsYouSection = allSections.find((s) => s.kind === 'needs-you');
  const failedSection = allSections.find((s) => s.kind === 'failed');
  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');

  const needsYouShown = needsYouSection ? needsYouSection.group.length : 0;
  const failedWindow = failedSection
    ? layout.selectionWindow(failedSection.group.length, 0, failedSection.cap, 0)
    : { start: 0, count: 0 };
  const failedShown = failedWindow.count;
  const failedHidden = failedSection ? failedSection.group.length - failedShown : 0;

  const sectionHeightNatural = (s, shown, groupLen) => {
    if (!groupLen) return s.forceRender ? (s.emptyLines || [s.emptyHint]).length + 2 : 0;
    if (shown === 0) return 1;
    return 2 + s.linesPerRow * shown + (groupLen > shown ? 1 : 0);
  };
  const needsYouHeight = needsYouSection ? sectionHeightNatural(needsYouSection, needsYouShown, needsYouSection.group.length) : 0;
  const failedHeight = failedSection ? sectionHeightNatural(failedSection, failedShown, failedSection.group.length) : 0;

  const { head, tail } = buildHeadTail(runs, opts);
  // The "-1" mirrors computeWindow's own `budget = rows > 0 ? rows - 1 : 0`
  // — one row reserved for the trailing newline the writer appends,
  // applied ONCE where raw terminal rows become a usable budget. Applied
  // here (not inside computeWindow's own call below, which already gets a
  // pre-netted `columnAreaHeight` and must not reserve a second row on
  // top of it) so the whole page's height accounting has exactly one
  // place that does this subtraction, matching every other budget
  // computation in this file.
  const pageBudget = totalRows > 0 ? totalRows - 1 : 0;
  const columnAreaHeight = Math.max(0, pageBudget - head.length - tail.length - needsYouHeight - failedHeight);

  const columnWindow = computeWindow(runs, columnSections, {
    rows: columnAreaHeight > 0 ? columnAreaHeight + 1 : 0,
    selected, scrollOffset, includeHeadTail: false,
  });

  let columnCursor = 0;
  const sections = allSections.map((s) => {
    if (s.kind === 'needs-you') return { shown: needsYouShown, startOffset: 0, hidden: 0 };
    if (s.kind === 'failed') return { shown: failedShown, startOffset: failedWindow.start, hidden: failedHidden };
    if (s.kind === 'metrics') return { shown: 0, startOffset: 0, hidden: 0 };
    const w = columnWindow.sections[columnCursor];
    columnCursor++;
    return w;
  });

  return {
    sections,
    firstVisibleIndex: columnWindow.firstVisibleIndex,
    lastVisibleIndex: columnWindow.lastVisibleIndex,
    maxScrollOffset: columnWindow.maxScrollOffset,
    // Exposed so renderFleetGrid (Task 8) sizes METRICS' box against the
    // EXACT SAME value that decided column 1's own trim — never a second,
    // independently-recomputed columnAreaHeight that could drift by even
    // one row and reintroduce the scroll-by-one bug the "-1" above exists
    // to prevent.
    columnAreaHeight,
  };
}
```

Add `visibleWindowGrid` to `module.exports`:

```javascript
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, visibleWindowGrid, computeWindow,
  sectionJumpTargets, buildSections, QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor,
  metricsColumnLines, renderStackedSection,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js test/fleet.test.js
git commit -m "Add visibleWindowGrid: grid-mode scroll/trim accounting"
```

---

### Task 8: `renderFleet`'s two-column branch, wired into `watch.js`

**Files:**
- Modify: `lib/ui/screens/fleet.js` (`renderFleet`, new `renderFleetGrid`, new `GRID_MIN_COLS`/`COLUMN_ONE_WIDTH` constants)
- Modify: `lib/ui/watch.js:866`, `lib/ui/watch.js:1280-1291` (`scrollToShow`)
- Test: `test/fleet.test.js`, `test/watch.test.js` (if a suitable integration test point exists there — otherwise cover the watch.js change indirectly via `fleet.test.js`'s `visibleWindowGrid` tests, already sufficient for its logic; this task's `watch.js` edit only wires up WHICH function gets called, not new logic)

**Interfaces:**
- Consumes: `metricsColumnLines` (Task 4), `computeWindow`/`visibleWindowGrid` (Tasks 5, 7), `renderStackedSection` (Task 6), `layout.hsplit`.
- Produces: `renderFleet(runs, opts)` at `opts.cols >= GRID_MIN_COLS` renders the two-column layout instead of the single-column stack. `GRID_MIN_COLS`/`COLUMN_ONE_WIDTH` exported for `watch.js` to share the exact same threshold.

- [ ] **Step 1: Write the failing tests**

Add to `test/fleet.test.js`:

```javascript
test('renderFleet stays single-column below GRID_MIN_COLS, byte-identical to before this task', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 109, rows: 30, selected: 0, now: 100000 }));
  assert.doesNotMatch(out, /METRICS.*RUNNING/s, 'single-column mode never places a later section\'s text before an earlier one on the same line');
  const lines = out.split('\n');
  assert.ok(lines.some((l) => l.trim().startsWith('┌') && l.includes('RUNNING')));
});

test('renderFleet: cols one below GRID_MIN_COLS stays single-column, cols at GRID_MIN_COLS switches to grid', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const { GRID_MIN_COLS } = require('../lib/ui/screens/fleet');
  const belowLines = plain(renderFleet(runs, { cols: GRID_MIN_COLS - 1, rows: 30, selected: 0, now: 100000 })).split('\n');
  const atLines = plain(renderFleet(runs, { cols: GRID_MIN_COLS, rows: 30, selected: 0, now: 100000 })).split('\n');
  assert.notEqual(
    belowLines.findIndex((l) => l.includes('RUNNING')),
    belowLines.findIndex((l) => l.includes('METRICS')),
    'below GRID_MIN_COLS, RUNNING and METRICS must be on DIFFERENT lines (single-column stack)',
  );
  assert.equal(
    atLines.findIndex((l) => l.includes('RUNNING')),
    atLines.findIndex((l) => l.includes('METRICS')),
    'at GRID_MIN_COLS, RUNNING and METRICS must be on the SAME line (side by side)',
  );
});

test('renderFleet switches to the two-column grid at GRID_MIN_COLS', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const runningLine = lines.find((l) => l.includes('RUNNING'));
  const metricsLine = lines.find((l) => l.includes('METRICS'));
  assert.ok(runningLine, 'RUNNING must render');
  assert.ok(metricsLine, 'METRICS must render');
  assert.equal(lines.indexOf(runningLine), lines.indexOf(metricsLine), 'RUNNING and METRICS render on the SAME line — side by side, not stacked');
});

test('grid mode: METRICS column fills the full column-area height regardless of column 1\'s actual content height', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })]; // column 1 has almost nothing to show
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const metricsBorderLines = lines.filter((l) => l.includes('│') || l.includes('┃'));
  // METRICS' own box border should extend well past where column 1's tiny
  // RUNNING box ends — i.e. there exist rows where the METRICS-side border
  // character is present but column 1's content area is just blank padding.
  assert.ok(metricsBorderLines.length > 6, 'METRICS should render a tall box, not a short one, on a 30-row terminal with almost no column-1 content');
});

test('grid mode: NEEDS YOU and FAILED render as full-width banners above the two columns', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
  ];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const needsYouIdx = lines.findIndex((l) => l.includes('NEEDS YOU'));
  const failedIdx = lines.findIndex((l) => l.includes('FAILED'));
  const runningIdx = lines.findIndex((l) => l.includes('RUNNING'));
  assert.ok(needsYouIdx >= 0 && failedIdx >= 0 && runningIdx >= 0);
  assert.ok(needsYouIdx < failedIdx, 'NEEDS YOU banner comes first');
  assert.ok(failedIdx < runningIdx, 'FAILED banner comes before the two-column area starts');
});

test('grid mode: digit-jump numbers still match sectionJumpTargets\' numbering (no drift introduced by grid rendering)', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
    run({ ticket: 'HEL-4', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const targets = sectionJumpTargets(runs, null, false, true);
  targets.forEach((t, i) => {
    const num = i + 1;
    assert.match(out, new RegExp(`\\[${num}\\] ${t.section.title.replace(/[[\]()]/g, '\\$&')}`));
  });
});

test('grid mode: selecting a run inside DONE (rendered in column 1) still highlights the correct row', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const outSelected1 = renderFleet(runs, { cols: 150, rows: 30, selected: 1, now: 100000 });
  const outSelected0 = renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 });
  assert.notEqual(plain(outSelected1), plain(outSelected0), 'selecting a different row must change the render');
  assert.match(plain(outSelected1), /»/, 'a selection marker must render somewhere');
});

test('grid mode: the total rendered frame never exceeds the requested row budget (no scroll-by-one from a mismatched columnAreaHeight)', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  for (const rows of [15, 20, 25, 30, 40]) {
    const out = renderFleet(runs, { cols: 150, rows, selected: 0, now: 100000 });
    const lineCount = out.split('\n').length;
    assert.ok(lineCount <= rows - 1, `at rows:${rows}, rendered ${lineCount} lines — must leave the one row reserved for the trailing newline`);
  }
});

test('grid mode: METRICS renders its expanded tier when the terminal is wide enough (>= COLUMN_ONE_WIDTH + 1 + 80)', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 160, rows: 30, selected: 0, now: 100000 }));
  assert.match(out, /throughput \(30d\)/);
});

test('grid mode: METRICS stays compact when the terminal is grid-eligible but METRICS\' own column is still narrow', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 115, rows: 30, selected: 0, now: 100000 }));
  assert.match(out, /throughput \(7d\)/);
  assert.doesNotMatch(out, /throughput \(30d\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fleet.test.js`
Expected: FAIL — `renderFleet` has no width branch yet, so every `cols: 150`/`cols: 115` test above renders the single-column stack (RUNNING and METRICS on different lines, no side-by-side banners).

- [ ] **Step 3: Implement**

In `lib/ui/screens/fleet.js`, add near `BOX_BORDER_PADDING_COLS` (~line 38):

```javascript
// fleet-metrics-grid design: the two-column layout only engages at this
// width; below it, renderFleet is the single-column stack, unchanged.
// Exported so watch.js's scroll logic can use the exact same threshold —
// two implementations of "is this wide enough for grid mode" that could
// ever disagree is exactly the risk design.md's own precedent (e.g.
// buildHeadTail being the ONE head/tail-row-count implementation both the
// renderer and the height budget call) warns against.
const GRID_MIN_COLS = 110;
// Column 1's fixed width in grid mode, regardless of total terminal width
// — see the design doc's "Sizing thresholds" section for why this is a
// constant rather than a proportional split.
const COLUMN_ONE_WIDTH = 70;
```

At the top of `renderFleet` (right after `const cols = Math.max(40, (opts && opts.cols) || 80);`, before anything else), add the grid-mode dispatch. The full new `renderFleet` looks like:

```javascript
function renderFleet(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const selected = (opts && opts.selected) || 0;
  const queuedTitles = (opts && opts.queuedTitles) || null;
  const queueState = (opts && opts.queueState) || null;
  const focus = (opts && opts.focus) || 'runs';
  const queueFocus = opts && opts.queueFocus;
  const quickStartFocus = opts && opts.quickStartFocus;
  const queueLaunchInfo = (queueState && queueState.pending && queueState.pending.length)
    ? launchplan.parseLaunchCommand(queueState.launchCommand)
    : null;

  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const buckets = bucketRuns(runs);
  const metrics = metricsFor(runs, now);
  const avgDoneMs = metrics.avgMs;
  const augmentedOpts = Object.assign({}, opts, { metrics });

  if (cols >= GRID_MIN_COLS) {
    return renderFleetGrid(runs, {
      cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
      queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets,
    });
  }

  const { head, tail } = buildHeadTail(runs, opts);
  const win = visibleWindow(runs, augmentedOpts);
  const sections = buildSections(buckets, queueState, augmentedOpts);

  ... // everything from here to the end of the function is UNCHANGED
```

(Everything below the `if (cols >= GRID_MIN_COLS)` block — the `out`, `jumpNumber`, `budget`, `renderableIndices`, `lastRenderableIndex`, `sections.forEach(...)`, and final `return` — is copy-pasted verbatim from today's function; only the setup at the top gained the early-return branch, and `now`/`buckets`/`metrics`/`avgDoneMs`/`augmentedOpts` moved up above where they used to be computed, since the grid branch needs them too. Confirm nothing below still redeclares `now`/`buckets`/`metrics`/`avgDoneMs`/`augmentedOpts` — remove the old, now-duplicate declarations of those five if today's code still has them further down.)

Then add `renderFleetGrid` as a new function, right after `renderFleet`:

```javascript
// The two-column grid renderer (fleet-metrics-grid design): NEEDS YOU and
// FAILED as full-width banners, RUNNING/QUICK START/QUEUED/DONE stacked in
// a fixed-width column 1, METRICS filling a full-height column 2. Composes
// layout.hsplit over two independently-built panes rather than inventing
// new box-composition machinery.
function renderFleetGrid(runs, ctx) {
  const {
    cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
    queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets,
  } = ctx;

  const { head, tail } = buildHeadTail(runs, augmentedOpts);
  const win = visibleWindowGrid(runs, augmentedOpts);
  const allSections = buildSections(buckets, queueState, augmentedOpts);

  // sectionStartIndex per section, walking the FULL canonical order — the
  // same accumulation renderFleet's single-column loop and
  // sectionJumpTargets both already do, so `selected`'s meaning never
  // disagrees between single-column and grid mode.
  let flatIndex = 0;
  const sectionStartIndices = allSections.map((s) => {
    const start = s.unselectable ? null : flatIndex;
    if (!s.unselectable) flatIndex += s.group.length;
    return start;
  });

  const rowCtx = { avgDoneMs, selected, queuedTitles, queueFocus, quickStartFocus, focus, queueLaunchInfo };
  let jumpNumber = 0;
  const out = head.slice();

  allSections.forEach((s, i) => {
    if (s.kind !== 'needs-you' && s.kind !== 'failed') return;
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols, sectionStartIndex: sectionStartIndices[i] }))) out.push(line);
  });

  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');
  const metricsSection = allSections.find((s) => s.kind === 'metrics');

  // Read directly off `win` — NEVER recompute this independently. It must
  // be the exact value visibleWindowGrid used to decide column 1's own
  // trim, or METRICS' box height and column 1's actual rendered height can
  // drift by a row and reintroduce the scroll-by-one bug the codebase's
  // "-1 for the trailing newline" convention exists to prevent.
  const columnAreaHeight = win.columnAreaHeight;

  const col1Lines = [];
  columnSections.forEach((s) => {
    const i = allSections.indexOf(s);
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols: COLUMN_ONE_WIDTH, sectionStartIndex: sectionStartIndices[i] }))) col1Lines.push(line);
  });

  const metricsWidth = Math.max(40, cols - COLUMN_ONE_WIDTH - 1);
  let metricsLines = [];
  if (metricsSection) {
    jumpNumber += 1;
    const metricsInner = Math.max(0, metricsWidth - BOX_BORDER_PADDING_COLS);
    const metricsContentRows = Math.max(0, columnAreaHeight - 2);
    const content = metricsColumnLines(metrics, { cols: metricsInner, contentRows: metricsContentRows });
    const metricsColour = f.STATUS_COLOUR.metrics || ((x) => x);
    const numberedTitle = `[${jumpNumber}] ${metricsSection.title}`;
    metricsLines = layout.degrade(metricsWidth, columnAreaHeight)
      ? ['  ' + metricsColour(numberedTitle), ...content]
      : layout.box(content, { width: metricsWidth, height: columnAreaHeight, title: metricsColour(numberedTitle), focused: false });
  }

  for (const line of layout.hsplit([
    { lines: col1Lines, width: COLUMN_ONE_WIDTH },
    { lines: metricsLines, width: metricsWidth },
  ])) out.push(line);

  for (const line of tail) out.push(line);
  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}
```

Add `GRID_MIN_COLS`/`COLUMN_ONE_WIDTH` to `module.exports`:

```javascript
module.exports = {
  renderFleet, phaseFraction, handleKey, render, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, visibleWindowGrid, computeWindow,
  sectionJumpTargets, buildSections, QUICK_START_COUNT, QUICK_START_TOGGLE_KEY, metricsFor,
  metricsColumnLines, renderStackedSection, GRID_MIN_COLS, COLUMN_ONE_WIDTH,
};
```

Now wire `watch.js`'s two `visibleWindow` call sites to switch to `visibleWindowGrid` at the same threshold. In `lib/ui/watch.js`, at line 866:

```javascript
    scrollOffset = Math.max(0, Math.min(scrollOffset,
      fleetScreen.visibleWindow(runs, { rows: 0, selected, scrollOffset, queueState }).maxScrollOffset));
```

Replace with:

```javascript
    // fleet-metrics-grid design: mirrors renderFleet's own cols >=
    // GRID_MIN_COLS branch exactly (same shared constant) — this clamp
    // must use the same windowing function the renderer will actually use
    // this frame, or a scrollOffset valid in one mode could be invalid in
    // the other.
    {
      const gridCols = process.stdout.columns || 80;
      const winFn = gridCols >= fleetScreen.GRID_MIN_COLS ? fleetScreen.visibleWindowGrid : fleetScreen.visibleWindow;
      scrollOffset = Math.max(0, Math.min(scrollOffset,
        winFn(runs, { rows: 0, selected, scrollOffset, queueState, cols: gridCols }).maxScrollOffset));
    }
```

And at `scrollToShow` (lines 1280-1291):

```javascript
    function scrollToShow(targetSelected) {
      const win = fleetScreen.visibleWindow(runs, {
        cols: process.stdout.columns || 80,
        rows: computeScreenRows(),
        selected: targetSelected, scrollOffset, prompt, queueNotice, restoreNotice, queueState, quitConfirm,
      });
      if (targetSelected < win.firstVisibleIndex) {
        scrollOffset = Math.max(0, scrollOffset - (win.firstVisibleIndex - targetSelected));
      } else if (targetSelected > win.lastVisibleIndex) {
        scrollOffset = Math.min(win.maxScrollOffset, scrollOffset + (targetSelected - win.lastVisibleIndex));
      }
    }
```

Replace with:

```javascript
    function scrollToShow(targetSelected) {
      const gridCols = process.stdout.columns || 80;
      const opts = {
        cols: gridCols,
        rows: computeScreenRows(),
        selected: targetSelected, scrollOffset, prompt, queueNotice, restoreNotice, queueState, quitConfirm,
      };
      const win = gridCols >= fleetScreen.GRID_MIN_COLS
        ? fleetScreen.visibleWindowGrid(runs, opts)
        : fleetScreen.visibleWindow(runs, opts);
      if (targetSelected < win.firstVisibleIndex) {
        scrollOffset = Math.max(0, scrollOffset - (win.firstVisibleIndex - targetSelected));
      } else if (targetSelected > win.lastVisibleIndex) {
        scrollOffset = Math.min(win.maxScrollOffset, scrollOffset + (targetSelected - win.lastVisibleIndex));
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`

Expected: PASS — every new test in this task, every pre-existing `renderFleet`/`visibleWindow` test (all use `cols` well under 110 via the file's `OPTS = { cols: 78, selected: 0 }` constant, so they never touch the new branch), and `test/watch.test.js` unchanged (the watch.js edit only changes WHICH function gets called at widths that didn't exist as a code path before this task).

If any pre-existing test fails: read the failure carefully before changing anything — a `cols` value at or above 110 in an existing fixture would now hit the new grid branch for the first time; if that's the cause, either the test's intent was width-agnostic (lower its `cols` to something under 110, e.g. `78`, matching the rest of the suite) or it genuinely needs grid-mode-aware assertions (treat it like Task 2's mechanical fixups — verify the new output is correct, then update the assertion).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/screens/fleet.js lib/ui/watch.js test/fleet.test.js
git commit -m "Add renderFleetGrid: two-column layout at GRID_MIN_COLS, wire into watch.js scroll logic"
```
