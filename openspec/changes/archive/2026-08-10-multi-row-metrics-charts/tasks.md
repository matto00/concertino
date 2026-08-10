## 1. `multiRowSparkline()` renderer

- [x] 1.1 In `lib/ui/format.js`, add `multiRowSparkline(values, rows)`
      alongside the existing `sparkline()` (unchanged), per design.md's
      algorithm — combined `rows * SPARK_LEVELS.length` sub-level
      resolution, top-row-first array, blank space for bands above the
      bar, `SPARK_LEVELS[7]` for bands fully below it.
- [x] 1.2 Export `multiRowSparkline` from `lib/ui/format.js`'s
      `module.exports`.

## 2. METRICS expanded-tier integration

- [x] 2.1 In `lib/ui/screens/fleet/metrics.js`, add two named constants, each
      with a comment cross-referencing design.md Decisions 2/3:
      `MULTI_ROW_THROUGHPUT_ROWS = 3` (the fixed row cap) and
      `MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS = 14` (the gate threshold).
- [x] 2.2 Update `metricsColumnLines()`'s `line3` construction: when
      `contentRows >= MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS`, replace the
      single-row `sparkline(throughputData)` with
      `multiRowSparkline(throughputData, MULTI_ROW_THROUGHPUT_ROWS)`, per
      design.md Decision 3's exact construction: prepend the existing
      `throughput (Nd)  ` prefix and append the existing
      `  avg X/day · peak Y` suffix to the **bottom** row only (the
      returned array's last element); left-pad the other rows with
      `f.visibleLength(prefix)` spaces so chart columns stay aligned across
      all 3 rows. This produces exactly 3 total lines for the block (a net
      +2 vs. today's 1 line) — do not introduce a separate 4th label line.
      Keep the existing `throughputWindowLabel`/`throughputAvg`/
      `throughputPeak` computation unchanged — this only changes how the
      chart itself renders.
- [x] 2.3 When `contentRows` is in the expanded tier but below the new
      threshold, or the tier is compact, confirm `line3` is unchanged from
      today's single-row `sparkline()` output (no behavior change on those
      paths).
- [x] 2.4 Adjust `metricsColumnLines()`'s `fixedLines`/`remaining` bookkeeping
      (used to size "recent escalations") to account for the multi-row
      chart's extra lines when it renders.

## 3. Verification

- [x] 3.1 Run existing tests for `format.js`/`metrics.js` and add new ones
      covering `multiRowSparkline()` (equivalence with `sparkline()` at
      `rows=1`, multi-row resolution, zero-value/all-zero-series behavior)
      and the new expanded-tier gating (both sides of `contentRows >= 14`,
      and the compact tier).
- [x] 3.2 Manually verify rendering in a tall terminal (or via test harness
      simulating `contentRows >= 14`) that the throughput chart visibly
      spans 3 rows and "recent escalations" still renders sensibly.

## 4. Documentation

- [x] 4.1 Update `docs/dashboard.md`'s "The METRICS panel" section to
      describe the multi-row throughput chart, its 3-row fixed cap, and the
      `contentRows >= 14` threshold, per design.md's Decision 4.
