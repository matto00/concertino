## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in full (not just the
  paragraph that changed since round 3), plus `skeptic-design-1.md`/`-2.md`/`-3.md`
  (treated as claims, re-derived independently below against the live worktree).

- **Round 3's specific finding — `tasks.md` 2.3 vs. `design.md`'s code block
  disagreeing on `innerCols` vs. raw `cols` — is now closed and consistent both
  ways:**
  - `design.md` lines 108-144 (the `sectionHeight` needs-you special case):
    computes `const cols = Math.max(40, (opts && opts.cols) || 80);` then
    `const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);`, and states
    the call must be `renderRun(run, { cols: innerCols }, false).length` —
    explicitly calling out "innerCols, not the raw cols" and citing this exact
    round-3 mismatch by name.
  - `tasks.md` task 2.3 (lines 40-61): now reads "sum each run in `s.group`'s
    actual rendered line count via `renderRun(run, { cols: innerCols },
    false).length`, where `cols = Math.max(40, (opts && opts.cols) || 80) ...
    and `innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS)` — **pass
    `innerCols`, not the raw `cols`, to `renderRun`**" — same variable names,
    same derivation, same final call, matching design.md verbatim. No
    remaining divergence between the two documents on this point.

- **Verified against the actual source (not just the design's narrative) that
  `innerCols` is genuinely what the real render pass uses**, so the design's
  fix target is correct, not just internally self-consistent:
  - `lib/ui/screens/fleet.js:1094`: `const innerCols = Math.max(0, cols -
    BOX_BORDER_PADDING_COLS);` and `:1126`: `renderRun(s.group[k], { cols:
    innerCols, avgDoneMs }, ...)` — confirms the real render pass's `renderRun`
    call is fed `innerCols`, exactly what design.md/tasks.md 2.3 now also feed
    the estimate.
  - `lib/ui/screens/fleet.js:960`: `const cols = Math.max(40, (opts &&
    opts.cols) || 80);` — confirms this is genuinely the file's own existing
    convention (design.md's claim), not an invented one.
  - `lib/ui/screens/fleet.js:1003`: `visibleWindow(runs, augmentedOpts)` where
    `augmentedOpts = Object.assign({}, opts, { metrics })` and `opts` is
    `renderFleet`'s own parameter (which carries `.cols`) — confirms `cols`
    genuinely flows from the real render call into `visibleWindow`'s `opts`,
    so `sectionHeight`'s derivation has the same input in production as the
    real render pass's derivation, not two independently-sourced numbers that
    only coincidentally look alike in the design's prose.
  - `test/fleet.test.js:2148-2150`: the one caller design.md says omits `cols`
    (`visibleWindow(manyRuns, { rows: 12, selected: 0 })`) — confirmed
    `manyRuns` are all constructed with `status: 'done'`, i.e. the needs-you
    group is genuinely empty for this call, so the `!s.group.length`
    short-circuit is reached before the new fallback-derivation code would
    ever run. Design.md's claim that this caller is "harmless today" is
    accurate, not hand-waved.

- **Checked the rest of design.md/tasks.md for regressions beyond the one
  paragraph that changed** (per the instruction not to spot-check only the
  fixed line): re-read the round-1/round-2 fixes (suffix re-truncate
  mechanism, `textwrap.wrap`'s `Math.max(10, width)` floor, `f.truncate`'s
  unconditional bound) as they currently stand in design.md's Decision section
  and tasks.md 2.2 — both still read exactly as round 3 verified them
  (re-checked `lib/ui/textwrap.js:13-30` and `lib/ui/format.js:259-293`
  directly again this round rather than trusting the prior report's readback
  of them; both functions are unchanged from round 3's reading). No new
  contradiction found anywhere else in the four documents.
  - `ticket.md` is unchanged from round 1; all four acceptance criteria are
    still traceable to a specific task (1.1/2.2 for wrapping, 2.3/2.4 for
    layout accommodation, 2.2's "no-op for already-fitting" argument + task
    3.2 for "short questions unaffected", task 3.1/3.4 for the verification
    criterion).
  - No `TODO`/`TBD`/placeholder text anywhere in `design.md`, `tasks.md`,
    `proposal.md`, or `ticket.md` (checked via grep).

### Verdict: CONFIRM

The plan is now internally consistent (design.md and tasks.md agree on
`innerCols` vs. raw `cols` throughout, not just in the one previously-flagged
paragraph), and that consistency matches the real codebase's actual behavior
at every point I independently re-verified against source (not the design's
own narrative). All four acceptance criteria trace to specific, unambiguous
tasks with a recorded rationale for why the two previously-unsound approaches
(round 1's unbounded append, round 2's pre-wrap reservation) were rejected.

### Non-blocking notes

- None beyond what round 3 already recorded (all previously-noted items —
  `textwrap` import task, `opts`/`BOX_BORDER_PADDING_COLS` scope — remain
  correctly reflected and unchanged this round).
