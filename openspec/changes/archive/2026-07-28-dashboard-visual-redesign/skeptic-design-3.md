## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-visual-design/spec.md` in full (current, post-round-2
  revisions) — cold, no reliance on prior reports' conclusions.
- Read `skeptic-design-1.md` and `skeptic-design-2.md` as claims lists only,
  and independently re-checked every claim each made against the current
  artifacts and the actual source.
- Read `lib/ui/format.js` and all six `lib/ui/screens/*.js` files
  (`fleet.js`, `drilldown.js`, `launchpad.js`, `escalation.js`,
  `ticketview.js`, `launchplan.js`) in full as ground truth.

- **Check 1 — task 5.1 vs. Decision 2, and 5.2/5.3.** Round 2's Change
  Request 1 flagged task 5.1 instructing "always focused" styling for the
  escalation screen, directly contradicting Decision 2's "single-pane
  screens use the plain border set" rule. Current `tasks.md` task 5.1 now
  reads: "Wrap the escalation screen's question/context/options block in a
  single `layout.box()` **using the plain/unfocused border set**, matching
  design.md Decision 2's single-pane rule" — this now matches Decision 2
  verbatim. Tasks 5.2/5.3 both say "same rule as 5.1" and are therefore also
  consistent. **Resolved.**
- **Check 2 — any other design/tasks contradiction of the same class.**
  `grep`-ed `focused|TODO|TBD|figure out|decide later|placeholder` across
  both files. Cross-checked every screen's border-set assignment: fleet
  (task 2.1: "plain/unfocused... per design.md Decision 2") matches Decision
  2's fleet paragraph; drill-down (task 3.1: "plain/unfocused border set")
  matches Decision 2's drill-down paragraph; launch pad (task 4.1: "`lp.pane`
  driving which side gets the focused border set") matches Decision 2's
  launch-pad paragraph (the one screen where a real pane-switch key exists —
  independently confirmed against `launchpad.js`'s actual `switch-pane`
  action and `lp.pane === 'epics' | 'tickets'`, `launchpad.js:238-240`).
  Verified `drilldown.js`'s `handleKey` (`drilldown.js:341-383`) has no
  pane-switch key (esc/y/↵/k/r all act on the one run) and `escalation.js`/
  `ticketview.js`/`launchplan.js`'s `handleKey` functions are each genuinely
  single-surface (`escalation.js:133-166`, `ticketview.js:112-115`,
  `launchplan.js:119-130`) — the "no second input target" premise Decision 2
  leans on for these five screens is true of the real code, not merely
  asserted. No other design/tasks contradiction found.
- **Check 3 — does the design hold together end to end / is it buildable.**
  Re-derived `fleet.js`'s actual `sectionHeight()` arithmetic by hand
  (`fleet.js:190-193`): a populated, uncapped section costs one title row +
  one trailing blank (`fleet.js:232`) + `2*shown` run rows + optional
  moreFlag = `2 + 2*shown + moreFlag`. Decision 3's restated
  border-replaces-title-and-blank formula nets to the identical
  `2 + 2*shown + moreFlag` — arithmetically sound against the real source,
  not just internally consistent with itself (this was round 1's Change
  Request 1; it is fully resolved and now verified against ground truth).
  Confirmed round 2's two non-blocking items were folded into Decision 3 as
  described: the drill-down `hsplit` height-reconciliation callout (pad
  TIMELINE by 2 extra blank rows to absorb GATES+EVIDENCE's doubled border
  overhead) and the fully-collapsed-fleet-section callout (`shown[i] === 0`
  stays a single unbordered line, unchanged from today) are both now present
  as explicit prose in Decision 3.
- Traced every ticket AC to a task: shared layout helper → 1.1/1.3;
  unambiguous focus → 4.1/4.2 + spec's focus requirements; snapshot tests at
  several widths/heights incl. wide-char → 1.3/6.2; forced-`isTTY` colour
  test → 1.4; every degradation string preserved → 2.3/3.3/4.3/5.4. No AC
  left uncovered.

### Verdict: CONFIRM

### Non-blocking notes

- Decision 3's drill-down `hsplit` height-reconciliation paragraph ends "...
  not a new degree of freedom — task 3.1 accounts for it." This is not
  currently true as written: task 3.1's actual text (`tasks.md` lines
  44-54) covers box structure, the plain/unfocused border-set rule, and
  preserving `rightContentWidth()`'s width sizing, but says nothing about
  padding TIMELINE's content by the 2 extra blank rows Decision 3 specifies.
  This is the same class of issue prior rounds caught (design.md asserting a
  cross-reference to tasks.md that the task text doesn't actually contain),
  but I'm not blocking on it here because: (a) Decision 3 already states the
  exact, concrete formula (pad by 2 rows) directly usable by an implementer
  reading the design doc, so no ambiguity or missing information blocks
  implementation; and (b) both round 1 and round 2 already accepted
  equivalent `hsplit`/height-matching inferences as "reasonable for a
  competent implementer" for this exact codepath. Worth a one-line addition
  to task 3.1 ("pad TIMELINE's content by 2 blank rows before calling
  `hsplit()`, per Decision 3") so the doc's own cross-reference is accurate,
  but this can be picked up during execution/evaluation rather than
  requiring another design-gate round.
