## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth artifacts read directly** — `ticket.md`, `design.md`, `tasks.md`,
   `files-modified.md`, `evaluation-1.md`, and `git diff main...HEAD --stat` (20 files,
   +1082/-19; 4 screen files + 4 test files + openspec artifacts — no changes to
   `fleet.js`/`drilldown.js`/`launchpad.js`/`watch.js`, matching the proposal's non-goals).

2. **AC #1 ("reproduce the gap first, name the actual cause")** — traced to design.md's
   "Live reproduction" subsection (100×30 tmux repro, exact blank-row counts per screen)
   plus a static trace against the pre-change code. Traceable and specific.

3. **AC #2 ("fills available rows without overflowing")** — read the full diff for all
   four screen files (`escalation.js`, `launchplan.js`, `docview.js`, `ticketview.js`) and
   checked the arithmetic by hand, not just by trusting the evaluator's narrative:
   - `escalation.js`: manually traced every `out.push()` after the box push and confirmed
     `belowBoxRows` accounts for each one exactly (blank separator, meta line, hint block,
     reply block incl. error line, notice block, blank-before-footer, footer) — the
     `usedSoFar = out.length + belowBoxRows` computation is exact, not approximate, given
     `out.length` at the point of the box push is provably `2` (title + blank) in this
     function.
   - `launchplan.js`/`docview.js`: `Math.max` growth gated on `rows > 0` /
     `Number.isFinite(viewportRows)` respectively, with the unbounded case algebraically
     unchanged — confirmed by reading the surrounding code, not just the diff hunk.
   - `ticketview.js`'s disclosed root-cause fix (`BOX_BORDER_ROWS = 2` added to
     `computeViewportRows`'s reserved chrome): read the full diff and the new regression
     test.

4. **Regression test for the disclosed root-cause fix actually catches the bug** — reverted
   `computeViewportRows`'s chrome computation to the pre-fix (buggy) form and re-ran
   `test/ticketview.test.js`: the new test *"computeViewportRows reserves the box border
   rows, not just the surrounding chrome"* failed with `expected the windowed frame to
   respect the rows - 1 budget, got 21 lines` (vs. the 19-line budget) — confirming this is
   a real, probe-confirmed root cause with a test that would catch a regression, not a
   test that merely exercises the code. Restored the file afterward (`git status --porcelain`
   confirmed clean).

5. **Full test suite re-run fresh** — `npm test` and `node --test`: both exit 0, 1063/1063
   pass (matches evaluation-1.md's claimed count exactly, independently reproduced).

6. **Independent live tmux verification (not reusing the executor's transcript)** — built my
   own seeded work directories and drove `bin/concertino watch` in a real 100×30 tmux pane,
   independently reproducing all three of the executor's claimed repro paths:
   - **escalation.js**: seeded `ESC-1` with a live tmux window (to avoid the `[stale]`
     variant), opened via Enter from the fleet — content renders through row 29 (`a
     approve d deny t reply ↵ attach esc back` footer as last line), row 30 genuinely
     blank (30-row capture, footer at line 29).
   - **launchplan.js**: `N` → `Tab` → `Space` → `L` on a seeded single-ticket cache —
     ticket-list box grows to fill, footer (`↵ confirm & launch ...`) at line 29, row 30
     blank.
   - **ticketview.js** (short description): `N` → `Tab` → `Enter` — box grows to fill,
     `esc back` footer at line 29, row 30 blank.
   - **ticketview.js** (long description, exercising the off-by-2 fix live): seeded a
     40-paragraph description forcing windowing (`… showing 1-20 of 83`) — total capture
     is exactly 30 lines, footer at line 29, row 30 blank — **no overflow**, confirming the
     disclosed root-cause fix holds under live rendering, not just in the unit test.
   All captures independently corroborate the executor's task 6.2 transcript rather than
   merely trusting it.

7. **Spec deltas match shipped behavior** — read
   `specs/dashboard-full-height-layout/spec.md` and `specs/docview/spec.md` in full;
   requirement text and scenarios (grow-to-fill under a finite budget, unbounded-unaffected,
   tight-budget-unaffected, large-batch-still-windows) line up exactly with the `Math.max`
   formulas and gating conditions actually in the diff.

8. **No scope drift** — all four touched screen files were the ones the ticket/proposal
   named; the one undisclosed-to-design addition (`ticketview.js`'s `BOX_BORDER_ROWS` fix)
   is explicitly disclosed in tasks.md/files-modified.md with a probe-confirmed root cause
   (`git stash` bisection cited in the code comment, and independently reproduced by me in
   item 4 above) and justified by AC #2's "without overflowing" requirement — legitimate
   in-scope discovery, not creep.

9. **UI/design judgment** — N/A per the assignment (no design standard configured for this
   project; it is a terminal UI, not a web UI with tokens/themes). I substituted direct
   visual inspection of live tmux captures (item 6) for the design-standard review this
   gate would otherwise perform, and found the rendering visually consistent with the
   established `fleet.js`/`drilldown.js`/`launchpad.js` grow-to-fill screens (border style,
   footer placement, single-pane convention).

### Verdict: CONFIRM

### Non-blocking notes

- Matches evaluation-1.md's own non-blocking suggestion: `BOX_BORDER_ROWS` is duplicated as
  a local constant in both `docview.js` and `ticketview.js` rather than shared from one
  place — cosmetic, and consistent with this codebase's existing `BOX_BORDER_PADDING_COLS`
  duplication pattern (each with an explicit "see X's identical constant" comment). Not
  required for this change.
