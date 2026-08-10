# CON-105: METRICS: break out success rate and duration by harness/model

## Description

`lib/ui/screens/fleet/metrics.js` already captures `run.harness`/`run.model` per run (set in `reducer.js`'s `run.start` handler), but METRICS' success-rate/duration numbers are fleet-wide aggregates only — there's no way to see "is Codex actually slower/less reliable than Claude Code on this fleet" from the dashboard. (Note: this is unlike `priority`, which the fleet-metrics-grid design ruled out as a METRICS cut for lack of any recorded data — harness/model needs no new instrumentation.)

## Proposed

Add a METRICS row/segment breaking out success rate and avg duration per harness (and, where present, per model) — same underlying `metricsFor()`/`buildThroughput()`-style walk over `runs`, just grouped by `run.harness`/`run.model` instead of collapsed across all of them. Render only in grid mode's expanded tier (same gating `metricsColumnLines`'s existing charts use) since it needs more vertical room than the compact 5-line tier has.

## Acceptance Criteria

* METRICS' expanded tier shows success rate and avg duration broken out by harness, and by model where more than one model has been used.
* A fleet with a single harness/model renders the same as today (no empty/degenerate breakout box for a fleet that doesn't need one).
* Documented in `docs/dashboard.md`'s METRICS section.
