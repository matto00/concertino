## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/drilldown-changes-panel/spec.md`, `workflow-state.md`, and round 1's
  `skeptic-design-1.md` in full.
- **Round-1 Change Request 1 (spec.md/design.md/tasks.md focus-switch contradiction) —
  confirmed resolved.** `specs/drilldown-changes-panel/spec.md`'s "CHANGES panel selection
  and its open key are focus-gated" requirement (lines 49-67) now states the focus switch
  itself is *never* blocked ("the digit key `5`/`Tab` focus switch itself SHALL still move
  focus to CHANGES even when its diff-stat list is empty") and its scenario is renamed/
  rewritten to "Focus switch still reaches an empty CHANGES panel" (lines 63-67) — the exact
  opposite of round 1's stale, imported "Focus switch is inert..." wording. Cross-checked
  this against the *actual current* `lib/ui/screens/drilldown.js` `handleKey` (lines 720-729):
  digit-key `1`-`4`/`Tab` dispatch is unconditional, with an explicit code comment ("every
  panel (including an empty EVIDENCE) is a legitimate focus target now") — and against
  `test/drilldown.test.js:777` (`'tab cycles through an empty EVIDENCE panel too — every
  panel is a legitimate focus target now'`), which passes today. `design.md` Decision 5
  (lines 99-111) now also explicitly disclaims mirroring EVIDENCE's stale historical
  requirement and states the same narrower behavior. All three artifacts (spec.md,
  design.md, code) now agree.
- **Round-1 Change Request 2 (missing layout decision, broken cross-reference) —
  confirmed resolved.** New `design.md` Decision 6 (lines 113-144) specifies: where CHANGES
  sits (third stacked pane in the existing right column, below EVIDENCE, no fourth top-level
  column), how its content width is derived (fold diff-stat line widths into
  `rightContentWidth`'s existing `Math.max` chain, raise `RIGHT_MAX` from 34), and how the
  three-box height reconciliation works (`gatesBoxHeight + evidenceBoxHeightNatural +
  changesBoxHeightNatural = rightTotalHeight`, new `changesFocused` footer branch alongside
  `evidenceFocused`, not folded into it). Verified all of this against the actual code:
  `RIGHT_MAX = 34` and `rightContentWidth()` (drilldown.js lines 215-234), the
  `minLeftContent`/`leftContentW` protection against a raised `RIGHT_MAX` crushing TIMELINE
  (lines 500-509), the two-box height math `gatesBoxHeight + evidenceBoxHeightNatural =
  rightTotalHeight` (lines 571-573) and the three-branch `footerRowCount` structure
  (`confirm` / `evidenceFocused` / default, lines 606-623) that Decision 6 correctly says
  needs a fourth `changesFocused` branch. `tasks.md` 3.3/3.3a/3.3b now correctly cite
  "design.md Decision 6" (previously the broken "Decision 5" reference) and each task maps
  to a real piece of Decision 6's content. No remaining broken cross-reference.
- Re-confirmed no other artifact drift: `proposal.md`/`workflow-state.md` unchanged from
  round 1 and still consistent (Planning escalation answers match Context/Decisions 1/2/4);
  all three ticket ACs still trace to concrete tasks/spec requirements; `Decision`
  numbering in `design.md` (1-6) and every `tasks.md` cross-reference to it now resolve to
  content that actually exists and matches, with no dangling "Decision N" reference left.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 3.4's parenthetical — "CHANGES-selection/open hints shown only while CHANGES
  is focused and has at least one file (mirrors EVIDENCE's own 'focus switch is inert when
  there is nothing to select' gate)" — still cites the old, now-explicitly-superseded
  EVIDENCE requirement name as what's being "mirrored," even though `design.md` Decision 5
  and `spec.md`'s rewritten requirement both explicitly say CHANGES does *not* mirror that
  behavior (the focus switch itself is never inert; only the footer hints are gated). The
  main clause of 3.4 is correct and unambiguous on its own, and Decision 5/spec.md take
  precedence, so this doesn't rise to a blocking contradiction — but the parenthetical is
  stale terminology that could momentarily mislead an implementer skimming tasks.md in
  isolation. Worth a one-line tightening (e.g. "mirrors `sections.js`'s 'only advertise a
  key that currently does something' discipline" instead) before or during execution.
- (Carried over from round 1, still open, still non-blocking) `docview.js`'s header comment
  ("mode = 'docview' is entered ONLY via the evidence reader's 'open-evidence-doc' action")
  will be inaccurate once `open-diff-doc` also enters `docview` mode — worth a one-line
  comment update alongside task 4.1.
