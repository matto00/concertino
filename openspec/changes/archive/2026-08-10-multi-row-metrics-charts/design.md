## Context

`lib/ui/format.js`'s `sparkline(values)` maps each data point onto one of 8
block-character levels (`SPARK_LEVELS = '▁▂▃▄▅▆▇█'`) and always returns a
single string — one terminal row. The METRICS panel's expanded tier
(`cols >= 80 && contentRows >= 11`, `lib/ui/screens/fleet/metrics.js`) widens
the throughput chart's time window (7d → 30d) but still renders it through
this same single-row `sparkline()`, so a tall terminal with plenty of
`columnAreaHeight` (`lib/ui/screens/fleet/grid.js`) gets more history but no
more vertical resolution than a terminal that barely qualifies for the
expanded tier.

Two decisions were escalated on the ticket and resolved directly by the
requester (2026-08-10, recorded in `.concertino/runs/CON-106/answer.json`):

1. **Rendering scheme: stacked block-character rows** (not braille sub-cell).
   Chosen for consistency with the existing `SPARK_LEVELS` aesthetic used
   throughout `format.js` (`bar()`, `sparkline()`) and to avoid braille's
   font-rendering inconsistency across terminals.
2. **Row-count policy: a fixed cap**, not scaled to whatever
   `columnAreaHeight` leaves over. The chart always uses the same number of
   rows in the expanded tier, rather than growing arbitrarily tall on a very
   tall terminal.

## Goals / Non-Goals

**Goals:**
- A new multi-row, stacked block-character chart renderer in `format.js`,
  independent of and non-disruptive to the existing single-row `sparkline()`.
- The expanded METRICS tier's throughput chart uses the new renderer when
  there is room, at a fixed row cap, materially improving resolution over
  today's single 8-level row.
- Compact tier is completely unchanged — same single-row `sparkline()`.
- Documented in `docs/dashboard.md`.

**Non-Goals:**
- Braille sub-cell rendering (explicitly decided against).
- Scaling row count to leftover `columnAreaHeight` (explicitly decided
  against — fixed cap only).
- Multi-row rendering of the `duration` line (the three-bucket
  `<10m`/`10-30m`/`30m+` percentage breakdown). Unlike the throughput
  sparkline, that line has no per-time-step array to stack — it is three
  aggregate percentages joined by `layout.fitSegments`, not a value series
  hitting an 8-level cap. There is no analogous resolution ceiling for a
  multi-row treatment to relieve, so it stays single-row. (The ticket phrases
  this as "ideally," not as an acceptance criterion.)

## Decisions

### 1. `multiRowSparkline(values, rows)` in `lib/ui/format.js`

A new exported function, additive alongside `sparkline()` (which is
untouched). Returns an array of `rows` strings, each the same length as
`values`, ordered **top row first** (index `0` is the topmost row, matching
print order).

Algorithm — extends `sparkline()`'s own max-normalization to a combined
`rows * SPARK_LEVELS.length` sub-level resolution (e.g. 3 rows × 8 levels =
24 distinct heights, a 3x improvement over today's 8):

```
max = reduce(values, max, 0-floor each value)
totalLevels = rows * SPARK_LEVELS.length
for each value v:
  totalLevel = max === 0 ? 0 : round(clamp(v, 0) / max * (totalLevels - 1))
for each row band b (0 = bottom, rows-1 = top):
  bandFloor = b * SPARK_LEVELS.length
  subLevel = totalLevel - bandFloor
  subLevel < 0                        -> ' ' (this band is above the bar)
  subLevel >= SPARK_LEVELS.length - 1 -> SPARK_LEVELS[last] (fully filled)
  else                                -> SPARK_LEVELS[subLevel]
```

Bottom band (`b = 0`) never renders a blank for an in-range value — a zero
value still yields `SPARK_LEVELS[0]` there (`totalLevel = 0`, `bandFloor =
0`, `subLevel = 0`), matching `sparkline()`'s existing zero-value convention.
Only bands strictly above the bar's current height render blank space, so a
data point's "true zero" reads identically to today at the bottom row.

Calling `multiRowSparkline(values, 1)` is equivalent to `[sparkline(values)]`
— same normalization, same per-point level — though `sparkline()` itself is
left as its own independent implementation rather than reimplemented in
terms of the new function, so the compact tier's code path is untouched by
this change.

`multiRowSparkline` itself returns pure chart glyphs only — an array of
`rows` strings of length `values.length`, no label or stats text embedded.
Decision 3 below specifies exactly how the existing
`throughput (Nd) ... avg X/day · peak Y` label/stats text combines with
those 3 raw rows into `metricsColumnLines`'s line array — this is resolved
explicitly there, not left as an implementation choice, precisely because it
determines the net line-count Decision 3's own threshold depends on.

### 2. Fixed row cap: 3

Three stacked rows (24 total sub-levels) — enough to be a materially better
than today's 8-level ceiling (the acceptance criterion) without the chart
dominating the expanded tier's fixed vertical budget (`line1`-`line5`,
`duration`, 0-2 breakdown lines, blanks — see `metrics.js`) at the expense of
"recent escalations," which is the one block that already absorbs whatever
height is left over.

### 3. Gating: a taller threshold than plain "expanded", and exactly how the label/stats line combines with the 3 chart rows

**The label/stats text is inlined onto the bottom chart row — there is no
separate 4th line.** Today's single `line3` is
`throughput (Nd)  <chart glyphs>  avg X/day · peak Y` — a prefix
(`throughput (Nd)  `), the chart glyphs (one character per data point), and
a suffix (`  avg X/day · peak Y`). When the multi-row chart renders:

- `multiRowSparkline(throughputData, 3)` returns 3 raw glyph rows,
  top-row-first (index `0` = top, index `2` = bottom).
- The **bottom** row (index `2`, the array's last element) is prepended with
  the same `throughput (Nd)  ` prefix and appended with the same
  `  avg X/day · peak Y` suffix the single-row version used — i.e. the
  bottom row becomes exactly `throughput (Nd)  <bottom chart glyphs>
  avg X/day · peak Y`.
- The two rows above it (indices `0` and `1`) are left-padded with spaces
  equal to the prefix's visible length (`visibleLength('throughput (Nd)  ')`
  — using `f.visibleLength`, the same helper `metricsColumnLines` already
  uses elsewhere for alignment, so the padding is correct even if the label
  text's width varies between `7d`/`30d`) and get **no** suffix — trailing
  whitespace needs no explicit padding, since `layout.box()` already
  pads/truncates each content line independently to the box's inner width
  (confirmed: `layout.box()` truncates/pads per-line via `f.truncate`/
  `f.padTo` with no cross-line assumptions).
- This left-padding is what keeps the chart's data columns aligned
  vertically across all 3 rows — column `i`'s glyph sits directly under
  column `i`'s glyph on every row, exactly the same visual column position
  the label-bearing bottom row's chart glyphs occupy (both start
  immediately after `visibleLength(prefix)` characters).

This makes the throughput block **exactly 3 lines total** after the change
(replacing today's 1 line) — a **net +2 lines** to `fixedLines`, matching
the arithmetic the rest of this section depends on. (An earlier draft of
this design left this combination unspecified, which produced two
arithmetically different net-line-count outcomes depending on how a reader
resolved the ambiguity; this section is now the single source of truth for
it, and tasks.md 2.2 states this same construction explicitly.)

Applying a multi-row chart unconditionally at the existing expanded-tier
gate (`contentRows >= 11`) would eat directly into "recent escalations" room
on a terminal that only just barely qualifies for expanded (`contentRows`
11-13) — on the narrowest few rows of that range it can leave zero rows for
escalations, a regression for exactly the terminals already tightest on
space.

So the multi-row throughput chart uses its own, taller gate:
`contentRows >= 14` (chosen as the existing `11` gate plus the 2 net lines
the multi-row chart itself adds, plus a `+1` margin so "recent escalations"
still gets at least one row on a terminal that just clears the new
threshold). Verified against `metricsColumnLines`'s actual `fixedLines`
construction (`[line1, line2, line3, line4, line5, '', line7,
...breakdownLines, '']`, base length 8 plus 0-2 breakdown lines): the
worst case is both `harnessBreakdown`/`modelBreakdown` lines present
(`fixedLines` = 10 today, 12 after the +2 multi-row change). At
`contentRows = 14`, `remaining = 14 - 12 = 2`, `rowsForList = remaining - 1
= 1` — "recent escalations" still gets its guaranteed minimum of 1 row, even
in this worst case. Terminals in the expanded tier but below this second
threshold (`11 <= contentRows < 14`) keep the existing single-row
`sparkline()` throughput line exactly as today — this is still "the expanded
tier," just without the multi-row upgrade until there's genuinely enough
height for it not to cost something else. The compact tier is unaffected
either way (`cols < 80 || contentRows < 11`).

### 4. `docs/dashboard.md`

Add a short paragraph under "The METRICS panel" section describing: the
multi-row throughput chart, its 3-row fixed cap, the `contentRows >= 14`
threshold it additionally requires beyond ordinary expanded-tier entry, and
that compact tier and the `11 <= contentRows < 14` expanded sub-range are
unaffected.

## Risks / Trade-offs

- **[Risk]** A fixed row cap means a very tall terminal still can't use all
  its vertical room for the chart. → **Mitigation:** explicitly the decided
  trade-off (this ticket's own resolved design decision); leftover height on
  a very tall terminal still goes to "recent escalations," which is
  designed to absorb it.
- **[Risk]** Two different height thresholds for "expanded tier" vs.
  "expanded tier with multi-row chart" adds a second magic number to reason
  about. → **Mitigation:** name it as a constant
  (`MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS` or similar) next to the existing
  expanded-tier gate in `metrics.js`, with a comment cross-referencing this
  design doc, rather than an inline unexplained number.
- **[Risk]** `multiRowSparkline`'s blank-space bands (' ') interacting with
  `layout.fitSegments`/truncation elsewhere. → **Mitigation:** the multi-row
  chart's rows are placed directly into `metricsColumnLines`'s line array
  like any other fixed line (not passed through `fitSegments`, which is only
  used for segment-joining lines like `line2`/`line4`/`line5`), so this does
  not apply; confirm during implementation that no width-trimming logic
  mistakes a trailing blank band for empty content and strips it.
