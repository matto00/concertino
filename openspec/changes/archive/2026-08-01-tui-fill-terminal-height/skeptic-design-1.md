## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/dashboard-full-height-layout/spec.md`, `specs/docview/spec.md`), and
  `workflow-state.md`.

- Cross-checked design.md's Context section's file:line claims against the
  actual code in this worktree:
  - `escalation.js:187` — confirmed `const boxHeight = boxContent.length + 2;`
    and confirmed (via `grep -n rows lib/ui/screens/escalation.js`) that
    `opts.rows` is never read anywhere in the file.
  - `launchplan.js:211-226` — confirmed `rows`/`ticketViewportRows` are
    already computed (`belowBoxRows`-aware) but `boxHeight` (line 226) still
    ignores that budget (`boxContent.length + 2`).
  - `docview.js`'s `bodyBox` (lines ~112-124) — confirmed
    `height = content.length + BOX_BORDER_ROWS` unconditionally, and its own
    comment states the "sized to content itself" behavior deliberately.
    Confirmed both callers (`renderDocView` and `ticketview.js:77`) are
    full-screen compositions, and `computeViewportRows`/`ticketview.js`'s own
    `computeViewportRows` resolve an absent/0 `rows` to `Infinity`.
  - `fleet.js:836-948` — confirmed the `budget = opts.rows > 0 ? opts.rows - 1
    : 0`, `lastRenderableIndex`, and
    `boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar)` pattern the
    design proposes mirroring for `escalation.js`/`launchplan.js` genuinely
    exists as described.
  - `watch.js:902` (`computeScreenRows()`) and `watch.js:957`
    (`rows: screenRows` passed to `router.render()`) confirmed as described.
  - `test/` already contains `escalation.test.js`, `launchplan.test.js`,
    `docview.test.js`, `ticketview.test.js`, `fleet.test.js`, matching the
    "fleet.test.js-style" test plan referenced throughout tasks.md.
  - All 7 files in `lib/ui/screens/` are accounted for by the design (3
    changed, 3 already-correct/no-change, 1 shared function with 2 callers)
    — no screen is left unaddressed by the plan.

- **Live-terminal reproduction, done myself, that the design explicitly
  claims is unavailable.** `tasks.md` §6.1 states: "root-cause diagnosis for
  this ticket was done via static code review (no live terminal available in
  this environment)" and treats an actual repro as optional ("if a live
  terminal is available at execution time, spot-check..."). This directly
  narrows the ticket's own AC #1 ("Reproduce the gap first (which screen,
  what terminal size, how much unused space) and name the actual cause
  before proposing a fix") and its explicit warning ("don't guess at the fix
  from the report alone").

  I checked whether the premise is true. `tmux` and `script` are both
  present in this environment, `bin/concertino watch` is itself a
  tmux-driven dashboard, and `test/scripts/watch-smoke.test.sh` already
  drives it end-to-end against a real tmux session (including opening the
  escalation screen via a seeded `events.jsonl` + a live tmux window named
  for the ticket, and `capture-pane`-style verification). I reproduced the
  reported gap directly using that exact pattern:

  ```
  tmux new-session -d -s SESSION -x 100 -y 30 -n ESC-1 'sleep 300'
  # seed .concertino/runs/ESC-1/events.jsonl with an escalation.raised event
  tmux new-window -t SESSION -n DRIVER "node bin/concertino watch --out=$WORK; sleep 30"
  tmux send-keys -t SESSION:DRIVER Enter   # opens the escalation screen
  tmux capture-pane -t SESSION:DRIVER -p
  ```

  Result, on a real 30-row terminal: the escalation box (rows 4-12) plus its
  meta/hint lines (rows 14-18) render, then **rows 19-30 (12 blank rows) are
  genuinely empty** — the pane is exactly as tall as the terminal but the
  content stops 12 rows short. This confirms the design's diagnosis
  (escalation.js never reads `opts.rows`) is correct in practice, not just in
  static trace — but it also proves the "no live terminal available"
  premise in tasks.md 6.1 is false. A live, quantified repro (screen name,
  terminal size, exact row count of unused space) is trivially achievable in
  this exact environment with tooling the repo's own test suite already
  uses.

### Verdict: REFUTE

### Change Requests

1. `tasks.md` §6.1 (and any corresponding claim in `design.md`) must not
   state or imply that live-terminal reproduction is unavailable — it is
   available via `tmux`, exactly as `test/scripts/watch-smoke.test.sh`
   already demonstrates for this same dashboard. Revise §6.1 to make live
   reproduction a required step (not an optional "if available" spot-check),
   and record the actual measured evidence the ticket's AC #1 asks for
   (which screen, what terminal size, how much unused space) for at least
   `escalation.js` — and ideally `launchplan.js`/`docview.js`'s two
   full-screen consumers too — using the tmux-driven pattern already
   established in `watch-smoke.test.sh`. The static file:line trace in
   design.md's Context section is good supporting evidence and should stay,
   but it should not be presented as a substitute for the reproduction the
   ticket explicitly requires when reproduction is this cheap to actually do.

### Non-blocking notes

- Everything else checked out: the file:line evidence in design.md's Context
  section is accurate against the current code, the proposed
  `Math.max(natural, budget - used)` mirroring of the existing
  `fleet.js`/`drilldown.js`/`launchpad.js` pattern is a faithful reuse (not a
  new invented mechanism), the `rows - 1` reserved-last-row convention is
  preserved in every decision, all 7 screens are accounted for, and the test
  plan (grow / unbounded-unaffected / tight-budget-still-shrinks /
  long-batch-still-scrolls per screen) matches the existing test file
  naming and shape in this repo.
- Once Change Request 1 is addressed, the rest of the design is sound enough
  to implement as written.
