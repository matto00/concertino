# Fleet page — two-column grid layout with an expanded METRICS panel

**Status:** proposed
**Date:** 2026-08-01

Restructures the fleet page from a single vertical stack of sections into a
two-column grid on wide terminals: NEEDS YOU and FAILED stay full-width
banners at the top, RUNNING/QUICK START/QUEUED/DONE stack in a fixed-width
left column, and METRICS becomes a full-height right column that grows its
own content (wider trend window, a new duration-distribution line, a
recent-escalations list) to actually use the vertical space a tall terminal
leaves empty today.

Follow-up to `docs/superpowers/specs/2026-08-01-fleet-metrics-charts-design.md`
(implemented and merged this same session), which gave METRICS its first
charts but kept it a fixed 5-line box — on a terminal taller than ~20 rows,
that box now looks tiny relative to all the blank space below it.

## Why

The METRICS box today (`lib/ui/screens/fleet.js:575-585`) is
`forceRender: true` with a hardcoded 5-line `emptyLines` array, sized for
the narrowest terminal the layout has to survive, not the terminal the user
actually runs (see attached screenshot: a ~50-row terminal with the entire
bottom half empty below a 7-row METRICS box). The rest of the page has the
same problem in miniature — everything is one vertical stack, so width
beyond what run rows need is never used either.

## Non-goals

- **Per-priority success rate.** Ticket priority is never recorded in the
  run/event log (`lib/ui/reducer.js`'s `run` object has no `priority`
  field) — it only exists in the ephemeral QUICK START ticket cache
  (`lib/ui/linear.js:325`), which drops a ticket once it's delivered. A
  historical DONE run generally can't be joined back to a priority.
  Confirmed via code research before this design was written. Needs new
  instrumentation (capture priority into `run.start`, going forward only) —
  filed as a follow-up ticket, same non-goal pattern as CON-60/CON-61 in
  the previous METRICS design.
- **Per-user layout configuration** (column widths, which sections go
  where). Fixed thresholds and widths, same precedent as the previous
  METRICS design's non-goals.
- **Changing column 1's section content or behavior.** RUNNING, QUICK
  START, QUEUED, and DONE keep their existing row rendering, caps, and
  height-budget trim logic — only the width and available height they're
  laid out against change.

## Architecture

### Layout shape

```
┌─ NEEDS YOU (full width, only when non-empty) ───────────────────────────┐
└───────────────────────────────────────────────────────────────────────┘
┌─ FAILED (full width, only when non-empty) ──────────────────────────────┐
└───────────────────────────────────────────────────────────────────────┘
┌─ RUNNING ────────────┐ ┌─ ◫ METRICS ──────────────────────────────────┐
│                       │ │                                              │
└───────────────────────┘ │  avg delivery · delivered · escalations     │
┌─ ▸ QUICK START ──────┐ │  success  today ██████░ 80% · week ████░ 86%│
│                       │ │  throughput (30d)  ▁▂▃▅▆▇█▇▆▅▃▂▁...         │
└───────────────────────┘ │  verdicts  evaluator 92% · skeptic 61% ...  │
┌─ ≡ QUEUED ───────────┐ │  gates  setup 100% · delivery 92% ...        │
│                       │ │                                              │
└───────────────────────┘ │  duration  <10m 45% · 10-30m 35% · 30m+ 20% │
┌─ DONE ───────────────┐ │                                              │
│  ...                  │ │  recent escalations                         │
│                       │ │  14:02  CON-53  orchestrator  "add zod?"    │
└───────────────────────┘ │  ...as many as fit...                       │
                           └──────────────────────────────────────────────┘
```

NEEDS YOU and FAILED are unchanged full-width sections, just adjacent at
the top (today FAILED sits between QUEUED and DONE in the stack) — both are
"needs a human's attention" content, so grouping them together reads
better than interleaving one of them into the two-column area below.

### Sizing thresholds

- **Two-column mode requires the terminal to be ≥ 110 columns wide.** Below
  that, the page renders exactly as it does today: one vertical stack, in
  section order NEEDS YOU → RUNNING → QUICK START → QUEUED → FAILED → DONE
  → METRICS (compact 5-line box) — the existing, already-tested code path,
  completely unchanged.
- **Column 1 is a fixed 70 columns wide** in two-column mode, regardless of
  total terminal width — the same width run rows already render
  comfortably narrower than today's typical 80+ column terminal, so ticket
  IDs/titles/status lines don't truncate any harder than they already
  tolerate. Column 2 (METRICS) gets everything else: `totalCols - 70 - 1`
  (the `1` is `hsplit`'s inter-column gap) — at the 110-column engagement
  threshold that's only 39 columns, well short of what METRICS' expanded
  content needs, so METRICS itself falls back to its compact 5-line
  rendering until its own column is wide enough (see "Rendering layer"
  below for the exact gate).
- **METRICS' box height is always the full column-area height** — the
  terminal's available rows after the header, NEEDS YOU/FAILED banners, and
  footer, minus 2 for METRICS' own border. Column 1's boxes stack up to
  whatever height their content needs (same trim-loop logic as today,
  now bounded by the column-area height instead of the whole terminal);
  if column 1 finishes shorter than that, the leftover space in column 1's
  band is blank — METRICS keeps rendering real content down to the bottom
  regardless.

### Composition — reusing `layout.hsplit`

`lib/ui/layout.js`'s `hsplit(panes)` (`layout.js:131-144`) already does
exactly this: takes pre-rendered `{ lines, width }` panes and merges them
side by side, padding whichever pane is shorter with blank lines of its own
width. It's already in production use for drilldown.js's GATES/EVIDENCE
columns, so this design adds a new *caller*, not new rendering machinery.

`renderFleet` gains a width-based branch:
- `< 110` cols: today's single loop over `buildSections()`'s full list,
  byte-for-byte unchanged.
- `>= 110` cols: render NEEDS YOU/FAILED banners via the existing
  section-box code (unchanged); build column 1's lines by running the
  existing box-building loop over just the RUNNING/QUICK START/QUEUED/DONE
  sections at width 70, bounded to the computed column-area height; build
  column 2's lines from a new `metricsColumnLines(metrics, opts)` (below);
  call `layout.hsplit([{lines: col1Lines, width: 70}, {lines: col2Lines, width: metricsWidth}])`
  and print the result.

`visibleWindow()`'s height-budget trim loop is reused for column 1 as-is,
called with the column-area height instead of the terminal's full row
count — no new trim logic, just a different height input.

## Data layer — `metricsFor` extensions

Two additions to what `metricsFor(runs, now)` already returns
(`fleet.js:70-167`):

- **`throughput30d: number[]`** — same construction as today's
  `throughput` (`fleet.js:110-115`), generalized to a `days` parameter
  (`buildThroughput(list, todayStart, days)`) and called twice: `days: 7`
  for the existing field (compact-tier rendering keeps using this one
  unchanged) and `days: 30` for the new one (expanded-tier rendering).
  Zero-filled for days with no history, exactly like today's 7-day array —
  `sparkline()` already handles arbitrary-length arrays, so no rendering
  change is needed beyond passing the longer array.
- **`durationBuckets: { under10: n, from10to30: n, over30: n }`** — counts
  `done` runs (the same `withElapsed` list `avgMs` already computes,
  `fleet.js:73`) by `elapsedMs` range: `< 10*60000`, `10*60000` to
  `30*60000` (inclusive lower, exclusive upper), `>= 30*60000`. No existing
  bucketing helper in the codebase (confirmed by research) — this is new,
  self-contained code, following `throughput`'s "fixed-shape counts object"
  precedent.
- **`recentEscalations: Array<{ ticket, role, question, raisedAt }>`** —
  every `escalation.raised` event across all of `runs` (same "walk
  `r.events`" pattern `escalationsToday`/`verdictRates` already use,
  `fleet.js:84-88`/`129-136`), sorted by `raisedAt` descending, **not
  capped here** — the rendering layer decides how many rows it has room
  for (see below). Each entry reads `ev.ticket`, `ev.role`, `ev.question`,
  `ev.t` — all fields already confirmed present on every
  `escalation.raised` event (`lib/ui/reducer.js:137-169`,
  `core/scripts/emit-event.sh`'s `write_escalation_raised()`).

## Rendering layer — `metricsColumnLines(metrics, opts)`

New function in `fleet.js`, called only from the `>= 110`-column branch.
`opts`: `{ cols, contentRows }` — `cols` is METRICS' column width,
`contentRows` is its available content-row budget (column-area height minus
2 for the border).

**Compact tier** (`contentRows < 11` OR `cols < 80`, or single-column mode
via the existing call site): returns exactly today's 5-line `emptyLines`
array, unchanged — same code as `buildSections()`'s current `if
(o.metrics)` block, extracted as-is (not duplicated) so both call sites
share one implementation. The `cols < 80` gate matters because two-column
mode can engage (at 110 total columns) while METRICS' own column is still
narrow — at 110 total width, METRICS gets `110 - 70 - 1 = 39` columns,
nowhere near enough for line 3's 30-day sparkline (needs ~70+ just for that
one line) — so two-column *layout* and expanded METRICS *content* are
gated independently, the same "degrade gracefully instead of rendering
something half-drawn" principle `fitSegments` already applies within a
single line, applied here one level up. In practice expanded content needs
roughly 150+ total terminal columns (70 + 1 + 80); two-column layout alone
is still a win below that width purely from having two boxes side by side
instead of one long stack.

**Expanded tier** (`contentRows >= 11` AND `cols >= 80`): builds these
lines, in order:

1. Same as today: `avg delivery · delivered today/week · escalations
   today`.
2. Same as today: success-rate bars (today/week).
3. Throughput — now `sparkline(metrics.throughput30d)` (30 values instead
   of 7) plus the same `avg X.X/day · peak N` suffix, computed over the
   30-day array.
4. Same as today: verdict-rate bars.
5. Same as today: gate-rate bars.
6. Blank separator line.
7. Duration distribution: `duration  <10m XX% · 10-30m XX% · 30m+ XX%`
   (percentages of the total `done`-with-`elapsedMs` count, one
   `fitSegments` line, same style as the gates line; `no data yet` when
   that total is 0 — same degradation convention as verdicts/gates today).
8. Blank separator line.
9. `recent escalations` header line (only emitted if at least one content
   row remains after lines 1-8).
10. As many `recentEscalations` rows as fit in whatever rows remain —
    `HH:MM  TICKET  role  "question"` (question `f.truncate`d to the
    column width), most recent first. `no escalations yet` in the single
    reserved row when the list is empty. If `recentEscalations` has fewer
    entries than there's room for, the remaining rows are genuinely blank
    (there's no more real data to show) — this mirrors the previous
    design's accepted stance on empty states rather than fabricating
    content.

This means the escalations list is what actually absorbs "how much extra
vertical space is there today" — everything above it (lines 1-8) is a
fixed row count for a given terminal, so a very tall terminal with few
escalations still leaves some blank space at the bottom of METRICS, same
as column 1 can. That's accepted, not solved further (this design's goal
is "use the space when there's real content to fill it with," not
"guarantee zero blank pixels").

## Edge cases

- **Terminal resized across the 110-column threshold mid-session**: the
  width check runs every frame (same as every other width-dependent
  computation in `renderFleet` today) — no special transition handling
  needed, the next frame just renders the other mode.
- **Column 1 taller than the column-area height** (e.g. many RUNNING
  entries on a short-but-wide terminal): the existing height-budget trim
  loop already handles "more content than fits" by capping/trimming
  sections — unchanged behavior, just running against a possibly-smaller
  height input than the full terminal.
- **METRICS content taller than `contentRows` even at the compact tier**
  (extremely short terminal): can't happen in two-column mode by
  construction — the `< 110` branch only engages when width is small, and
  height-only constraints stay on the existing single-column path where
  METRICS is already `forceRender` and this exact scenario is already
  handled (documented in the previous design's edge cases).
- **Zero runs in history at all**: compact-tier degradation is unchanged
  from today. Expanded tier: lines 1-5 degrade exactly as today
  (`n/a`/`no data yet`), line 7 shows `no data yet`, line 10 shows `no
  escalations yet`.

## Testing

- `metricsFor`'s two new fields: pure function tests in `test/fleet.test.js`
  — `throughput30d`'s day-boundary bucketing (mirroring the existing 7-day
  tests), `durationBuckets`' three ranges including boundary values
  (exactly 10min, exactly 30min), `recentEscalations`' sort order and field
  extraction, following the existing fixture pattern.
- `metricsColumnLines`: render-level tests for both tiers — compact tier
  produces the exact same 5 lines as today's box (regression check against
  the previous design's own test fixtures), expanded tier at a few
  `contentRows` values verifying: fixed lines 1-8 always present, header
  line 9 only appears when there's room, escalation row count matches
  available space, `no escalations yet` when the list is empty but there's
  room for it.
- `renderFleet`/`visibleWindow`: width-threshold tests at 109 vs 110
  columns (single-column vs two-column mode), a two-column-mode render
  test asserting column 1's box tops/bottoms align with `hsplit`'s output
  and column 2 fills the full column-area height regardless of column 1's
  actual content height, plus a case at exactly 110-149 total columns
  confirming two-column layout engages while METRICS still renders its
  compact tier (the `cols < 80` gate), and one at 150+ confirming the
  expanded tier takes over.
- `layout.hsplit` itself needs no new tests — already covered by its
  existing test suite from the drilldown.js integration.

## Implementation surface

- `lib/ui/screens/fleet.js` — `metricsFor` (two new fields, generalized
  `buildThroughput` helper), new `metricsColumnLines` function (extracted
  compact tier + new expanded tier), `renderFleet`'s width-based branch,
  `visibleWindow`'s column-area-height parameterization for column 1.
- `lib/ui/layout.js` — no changes; `hsplit` is reused as-is.
- `test/fleet.test.js` — new fixtures/assertions for all of the above.

## Build order

1. `metricsFor`'s `throughput30d` and `durationBuckets` fields + their unit
   tests (pure data layer).
2. `metricsFor`'s `recentEscalations` field + its unit tests.
3. Extract today's compact-tier 5-line construction into
   `metricsColumnLines`'s compact branch (regression: identical output),
   verified against the existing METRICS render tests.
4. `metricsColumnLines`'s expanded tier (lines 1-10) + render-level tests.
5. `renderFleet`/`visibleWindow`'s two-column branch (banners, column 1 at
   width 70 bounded to column-area height, `hsplit` composition) + width-
   threshold and column-alignment tests.
