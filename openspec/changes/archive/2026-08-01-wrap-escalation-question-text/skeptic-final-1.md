## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` — touches exactly
  `lib/ui/screens/escalation.js`, `lib/ui/screens/fleet.js`, `test/escalation.test.js`,
  `test/fleet.test.js`, plus this change's own planning artifacts. No scope creep.

- **AC1 (fleet page wraps, no border corruption)**: `lib/ui/screens/fleet.js:289-302`
  (`renderRun`) — wraps `run.escalation.question` alone via `textwrap.wrap(question,
  opts.cols - 8)`, appends `suffix = stale + keys` to the wrapped block's last line only,
  then re-truncates that composed line via `f.truncate(lastLine + suffix, opts.cols - 8)`.
  Read `lib/ui/textwrap.js` and `f.truncate` (`lib/ui/format.js:259-267`) directly:
  `truncate` is a genuine no-op when the input already fits (`visibleLength(str) <= n`
  returns `str` unchanged), confirming the "short questions unaffected" claim is not just
  asserted but structurally true.

- **`sectionHeight`/`innerCols` edge case (the one flagged for special attention)**: read
  `lib/ui/screens/fleet.js:890-895` (the new `s.kind === 'needs-you'` branch of
  `sectionHeight`) side-by-side with the real render call site at `fleet.js:1125,1157`
  (`const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS)` then
  `renderRun(s.group[k], { cols: innerCols, avgDoneMs }, ...)`) — the `cols`/`innerCols`
  derivation is byte-for-byte identical in both places (`Math.max(40, (opts && opts.cols)
  || 80)` then `Math.max(0, cols - BOX_BORDER_PADDING_COLS)`), and the estimate reuses
  `renderRun(...).length` itself rather than a second formula.
  I did not just read this — I **reproduced it empirically** (scratchpad
  `repro2.js`/`repro5.js`, node run against the worktree's own `lib/ui/screens/fleet.js`):
  a NEEDS YOU run with a 40-word question at `cols: 80` renders a box with
  `naturalBoxHeight = contentLines.length + 2 = 7` (1 title + 4 wrapped-question lines +
  2 border), and manually walking `sectionHeight`'s needs-you branch for the same input
  produces `2 + lineCount` where `lineCount = renderRun(...).length = 5` → `7`. Estimate
  and actual render match exactly — no drift.
- **Suffix re-truncation at the 40-column floor** (the other flagged edge case): reproduced
  (`repro4.js`) a stale, two-long-option escalation at `cols: 40/50/60/80`. At every width
  the border characters are a single consistent width (`border widths: [40]` etc.), no
  line exceeds the terminal width, and the wrapped block's last line correctly carries the
  suffix (truncated with `…` only when question+suffix together overflow, matching
  pre-existing single-line-truncation behavior for that same rare case — not a regression).
  Also confirmed (`repro5.js`) two simultaneous NEEDS YOU rows with different-length
  questions render without bleeding into each other or into the RUNNING/METRICS sections
  below.
- Confirmed (comment/code read) that `cols` in `renderFleet`/`sectionHeight` is always
  floored at 40 (`Math.max(40, ...)`), so `opts.cols - 8` inside `renderRun` can never
  actually fall below `textwrap.wrap`'s internal `Math.max(10, width)` floor via this
  path — the previously-rejected reserve-suffix-before-wrap approach (round 2's unsound
  design) is genuinely not present in the shipped code; the re-truncate-after-append
  approach sidesteps the whole class of failure as designed.
- **AC2 (escalation answer screen)**: `lib/ui/screens/escalation.js:146` —
  `for (const line of textwrap.wrap(currentQuestion, innerWidth)) boxContent.push(line);`,
  identical pattern to the context field three lines below (`escalation.js:160`). Read
  the surrounding function: `naturalBoxHeight = boxContent.length + 2` already sizes off
  the array's real length, so no second bookkeeping site needed here (matches
  tasks.md 1.3's reasoning).
- **AC3 (short questions unaffected)**: read the tests
  (`test/escalation.test.js` "renders identically", `test/fleet.test.js` "renders
  identically") and independently reproduced a short question at `cols: 80` renders on
  exactly one line unchanged.
- **AC4 (synthetic long question at narrow terminal)**: reproduced directly at 78/80/40
  columns; also present as committed tests.
- **Full test suite**: ran `npm test` myself fresh in the worktree — `tests 1142, pass
  1142, fail 0`, matching the evaluator's claim exactly (not merely trusting the pasted
  number). Also ran `node --test test/fleet.test.js test/escalation.test.js` directly:
  `tests 263, pass 263, fail 0`.
- **No regression to `visibleWindow`'s existing NaN-guard callers**: `opts.cols` is
  optional everywhere it's read in this file (`Math.max(40, (opts && opts.cols) || 80)`),
  matching every other field's existing fallback convention — verified by reading, and by
  the full suite (including `test/fleet.test.js`'s pre-existing `visibleWindow(manyRuns, {
  rows: 12, selected: 0 })`-shaped calls that omit `cols`) passing green.
- **Git hygiene**: `git status --short` shows only `workflow-state.md` (tracked) and the
  evaluator's own report (untracked, expected pre-archival) — no stray uncommitted code
  changes outside the reviewed diff.
- UI/design-judgment section: N/A per role contract for this project (no design standard
  configured); this is a TUI (terminal ANSI rendering), not a browser UI, so dev-server
  screenshotting doesn't apply — I substituted direct plain-text render captures (shown
  above) across multiple terminal widths as the TUI-equivalent visual check, and found box
  borders, alignment, and spacing all correct and consistent.

### Verdict: CONFIRM

### Non-blocking notes
- Independent of this ticket's scope: at very small `rows` budgets, `METRICS` (a
  `forceRender: true`, fixed 5-line section with an always-empty `group`) is not subject
  to the height-budget trim loop at all (only sections in `scrollable` — i.e.
  non-`unselectable`, non-`pinned` — get trimmed), so a NEEDS YOU section that has grown
  tall due to a long wrapped question, combined with METRICS's fixed cost, can still push
  the total frame past `rows` after every trimmable section (RUNNING/FAILED/DONE/QUEUED)
  has been trimmed to zero. I confirmed via reproduction that this is **pre-existing**
  behavior (METRICS's fixed, untrimmable cost predates this ticket) and is exactly the
  "if NEEDS YOU alone overflows the terminal we lose the header, which is the right thing
  to lose" trade-off the code already documents at `fleet.js:908-909` — extended
  slightly further down the frame by METRICS's own fixed cost. Not a regression this
  ticket introduced and not in scope for CON-53's acceptance criteria (which asks only
  that borders/other rows not be *corrupted*, not that overflow past `rows` never
  happens at all) — borders stayed intact and unmangled in every reproduction I ran,
  including the most degenerate small-`rows` cases. Worth a future ticket if extreme
  small-terminal overflow with a hot NEEDS YOU section becomes a real complaint.
