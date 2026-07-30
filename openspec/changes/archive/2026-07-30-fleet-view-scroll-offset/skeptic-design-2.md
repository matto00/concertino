## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report in full (`skeptic-design-1.md`) to recover the exact
  two required change requests and the two non-blocking notes.
- Read the revised `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-view-scroll/spec.md` in full.
- Confirmed via `git status --short` and `git diff main...HEAD --stat` that
  this worktree still has zero code changes (only the untracked
  `openspec/changes/fleet-view-scroll-offset/` directory) — the design is
  being checked against the actual, unmodified `main` state of
  `lib/ui/screens/fleet.js` / `lib/ui/watch.js`, not a moving target.
- Re-read `lib/ui/screens/fleet.js` in full: confirmed the trim loop (lines
  284-291), `sections` array with each section's `cap` (`Infinity` for
  `NEEDS YOU`/`RUNNING`, `MAX_FINISHED` for `QUEUED`/`FAILED`/`DONE`, lines
  232-258), the `shown[i] = Math.min(...)` line (259), the render loop's
  `index`/`!s.unselectable` handling (293-355), and `render(state, opts)`
  (457-470) — all match design.md's descriptions of current behavior.
- Re-read `lib/ui/watch.js`: `selected` declaration (224), `currentState()`
  (308-314), the `selected` clamp (466), `router.render` call (531-537), and
  the `move` case in `applyAction` (729-731) — confirmed `applyAction` runs
  in the same closure scope as `draw()`, so it can read
  `process.stdout.columns`/`.rows` directly the same way `draw()` does
  (line 495/505) without new plumbing, for task 2.2's `visibleWindow` call.
- Re-read `test/fleet.test.js`'s existing whole-frame-trim test (all four
  sections, lines 376-402) and marker-alignment test (`the selection marker
  points at reduce()'s run for every index`, line ~574) to confirm the
  baseline tasks 3.1/3.5 build on top of.
- Confirmed `test/scripts/watch-smoke.test.sh` exists (task 3.6's cited
  precedent for real-keypress-level assertions is real, not invented).

### Change Request 1 (round 1) — trim direction for a scroll-straddled section

**Closed.** Decision 3 now states the rule explicitly: when the height-budget
trim shrinks a section containing `selected` within its current
`[startOffset, startOffset + shown)` window, it trims from whichever edge is
*farther* from `selected` — growing `startOffset` (dropping rows off the top)
if `selected` is nearer the tail, or shrinking `shown` from the bottom if
`selected` is nearer the head — and never trims past the point where
`selected` would fall outside the window. Applied to round 1's own concrete
example (`FAILED` windowed to `group[10..15)`, `selected` at `failed[14]`,
budget forcing `shown` from 5 to 3): `selected` is nearest the tail, so the
farther edge is the top, and the correct result is `startOffset` growing to
12 (window `[12,15)`), which still contains `failed[14]` — the exact failure
mode CR1 identified no longer occurs. A section *not* containing `selected`
is explicitly left on the old tail-first rule, which is correct (nothing to
protect there). The `visibleWindow` per-section `{shown, startOffset,
hidden}` shape (task 1.1) is now specified precisely enough to make this
direction unambiguous, and Decision 3 explicitly names the terminal fallback
(full collapse to the "… and N more" line) for the case where even this
protection can't be satisfied, correctly scoping that to the "very small
terminal" degraded case AC4 already allows, not to the moderate-terminal case
CR1 was about.

### Change Request 2 (round 1) — test plan gap

**Closed.** Task 3.5 adds exactly the combined scroll-plus-small-terminal
marker-alignment test CR1/CR2 called for: constructs a `runs`/`rows`
combination that forces the whole-frame budget to shrink the very section a
non-zero `scrollOffset` has windowed mid-group (using the same `FAILED`
`group[10..15)`/`lastVisibleIndex` scenario as the design's own worked
example) and asserts the `▸` marker for `runs[selected]` is still rendered.
Task 3.6 additionally adds a real-keypress-level (`watch-smoke.test.sh`
precedent) regression test, which is more than CR2 required and closes the
gap from two angles (direct `fleet.js` call and real `j` keypresses through
`watch.js`).

### Non-blocking notes (both previously-flagged wording issues, also fixed)

- Round 1 note 3 (the `router.render`/`opts` wiring wording): design.md's
  Impact section and task 2.4 now correctly describe `scrollOffset` flowing
  through `currentState()`/`state.scrollOffset`, merged into `opts` by
  `fleet.js`'s own `render(state, opts)` wrapper — not literally part of the
  `{cols, rows, now, queuedTitles, ticketText}` object passed to
  `router.render`. Matches the actual code at `watch.js:531-537`.
- Round 1 note 4 (QUEUED skip in the section walk): Decision 2 and task 1.1
  now both state explicitly that the per-section walk skips `QUEUED` via the
  same `!s.unselectable` guard the existing `index` counter uses.

### New, non-blocking observation (does not require another round)

Decision 2's "Concretely" walkthrough twice says a straddled/subsequent
section renders "up to `MAX_FINISHED` further rows" / "subject to
`MAX_FINISHED`" — read literally, this would apply the FAILED/DONE-specific
constant (5) to every section, including `RUNNING`, which today has
`cap: Infinity` (`fleet.js` line 234) and is never artificially capped, only
trimmed by the whole-frame budget. That would be a new, out-of-scope
regression (hiding legitimately-running agents behind a "… and N more
running" line on a terminal with plenty of room) that neither the ticket nor
Decision 1's own stated scope ("FAILED/DONE, the two sections `MAX_FINISHED`
already gates") asks for. I judge this non-blocking rather than a required
revision because task 1.2 already frames the refactor as reusing each
section's existing `cap` field (explicitly calling `NEEDS YOU`/`QUEUED`
"unaffected," which is only true if the per-section `cap` — not a hardcoded
literal — drives the computation), and no task instructs touching `RUNNING`'s
`cap` value, so the natural implementation path already avoids the bug. Worth
a one-line tightening in Decision 2 ("subject to that section's own cap —
`MAX_FINISHED` for `FAILED`/`DONE`/`QUEUED`, `Infinity` for `RUNNING`/`NEEDS
YOU`") so the prose can't be misread in isolation from task 1.2.

### Verdict: CONFIRM

Both of round 1's required change requests are directly, specifically closed
in design.md (Decision 3) and tasks.md (1.1/1.2/1.6/1.7/2.4/3.5/3.6), traced
against the actual current behavior of `lib/ui/screens/fleet.js` and
`lib/ui/watch.js`. The design's scope still matches the ticket's four
acceptance criteria one-to-one (spec.md's four Requirements), the Non-Goals
still bound scope appropriately (no queue scrolling, no new keybinding, no
persistence), and no new placeholders, contradictions, or missing contract
updates were introduced by the revision. Sound enough to implement.

### Non-blocking notes
- See "New, non-blocking observation" above — tighten Decision 2's
  "MAX_FINISHED" wording to "that section's own cap" for precision.
