## RENAMED Requirements

- FROM: `### Requirement: check-merge-readiness.sh deterministically evaluates the three machine-verifiable merge conditions`
- TO: `### Requirement: check-merge-readiness.sh deterministically evaluates the four machine-verifiable merge conditions`
- FROM: `### Requirement: The auditor merges only when all four conditions hold, and escalates cleanly otherwise`
- TO: `### Requirement: The auditor merges only when every deterministic condition holds and the acceptance-criteria trace succeeds, and escalates cleanly otherwise`

## MODIFIED Requirements

### Requirement: check-merge-readiness.sh deterministically evaluates the four machine-verifiable merge conditions
`scripts/concertino/check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>` SHALL check, in a single invocation: (1) every CI check reported for the PR on `BRANCH` is `SUCCESS`, treating any pending/queued/in-progress or missing conclusion as a distinct non-pass rather than collapsing it with an actual failure; (2) the PR's `mergeStateStatus` is `CLEAN`, with a `BLOCKED` status whose `reviewDecision` is `REVIEW_REQUIRED` reported as a specific "branch protection requires human review" reason distinct from any other non-mergeable reason; (3) the latest `verdict` event for `role=evaluator` in `.concertino/runs/<TICKET_ID>/events.jsonl` (resolved from the main checkout) is `PASS`, and the latest `verdict` event for `role=skeptic` is `CONFIRM`; and (4) no path in the branch's diff against the review base matches any glob configured in `agentMerge.protectedPaths`, that list being read from the main checkout's configuration and never from a caller-supplied argument. It SHALL print `PASS` and exit 0 only when all four hold, and `FAIL <reason>` (one line per failed condition, to stderr) with a non-zero exit otherwise, following the same stdout/stderr contract as `assert-phase.sh`. A refusal caused by condition (4) SHALL use an exit code distinct from an ordinary condition failure and from the stale-reviewed-SHA outcome, and condition (4) SHALL be a complete no-op when `protectedPaths` is empty or unset.

#### Scenario: All three conditions pass
- **WHEN** all four machine-verifiable conditions hold: the PR's checks are all `SUCCESS`, `mergeStateStatus` is `CLEAN`, the event log's latest evaluator verdict is `PASS`, its latest skeptic verdict is `CONFIRM`, and no diff path matches a configured protected glob
- **THEN** `check-merge-readiness.sh` prints `PASS` and exits 0

#### Scenario: A pending CI check is not treated as a pass
- **WHEN** at least one required check has no `conclusion` yet (still running)
- **THEN** `check-merge-readiness.sh` fails with a reason identifying that check as pending, distinct from a failed-check reason

#### Scenario: A failed CI check is reported distinctly from a pending one
- **WHEN** at least one required check's conclusion is `FAILURE` or equivalent
- **THEN** `check-merge-readiness.sh` fails with a reason identifying that check as failed, not as pending

#### Scenario: Branch protection requiring review is identified specifically
- **WHEN** the PR's `mergeStateStatus` is `BLOCKED` and `reviewDecision` is `REVIEW_REQUIRED`
- **THEN** `check-merge-readiness.sh` fails with a reason that names branch-protection/review-required specifically, not a generic "not mergeable" message

#### Scenario: A stale branch behind its base fails as not mergeable
- **WHEN** the PR's `mergeStateStatus` is `BEHIND` or `DIRTY`
- **THEN** `check-merge-readiness.sh` fails with a reason naming that status

#### Scenario: A transient or unrecognized mergeability status fails closed
- **WHEN** the PR's `mergeStateStatus` is `UNKNOWN`, `DRAFT`, or any value not otherwise enumerated by this requirement
- **THEN** `check-merge-readiness.sh` fails with a reason indicating mergeability is not yet determined, rather than passing by default

#### Scenario: A missing evaluator PASS or skeptic CONFIRM fails the gates check
- **WHEN** the latest evaluator `verdict` event in the run's event log is not `PASS`, or the latest skeptic `verdict` event is not `CONFIRM`
- **THEN** `check-merge-readiness.sh` fails with a reason naming which gate's verdict was missing or wrong

#### Scenario: A protected path in the diff refuses the merge
- **WHEN** every other condition holds but at least one path in the branch's diff against the review base matches a configured `agentMerge.protectedPaths` glob
- **THEN** `check-merge-readiness.sh` does not print `PASS`, names each matched path, and exits with the protected-path exit code

### Requirement: The auditor merges only when every deterministic condition holds and the acceptance-criteria trace succeeds, and escalates cleanly otherwise
The auditor SHALL run `check-merge-readiness.sh` for the deterministic conditions — CI, mergeability, this run's own gates, and protected paths — and independently trace the diff against every ticket acceptance criterion for the judgment condition. It SHALL run `gh pr merge` only when all of them hold, and SHALL escalate (verdict `ESCALATE`, or `BLOCKER` for environmental failures) without merging when any one fails, naming the specific reason. A protected-path refusal SHALL be reported as an `ESCALATE` for human merge, naming the matched paths, and SHALL NOT be retried or worked around by the auditor. A failed or escalated attempt SHALL leave the PR open and the worktree unchanged.

#### Scenario: All four conditions hold
- **WHEN** every deterministic condition holds — `check-merge-readiness.sh` passes — and the auditor traces every acceptance criterion to real code/behavior in the diff
- **THEN** the auditor merges the PR and returns verdict `MERGE`

#### Scenario: A deterministic condition fails
- **WHEN** `check-merge-readiness.sh` fails for any reason
- **THEN** the auditor does not merge, returns verdict `ESCALATE` naming that reason, and the PR remains open

#### Scenario: A protected-path refusal escalates for human merge
- **WHEN** `check-merge-readiness.sh` exits with the protected-path code, naming one or more matched paths
- **THEN** the auditor does not merge, returns verdict `ESCALATE` naming those paths and stating that a human must perform the merge, and the PR remains open

#### Scenario: An acceptance criterion cannot be traced to the diff
- **WHEN** `check-merge-readiness.sh` passes but the auditor cannot trace one or more acceptance criteria to actual code/behavior in the diff
- **THEN** the auditor does not merge, returns verdict `ESCALATE` naming the untraceable criteria, and the PR remains open

#### Scenario: An environmental failure blocks verification
- **WHEN** `gh` is unauthenticated or the GitHub API is unreachable during the auditor's checks
- **THEN** the auditor does not merge and returns verdict `BLOCKER` rather than guessing `ESCALATE` or `MERGE`

#### Scenario: A merge attempt never partially completes
- **WHEN** the auditor invokes `gh pr merge`
- **THEN** it does so only after every deterministic condition and the acceptance-criteria trace have already been independently confirmed, so no run ever reaches a state where the PR is merged but the worktree/branch is left in a broken intermediate state, or vice versa
