## ADDED Requirements

### Requirement: Phase 4 begins only once the auditor's spawn call has returned

`core/roles/orchestrator.md` SHALL state that, following an auditor `MERGE` verdict, Phase 4 may begin only once the auditor's spawn call has returned that verdict as its return value. The role SHALL explicitly name observing the PR as merged by any other means — polling `gh pr view`, a GitHub notification, or a `merged` timestamp — as not satisfying that condition, and SHALL explain why: the merge becomes observable out-of-band strictly before the auditor finishes writing and persisting its report.

#### Scenario: the role names the return value as the condition

- **WHEN** the orchestrator role's agent-merge Phase-3 branch is read
- **THEN** it states that the `MERGE` verdict must be consumed as the spawn call's return value before Phase 4 begins

#### Scenario: the role names out-of-band observation as insufficient

- **WHEN** the same passage is read
- **THEN** it explicitly excludes polling the PR, a notification, or a merged timestamp as a substitute for that return value

#### Scenario: the exclusion is explained, not merely asserted

- **WHEN** the same passage is read
- **THEN** it gives the reason — the merge is observable before the auditor has persisted its report — rather than stating the prohibition bare
