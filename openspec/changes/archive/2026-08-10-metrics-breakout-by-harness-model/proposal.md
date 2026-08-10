## Why

`lib/ui/screens/fleet/metrics.js` already captures `run.harness`/`run.model` per
run (set in `reducer.js`'s `run.start` handler), but METRICS' success-rate/
duration numbers are fleet-wide aggregates only. There's no way to see "is
Codex actually slower/less reliable than Claude Code on this fleet" from the
dashboard without this per-harness/per-model breakout. No new instrumentation
is needed — the fields are already recorded.

## What Changes

- `metricsFor()` gains a `harnessBreakdown` array: one entry per distinct
  `run.harness` value seen across `runs` (terminal-state runs for success
  rate, exactly like the existing fleet-wide `successRate` computation;
  `withElapsed` runs for avg duration, exactly like the existing `avgMs`
  computation), each `{ harness, rate: { rate, done, total }, avgMs }`.
- `metricsFor()` gains a `modelBreakdown` array, grouped by `run.model`
  (singular — the same field `drilldown.js`'s `harnessText()` already reads),
  same shape as `harnessBreakdown` but keyed by `model`.
- `metricsColumnLines()` renders a new "by harness"/"by model" block in the
  expanded tier only (the same `expanded` gate its existing duration/
  escalations blocks already use) — `by harness` renders whenever
  `harnessBreakdown` has more than one entry; `by model` renders whenever
  `modelBreakdown` has more than one entry. A fleet with only one distinct
  harness (or one/no distinct model) renders neither block — identical to
  today's expanded tier.
- `docs/dashboard.md`'s METRICS section documents the new breakout block.

## Capabilities

### New Capabilities

- `fleet-metrics-harness-breakdown`: METRICS' expanded tier breaking out
  success rate and average delivery duration by `run.harness` and
  `run.model`, gated on more than one distinct value being present.

### Modified Capabilities

(none — no existing capability spec formally covers `metrics.js`'s fleet-wide
rollup or `metricsColumnLines()`'s rendering; this proposal introduces the
first capability spec for that surface, scoped only to the new breakout
behavior.)

## Impact

- `lib/ui/screens/fleet/metrics.js` — `metricsFor()`, `metricsColumnLines()`.
- `docs/dashboard.md` — METRICS section.
- No changes to `reducer.js`, `grid.js`, or the event schema — `run.harness`/
  `run.model` are already populated by the existing `run.start` handling.
