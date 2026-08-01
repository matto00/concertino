## ADDED Requirements

### Requirement: A checkable trigger rule governs when ticket-drafting text must escalate instead of continuing
`core/laws/ticket-drafting-escalation.md` SHALL define, as a mechanically-followable rule (not a
vague intuition), two independent triggers that require raising a real escalation instead of
finalizing ticket text: (1) an enumerated banned-hedge-phrase list (e.g. "likely acceptable,"
"probably fine," "should be fine," "I'll assume," "for now, I'll go with," "reasonable default,"
and similar hedge language) whose appearance in drafted ticket body text trips the rule, and (2) a
structural check — a ticket draft that names an open question, a design fork, or a scope boundary
without a stated resolution SHALL NOT be finalized as-is.

#### Scenario: A reader finds an enumerated phrase list, not a vague instruction
- **WHEN** a reader opens `core/laws/ticket-drafting-escalation.md`
- **THEN** they find a concrete list of specific banned hedge phrases, not only a general
  instruction like "escalate if you're guessing"

#### Scenario: A reader finds the structural open-question check stated as a rule
- **WHEN** a reader opens `core/laws/ticket-drafting-escalation.md`
- **THEN** they find a stated rule that a ticket referencing an open question, fork, or scope
  boundary with no resolution must not be finalized as-is

### Requirement: The law is registered in the Iron Laws index
`core/laws/README.md`'s laws table SHALL include a row for `ticket-drafting-escalation.md`,
naming its Iron Law and the role(s) it is bound to, consistent with the existing two-law table
format.

#### Scenario: The new law appears in the laws table
- **WHEN** a reader opens `core/laws/README.md`
- **THEN** the laws table includes a row for `ticket-drafting-escalation.md` with a stated Iron
  Law and bound role(s)

### Requirement: The orchestrator applies the law when composing Phase 4 step 4's follow-up-suggestion question
`core/roles/orchestrator.md`'s Phase 4 step 4 SHALL state that composing that step's
`question=`/`options=` text (the one-shot follow-up-ticket suggestion — the only ticket-adjacent
text this step produces; there is no downstream ticket-drafting-then-`mcp__linear__save_issue`
step in this role today) is governed by `ticket-drafting-escalation.md`. If composing that text
trips either trigger from that law, the orchestrator SHALL surface the fork within that same
one-shot escalation (using the multi-part `sub_questions=` form when more than one genuinely
independent fork applies) rather than silently collapsing it into a single confidently-worded
suggestion. This SHALL NOT introduce a second escalation call, and SHALL NOT grow, or count
separately against, the existing one-shot cap already governing that step.

#### Scenario: A reader finds the wiring at Phase 4 step 4
- **WHEN** a reader reaches Phase 4 step 4 of the rendered orchestrator role
- **THEN** they find an instruction that composing that step's follow-up-suggestion question text
  is governed by `ticket-drafting-escalation.md`, and that a trigger hit there is surfaced within
  that same one-shot escalation rather than silently resolved

#### Scenario: A law-triggered fork does not create a second escalation or grow the one-shot budget
- **WHEN** composing Phase 4 step 4's follow-up-suggestion question text trips the law's trigger
- **THEN** the orchestrator raises exactly one escalation call for that step (using
  `sub_questions=` if more than one fork applies), not two, and this is not treated as a
  second occurrence of, or an addition to, the step's existing one-shot cap
