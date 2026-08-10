## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/drilldown-changes-panel/spec.md`, and `workflow-state.md` in full.
- Confirmed the three Planning-escalation answers are correctly threaded through the
  artifacts: `workflow-state.md` line 30 records `cadence=every-poll,
  worktree-gone=worktree-removed-message, large-diff=truncate`; `design.md`'s Context
  (lines 12-16) and Decisions 1/2/4 restate them consistently, and `proposal.md`/`spec.md`
  match. No drift found here.
- Traced all three ticket ACs to concrete tasks/spec requirements — all three are covered
  (panel reachability §1/§3/§4, honest degradation §2/§3 Decision 2, docs+footer discipline
  §5/§3.4). No scope drift beyond the ticket's stated ACs.
- Read `lib/ui/screens/drilldown.js` in full (817 lines) — confirmed the "pure render /
  gated non-pure poll read in watch.js" split the design claims to follow, confirmed
  `DRILL_PANELS`, the digit-key range check (`key >= '1' && key <= '4'`), the
  `evidenceFocused`/default two-footer-variant split, and the `rightContentWidth()`/
  `leftContentW`/height-reconciliation layout math the design's Decision 5 and tasks 3.3
  touch.
- Read `lib/ui/watch.js` (the `drillTicketText`/`draw()` per-poll gating block, lines
  774-837) — confirmed the `S.mode === 'drilldown' && S.drillTicket` gate and `opts`
  threading pattern the design claims to mirror for the new diff-stat read.
- Read `lib/ui/controllers/drilldown.js` in full — confirmed the `open-evidence-doc`/
  `back-to-drilldown-from-doc` round trip the design's Decision 3 claims to reuse for
  `open-diff-doc`.
- Read `lib/ui/screens/docview.js` in full — confirmed `bodyBox`/`renderDocView` are
  generic/reusable as claimed, and noted its own header comment ("mode = 'docview' is
  entered ONLY via the evidence reader's 'open-evidence-doc' action") will become stale
  once a second entry point (`open-diff-doc`) exists — non-blocking, see notes below.
- Read `lib/ui/icons.js` — confirmed the glyph-block constraint (Geometric
  Shapes/Dingbats/Misc Technical/Math Operators, `Emoji_Presentation=No`) tasks.md 1.1's
  proposed `◧` U+25E7 would need to satisfy; U+25E7 is in the Geometric Shapes block and
  not already used by another entry — consistent with the constraint as stated.
- Read `openspec/specs/evidence-reader/spec.md` in full and cross-checked its "Focus
  switch is inert when there is nothing to select" requirement against the *actual*
  current `handleKey` code and `test/drilldown.test.js` (lines 725-730, 777-780): the
  digit-key/`Tab` focus switch is unconditional today (`test('tab cycles through an empty
  EVIDENCE panel too — every panel is a legitimate focus target now', ...)`), i.e. the
  evidence-reader spec's own text on this point is already stale versus the "lazygit-layout
  pass" code — this pre-existing drift is not this ticket's fault, but the new CHANGES spec
  delta imports the same stale wording, which now actively contradicts this change's own
  design/tasks (see Change Request 1 below).

### Verdict: REFUTE

### Change Requests

1. **Internal contradiction: spec.md forbids focusing an empty CHANGES panel; design.md/tasks.md implement the opposite.**
   `specs/drilldown-changes-panel/spec.md`'s "The CHANGES panel selection and its open key
   are focus-gated" requirement includes the scenario "Focus switch is inert when there is
   nothing to select" (lines 56-59): *"WHEN the CHANGES panel shows no changed files...
   THEN the focus-switch key does not move focus to CHANGES..."* — i.e. `5`/`Tab` must be
   blocked from ever giving CHANGES focus when the diff is empty.
   `design.md` Decision 5 (lines 99-106) and `tasks.md` 3.4, by contrast, only gate the
   *footer hints* on the stat list being non-empty ("CHANGES-selection/open hints shown
   only while CHANGES is focused and has at least one file") — they say nothing about
   blocking the focus switch itself, and this matches the actual current codebase
   convention (`drilldown.js`'s digit-key/`Tab` handling is unconditional for every panel —
   confirmed by the explicit regression test `'tab cycles through an empty EVIDENCE panel
   too — every panel is a legitimate focus target now'`, added specifically to lock in that
   post-"lazygit-layout-pass" behavior).
   This is a straight contradiction between two of this change's own artifacts, copied
   from an already-stale line in the pre-existing `evidence-reader` spec (whose scenario
   description predates the lazygit-layout pass and no longer matches EVIDENCE's own
   real behavior either). Pick one and make both artifacts agree:
   - Either correct `spec.md`'s scenario to match design.md/tasks.md's actual intended
     behavior ("the focus switch is never blocked; only the selection/open hints and
     `↵`/`j`/`k` handling are gated on focus + non-empty list" — i.e. delete/rewrite this
     scenario to mirror the *code*, not evidence-reader's stale spec text), or
   - If the intent really is to block focus on an empty CHANGES panel (a *new*, stricter
     behavior versus every other panel), add that as an explicit design decision and task,
     since `handleKey`'s digit-key/`Tab` dispatch would need new per-panel conditional
     logic it does not have today for any panel.

2. **Missing design decision: CHANGES panel layout/sizing, and a broken cross-reference.**
   `tasks.md` 3.3 says CHANGES is "a fifth pane, sized/positioned consistently with the
   existing GATES/EVIDENCE stacked-pane treatment — see design.md Decision 5" — but
   `design.md`'s Decision 5 is titled "Footer hints — extend, don't duplicate..." and
   contains zero content about pane layout, width, or the left/right column split. There is
   no decision anywhere in `design.md` that actually specifies where CHANGES sits in
   `renderDrillDown()`'s layout (a third box stacked under GATES/EVIDENCE in the existing
   right column? a new column? full-width like TICKET?) or how its content width should be
   computed. This matters concretely: `rightContentWidth()` (drilldown.js lines 219-236) is
   sized today from short gate names and evidence labels and capped at `RIGHT_MAX = 34`
   columns — but `git diff --stat` lines routinely carry full relative file paths (e.g.
   `lib/ui/screens/drilldown.js | 45 +++...`), which will regularly exceed that cap and
   force pervasive path truncation the design never analyzed. Adding a third stacked box
   also changes the existing `rightTotalHeight`/`evidenceBoxHeight` padding math (lines
   571-644), which currently reconciles exactly two right-column boxes against TIMELINE's
   height — a required change to `drilldown-ticket-context`'s and `evidence-reader`'s
   "GATES/EVIDENCE panels' widths and heights" invariants that the proposal's "Modified
   Capabilities: (none)" section does not currently account for. Add an explicit design
   decision covering: where CHANGES sits, how its content width is derived (independent of
   or shared with `rightContentWidth()`), and how the three-box height reconciliation on
   the right column works — then fix tasks.md 3.3's cross-reference to point at it.

### Non-blocking notes

- `docview.js`'s own header comment ("mode = 'docview' is entered ONLY via the evidence
  reader's 'open-evidence-doc' action") will be inaccurate once `open-diff-doc` also enters
  `docview` mode — worth a one-line comment update alongside task 4.1, though it does not
  affect behavior since both actions still return via the same generic `back` ->
  `back-to-drilldown-from-doc` path.
- `handleKey`'s local state object (built by `routeHandleKey`, currently `{ run, confirm,
  drillFocus, drillEvidenceIndex }`) will need a new field carrying the current poll's
  parsed diff-stat file list (or `drillChangesIndex`'s resolved file) so `open-diff-doc`'s
  action can be built with a concrete file argument — tasks.md 4.2 doesn't spell this
  threading out explicitly the way it does for `drillEvidenceIndex`. Likely inferable by a
  competent implementer from the existing EVIDENCE pattern, but worth a sentence in
  design.md Decision 3 for precision.
- Design decision 5 implies (but tasks.md 3.4 doesn't say outright) that a CHANGES-focused
  footer variant should also hide `↵ attach`/`k kill`/`r restart`, mirroring EVIDENCE's
  focused footer exactly — worth stating explicitly in tasks.md rather than leaving it to
  be inferred from "mirrors EVIDENCE."
