## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-metrics-multi-row-charts/spec.md` in full.
- Read the actual current implementation the change targets:
  `lib/ui/format.js` (confirmed `SPARK_LEVELS = '▁▂▃▄▅▆▇█'`, `sparkline()`'s
  `Math.round((v/max)*(SPARK_LEVELS.length-1))` normalization at
  format.js:344-353), `lib/ui/screens/fleet/metrics.js` (confirmed
  `expanded = cols >= 80 && contentRows >= 11` at metrics.js:208, the
  single-string `line3` construction at metrics.js:243-247, and the
  `fixedLines`/`remaining`/`rowsForList` bookkeeping at metrics.js:313-330),
  and `lib/ui/screens/fleet/grid.js` (confirmed `metricsContentRows =
  columnAreaHeight - 2` at grid.js:365, matching the ticket's
  `columnAreaHeight` reference).
- Confirmed the two escalated design decisions the design doc cites as
  "resolved directly by the requester" are real:
  `.concertino/runs/CON-106/answer.json` contains
  `{"subAnswers":["stacked-blocks","fixed-cap"], ...}`, matching design.md's
  Context section verbatim.
- Confirmed `openspec validate multi-row-metrics-charts --strict` passes
  (`Change 'multi-row-metrics-charts' is valid`).
- Confirmed test infrastructure exists to satisfy task 3.1 (`test/format.test.js`
  covers `format.js`, `test/fleet.test.js` covers `metricsColumnLines`).
- Confirmed `layout.box()` (layout.js:73-118) truncates/pads each content
  line independently via `f.truncate`/`f.padTo` with no trimming of
  leading/trailing blank characters — validates design.md's Risk #3
  mitigation (blank chart bands surviving into the rendered box) is
  accurate.
- Manually traced the `multiRowSparkline` pseudocode in design.md
  (`totalLevel`/`bandFloor`/`subLevel` logic) against several concrete cases
  (rows=1 equivalence to `sparkline()`, zero value at bottom row only,
  boundary continuity across bands at e.g. `totalLevel=8`) — the algorithm
  itself is internally consistent and matches spec.md's four scenarios.
- Grepped for `TODO`/`TBD`/placeholder language across all five change
  artifacts — none found.

### Verdict: REFUTE

### Change Requests

1. **The throughput block's line-count math is internally contradictory
   between design.md and tasks.md, and the contradiction breaks the design's
   own stated safety guarantee.**

   - `design.md` Decision 3 (lines 96-114) computes the new
     `contentRows >= 14` gate from the premise that "growing the throughput
     line from 1 row to 3 rows adds **2 net lines**" to `fixedLines` — i.e.
     the whole throughput block (label + chart + stats) occupies exactly 3
     total lines after the change, same as `multiRowSparkline(_, 3)`'s
     return-array length, with no extra line for the label/stats text.
   - `tasks.md` 2.2 instead says the existing `throughput (Nd) ... avg X/day
     · peak Y` label/stats line must be "**kept as part of this block, not
     duplicated per row**" — which most naturally reads as its own
     surviving line (today it *is* its own single line — metrics.js:247),
     i.e. **3 chart rows + 1 label/stats line = 4 total lines**, a net **+3**,
     not +2.
   - `multiRowSparkline`'s own contract (spec.md's Requirement text: "an
     array of exactly `rows` strings, **each of length `values.length`**")
     confirms the function itself returns pure chart glyphs with no room to
     embed label text — so *something* outside the function has to attach
     "throughput (30d) ... avg X/day · peak Y" to the 3 raw chart rows, and
     neither doc says how: which row carries it, whether the other two rows
     get compensating blank-padding to keep chart columns aligned across all
     3 rows, or whether it becomes a genuinely separate 4th line.
   - This is not a cosmetic ambiguity — it invalidates the arithmetic the
     design leans on to justify its magic number. Re-deriving both ways
     against the actual `fixedLines` construction (metrics.js:313,
     `[line1, line2, line3, line4, line5, '', line7, ...breakdownLines,
     '']`, base length 8 with 0 breakdown lines):
     - **+2 net (design.md's assumption):** `fixedLines` = 10 (0 breakdown)
       or 12 (2 breakdown lines, `harnessBreakdown`/`modelBreakdown` both
       populated — a normal case per metrics.js:304-310). At
       `contentRows = 14`: `remaining` = 4 or 2, `rowsForList` = 3 or **1**.
       The "at least one row for escalations" guarantee design.md claims
       (line 107-108) holds, and barely — it's clearly this exact
       worst case (2 breakdown lines) the `+1` margin in `14 = 11 + 2 + 1`
       was sized for.
     - **+3 net (tasks.md's literal instruction, the more obvious
       implementation for anyone reading "kept as part of this block" as
       "give it its own line"):** `fixedLines` = 11 (0 breakdown) or 13 (2
       breakdown lines). At `contentRows = 14`: `remaining` = 3 or **1**,
       `rowsForList` = 2 or **0**. With 2 breakdown lines present, this
       reproduces *exactly* the "zero rows left for recent escalations on a
       terminal that just clears the threshold" regression design.md's
       Decision 3 exists specifically to prevent (design.md line 99-103).
   - **Required revision:** `design.md` must state explicitly, in the
     algorithm/integration section (not just implied by an arithmetic
     aside), which row of the 3-row `multiRowSparkline` output carries the
     `throughput (Nd) ... avg X/day · peak Y` text, how the other two rows
     preserve column alignment (e.g. left-padded with spaces matching the
     label's visible width) if the label is inlined into one row, or —
     if a separate label line is intended instead — the design must
     recompute Decision 3's threshold and margin against a **+3** net-line
     cost (this likely means `contentRows >= 14` is no longer sufficient
     to guarantee the escalations panel never drops to zero rows when
     both breakdown lines are present, and the threshold and/or the
     stated guarantee need to change). `tasks.md` 2.2 and 2.4 should then
     be updated to match whichever resolution is chosen, so the
     implementer isn't left to pick between two arithmetically different
     outcomes based on which of the two documents they read more
     carefully.

### Non-blocking notes

- `tasks.md` 2.1's "add a named constant... for the fixed row cap (3)" is
  fine as-is, but design.md's Risk section only *suggests* a name
  (`MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS`) for the threshold constant, not
  the row-cap constant — worth naming both explicitly when task 1 above is
  resolved, since the row-cap constant's value will need to stay in sync
  with whatever line-count math design.md ends up specifying.
- Everything else in the design — the `multiRowSparkline` algorithm itself,
  the escalated decisions (stacked blocks over braille, fixed cap over
  scaled), the compact-tier no-op guarantee, the `docs/dashboard.md` update
  plan, and the spec delta's scenarios — checks out cleanly against current
  source and is internally consistent. This is a narrowly-scoped,
  well-reasoned design apart from the one line-count contradiction above.
