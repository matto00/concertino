## ADDED Requirements

### Requirement: `multiRowSparkline()` renders a value series across a fixed number of stacked rows
`lib/ui/format.js` SHALL export `multiRowSparkline(values, rows)`, which
SHALL return an array of exactly `rows` strings, each of length
`values.length`, ordered with index `0` as the topmost row (the last array
element as the bottommost row). Normalization SHALL follow the same
"divide by the series max" approach as the existing `sparkline()`: when the
series max is `0`, every position in every row SHALL render as if its value
were `0`. Otherwise, each value SHALL be mapped onto a combined resolution of
`rows * 8` levels (8 being `SPARK_LEVELS.length`, the existing block-ramp
size), with the bottom row (index `rows - 1`) receiving the lowest levels and
each row above it receiving progressively higher levels. A row entirely
above a given column's computed height SHALL render a blank space (`' '`) at
that column; a row entirely below it SHALL render the fully-filled glyph
(`SPARK_LEVELS[7]`, `'█'`); the row spanning the boundary SHALL render the
partial-fill glyph for its within-row level. The existing single-row
`sparkline(values)` function SHALL remain unchanged and independently
callable.

#### Scenario: Single row is equivalent to sparkline()
- **WHEN** `multiRowSparkline(values, 1)` is called for any `values` array
- **THEN** the returned single-element array's string equals
  `sparkline(values)`

#### Scenario: Multiple rows increase resolution
- **WHEN** `multiRowSparkline(values, 3)` is called with a `values` array
  whose distinct magnitudes exceed what 8 levels can distinguish
- **THEN** the returned 3 rows, read together (bottom-filled, top-partial),
  distinguish more distinct heights than a single `sparkline()` row would
  for the same data

#### Scenario: Zero value renders at the bottom row only
- **WHEN** `multiRowSparkline(values, rows)` is called with a value of `0`
  in a series with a non-zero max
- **THEN** that column's bottom row (index `rows - 1`) renders
  `SPARK_LEVELS[0]` and every row above it renders a blank space, matching
  `sparkline()`'s existing zero-value convention at the bottom row

#### Scenario: All-zero series
- **WHEN** `multiRowSparkline(values, rows)` is called with a `values` array
  whose maximum is `0`
- **THEN** every row's every column renders `SPARK_LEVELS[0]` at the bottom
  row and blank spaces above it, matching `sparkline()`'s existing
  all-zero-series output at the bottom row

### Requirement: METRICS' expanded tier renders the throughput chart across 3 rows when there is sufficient vertical room
`metricsColumnLines()` SHALL render the throughput line using
`multiRowSparkline(throughputData, 3)` in place of the single-row
`sparkline(throughputData)` when `contentRows >= 14` (in addition to the
existing expanded-tier gate, `cols >= 80 && contentRows >= 11`). When
`contentRows` is in the expanded tier but below `14` (`11 <= contentRows <
14`), the throughput line SHALL continue to render via the existing
single-row `sparkline()`, unchanged from today. The compact tier (`cols < 80
|| contentRows < 11`) SHALL be entirely unaffected by this requirement — its
throughput line SHALL continue to render via single-row `sparkline()`
exactly as before this change, regardless of `contentRows`.

#### Scenario: Expanded tier, ample vertical room
- **WHEN** METRICS renders in the expanded tier with `contentRows >= 14`
- **THEN** the throughput chart renders across 3 stacked rows via
  `multiRowSparkline`, using the same 30-day `throughput30d` data the
  expanded tier already selects

#### Scenario: Expanded tier, borderline vertical room
- **WHEN** METRICS renders in the expanded tier with `11 <= contentRows < 14`
- **THEN** the throughput chart renders as a single row via `sparkline()`,
  identical to the expanded tier's output before this change

#### Scenario: Compact tier is never affected
- **WHEN** METRICS renders in the compact tier (`cols < 80` or
  `contentRows < 11`), regardless of how much vertical room is nominally
  available
- **THEN** the throughput line renders via single-row `sparkline()`,
  identical to today's compact tier output
