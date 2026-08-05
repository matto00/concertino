## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/dashboard-shared-widgets/spec.md`, `specs/dashboard-iconography/spec.md`,
  `workflow-state.md`, and the round-1 `skeptic-design-1.md` (treated as a
  claim to re-verify, not fact).

**Round-1 Change Request 1 (ticketdraft.js / textinput.js) — confirmed resolved.**
Read `lib/ui/screens/ticketdraft.js:31-71` fresh: each field renders as a
multi-line wrapped textarea (`marker + f.bold('[' + key + '] ' + label)`
header line, N `textwrap.wrap(text, innerWidth)` body lines, and a bare
`'    ▏'` cursor line when active) — not the single-line `label + ' › ' +
value + '▏'` shape. `proposal.md`, `design.md` (lines 20-23, 36-43, 130-133),
`tasks.md` 2.6, and `specs/dashboard-shared-widgets/spec.md` line 21 now all
explicitly exclude `ticketdraft.js` as an `inputLines` consumer, consistent
with this reading. `grep`-ed every remaining `ticketdraft` mention across the
change dir (10 hits) — all are either the exclusion note or the unrelated
Decision 4 (`sectionHeader`) header-widget application (`tasks.md` 4.6), which
is a different widget/shape and not affected by this exclusion.

**Round-1 Change Request 2 (footer.js consumer scope) — confirmed resolved
for the named screens, but one new gap found (see Change Request below).**
Re-grepped `hintLines|footerRows|belowRow|belowBoxRows|reservedBelow|
tail.length|CHROME_ROWS|footerLine|DOC_CHROME` across
`escalation.js`, `ticketview.js`, `docview.js`, `drilldown.js`,
`launchplan.js`, `fleet/sections.js`, `fleet/render.js`:
  - `drilldown.js:584-608` and `launchplan.js:264-299` genuinely call
    `f.hintLines(...)` then separately reuse `.length` — legitimate targets,
    matching design.md Decision 3 and the narrowed spec requirement.
  - `escalation.js:202-211` builds `belowBoxRows` from fixed `+= 1`/`+= 2`
    increments, never calls `f.hintLines`.
  - `ticketview.js:27` (`CHROME_ROWS_BASE = 5`) and its footer
    (`f.dim('  esc back')`) are fixed constants; zero `hintLines` references.
  - `docview.js:40` (`DOC_CHROME_ROWS`) and `footerLine()` (162-177) are
    likewise fixed/hand-built, zero `hintLines` references.
  - `fleet/render.js:156,234` reads `tail.length` off the same array
    `fleet/sections.js:369` already pushes into (`for (const line of
    f.hintLines(hints, cols)) tail.push(line);`) — a single read, not a
    duplicated re-derivation.
  `design.md` (lines 26-32, 44-57), `proposal.md` (lines 29-34, 64-74),
  `tasks.md` 3.5, and `specs/dashboard-shared-widgets/spec.md` (footer
  requirement, line 37) now consistently name only `drilldown.js` and
  `launchplan.js` as `footer()` consumers and explicitly carve out
  `escalation.js`/`ticketview.js`/`docview.js`/fleet. This part of round 1's
  requested revision is correctly made.

- Checked Decision 1 (`confirm.js`) and Decision 2 (`textinput.js`) shapes
  byte-for-byte at all named call sites, fresh: `fleet/sections.js:295-322`
  (clear-queue/force-start/quit) and `drilldown.js:632-639` (kill/restart)
  match `confirmLines`'s `['  ' + warning, f.dim('  ' + confirmHint)]` shape;
  `fleet/sections.js:329-331`, `escalation.js:230-233`, `banner.js:58-60`
  match `inputLines`'s `'  ' + f.bold(label) + f.dim(' › ') + f.truncate(...) +
  '▏'` (+ `'  ' + f.red(...)` error line) shape, including the `'  '` error-line
  indent design.md now states explicitly (line ~123-124) — the round-1
  non-blocking note about the missing indent in the formula is also fixed.
- Confirmed `lib/ui/icons.js:3-9`'s header comment and actual `grep -rl
  "require(.*icons" lib/ui/` requirer list (`ticketDetail.js`,
  `controllers/drilldown.js`, `screens/fleet/sections.js`,
  `screens/drilldown.js`, `screens/launchpad.js`) match design.md's icon-gap
  framing.

### New finding (not raised in round 1)

Reading `drilldown.js:583-648` closely: `footerRows` is built by a
three-way branch (`confirm` / `evidenceFocused` / default), but the
`confirm` branch (line 586) is **not** an `f.hintLines`-based footer at
all — `footerRows = ['confirm-placeholder', 'confirm-placeholder']; // 2
rows, built inline below`. This placeholder is never iterated/pushed to
output (the `for (const line of footerRows) out.push(line);` at line 646
only runs in the `else`, non-confirm branch); its sole purpose is
`footerRows.length` in the `belowRow` height-budget sum at line 608. The
*actual* confirm-block content is built separately, later, at lines
632-639 (`out.push('  ' + f.red(...)); out.push(f.dim('  y confirm ...
cancel'));`) — exactly the two-line shape Decision 1's `confirmLines()`
governs (already confirmed byte-for-byte above), and exactly what
`tasks.md` task 1.4 assigns to `confirmLines`. So the `confirm` branch's
"2 rows" is the *confirm dialog's* row count (Decision 1's concern,
always fixed at 2 by `confirmLines`'s own contract), not a *footer's*
row count (Decision 3's concern, derived from wrapping a hints array with
`f.hintLines`).

`design.md` (lines 155-159) states: "Screens that build footer hints
conditionally (drilldown's `confirm`-vs-`evidenceFocused`-vs-default
branches) call `footer()` once per branch and read `.rows` off the result
for their height-budget math" — and `tasks.md` 3.3 directs: "Update
`lib/ui/screens/drilldown.js`'s footer-row computation (**all three
branches**: `confirm`, `evidenceFocused`, default) to read `rows` from
`footer()` instead of re-deriving `.length`." Both instruct the `confirm`
branch to go through `footer()` too. But there is no `hints` array for
the confirm branch — nothing analogous to `['1-4 jump', 'tab cycle', ...]`
exists for it — so a literal reading requires either (a) inventing a
meaningless `hints` array (e.g. re-passing the `['confirm-placeholder',
'confirm-placeholder']` strings through real `f.hintLines` wrapping,
which is not what those placeholder strings are for and could legitimately
wrap to a row count other than 2 at narrow `cols`, silently breaking the
height budget the comment at line 578 says this pre-computation exists to
protect), or (b) the executor correctly realizing on their own that this
branch doesn't fit `footer()`'s contract and diverging from the task as
written. Either way this is exactly the "a task a competent implementer
could read two ways" ambiguity this gate exists to catch, and forcing the
`confirm` branch through `footer()` (a widget scoped to `f.hintLines`-based
footers per Decision 3's own text) would be an unplanned, wrong widget
application — the `confirm` branch's row count should instead be derived
from Decision 1's `confirmLines()` contract (its output is always exactly
2 lines by construction), not Decision 3's `footer()`.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 3 (lines 155-159) and `tasks.md` task 3.3
   incorrectly fold `drilldown.js`'s `confirm` branch into the `footer()`
   widget's scope.** The `confirm` branch's `footerRows = ['confirm-
   placeholder', 'confirm-placeholder']` (`drilldown.js:586`) is not a
   footer-hint duplication — it tracks the *confirm dialog's* row count
   (always 2, by Decision 1's own `confirmLines` contract), and the real
   confirm-block content it stands in for (`drilldown.js:632-639`) is
   already assigned to `confirmLines()` by task 1.4, not to `footer()`.
   Required revision: narrow Decision 3's text and task 3.3 to the two
   branches that genuinely call `f.hintLines` (`evidenceFocused` and
   default), and separately specify that the `confirm` branch's
   pre-computed row count comes from Decision 1's `confirmLines(...)`
   output length (or a constant kept explicitly in sync with
   `confirmLines`'s fixed 2-line contract, with a comment saying so) —
   not from `footer()`. This is the same class of fix round 1 already
   applied to `escalation.js`/`ticketview.js`/`docview.js`/fleet: name the
   widget that actually governs each duplicated shape, rather than
   grouping an unrelated computation into the wrong widget's consumer list
   because it lives in the same local variable/branch structure.

### Non-blocking notes

- None beyond the change request above — everything else checked (Decisions
  1, 2, 4, 5, 6; icon-coverage framing; both round-1 change requests) is
  now internally consistent and verified against the live source.
