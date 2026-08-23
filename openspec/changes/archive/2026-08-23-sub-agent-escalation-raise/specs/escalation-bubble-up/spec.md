## ADDED Requirements

### Requirement: Sub-agent-originated escalations reuse the existing raise/relay/resolve procedure unchanged
The orchestrator SHALL raise an `ESCALATION` verdict from executor/evaluator/skeptic, or an
`ESCALATION-RAISE` verdict from auditor (per the `subagent-escalation-raise` capability), through
this capability's existing
`--await`/`--raise-only` topology-aware procedure, unmodified in its
logic — only the `role=` tag on the resulting event differs (`role=<raiser>` instead of
`role=orchestrator`). No new escalation mechanism, event kind, or `emit-event.sh` mode is
introduced for sub-agent-originated escalations.

#### Scenario: A sub-agent escalation at the root uses --await
- **GIVEN** the orchestrator is the root (no parent of its own) and receives an `ESCALATION`
  verdict from a sub-agent
- **WHEN** it raises that escalation
- **THEN** it calls `--await` exactly as it would for its own Planning `ESCALATION`, tagging
  `role=<raiser>`

#### Scenario: A sub-agent escalation from a spawned orchestrator bubbles per the existing rule
- **GIVEN** the orchestrator is itself running as a spawned subagent and receives an `ESCALATION`
  verdict from a sub-agent it spawned
- **WHEN** it raises that escalation
- **THEN** it calls `--raise-only` and returns `ESCALATION-PENDING` to its own parent exactly per
  this capability's existing bubble requirement, tagging `role=<raiser>`

#### Scenario: The role tag distinguishes origin without a new event kind
- **WHEN** `events.jsonl` is inspected for an escalation raised by a sub-agent versus one raised by
  the orchestrator itself
- **THEN** both appear as ordinary `escalation.raised`/`escalation.answered` events, distinguished
  only by their `role=` field, with no new event kind introduced
