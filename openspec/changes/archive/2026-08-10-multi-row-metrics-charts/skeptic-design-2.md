## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-multi-row-charts/spec.md` fresh, in full (not the
  executor's summary of the revision).
- Read `skeptic-design-1.md` (round 1's report) only to know what the single
  change request was, then independently re-verified the revision addresses
  it against the artifacts and source — not taken on faith.
- Re-read `lib/ui/screens/fleet/metrics.js` in full, in particular the
  `fixedLines` construction (`metrics.js:313`:
  `[line1, line2, line3, line4, line5, '', line7, ...breakdownLines, '']`)
  and the `remaining`/`rowsForList` bookkeeping (`metrics.js:314-330`), to
  independently re-derive the line-count arithmetic rather than trust
  design.md's re-derivation:
  - Base `fixedLines.length` with 0 breakdown lines = 8 (`line1..line5`,
    `''`, `line7`, `''`) — matches design.md.
  - With both `harnessBreakdown`/`modelBreakdown` present (2 breakdown
    lines, a normal case per `metrics.js:304-310`) = 10 today.
  - design.md Decision 3 now states explicitly: the label/stats text
    (`throughput (Nd)  ... avg X/day · peak Y`) is inlined as a prefix/suffix
    on the **bottom** row only (the multi-row array's last element, index
    `rows-1`), the other 2 rows are left-padded with
    `f.visibleLength(prefix)` spaces for column alignment and get no
    suffix, and the whole throughput block becomes **exactly 3 lines total**
    — a net **+2** vs. today's 1 line. This is now stated as the single
    resolution, not left ambiguous.
  - Re-deriving independently: `fixedLines` after the change = 10 (0
    breakdown) or **12** (2 breakdown, the worst case). At
    `contentRows = 14`: `remaining = 14 - 12 = 2`, `rowsForList = 2 - 1 = 1`
    — "recent escalations" still gets its guaranteed minimum of 1 row in the
    worst case, exactly as design.md now claims. Arithmetic checks out.
  - `tasks.md` 2.2 now states the identical construction (bottom-row
    prefix/suffix, other rows left-padded, "exactly 3 total lines... net +2
    vs. today's 1 line... do not introduce a separate 4th label line") — no
    longer contradicts design.md's premise the way round 1 found.
  - `spec.md`'s new requirement text and both scenarios (`11 <= contentRows
    < 14` stays single-row; `contentRows >= 14` goes multi-row) are
    consistent with the same threshold and both design.md and tasks.md.
- Independently confirmed the padding mechanism design.md's Decision 3 relies
  on is real: read `lib/ui/layout.js`'s `box()` (`layout.js:107-114`),
  confirmed each content line is independently `f.padTo(f.truncate(raw,
  innerWidth), innerWidth)` with no cross-line assumption — so the claim that
  "trailing whitespace needs no explicit padding" on the two non-label rows
  is accurate.
- Re-confirmed `lib/ui/format.js`'s current `sparkline()`/`SPARK_LEVELS`
  (format.js:344-353) match what design.md's Decision 1 algorithm and
  equivalence claim (`multiRowSparkline(values, 1)` ≡ `[sparkline(values)]`)
  depend on — unchanged since round 1, still accurate.
- `openspec validate multi-row-metrics-charts --strict` → `Change
  'multi-row-metrics-charts' is valid`.
- `git status` confirms the entire `openspec/changes/multi-row-metrics-charts/`
  dir is still untracked/pre-implementation — no source files have changed
  since round 1, only the planning artifacts, so re-verifying against the
  same ground-truth source files is the correct check.
- Grepped all four planning artifacts for `TODO`/`TBD`/"figure out"/"later"/
  "placeholder" — none found.

### Verdict: CONFIRM

The round 1 change request is fully resolved: design.md Decision 3 and
tasks.md 2.2 now state one identical, unambiguous construction for how the
label/stats text combines with the 3 chart rows (inlined on the bottom row
only, other two rows left-padded, net +2 not +3), and the `contentRows >= 14`
threshold's safety guarantee (at least 1 row for "recent escalations" in the
worst case of both breakdown lines present) is re-derived correctly against
this +2 premise and against the actual `fixedLines`/`remaining`/`rowsForList`
code in `metrics.js`, matching my own independent re-derivation. No new
contradictions were introduced by the revision; the rest of the design
(unchanged from round 1: the `multiRowSparkline` algorithm, the two escalated
decisions, the compact-tier no-op guarantee, the `docs/dashboard.md` plan)
remains sound.

### Non-blocking notes

- Same as round 1: naming both constants explicitly (`tasks.md` 2.1 already
  does this well — `MULTI_ROW_THROUGHPUT_ROWS` and
  `MULTI_ROW_THROUGHPUT_MIN_CONTENT_ROWS` are both named there now, closing
  round 1's non-blocking note too).
- `tasks.md` 2.2's instruction to "replace the single-row `sparkline(...)`"
  and spread 3 lines into the `fixedLines` array is a reasonable-but-implicit
  code-shape detail (today's `fixedLines` array literal at metrics.js:313
  references a `line3` variable that would need to become either an array
  spread or 3 separate variables) — not ambiguous enough to block, since
  design.md's prose fully constrains the *content* of those 3 lines, just
  flagging it as the one spot an implementer has minor discretion on
  variable shape, not on any of the arithmetic or text content.
