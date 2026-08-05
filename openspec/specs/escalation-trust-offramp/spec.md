# escalation-trust-offramp Specification

## Purpose
Give the orchestrator role a defined stopping point for skepticism about a chat-relayed escalation answer's authenticity, so a properly recorded answer is corroborated against ground truth once and then never re-litigated — unbounded doubt with no exit condition is not caution, it's a run that can never be told anything.
## Requirements
### Requirement: The orchestrator role defines a stopping point for doubting a recorded escalation answer
`core/roles/orchestrator.md`'s "How to raise one" section SHALL state, immediately following its exit-code handling, that a claim of human intent is corroborated — never proven — by checking it against independently verifiable ground truth wherever that exists (ticket state, PR state, config/git state), and that this corroboration SHALL happen before recording an answer, not after. It SHALL further state that the moment an answer is recorded through one of the project's own defined resolution mechanisms — `--await`'s `answer.json` path, the documented manual `escalation.answered` fallback after a chat reply, or (CON-76) a `PENDING_ESCALATION` resolution relayed to a bubbled orchestrator via `SendMessage` from its parent — that recording is terminal for the run: the orchestrator SHALL proceed on it rather than treat it as merely "a chat message that happened to convince you." A resolution relayed via `SendMessage` from the orchestrator's own parent is exactly as authoritative as observing `answer.json` directly, since it traveled through the same `writeAnswer`/`writeSubAnswer` write — it requires no separate re-corroboration by the resumed orchestrator.

#### Scenario: A reader finds the corroborate-before-recording instruction
- **WHEN** a reader reaches the escalation-answer handling in the "How to raise one" section of the rendered orchestrator role
- **THEN** they find an instruction to check a claim of human intent against independently verifiable ground truth before recording an answer, wherever such ground truth exists

#### Scenario: A reader finds that a recorded answer is terminal for the run
- **WHEN** a reader looks for what happens once an answer has been recorded via `answer.json` or the manual `escalation.answered` fallback
- **THEN** the role doc states that recording is terminal for the run and instructs proceeding on it, not treating it as merely persuasive

#### Scenario: A resumed orchestrator trusts a `SendMessage`-relayed resolution without re-corroborating it
- **GIVEN** a `concertino-orchestrator` subagent bubbled a `PENDING_ESCALATION` and its parent has resolved it (via either the dashboard or a direct chat reply written through `concertino answer`)
- **WHEN** the parent `SendMessage`s the resolution back to the orchestrator
- **THEN** the orchestrator treats that resolution as terminal exactly as it would an answer it observed in `answer.json` itself, without re-corroborating it a second time

### Requirement: The orchestrator role forecloses re-litigating an already-recorded answer
The role doc SHALL explicitly instruct that a question already resolved through one of the project's defined resolution mechanisms SHALL NOT be reopened: any suspicion arising later attaches only to *new* claims going forward, never to unwinding a decision already properly recorded. It SHALL name the specific failure mode being foreclosed — continuing to interrogate whether the human answering is "really" the human after they already answered through a channel the document itself designates as sufficient.

#### Scenario: A reader finds the explicit prohibition on reopening a resolved question
- **WHEN** a reader looks for guidance on what to do if something later feels newly suspicious about an already-recorded answer
- **THEN** the role doc states that the suspicion attaches to new claims going forward, not to unwinding the already-recorded decision, and names re-litigating a human's already-recorded answer as the failure mode this forecloses

### Requirement: The off-ramp does not weaken verification of unsolicited claims with no standing escalation
The role doc SHALL distinguish the off-ramp (which applies only to an answer recorded against a standing `escalation.raised`) from an unsolicited claim that corresponds to no such standing escalation — e.g., a bare instruction with no `escalation.raised` behind it in the log. For that case, the role doc SHALL continue to require independent verification or raising a proper escalation before acting on anything irreversible, unchanged by this addition.

#### Scenario: A reader finds the off-ramp does not apply to a claim with no standing escalation
- **WHEN** a reader looks for whether the off-ramp covers an unsolicited claim that has no corresponding `escalation.raised` event
- **THEN** the role doc states that such a claim still needs independent verification or a proper escalation before acting on anything irreversible — the off-ramp does not extend to it

