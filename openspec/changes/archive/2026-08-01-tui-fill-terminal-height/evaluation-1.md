## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Details:
- AC #1 ("reproduce the gap first, name the actual cause") is satisfied: design.md's Context
  section documents a live tmux reproduction (100×30 terminal, `tmux capture-pane`) for all
  three affected screens, with exact blank-row counts (escalation 12, launchplan 11,
  docview/ticketview 17) and a static-trace cross-check against the codebase.
- AC #2 ("fills available rows without overflowing/scroll artifact") is satisfied by the
  implementation and confirmed both by unit tests (rows-1 bound assertions across a range of
  terminal heights in `test/ticketview.test.js`, `test/escalation.test.js`,
  `test/launchplan.test.js`, `test/docview.test.js`) and by task 6.2's post-implementation live
  tmux re-verification (all three screens render through row 29 of a 30-row terminal, footer as
  last line, row 30 genuinely blank).
- All tasks.md items are marked done and match the diff: escalation.js's `budget`/`usedSoFar`/
  `boxHeight` computation (Decision 2), launchplan.js's `Math.max(boxContent.length,
  ticketViewportRows) + 2` (Decision 3), docview.js's `bodyBox` growth (Decision 4), and the
  discovered ticketview.js `BOX_BORDER_ROWS` off-by-2 fix are all present in the code exactly as
  described.
- No AC was silently reinterpreted. The scope stayed to exactly the four screen files identified
  in proposal.md's Impact section (`escalation.js`, `launchplan.js`, `docview.js`,
  `ticketview.js`) plus their four corresponding test files and the openspec artifacts — no
  changes to `fleet.js`, `drilldown.js`, `launchpad.js`, or `watch.js`, matching the proposal's
  explicit non-goals.
- The `ticketview.js` off-by-2 fix is scope creep in the literal sense (not in the original
  design.md task list) but is justified and disclosed inline: it's a root-cause fix that the
  Decision-4 change would otherwise have turned into a hard overflow regression on every
  finite-`rows` ticketview render (confirmed via `git stash` bisection in the code comment), and
  it's covered by its own regression test and documented in files-modified.md/tasks.md. This is
  the kind of in-scope "discovered while implementing" fix the ticket's own AC #2 (no overflow)
  requires, not unrelated scope creep.
- Spec deltas (`specs/dashboard-full-height-layout/spec.md`, `specs/docview/spec.md`) match the
  shipped behavior exactly — requirement text and scenarios line up with the actual `Math.max`
  formulas and the `rows - 1` / `Infinity` unbounded-case semantics in the diff.
- No regressions to specs owned by other screens: `fleet.js`, `drilldown.js`, `launchpad.js`
  were not touched and their existing tests pass unmodified.

### Phase 2: Code Review — PASS
Issues: none.

Gate run (fresh, in `WORKTREE_PATH` — `CLEAN_WORKTREE` not set, consistent with `default` speed):
```
npm test
```
Result: exit 0. `node --test`: 1063 tests, 1063 pass, 0 fail. All subsequent bash script gates
(`emit-event`, `persist-evidence`, `gather-escalation-context`, `triage-followup`,
`assert-phase`, `start-servers`, `watch-smoke`, `doctor-artifacts`, `ticket-pattern`,
`escalation-loop`, `sync-core-resolution`, `harness-identity`, `resolve-speed`, `cleanup`,
`doctor-base-branch`, `auditor-render`, `check-merge-readiness`) also passed. No canonical
code-quality standard is configured for this project.

Manual review of the diff (`lib/ui/screens/escalation.js`, `launchplan.js`, `docview.js`,
`ticketview.js`):
- **Arithmetic verified by hand**, not just by the tests: `escalation.js`'s `usedSoFar =
  out.length + belowBoxRows` is read at exactly the point in the function where `out` holds only
  the title/blank lines pushed before the box (line 217, before the box push at line 220), and
  `belowBoxRows` mirrors every push that follows the box row-for-row for every state variant
  (stale/reply/reply-with-error/notice) — the total frame length algebraically resolves to
  `budget` when the grown branch is taken, matching the `rows - 1` reserved-row convention.
  `launchplan.js`'s reuse of the already-computed `ticketViewportRows` and `docview.js`'s
  `Math.max(content.length, viewportRows) + BOX_BORDER_ROWS` are both straightforward and
  correctly gated on `Number.isFinite(viewportRows)`/`rows > 0` so the unbounded case is
  byte-identical to pre-change behavior (also directly asserted by tests).
- **The `ticketview.js` off-by-2 fix is correct**: `computeViewportRows` now reserves
  `CHROME_ROWS_BASE (5) + BOX_BORDER_ROWS (2) + (hasUrl ? 1 : 0)`, mirroring `docview.js`'s own
  `DOC_CHROME_ROWS = 4 + BOX_BORDER_ROWS` pattern; regression test
  `test/ticketview.test.js`'s "computeViewportRows reserves the box border rows, not just the
  surrounding chrome" exercises the windowed case specifically and passes.
- **DRY**: `BOX_BORDER_ROWS = 2` is duplicated as a local constant in both `docview.js` and
  `ticketview.js` rather than exported/imported from one place, but this mirrors an established,
  pre-existing codebase convention (`BOX_BORDER_PADDING_COLS = 4` is already duplicated the same
  way across `escalation.js`/`fleet.js`/`drilldown.js`/`ticketview.js`, each with an explicit
  "see X's identical constant" comment) — not a new DRY violation introduced by this change.
- **Readable**: naming is clear (`usedSoFar`, `belowBoxRows`, `naturalBoxHeight`, `budget`), no
  unexplained magic numbers — every constant (`BOX_BORDER_ROWS`, `CHROME_ROWS_BASE`) is comment-
  documented with its derivation.
- **Modular**: growth logic stays local to each screen exactly as design.md's Decision 1
  (rejecting a generic post-render pad step) specifies; `bodyBox` remains the one shared,
  bounded/scrollable box primitive `renderDocView` and `ticketview.js` both delegate to.
- **No dead code**: no leftover TODO/FIXME, no unused imports in the diff.
- **No over-engineering**: the per-screen `belowBoxRows`/budget accounting is proportional to
  the actual row-counting problem being solved, not a new abstraction layer.
- **Behavior-preserving where expected**: all four "unbounded (`rows` absent/0) is unaffected"
  tests pass, confirming byte-identical output to pre-change behavior in the untouched case, and
  the "large batch still windows exactly as before" / "content taller than the viewport still
  windows" tests confirm no drive-by behavior change to the over-height case.
- **Tests meaningful**: new tests assert concrete line counts and footer-last-line positions
  (not just "renders without throwing"), and would catch a real regression (e.g. an off-by-one in
  the reserved-row budget, or the footer no longer being the last line).

### Phase 3: UI Review — N/A
This project has no UI review configured for this evaluator; dev-server steps were skipped per
instructions. (Live-terminal verification for this specific TUI change was instead performed by
the executor via tmux, documented and cross-checked in Phase 1 above.)

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider exporting `BOX_BORDER_ROWS` from `docview.js` (or a small shared layout-constants
  module) so `ticketview.js` derives it rather than re-declaring the same literal `2` — purely
  cosmetic, matches an existing codebase pattern either way, not required for this change.
