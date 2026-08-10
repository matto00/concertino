# CON-106: Taller, multi-row METRICS charts (past the 8-level sparkline cap)

## Description

`format.js`'s `sparkline()` maps each data point to one of 8 block-character
levels (`▁▂▃▄▅▆▇█`) but always renders exactly **one terminal row**, capping
the throughput chart's vertical resolution at 8 levels regardless of how much
vertical space grid mode's right column (`columnAreaHeight`, see the
fleet-metrics-grid design's "wider trend window" goal) actually has on a tall
terminal.

## Proposed

A multi-row chart renderer usable by `metricsColumnLines`'s expanded tier —
e.g. N stacked block-character rows, or a braille 2x4 sub-cell scheme for
finer resolution — that the throughput chart (and any future chart) can opt
into once grid mode gives it the height. Compact tier keeps today's
single-row `sparkline()` unchanged.

## Design decisions to escalate

* Stacked-block-rows vs. braille sub-cell rendering — braille gives ~4x the
  resolution per character cell but reads less cleanly on some terminal
  fonts; stacked blocks are simpler and match the existing `SPARK_LEVELS`
  aesthetic. Worth a quick side-by-side before committing.
* How many rows to grow into — a fixed cap, or scaled to whatever
  `columnAreaHeight` leaves over after the fixed-line content (success rate,
  verdicts, gates, duration distribution, recent escalations)?

## Acceptance criteria

* The throughput chart (and ideally the duration-distribution line) renders
  across multiple terminal rows when grid mode's expanded tier has the
  vertical room, materially improving resolution over the current 8-level
  single row.
* Compact tier (narrow/short terminals) is unaffected — same single-row
  `sparkline()` as today.
* Documented in `docs/dashboard.md`.
