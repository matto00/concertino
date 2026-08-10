## Files modified

- `lib/ui/format.js` — added `multiRowSparkline(values, rows)`, additive
  alongside the existing unchanged `sparkline()`; exported it from
  `module.exports`.
- `lib/ui/screens/fleet/metrics.js` — added `MULTI_ROW_THROUGHPUT_ROWS` (3)
  and `MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS` (14) constants; updated
  `metricsColumnLines()`'s throughput block to render via
  `multiRowSparkline(throughputData, 3)` when `contentRows >= 14` in the
  expanded tier, inlining the `throughput (Nd)  ` prefix and
  `  avg X/day · peak Y` suffix onto the bottom chart row only and
  left-padding the other two rows for column alignment; `fixedLines`
  construction now spreads the (1- or 3-element) `throughputLines` array so
  the "recent escalations" sizing accounts for the extra lines automatically.
- `docs/dashboard.md` — documented the new multi-row throughput chart, its
  3-row fixed cap, the `contentRows >= 14` threshold, and that the
  `11 <= contentRows < 14` expanded sub-range and the compact tier are
  unaffected, under "The METRICS panel" section.
- `test/format.test.js` — added tests for `multiRowSparkline()`: equivalence
  with `sparkline()` at `rows=1`, multi-row resolution beyond what
  `sparkline()` can distinguish, zero-value/all-zero-series bottom-row
  convention, output shape (`rows` strings of `values.length`), and an empty
  `values` array.
- `test/fleet.test.js` — fixed one pre-existing test's index-based assertion
  (`lines[2]`) that the multi-row change legitimately invalidates at
  `contentRows: 20` (now finds the `throughput (30d)` label by content
  instead, since it's on the multi-row chart's bottom row rather than a
  fixed index); added new tests for the multi-row throughput block's exact
  construction (bottom-row label/stats, left-padded/aligned upper rows),
  the `contentRows >= 14` / `< 14` gating boundary, compact-tier
  non-interference regardless of `contentRows`, and the design doc's
  documented worst-case (`contentRows: 14` with both harness/model breakdown
  lines present) still leaving "recent escalations" at least 1 row.
