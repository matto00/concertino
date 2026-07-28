# Files modified — dashboard-visual-redesign (CON-12)

## New

- `lib/ui/layout.js` — the shared layout module every screen now draws its
  bordered panes through: `box()`, `hsplit()`, `degrade()`, the focused/
  unfocused box-drawing character sets, and `MIN_BOX_WIDTH`/`MIN_BOX_HEIGHT`.
  Pure, no I/O.
- `test/layout.test.js` — box dimensions at several widths/heights (including
  wide CJK/emoji content), the focused-vs-unfocused character-set
  distinction, `degrade()`'s threshold behaviour, title-overflow truncation,
  and the visible-column budget for `box()`/`hsplit()` output.
- `test/layout-colour.test.js` — the `format-colour.test.js`-pattern
  colour-forced test (`isTTY = true`, require-cache cleared before
  requiring) exercising the focused box's bold/cyan border colour, and that
  border colour never bleeds into a content row's own colour.

## Modified

- `lib/ui/format.js` — added `STATUS_COLOUR` (needs-you/running/failed/
  done/pass/fail) next to the existing `ROLE_COLOUR`; `truncate`/`padTo`/
  `visibleLength` contracts unchanged.
- `lib/ui/screens/fleet.js` — the four sections (NEEDS YOU/RUNNING/FAILED/
  DONE) are now each their own `layout.box()` (plain border set, title woven
  into the top border, colour from `STATUS_COLOUR`); the box's top/bottom
  border replace the old standalone title row and trailing blank line
  respectively, so `sectionHeight()`/`height()`/`budget` keep their exact
  pre-change row-count arithmetic. Below `layout.degrade()`'s threshold, a
  section falls back to the old borderless rendering verbatim.
- `lib/ui/screens/drilldown.js` — `twoCol()` removed; TIMELINE (left) and
  GATES + EVIDENCE (two separate stacked boxes on the right, not merged) now
  render through `layout.box()` + `layout.hsplit()`, all plain border set.
  TIMELINE's box height is set to `max(its own natural height, GATES+EVIDENCE's
  combined height)` so the two columns always end at the same row — `box()`'s
  own `height` option blank-pads the shorter side, which in the common case
  is exactly "pad TIMELINE by the 2 extra rows the right column's second
  border pair costs." The gate-icon colour now reads `STATUS_COLOUR.pass`/
  `.fail` instead of `f.green`/`f.red` directly. **(Cycle 2)** `elapsedText()`
  now colours the run's `endStatus`/"window exited" word through
  `f.STATUS_COLOUR[run.status]`, so a failed run's header carries the exact
  same red the fleet view's FAILED section heading uses — this was the
  evaluator's one required change request (spec.md's "Failed status is the
  same colour everywhere" scenario was previously unmet for this screen).
- `lib/ui/screens/launchpad.js` — the EPICS | TICKETS split now renders
  through `layout.hsplit()` + `layout.box()`, with `lp.pane` driving which
  side gets the focused (heavier, bold/cyan) border set — the only screen
  with a real pane-switch key (Tab/←/→), per design.md Decision 2.
  `epicRow`/`ticketRow` were restructured so a row's **selection marker**
  (always shown when that row is the pane's current index) is independent of
  its **emphasis** (bold in the focused pane, dim in the unfocused one) —
  before this change, `ticketRow`'s marker itself was gated on the tickets
  pane having focus, so the selected ticket's marker vanished outright
  (rather than receding) whenever the epics pane was active.
- `lib/ui/screens/escalation.js` — the question/context/options block is now
  a single `layout.box()` (plain border set); the header line and the
  meta/reply/notice/footer lines outside it are unchanged. **(Cycle 2)** the
  `ESCALATION` tag now reads `f.STATUS_COLOUR['needs-you']` instead of a
  hardcoded `f.yellow` (non-blocking suggestion; same colour value, one
  source of truth for task 6.1's sweep).
- `lib/ui/screens/ticketview.js` — the DESCRIPTION/COMMENTS body is now a
  single `layout.box()` (plain border set); the identifier/title/meta/url
  header above it and the `esc back` footer below it are unchanged.
- `lib/ui/screens/launchplan.js` — the ticket-list body is now a single
  `layout.box()` (plain border set); the pre-flight ports/mode/concurrency
  lines above it and the already-active warning/footer below it are
  unchanged. **(Cycle 2)** removed the unused `BOX_BORDER_PADDING_COLS`
  constant (non-blocking suggestion) — unlike the other four boxed screens,
  this screen's box content (`ticketRow`) is a fixed-column layout that never
  varies with the box's own inner width, so there was nothing to size the
  constant against; a comment now explains why.
- `docs/dashboard.md` — added a "What it looks like" section with a rendered
  fleet-screen example and a rendered launch-pad (two-pane, focus-vs-plain
  border) example, both at 100 columns, replacing prose-only description.
- `test/fleet.test.js` — updated the selection-marker test for the new
  bordered output (marker no longer sits at column 0 of its line); added a
  colour-forced, multi-width (60/80/100/120), wide-CJK-character snapshot
  test (task 6.2). **(Cycle 2)** added an integration-level test that stubs
  `layout.degrade()` to force `true` and re-requires `fleet.js` against the
  stub, confirming the screen's OWN borderless-fallback branch runs and
  produces no box-drawing characters (non-blocking suggestion — this
  threshold is otherwise unreachable through any real screen's actual
  `cols`/`rows` floors, as the evaluator noted).
- `test/drilldown.test.js` — updated the "no nested `└` line" assertion (box
  borders now use `└` too, so the check is scoped to the content-row nested
  marker's own shape); bumped two width-dependent tests from 78 to 84
  columns and the gates-column-width test's widths from 60/78/120 to
  70/90/130, to absorb the border+padding+gap overhead bordering now costs
  (accepted trade-off per design.md's own risk log); the gates-column-width
  test now locates the right pane's start column via the top border row's
  second `┌` rather than an ` │ ` divider's `indexOf`. **(Cycle 2)** added a
  colour-forced test asserting a failed run's header wraps its `endStatus`
  (and, separately, "window exited") in `STATUS_COLOUR.failed`, and that the
  exact same escape sequence appears on the fleet view's FAILED heading for
  the same run — the evaluator's required change request.
- `test/launchpad.test.js` — bumped the OSC-neutralisation test's width from
  78 to 90 columns for the same border-overhead reason; added tests for the
  focused/unfocused border-character distinction, the colourless-terminal
  focus distinction, the selection-recede (dim, not bold, and — for tickets —
  no-longer-disappearing) behaviour in the unfocused pane, and the
  colour-forced multi-width wide-CJK-character snapshot test (task 6.2).
- `test/launchplan.test.js` — updated the ticket-row regex (`^\s+\d+\s+CON-3`
  → `^[│┃]\s+\d+\s+CON-3`) now that ticket rows sit inside a box.

## Notes for the reviewer

- `test/escalation.test.js` and `test/ticketview.test.js` needed **no**
  changes — every existing assertion (`plain()`-stripped text matches,
  ordering via `indexOf`, degradation strings) still holds verbatim once the
  question/context/options and description/comments blocks are boxed.
- Every degradation string/behaviour named in the ticket ("no telemetry",
  "phase unknown", "no evidence recorded", "no gate results recorded",
  "press r to fetch" / "no tickets cached yet — press r to fetch", the
  malformed-events banner, NEEDS YOU never scrolling away) is covered by an
  existing or updated test and was verified to still render verbatim.
- Full suite: `npm test` (`node --test` plus all `test/scripts/*.test.sh`
  suites, including `watch-smoke.test.sh`'s real-tmux end-to-end dashboard
  exercises) — 423 `node --test` cases (421 + 2 added in cycle 2) plus every
  shell suite, all green.

## Cycle 2 (evaluator change request + non-blocking suggestions)

- Required: `lib/ui/screens/drilldown.js`'s `elapsedText()` now colours the
  run's overall status word through `f.STATUS_COLOUR`; `test/drilldown.test.js`
  gained a colour-forced test pinning it against the fleet view's FAILED
  heading colour for the same run.
- Non-blocking, all addressed: removed the dead `BOX_BORDER_PADDING_COLS`
  constant from `lib/ui/screens/launchplan.js`; switched
  `lib/ui/screens/escalation.js`'s `ESCALATION` tag to
  `f.STATUS_COLOUR['needs-you']`; added an integration-level
  `layout.degrade()`-stub test to `test/fleet.test.js` exercising fleet.js's
  own borderless-fallback branch end to end (judgement call: adding this test
  was cheaper and lower-risk than lowering any screen's width/height floor
  just to make the threshold reachable at a "real" terminal size).
