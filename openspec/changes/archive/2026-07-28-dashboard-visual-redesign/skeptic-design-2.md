## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-visual-design/spec.md` in full (current, post-round-1
  revisions), and the round-1 report (`skeptic-design-1.md`) as a claims
  list only — re-derived every conclusion from the current artifacts and
  the actual source, not from the prior report's narrative.
- Read `lib/ui/screens/fleet.js`, `lib/ui/screens/drilldown.js`,
  `lib/ui/screens/launchpad.js`, `lib/ui/screens/escalation.js`,
  `lib/ui/screens/ticketview.js`, `lib/ui/screens/launchplan.js`, and
  `lib/ui/format.js` in full as ground truth.
- Re-derived `fleet.js`'s current `sectionHeight()`/render-loop arithmetic
  (`fleet.js:190-233`) by hand and checked it against design.md Decision 3's
  restated formula. Today: a populated, uncapped section costs one title row
  + one trailing blank (`out.push('')` at the end of the section's `forEach`
  branch, `fleet.js:232`) + `2*shown` run rows + an optional "…and N more"
  row = `2 + 2*shown + moreFlag`, exactly matching `sectionHeight()`'s own
  return value. Decision 3's restated version (top border replaces the title
  row, bottom border replaces the trailing blank, run rows/moreFlag
  unchanged) nets to the same `2 + 2*shown + moreFlag` — this is arithmetically
  sound and directly resolves round-1 Change Request 1 (the prior version's
  "+2 extra rows" claim, which contradicted its own math, is gone; the
  corrected formula is now stated explicitly and task 2.1 forbids the
  executor from re-deriving a different one).
- Confirmed round-1 Change Request 2 (fleet: one box vs. four) is resolved:
  Decision 2 now states explicitly "the four sections... each become their
  own `box()`, all drawn with the plain (unfocused) border set," matching
  task 2.1's wording exactly.
- Confirmed round-1 Change Request 3 (drill-down focus asserted-resolved-
  then-reopened) is resolved: task 3.2 now reads "(Resolved in design.md
  Decision 2 — no implementation-time decision needed here.) Confirm...",
  not a re-opened decision. Independently checked `drilldown.js`'s actual
  `handleKey` (`drilldown.js:341-384`) — no key routes differently based on
  a pane concept (esc/y/↵/k/r all act on the one run), so the "no
  pane-switch key exists today" premise the design leans on is true, not
  merely asserted.
- Confirmed round-1 Change Request 4 (GATES/EVIDENCE box count) is resolved:
  Decision 2 and task 3.1 both now state "GATES and EVIDENCE as two separate
  stacked boxes on the right," not left to a code comment.
- Confirmed round-1 Change Request 5 (vertical-padding contract) is resolved:
  Decision 1 now states explicitly "Padding is horizontal-only... does not
  reserve any additional blank row... Content rows are exactly `height - 2`,"
  and spec.md has a matching scenario ("Padding never changes a box's row
  count").
- Confirmed round-1 Change Request 6 (title-overflow contract) is resolved:
  Decision 1 now states the title is woven in via `f.truncate(title,
  availableTitleWidth)`, matching content's own truncation contract, with a
  matching spec.md scenario ("An overlong coloured title is truncated, not
  overflowed").
- Read `launchpad.js` in full to check Decision 2's claim that it already
  has a `focused` boolean threaded through `epicRow`/`ticketRow` and that
  `lp.pane === 'epics' | 'tickets'` is switched by Tab/arrows
  (`launchpad.js:93-121`, `238-240`) — confirmed accurate.
- Read `escalation.js`, `ticketview.js`, `launchplan.js` in full to confirm
  they are genuinely single-pane (one `handleKey` acting on one body, no
  pane-switch key in any of the three) — confirmed, matching design.md's own
  characterisation of them as single-pane screens.
- `grep`-ed all five planning artifacts for `TODO|TBD|figure out|decide
  later|placeholder` — no matches; no hand-waving placeholders remain.
- `grep`-ed `focused|unfocused|plain border` across `tasks.md`, `design.md`,
  `specs/dashboard-visual-design/spec.md` to cross-check every screen's
  border-set assignment for internal consistency — this is where I found a
  new contradiction (below), not present in round 1's report.

### Verdict: REFUTE

### Change Requests

1. **Task 5.1 directly contradicts design.md Decision 2 on the escalation
   screen's border styling.** Design.md Decision 2 states plainly: "`escalation.js`,
   `ticketview.js` and `launchplan.js` are single-pane by construction (one
   body, no list to switch into); **their one box also uses the plain border
   set**" (design.md, Decision 2, third bullet) — the same reasoning applied
   to fleet's four sections and drill-down's three panels (no second pane to
   contrast a "focused" style against, which the spec's "Single-input-target
   screens never claim a focused border" scenario generalises the same way).
   But `tasks.md` task 5.1 instructs the opposite for the same screen: "Wrap
   the escalation screen's question/context/options block in a single
   `layout.box()` (**single pane — always "focused" styling**, since it is
   the only interactive surface on the screen)." These are two different,
   mutually exclusive instructions for the same box (plain `┌─┐│└─┘` vs.
   heavier `┏━┓┃┗━┛`, and — per Decision 2's own colour rule — uncoloured/dim
   vs. bright/bold cyan border), and it is exactly the kind of "tasks
   contradict design" defect round 1 already caught once for the drill-down
   (round-1 Change Request 3) recurring in a new spot on this revision. An
   implementer following `tasks.md` literally would render escalation's box
   with the heavier/coloured border set that Decision 2 and the spec's own
   "no second input target" rule say a single-pane screen must never claim.
   Resolve by picking one rule and correcting whichever artifact disagrees
   with it: either (a) change task 5.1 to say "plain/unfocused border set,
   matching Decision 2's single-pane rule" (and confirm ticketview/launchplan's
   own tasks, 5.2/5.3, don't need the same fix — they currently don't assert
   either way, so they're silently consistent with Decision 2, but only
   escalation's task actively disagrees), or (b) if "always focused" for
   truly single-interactive-surface screens is actually the intended design
   (a defensible alternative — always-heavy border as "this is the one thing
   on screen you can act on"), then change Decision 2's stated rule and its
   matching spec.md scenario to say so, and clarify whether that also means
   ticketview/launchplan (equally single-pane) should render "focused" too,
   not just escalation. Either resolution is fine; leaving the contradiction
   as-is is not — it hands the executor an unresolved coin flip on a
   directly testable, screen-visible property.

### Non-blocking notes

- `hsplit()`'s stated precondition ("boxes that are already the same
  height") pushes height-reconciliation onto the caller, and for the
  drill-down specifically this is a genuine (if mechanical) asymmetry worth
  a one-line callout in Decision 3: TIMELINE costs 2 border rows total, but
  the right column (GATES box + EVIDENCE box stacked) costs 4 (2 boxes ×
  2 border rows each), so matching heights requires the caller to pad
  TIMELINE's content by 2 extra rows purely to absorb the second box's extra
  border overhead — not just "whichever side has fewer content lines gets
  padded," which is what the pre-change `twoCol()` did automatically. This
  is the same class of issue round 1 raised for the fleet (Change Request 1)
  but at lower stakes: the drill-down has no NEEDS-YOU-style hard row
  budget riding on it (Decision 3 says so explicitly), and round 1's own
  non-blocking note already accepted equivalent height-matching arithmetic
  as "a reasonable inference for a competent implementer" for `hsplit`/`box`
  in general. Calling it out explicitly would remove all doubt, but I'm not
  blocking on it given that precedent.
- The fully-collapsed fleet section case (`shown[i] === 0`, i.e. every run in
  a section is hidden behind "… and N more {title}") isn't addressed by
  Decision 3's arithmetic — it stays a single unbordered summary line today
  (`fleet.js:219-222`) and neither design.md nor tasks.md says whether that
  stays true post-change. It almost certainly should (there's no box to draw
  around zero visible rows), but it's worth one sentence in Decision 3 or
  task 2.1 to remove the inference entirely.
