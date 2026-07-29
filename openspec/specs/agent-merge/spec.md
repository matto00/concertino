# agent-merge Specification

## Purpose
Let a delivery that has already cleared the design gate, the evaluation loop, and the final skeptic gate merge its own PR: a fifth cold `auditor` role checks that CI is green, the PR is mergeable, this run's own gates passed, and the diff satisfies the ticket's acceptance criteria, then merges or escalates with the specific reason.
## Requirements
### Requirement: A fifth cold auditor role ships with the ensemble on both harnesses
Concertino SHALL ship a fifth agent role, `auditor`, alongside the existing orchestrator/executor/evaluator/skeptic, rendered into both the Claude Code and Codex adapters. The auditor SHALL be cold by construction: every invocation is a fresh spawn, never a warm resume, matching the skeptic's posture.

#### Scenario: Auditor role file exists and is rendered for Claude Code
- **WHEN** `concertino sync` runs for a project with `harnesses` including `claude-code`
- **THEN** `.claude/agents/concertino-auditor.md` is written with its own `tools:` frontmatter (not identical to the skeptic's or evaluator's UI-tool grant) and its own `model:` resolved from `models.auditor`

#### Scenario: Auditor role is documented in the Codex sequential flow
- **WHEN** `concertino sync` runs for a project with `harnesses` including `codex`
- **THEN** the rendered `AGENTS.md` contains a `## Role: Auditor` section, and `.codex/prompts/concertino-deliver.md` describes a sequential stage for the auditor after the final skeptic gate

#### Scenario: Auditor is available as an optional Codex worker
- **WHEN** `concertino sync` runs for a project with `harnesses` including `codex`
- **THEN** `.codex/agents/concertino-auditor.toml` is written, matching the optional worker-dispatch pattern already used for the executor and evaluator

#### Scenario: doctor and diff report the auditor's rendered files
- **WHEN** `concertino doctor` or `concertino diff` runs after a sync that included the auditor
- **THEN** a missing `concertino-auditor.md` (Claude Code) is reported the same way a missing `concertino-skeptic.md` would be, not silently ignored

### Requirement: check-merge-readiness.sh deterministically evaluates the three machine-verifiable merge conditions
`scripts/concertino/check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>` SHALL check, in a single invocation: (1) every CI check reported for the PR on `BRANCH` is `SUCCESS`, treating any pending/queued/in-progress or missing conclusion as a distinct non-pass rather than collapsing it with an actual failure; (2) the PR's `mergeStateStatus` is `CLEAN`, with a `BLOCKED` status whose `reviewDecision` is `REVIEW_REQUIRED` reported as a specific "branch protection requires human review" reason distinct from any other non-mergeable reason; (3) the latest `verdict` event for `role=evaluator` in `.concertino/runs/<TICKET_ID>/events.jsonl` (resolved from the main checkout) is `PASS`, and the latest `verdict` event for `role=skeptic` is `CONFIRM`. It SHALL print `PASS` and exit 0 only when all three hold, and `FAIL <reason>` (one line per failed condition, to stderr) with a non-zero exit otherwise, following the same stdout/stderr contract as `assert-phase.sh`.

#### Scenario: All three conditions pass
- **WHEN** the PR's checks are all `SUCCESS`, `mergeStateStatus` is `CLEAN`, the event log's latest evaluator verdict is `PASS`, and its latest skeptic verdict is `CONFIRM`
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

### Requirement: The auditor merges only when all four conditions hold, and escalates cleanly otherwise
The auditor SHALL run `check-merge-readiness.sh` for the three deterministic conditions and independently trace the diff against every ticket acceptance criterion for the fourth. It SHALL run `gh pr merge` only when all four hold, and SHALL escalate (verdict `ESCALATE`, or `BLOCKER` for environmental failures) without merging when any one fails, naming the specific reason. A failed or escalated attempt SHALL leave the PR open and the worktree unchanged.

#### Scenario: All four conditions hold
- **WHEN** `check-merge-readiness.sh` passes and the auditor traces every acceptance criterion to real code/behavior in the diff
- **THEN** the auditor merges the PR and returns verdict `MERGE`

#### Scenario: A deterministic condition fails
- **WHEN** `check-merge-readiness.sh` fails for any reason
- **THEN** the auditor does not merge, returns verdict `ESCALATE` naming that reason, and the PR remains open

#### Scenario: An acceptance criterion cannot be traced to the diff
- **WHEN** `check-merge-readiness.sh` passes but the auditor cannot trace one or more acceptance criteria to actual code/behavior in the diff
- **THEN** the auditor does not merge, returns verdict `ESCALATE` naming the untraceable criteria, and the PR remains open

#### Scenario: An environmental failure blocks verification
- **WHEN** `gh` is unauthenticated or the GitHub API is unreachable during the auditor's checks
- **THEN** the auditor does not merge and returns verdict `BLOCKER` rather than guessing `ESCALATE` or `MERGE`

#### Scenario: A merge attempt never partially completes
- **WHEN** the auditor invokes `gh pr merge`
- **THEN** it does so only after all four conditions have already been independently confirmed, so no run ever reaches a state where the PR is merged but the worktree/branch is left in a broken intermediate state, or vice versa

### Requirement: The auditor's verdict is recorded as durable evidence
The auditor SHALL write its findings to a report file, persist it via `persist-evidence.sh`, and emit a `verdict` event (`role=auditor`, `verdict=MERGE|ESCALATE|BLOCKER`) carrying the persisted `ref`, following the same durable-evidence discipline the skeptic already uses (no redundant separate `evidence` event for the same report).

#### Scenario: A MERGE verdict is traceable after cleanup
- **WHEN** the auditor merges a PR and the run's worktree is later removed by `cleanup.sh --phase4`
- **THEN** the event log's `verdict` event for `role=auditor` still has a `ref` that resolves to a readable report

#### Scenario: An ESCALATE verdict is likewise durable
- **WHEN** the auditor escalates instead of merging
- **THEN** the event log still contains a `role=auditor` `verdict` event with `verdict=ESCALATE` and a durable `ref` naming the failed condition(s)

### Requirement: Agent-merge is a config default with a per-run override, exposed identically everywhere a run is launched
Concertino SHALL support `agentMerge.enabled` (default `false`) and `agentMerge.mergeMethod` (default `squash`) as project config, and a per-run override that takes precedence over the config default when present. The override SHALL be exposed at three points: the `/concertino-deliver` slash command (`--agent-merge` / `--no-agent-merge`), the dashboard's `n` quick-launch prompt, and the launch plan screen — the launch plan SHALL display how the toggle resolved before the run launches.

#### Scenario: Config default applies with no override
- **WHEN** a run is launched with no `--agent-merge`/`--no-agent-merge` flag and no launch-plan/`n`-prompt override
- **THEN** the orchestrator resolves `AGENT_MERGE` from `agentMerge.enabled` in the project config

#### Scenario: A per-run override wins over the config default
- **WHEN** a run is launched with `--agent-merge` (or `--no-agent-merge`) explicitly
- **THEN** the orchestrator resolves `AGENT_MERGE` to that value regardless of the project config default

#### Scenario: The n prompt accepts the same override
- **WHEN** a ticket is typed into the dashboard's `n` prompt with a trailing `--agent-merge` or `--no-agent-merge` flag
- **THEN** the launched run resolves `AGENT_MERGE` from that flag, the same as if it had been passed to `/concertino-deliver` directly

#### Scenario: The launch plan shows the resolved value pre-flight
- **WHEN** the launch plan screen is showing a batch of tickets to launch
- **THEN** it displays whether agent-merge will run for this batch, before any run starts, and a key exists to toggle it

### Requirement: A disabled agent-merge run is unchanged from today's human-confirmation flow
When `AGENT_MERGE` resolves to `false` for a run, the orchestrator SHALL behave exactly as it did before this change: present the PR to the human after creation and wait for a "merged" confirmation before running Phase 4 cleanup. No new phase is introduced; agent-merge is a branch inside the existing Delivery→Cleanup boundary.

#### Scenario: Disabled runs never spawn the auditor
- **WHEN** `AGENT_MERGE` resolves to `false`
- **THEN** the orchestrator does not spawn the auditor and Phase 4 begins only after an explicit human merge confirmation, exactly as before this change

### Requirement: Merge and post-merge cleanup are both auditable events
When the auditor merges a PR, and when the orchestrator subsequently runs Phase 4 cleanup for that run, both SHALL be visible in the run's event log so a self-merged run is auditable after the fact without attaching to the session that ran it.

#### Scenario: A self-merged run's history shows the merge and the cleanup
- **WHEN** a run's `AGENT_MERGE` resolves to `true` and the auditor returns `MERGE`
- **THEN** the event log contains the auditor's `verdict=MERGE` event followed later by the existing `run.end status=delivered` event `cleanup.sh --phase4` already emits, with no gap in the record between "merged" and "cleaned up"

