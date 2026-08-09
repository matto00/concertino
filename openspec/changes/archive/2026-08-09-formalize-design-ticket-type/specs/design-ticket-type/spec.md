## ADDED Requirements

### Requirement: A ticket is detected as a design ticket via label or title convention
The orchestrator SHALL check, at Setup, immediately alongside the existing
CON-62 `harness:` label check, whether the fetched ticket is a design
ticket. A Linear label matching exactly `type:design` SHALL mark it as one.
Absent that label, a title starting with the literal prefix `[DESIGN] `
SHALL also mark it as one. When neither signal is present, the ticket
SHALL be treated as an ordinary (`feature`/`task`/`bug`) ticket, unchanged
from today. The resolved value SHALL be recorded as `TICKET_TYPE: design |
feature` in `workflow-state.md` at Setup, alongside `AGENT_MERGE` and the
harness resolution.

#### Scenario: Label marks a design ticket
- **WHEN** the orchestrator fetches a ticket labeled `type:design`
- **THEN** `TICKET_TYPE` resolves to `design`, regardless of the ticket's title

#### Scenario: Title convention marks a design ticket absent the label
- **WHEN** the orchestrator fetches a ticket titled `[DESIGN] Formalize X`
  with no `type:design` label
- **THEN** `TICKET_TYPE` resolves to `design`

#### Scenario: Neither signal present
- **WHEN** the orchestrator fetches a ticket with no `type:design` label and
  a title with no `[DESIGN] ` prefix
- **THEN** `TICKET_TYPE` resolves to `feature`, and Setup/Planning proceed
  exactly as they do today

### Requirement: Planning extracts a design ticket's open questions and raises them as one multi-part escalation
The orchestrator SHALL, for a ticket with `TICKET_TYPE: design`, after
`ticket.md` is written (Phase 1 steps 1–2, unchanged), scan the ticket body
line by line (heading or plain paragraph, any nesting level) for the first
line whose text matches the regex `/open questions?/i`, and, when found,
extract the markdown bullet list immediately following it (skipping only
blank lines; stopping at the first non-bullet, non-blank line) as one
`sub_questions[]` entry per bullet, then raise them as a single multi-part
`emit-event.sh escalation` call using the existing `sub_questions=`
mechanism. This matching rule intentionally does not require a dedicated
heading — a plain lead-in sentence (e.g. "Open questions this ticket should
resolve:") immediately followed by a bullet list SHALL also match. When no
line matches `/open questions?/i`, or a match exists but no bullet list
immediately follows it, the orchestrator SHALL instead raise a
single-question Planning ESCALATION asking what the design ticket should
resolve, rather than proceeding as though there were nothing to ask. Each
question and its recorded answer SHALL be persisted into
`workflow-state.md`'s `DESIGN_QUESTIONS` field.

#### Scenario: Open questions extracted from a heading
- **GIVEN** a design ticket whose body contains a `## Open questions`
  heading followed by three bullets
- **WHEN** Planning runs
- **THEN** the orchestrator raises one multi-part escalation with three
  `sub_questions[]` entries, one per bullet, and persists each
  question/answer pair into `DESIGN_QUESTIONS` once answered

#### Scenario: Open questions extracted from a plain lead-in sentence, no heading
- **GIVEN** a design ticket whose body contains no heading named "open
  questions," but contains the plain paragraph line "Open questions this
  ticket should resolve:" immediately followed by a bullet list of three
  items (CON-100's own `ticket.md` shape)
- **WHEN** Planning runs
- **THEN** the orchestrator raises one multi-part escalation with three
  `sub_questions[]` entries, one per bullet — matching on the paragraph
  line's text, not on any heading

#### Scenario: No matching line escalates instead of guessing
- **GIVEN** a design ticket whose body contains no line matching
  `/open questions?/i`
- **WHEN** Planning runs
- **THEN** the orchestrator raises a single Planning ESCALATION asking what
  the ticket should resolve, rather than treating the ticket as having
  nothing to plan

#### Scenario: A matching line with no following bullet list escalates instead of guessing
- **GIVEN** a design ticket whose body contains a line matching
  `/open questions?/i` but the text immediately following it is prose, not
  a bullet list
- **WHEN** Planning runs
- **THEN** the orchestrator raises the same single-question Planning
  ESCALATION rather than attempting to parse the prose as questions

### Requirement: Each answered question is triaged via the existing follow-up-triage sub-procedure
The orchestrator SHALL, for each question in `DESIGN_QUESTIONS` whose
answer plausibly implies future work, invoke the "Triaging a suggested
follow-up" sub-procedure (see the `followup-triage` capability) with
`description` set to the question plus its answer and `files=unknown`,
recording the resulting `fold-in`/`standalone`/`discard` verdict back into
`DESIGN_QUESTIONS`. When an answer plainly implies no action, the
orchestrator MAY record an implicit `discard` directly, stating why,
without invoking the sub-procedure. A `fold-in` verdict SHALL cause the
orchestrator to apply `followup-triage`'s existing plan-revision
requirement (extending `ticket.md`/`proposal.md`/`design.md`/`tasks.md` to
cover the combined scope of every `fold-in` question, re-validating, and
re-running the design gate) before proceeding into the ordinary
Execution/Evaluation/final-gate/Delivery pipeline for that combined scope.
A `standalone` verdict SHALL cause the orchestrator to file a follow-up
ticket per `followup-triage`'s existing standalone behavior, recording its
identifier into `DESIGN_QUESTIONS`.

#### Scenario: A question triaged fold-in pulls the ticket into the ordinary pipeline
- **GIVEN** a design ticket where one question's answer triages to
  `fold-in`
- **WHEN** the orchestrator proceeds
- **THEN** it extends the change's plan artifacts to cover that scope,
  re-validates, re-runs the design gate to `CONFIRM`, and then runs
  Execution/Evaluation/the final gate/Delivery for that scope exactly as it
  would for an ordinary ticket

#### Scenario: A question triaged standalone files a ticket, not just a recorded answer
- **GIVEN** a design ticket where one question's answer triages to
  `standalone`
- **WHEN** the orchestrator proceeds
- **THEN** a new ticket exists summarizing that question's implied work and
  linking back to the design ticket, and its identifier is recorded in
  `DESIGN_QUESTIONS`

#### Scenario: An answer implying no action may skip the triage round-trip
- **GIVEN** a design ticket where one question's answer is purely a
  definitional/policy statement with no implied build work
- **WHEN** the orchestrator proceeds
- **THEN** it may record an implicit `discard` verdict for that question
  directly, stating why, without a separate triage escalation

### Requirement: A design ticket is done only when every question is triaged and actioned
The orchestrator SHALL NOT treat a design ticket as complete until: every
question in `DESIGN_QUESTIONS` has a recorded verdict; every `standalone`
verdict has an actually-filed follow-up ticket (not merely a recorded
verdict); and every `fold-in` verdict's combined scope has completed
ordinary delivery. A recorded verdict with no corresponding filed ticket or
completed delivery SHALL NOT be treated as satisfying this requirement.

#### Scenario: A recorded standalone verdict with no filed ticket is not done
- **GIVEN** a question's verdict is recorded as `standalone`
- **AND** no corresponding follow-up ticket has been filed yet
- **THEN** the design ticket is not yet complete

#### Scenario: All verdicts actioned satisfies done
- **GIVEN** every question in `DESIGN_QUESTIONS` has a recorded verdict,
  every `standalone` verdict has a filed ticket id, and every `fold-in`
  scope has completed delivery
- **THEN** the design ticket is complete

### Requirement: Phase 4 cleanup proceeds without a merged-PR confirmation when no question triaged fold-in
The orchestrator SHALL, for a design ticket where no question in
`DESIGN_QUESTIONS` triaged to `fold-in`, treat "every `standalone`/`discard`
verdict resolved" as the entry condition for Phase 4, in place of the
ordinary "human 'merged' confirmation or auditor `MERGE` verdict"
precondition — since no code was ever executed or pushed for that ticket.
This substitutes only the *entry condition*: Phase 4's own internal step
order SHALL remain unchanged from an ordinary ticket's — `cleanup.sh
--phase4` runs first, then the ticket is set Done and the closing comment
is posted, then the hygiene check — it is NOT reordered to post the
closing comment or set Done before `cleanup.sh --phase4` runs.
`cleanup.sh`'s local-`<base>` fast-forward step SHALL run unmodified in
this branch; it is a documented no-op when there is nothing new to
fast-forward, which is the expected state here since this branch never
pushed anything to `<base>`. When at least one question triaged to
`fold-in`, the ordinary merged-PR precondition SHALL apply unchanged, since
real code exists for that scope.

#### Scenario: Pure-decision design ticket cleans up without a merge confirmation
- **GIVEN** a design ticket where every question triaged to `standalone` or
  `discard`
- **WHEN** every such verdict has resolved (every `standalone` ticket
  filed)
- **THEN** the orchestrator proceeds to Phase 4 without waiting for a
  merged-PR confirmation, running `cleanup.sh --phase4` first and then
  setting the ticket Done and posting the closing comment, in that order —
  the same internal order as an ordinary ticket's Phase 4

#### Scenario: A design ticket with a fold-in scope still requires the merge precondition
- **GIVEN** a design ticket where one question triaged to `fold-in`
- **WHEN** that scope's delivery reaches Phase 3
- **THEN** Phase 4 cleanup still requires the ordinary human "merged"
  confirmation or auditor `MERGE` verdict before proceeding, unchanged from
  an ordinary ticket

### Requirement: The closing comment for a design ticket summarizes each question and its resulting action
The orchestrator SHALL post a closing comment to a design ticket listing
each question, its answer, and the resulting action (`fold-in` → merged/PR
link, `standalone` → new ticket id, `discard` → no action), in addition to
the ordinary "what shipped + merged PR link" content when a `fold-in` scope
also executed.

#### Scenario: Closing comment lists every question's resolution
- **GIVEN** a design ticket with three questions triaged `fold-in`,
  `standalone`, and `discard` respectively
- **WHEN** the orchestrator posts the closing comment
- **THEN** it lists all three questions with their answers and resulting
  actions (the merged PR link for the fold-in scope, the new ticket id for
  the standalone item, and a note of no action for the discarded item)
