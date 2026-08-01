## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both
  spec deltas (`specs/dashboard-full-height-layout/spec.md`,
  `specs/docview/spec.md`), `workflow-state.md`, and both prior skeptic
  reports (`skeptic-design-1.md`, `skeptic-design-2.md`), treated as claims to
  re-check, not fact.

- **Round 2's change request — arithmetic re-check.** `design.md`'s "Live
  reproduction (ticket AC #1)" subsection (lines 38-63) now states, for a
  100×30 terminal:
  - `escalation.js`: content through row 18, rows 19-30 blank → **12 unused
    rows**. `30 - 18 = 12`. Consistent.
  - `launchplan.js`: content through row 19, rows 20-30 blank → **11 unused
    rows**. `30 - 19 = 11`. Consistent.
  - `docview.js`/`ticketview.js`: content through row 13, rows 14-30 blank →
    **17 unused rows**. `30 - 13 = 17`. Consistent (corrected from round 2's
    self-contradictory "row 9" / "18 unused" pairing).
  - `tasks.md` §6.1 cites the same three numbers (12/11/17) and they match
    `design.md` verbatim — no drift between the two artifacts.
  - Grepped the whole change dir for the old, wrong numbers (`row 9`, `18
    unused`, `18 blank`, `rows 10-30`): the only remaining occurrences are
    inside `skeptic-design-2.md` itself (the historical record of the
    mistake, correctly left alone), not in `design.md`/`tasks.md`/specs.

- **Went beyond arithmetic consistency and independently re-derived the
  numbers from the actual (pre-fix) code**, rather than trusting either the
  orchestrator's tmux capture or my own arithmetic check alone — this exact
  subsection has now been wrong twice (round 1: falsely claimed unreproducible;
  round 2: internally inconsistent), so it warranted the strongest evidence I
  could produce in the time available:
  - `docview.js`/`ticketview.js` — ran `ticketview.renderTicketView()`
    directly in the current worktree (`node -e ...`) with a one-line
    description, no comments, no URL, at `cols:100, rows:29` (the actual
    per-screen budget `watch.js:731` computes for a 30-row terminal with no
    banner: `reserved = bannerLines(0) + 1`, so `screenRows = 30 - 1 = 29`).
    Output is exactly 12 screen-content lines, footer (`esc back`) last.
    Terminal row = 1 (top bar) + 12 = **13**, matching design.md's corrected
    claim exactly, not merely arithmetically plausible.
  - `escalation.js` — ran `renderEscalation()` directly with a minimal
    question/two-options/role/raisedAt escalation (no context, no reply/
    notice), `cols:100`. Output is exactly 17 screen-content lines, footer
    last. Terminal row = 1 + 17 = **18**, matching design.md's claim exactly.
  - `launchplan.js` — ran `renderLaunchPlan()` with a minimal one-ticket,
    `activeCount:0` plan. Got 16 screen-content lines → terminal row 17, two
    short of design.md's claimed 19. This is explained by my fixture being
    intentionally minimal (`activeCount:0` and `startNow:true` skip the
    "already active" warning block, which per `launchplan.js:238-243` costs
    exactly 2 rows — a blank line + one warning line — when present); the
    actual reproduction almost certainly used a plan where that warning (or
    an equivalent optional row) renders, which resolves the gap without
    contradicting the design's claim. This is a fixture-shape difference on
    my part, not evidence against the design's number, and the
    `30 - 19 = 11` arithmetic (independently checked above) already holds
    regardless.
  - Confirmed `BOX_BORDER_ROWS = 2` (`docview.js:31`) and
    `CHROME_ROWS_BASE = 5` (`ticketview.js:26`) match my hand math for the
    docview case, and `watch.js:719-730`'s `computeScreenRows()` (`reserved =
    bannerLines + 1`) matches the "top bar takes row 1" assumption used in
    all three re-derivations.

- Re-verified (not just trusted prior rounds) the rest of the design's
  file:line claims still hold against the current worktree source:
  `escalation.js:187`'s `boxContent.length + 2` (unfixed, matches "current
  state" framing), `launchplan.js:211-226`'s `ticketViewportRows` computed
  but unused by `boxHeight`, `docview.js:112-126`'s unconditional
  `content.length + BOX_BORDER_ROWS`. All accurate, all still describing
  pre-fix behavior as design.md's Context section requires.

- Read `specs/dashboard-full-height-layout/spec.md` and `specs/docview/spec.md`
  in full: neither contains the row-count numbers that were corrected (they
  are purely behavioral/scenario-based), so round 2's fix had no knock-on
  spec text to update, and none is needed now. No `TODO`/`TBD`/placeholder
  text anywhere in the change dir.

- Checked scope and AC traceability once more: all 7 `lib/ui/screens/` files
  accounted for; ticket's two ACs (reproduce-first with real numbers,
  fill-without-overflow) both traceable to design content (Context's Live
  reproduction subsection; Decisions 2-5) and task items (§1-3, §6); no scope
  drift.

### Verdict: CONFIRM

### Non-blocking notes

- The `docview.js`/`ticketview.js` number is now not just internally
  consistent but exactly reproducible by direct execution of the current
  code — the strongest evidence this subsection has had across all three
  rounds. The design is sound enough to proceed to implementation: the
  `Math.max(natural, budget - used)` mirroring of the existing
  `fleet.js`/`drilldown.js`/`launchpad.js` pattern, the `rows - 1`
  reserved-row convention (Decision 5), and both spec deltas all check out
  against the real code and against each other.
