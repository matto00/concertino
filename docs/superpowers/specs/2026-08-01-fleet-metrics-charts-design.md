# Fleet page METRICS section — charts and more metrics

**Status:** design approved, not yet implemented
**Date:** 2026-08-01

Expands the fleet page's METRICS section (introduced by
`docs/superpowers/specs/2026-07-30-tui-lazygit-layout-design.md` as a single
always-rendered summary line) from one line of plain counts into a five-line
box: the existing delivery/count summary, a success-rate bar, a 7-day
throughput sparkline, and two gate/verdict pass-rate breakdowns — all
computed from data the reducer already produces, no new event kinds.

This is a this-session change made directly (not via `/concertino-deliver`),
alongside a separate stray-cursor fix. Session also filed CON-53 through
CON-61 as follow-up tickets for related fleet-page work discussed at the same
time; CON-60 (harness usage-remaining indicator) and CON-61 (cost/token
tracking) were explicitly scoped OUT of this design after investigation —
see "Non-goals" below.

## Why

METRICS today (`lib/ui/screens/fleet.js:407-420`) is one dimmed line: `avg
delivery Xm · delivered today N · this week N · escalations today N`. It
answers "is the pipeline working" but not "where is it failing" or "is it
getting better or worse" — the fleet page has no trend view and no
gate/verdict reliability view anywhere, despite that data already existing
in every run's event log.

## Non-goals

- **Cost/token usage.** No event kind, run field, or evidence file captures
  per-run token/cost data anywhere in the codebase today (confirmed via a
  full grep of `lib/` and `core/`). Adding it needs new instrumentation
  (capture hook + event kind), not just a chart — filed as CON-61 instead of
  folded into this design.
- **Harness usage-remaining indicator** (5h/weekly limits, top bar). Explored
  and shelved: neither `claude` nor `codex` CLI exposes this via a cheap
  headless command, and the one live test performed (`claude -p ...
  --output-format json`) cost real money ($0.09) and still didn't return the
  field. Filed as CON-60 for later research. Also a top-bar concern, not a
  METRICS-section one.
- **Config-driven customization** (choosing which metrics show, window
  lengths). Everything here is a fixed, hardcoded layout, matching how the
  rest of the fleet page has no per-user layout config today.
- **Changing the existing single-line metrics' semantics.** `avg delivery`,
  `delivered today/this week`, and `escalations today` keep their current
  definitions and stay on their own line, unchanged.

## Architecture

### Data layer — `metricsFor(runs, now)` (`fleet.js:55-75`)

Four new fields, added to the object this function already returns:

- **`successRate: { today: {rate, done, total}, week: {...} }`** — for each
  window, `total` = runs with `status` in `{done, failed}` and `endedAt` in
  the window; `done` = the subset with `status === 'done'`; `rate =
  done/total` (`null` when `total === 0`, rendered as `n/a`).
- **`throughput: number[7]`** — daily counts of `done` runs by `endedAt` day
  bucket, oldest to newest, always exactly 7 entries (zero-filled for empty
  days) regardless of how much history exists.
- **`verdictRates: { evaluator: rate|null, skeptic: rate|null, auditor:
  rate|null }`** — computed by scanning every run's `events` for `kind ===
  'verdict'`, grouping by `ev.role`, and treating `verdict === 'PASS' |
  'CONFIRM' | 'MERGE'` (the "good" outcome per role, per
  `core/roles/{evaluator,skeptic,auditor}.md`'s documented verdict values)
  as a pass. `null` when a role has zero verdict events anywhere in history.
- **`gateRates: Record<gateName, rate>`** — for each of the 8 known gate
  names (`phase:Setup`, `phase:Planning`, `phase:Execution`,
  `phase:Evaluation`, `phase:Delivery`, `phase:Cleanup`, `server:backend`,
  `server:frontend`), the fraction of runs whose `run.gates` array (already
  deduped to the latest result per name per run, `reducer.js:116-127`)
  records `status === 'pass'` for that name, among runs that reported it at
  all. A gate name absent from every run's history is omitted from the map
  entirely (not rendered as 0%).

All four are computed over **all** of `runs` (full on-disk history, same
precedent as the existing `avgMs`), except `throughput`, which is explicitly
the trailing 7 calendar days — confirmed as the right window size in
brainstorming: always populated even for a young project, fits any
reasonable terminal width as a single-line sparkline.

### Rendering layer

Two new small helpers, colocated with `format.js`'s existing `bar()` (the
phase-progress bar already used on run rows), reusing its block-character
style rather than inventing a new one:

- **`microBar(fraction, width = 10)`** — same fill logic as `bar()`, but
  sized for an inline `label ██████░░░░ XX%` segment rather than a full-row
  progress bar. 10 chars matches the widths used in this doc's mockup below
  and reads clearly at any terminal width `fitSegments` will actually try.
- **`sparkline(values)`** — maps each of the 7 throughput values to one of
  `▁▂▃▄▅▆▇█` scaled against the max value in the array (an all-zero array
  renders as 7 `▁`, not a divide-by-zero).

One new layout helper, `fitSegments(segments, maxWidth, sep)`: given an
ordered list of pre-rendered segment strings (e.g. `"evaluator ████████░░
84%"`), joins as many as fit within `maxWidth` (using `sep`, default `" · "`)
and appends a trailing `…` if any were dropped. This is a real behavior
change from today's `f.truncate`-per-line approach — needed specifically for
the gate-rate line (up to 8 segments), which will not fit an 80-column
terminal in full. Dropping whole segments (not character-truncating) avoids
ever rendering a half-drawn bar.

### Section mechanism — generalizing forceRender/emptyHint to N lines

METRICS today reuses the same "always-rendered, unselectable, single
`emptyHint` line" mechanism QUICK START established for its own empty state
(`fleet.js:407-420`, height hardcoded to `3` — border+content+border — at
`fleet.js:693`, content hardcoded to a 1-element array at `fleet.js:878`).
This is generalized to an `emptyLines: string[]` field:

- `fleet.js:693`: `s.forceRender ? (s.emptyLines || [s.emptyHint]).length +
  2 : 0` — height grows with actual content instead of being hardcoded to 1.
- `fleet.js:878`: content becomes `(s.emptyLines || [s.emptyHint ||
  '']).map(line => f.truncate(line, innerCols))` — each line independently
  truncated (segment-aware lines use `fitSegments` internally before this
  step, so this final truncate is a no-op safety net for them).
- QUICK START's existing call site is unchanged (still passes `emptyHint`,
  a single string) — this is additive, not a breaking rename.
- METRICS's call site switches from `emptyHint` to `emptyLines: [...]`
  (5 strings, built as described below).

### The 5 METRICS lines

```
◫ METRICS ─────────────────────────────────────────────────────────────────
 avg delivery 12m · delivered today 5 · this week 22
 success  today ██████░░░░ 80% (4/5) · week ████████░░ 86% (19/22) · escalations today 3
 throughput (7d)  ▂▄▁▇▅▃▂  avg 3.4/day · peak 7
 verdicts  evaluator ████████░░ 84% · skeptic █████████░ 91% · auditor ██████████ 100%
 gates  Setup 100% · Planning 95% · Execution 88% · Evaluation 92% · Delivery 100% · Cleanup 100% · backend 100% · frontend 98%
─────────────────────────────────────────────────────────────────────────────
```

1. Unchanged from today (`avg delivery`, `delivered today/this week`).
2. New — `successRate.today`/`.week` as `microBar` segments, joined via
   `fitSegments`; `escalations today` (today's existing count, unchanged
   value) appended as a trailing plain segment, dropped first if the line
   doesn't fit.
3. New — `sparkline(throughput)` plus `avg X.X/day` (mean of the 7 values)
   and `peak N` (max of the 7 values).
4. New — `verdictRates` as three `microBar` segments via `fitSegments`.
5. New — `gateRates` as up to 8 plain `name XX%` segments (no bar — 8 bars
   would not fit any realistic terminal width) via `fitSegments`.

### Edge cases

- **No run history at all**: line 1 already degrades to `avg delivery n/a`
  (existing behavior). Lines 2-5 degrade the same way: `success  today n/a ·
  week n/a · escalations today 0`, `throughput (7d)  ▁▁▁▁▁▁▁  avg 0.0/day ·
  peak 0`, `verdicts  no data yet`, `gates  no data yet`.
- **Some roles/gates never reported** (e.g. a project that's never used
  agent-merge, so no `auditor` verdicts exist): that segment is omitted from
  its line, not rendered as `n/a` or `0%` (a role that's never run is
  different from a role that always fails).
- **Narrow terminal**: `fitSegments` drops trailing segments with `…`;
  verified down to 80 cols in tests. Box borders and line count are
  unaffected by width — only segment count within lines 2/4/5 changes.

## Testing

- `metricsFor`'s four new fields: pure function tests against synthetic
  fixture `runs`/`events` arrays in `test/fleet.test.js`, following the file's
  existing pattern for the current metrics fields — covering: normal mixed
  pass/fail history, zero-history (`n/a` degradation), a role/gate with zero
  reports (omitted, not zeroed), and the 7-day throughput bucketing crossing
  a UTC day boundary (mirroring how `deliveredToday`/`deliveredWeek` are
  already tested against day-boundary edge cases).
- `microBar`/`sparkline`/`fitSegments`: pure unit tests in
  `test/format.test.js` (or a new `test/layout.test.js` section, matching
  wherever `bar()`'s own tests live) — bar fill rounding at fraction
  boundaries, sparkline's all-zero case, `fitSegments` dropping trailing
  segments and never emitting a partially-rendered one.
- Render-level test in `test/fleet.test.js`/`test/watch.test.js`: the METRICS
  box renders exactly 5 content lines (7 total with borders) at a normal
  width, and degrades to fewer segments (not fewer lines, not crashed
  borders) at 80 cols — mirroring the lazygit-layout pass's own
  height-budget test style.

## Implementation surface

- `lib/ui/screens/fleet.js` — `metricsFor` (new fields), `buildSections`
  (emptyLines instead of emptyHint for METRICS), `visibleWindow`/render
  height and content logic (generalized to N lines).
- `lib/ui/format.js` — `microBar`, `sparkline` helpers alongside `bar()`.
- `lib/ui/layout.js` (or `format.js`, wherever fits existing conventions
  best) — `fitSegments` helper.
- `test/fleet.test.js` — new fixtures/assertions for the above.

## Build order

1. `metricsFor`'s four new fields + their unit tests (pure data layer, no
   rendering yet).
2. `microBar`/`sparkline`/`fitSegments` helpers + their unit tests.
3. `emptyLines` generalization in `fleet.js`'s height/content logic (QUICK
   START's existing single-line case must keep passing unchanged).
4. Wire the 5 METRICS lines together, switch METRICS's `buildSections` entry
   to `emptyLines`.
5. Render-level tests (full width + narrow-width segment-dropping).
