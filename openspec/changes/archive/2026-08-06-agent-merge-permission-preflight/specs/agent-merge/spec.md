## ADDED Requirements

### Requirement: `concertino sync` maintains the Claude Code permission grant agent-merge needs

`concertino sync` SHALL, when `agentMerge.enabled` is `true` and `claude-code` is in the project's `harnesses`, additively merge the two allow rules `Bash(gh pr merge:*)` and `Task(concertino-auditor)` into `<project>/.claude/settings.json`'s `permissions.allow` array, creating the file (and its `permissions`/`permissions.allow` structure) if absent, preserving every other existing key and array entry in the file untouched. When `agentMerge.enabled` is `false`, `sync` SHALL NOT modify `.claude/settings.json` at all — including not removing rules a previous sync with `agentMerge.enabled: true` added.

#### Scenario: Sync adds the grant to a project with no settings.json
- **WHEN** `concertino sync` runs for a project with `agentMerge.enabled: true`
  and `claude-code` in `harnesses`, and no `.claude/settings.json` exists yet
- **THEN** `.claude/settings.json` is created containing
  `permissions.allow` with both `Bash(gh pr merge:*)` and
  `Task(concertino-auditor)`

#### Scenario: Sync preserves existing settings.json content
- **WHEN** `concertino sync` runs for a project with `agentMerge.enabled: true`
  and an existing `.claude/settings.json` that already has its own
  `permissions.allow`/`permissions.deny` entries and unrelated top-level keys
- **THEN** every pre-existing key and array entry is preserved unchanged, and
  only the two required rules are added to `permissions.allow` if not already
  present

#### Scenario: Sync is a no-op on settings.json when agent-merge is disabled
- **WHEN** `concertino sync` runs for a project with `agentMerge.enabled: false`
  (the default)
- **THEN** `.claude/settings.json` is not created, read, or modified by this
  behavior

#### Scenario: A previously-added grant survives agent-merge being turned back off
- **WHEN** a project had `agentMerge.enabled: true` at a prior sync (grant
  added) and is now synced again with `agentMerge.enabled: false`
- **THEN** the previously-added allow rules remain in `.claude/settings.json`
  untouched — `sync` never removes them

### Requirement: `check-agent-merge-permission.sh` deterministically checks the grant

`scripts/concertino/check-agent-merge-permission.sh <WORKTREE_PATH>` SHALL
resolve the main checkout from `<WORKTREE_PATH>` the same way
`check-merge-readiness.sh` already does (`git rev-parse --git-common-dir`),
then check whether `<main_checkout>/.claude/settings.json` exists, is valid
JSON, and its `permissions.allow` array contains both `Bash(gh pr merge:*)`
and `Task(concertino-auditor)` — never reading
`<WORKTREE_PATH>/.claude/settings.json` directly, since a worktree has no
copy of this gitignored file. It SHALL print `PASS` and exit 0 only when all
of that holds, and `FAIL <reason>` (one line per missing rule, or a
main-checkout-resolution failure, to stderr) with a non-zero exit otherwise,
following the same stdout/stderr contract as `assert-phase.sh` and
`check-merge-readiness.sh`.

#### Scenario: Both rules present, checked from a worktree
- **WHEN** invoked with a worktree path whose main checkout's
  `.claude/settings.json` exists and its `permissions.allow` array contains
  both required rules
- **THEN** the script prints `PASS` and exits 0, even though the worktree
  itself has no `.claude/settings.json`

#### Scenario: One rule missing
- **WHEN** the main checkout's `.claude/settings.json` exists but
  `permissions.allow` contains only one of the two required rules
- **THEN** the script fails with a reason naming the specific missing rule,
  not a generic "not authorized" message

#### Scenario: settings.json missing entirely
- **WHEN** the main checkout has no `.claude/settings.json`
- **THEN** the script fails with a reason stating no settings file was found,
  rather than passing by default

#### Scenario: settings.json is not valid JSON
- **WHEN** the main checkout's `.claude/settings.json` exists but cannot be
  parsed as JSON
- **THEN** the script fails with a reason naming the parse failure, rather
  than passing by default

#### Scenario: Main checkout cannot be resolved
- **WHEN** `<WORKTREE_PATH>` is not inside a git working tree at all
- **THEN** the script fails with a reason stating the main checkout could
  not be resolved, rather than passing by default

### Requirement: doctor and validate warn on an agent-merge/permission-grant mismatch

`concertino doctor` and `concertino validate` SHALL warn, in a dedicated
"Agent-merge" section, when `agentMerge.enabled` is `true` and `claude-code`
is in the project's `harnesses`, but
`scripts/concertino/check-agent-merge-permission.sh` reports `FAIL` against
the project root — naming the specific missing rule(s) and stating that
`concertino sync` will add them. This section SHALL be a silent no-op when
`agentMerge.enabled` is `false`, or `claude-code` is not among the project's
configured harnesses.

#### Scenario: Warns on a missing grant
- **WHEN** `agentMerge.enabled` is `true`, `claude-code` is in `harnesses`,
  and `check-agent-merge-permission.sh` reports `FAIL`
- **THEN** `concertino doctor` (and `concertino validate`) print a warning
  naming the specific missing rule(s) and suggesting `concertino sync`

#### Scenario: Silent when agent-merge is disabled
- **WHEN** `agentMerge.enabled` is `false`
- **THEN** neither `concertino doctor` nor `concertino validate` run or
  report this check

#### Scenario: Silent when claude-code is not a configured harness
- **WHEN** `agentMerge.enabled` is `true` but `claude-code` is not in
  `harnesses`
- **THEN** neither `concertino doctor` nor `concertino validate` run or
  report this check

#### Scenario: No warning once the grant is present
- **WHEN** `agentMerge.enabled` is `true`, `claude-code` is in `harnesses`,
  and `check-agent-merge-permission.sh` reports `PASS`
- **THEN** the Agent-merge section reports success, with no warning

### Requirement: The orchestrator checks the permission grant before spawning the auditor

The orchestrator SHALL, when `AGENT_MERGE` resolves `true` for a run and the run's resolved harness is `claude-code`, run `scripts/concertino/check-agent-merge-permission.sh` against the run's worktree immediately before spawning the auditor, in Phase 3 Delivery. On
`PASS`, it SHALL proceed to spawn the auditor exactly as it did before this
change — no added step or cost on the already-working path. On `FAIL`, it
SHALL NOT attempt the auditor spawn; instead it SHALL raise one escalation
naming the missing rule(s) verbatim, with options to retry (after the human
runs `concertino sync` or edits the grant by hand) or fall back to the
existing `AGENT_MERGE = false` human-confirmation flow for this run. On any
harness other than `claude-code`, this check SHALL be a no-op and the
orchestrator SHALL proceed exactly as before this change.

#### Scenario: Grant present — no behavior change
- **WHEN** `AGENT_MERGE` resolves `true`, the run's harness is `claude-code`,
  and the permission-grant check reports `PASS`
- **THEN** the orchestrator spawns the auditor exactly as before this change

#### Scenario: Grant missing — ask before spawning, not after a denial
- **WHEN** `AGENT_MERGE` resolves `true`, the run's harness is `claude-code`,
  and the permission-grant check reports `FAIL`
- **THEN** the orchestrator does not attempt the auditor spawn, and instead
  raises one escalation naming the missing rule(s) and offering to retry
  (after the human grants it) or fall back to the manual-confirmation flow

#### Scenario: Retry after the human grants permission
- **WHEN** the human answers the escalation above with "retry" after running
  `concertino sync`
- **THEN** the orchestrator re-runs the permission-grant check and, on
  `PASS`, proceeds to spawn the auditor

#### Scenario: Fallback preserves the existing manual-confirmation flow
- **WHEN** the human answers the escalation above with "fallback"
- **THEN** the orchestrator proceeds exactly as the existing
  `AGENT_MERGE = false` path does — presents the PR and waits for a manual
  "merged" confirmation before Phase 4

#### Scenario: No-op on a non-claude-code harness
- **WHEN** `AGENT_MERGE` resolves `true` but the run's resolved harness is
  not `claude-code`
- **THEN** the orchestrator does not run this check and proceeds to spawn the
  auditor exactly as it did before this change

## MODIFIED Requirements

### Requirement: A disabled agent-merge run is unchanged from today's human-confirmation flow

When `AGENT_MERGE` resolves to `false` for a run, the orchestrator SHALL
behave exactly as it did before this change: present the PR to the human
after creation and wait for a "merged" confirmation before running Phase 4
cleanup. No new phase is introduced; agent-merge is a branch inside the
existing Delivery→Cleanup boundary. This path SHALL remain reachable both
when `AGENT_MERGE` resolves `false` from the start of a run, and when a
`true`-resolved run's permission-grant pre-check fails and the human chooses
the "fallback" option instead of retrying.

#### Scenario: Disabled runs never spawn the auditor
- **WHEN** `AGENT_MERGE` resolves to `false`
- **THEN** the orchestrator does not spawn the auditor and Phase 4 begins only
  after an explicit human merge confirmation, exactly as before this change

#### Scenario: A permission-grant fallback lands on the identical flow
- **WHEN** `AGENT_MERGE` resolved `true` for a run but the human chose
  "fallback" in response to a missing-permission-grant escalation
- **THEN** the rest of the run proceeds identically to a run where
  `AGENT_MERGE` resolved `false` from Setup — presenting the PR and waiting
  for a manual "merged" confirmation before Phase 4, with no auditor spawn
