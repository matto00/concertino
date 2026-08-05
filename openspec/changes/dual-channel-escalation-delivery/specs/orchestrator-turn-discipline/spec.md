## ADDED Requirements

### Requirement: A single, narrow exception permits ending a turn to bubble a pending escalation
`core/roles/orchestrator.md`'s "Harness resume model" section SHALL state exactly one exception to "never end your turn while artifacts of the current ticket are still incomplete": bubbling a `PENDING_ESCALATION` the orchestrator has just raised (via `--raise-only`) or received from a child it spawned, up to its own parent — and only once that escalation's full state is durably persisted in `workflow-state.md` so a cold re-spawn can reconstruct it. This exception SHALL be worded to state explicitly that it applies only when the orchestrator has no outstanding spawned child of its own at the moment of the return, and that it does not loosen the existing rule for any other case — most importantly, ending a turn while waiting on a spawned executor, evaluator, skeptic, or auditor remains exactly as forbidden as before.

#### Scenario: The exception's precondition is stated explicitly
- **WHEN** a reader reaches the turn-discipline exception in the rendered orchestrator role
- **THEN** it states plainly that the only permitted early return is to bubble a pending escalation, that this requires no outstanding spawned child at the moment of the return, and that `workflow-state.md` must already hold everything needed to reconstruct the pending escalation before the return happens

#### Scenario: The exception is distinguished from the CON-10/CON-15 failure mode
- **WHEN** a reader compares the new exception against the original "never end your turn while a sub-agent is outstanding" rule
- **THEN** the role doc explains why bubbling a pending escalation is not the same failure mode: nothing is orphaned by the return, because the escalation's full state is already persisted and the parent receiving the return is the one now responsible for resuming the orchestrator via `SendMessage`

#### Scenario: The exception does not cover returning while a spawned child is outstanding
- **WHEN** a reader checks whether the new exception permits returning while an executor, evaluator, skeptic, or auditor spawned by this orchestrator is still outstanding
- **THEN** the role doc states that it does not — that case remains forbidden exactly as it was before this change
