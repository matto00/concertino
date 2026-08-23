## ADDED Requirements

### Requirement: Sub-agent results are documented as return-value-only
The rendered `.claude/agents/concertino-orchestrator.md` (Claude Code) SHALL
state explicitly that the executor, evaluator, skeptic, and auditor have no
`SendMessage` tool and cannot address the orchestrator, and that a
sub-agent's result arrives only as the return value of the `Agent`/
`SendMessage` call that spawned or resumed it.

#### Scenario: Rendered orchestrator file states the no-inbound-channel fact
- **WHEN** `core/roles/orchestrator.md` is rendered for the `claude-code`
  harness via `concertino sync`
- **THEN** the rendered `.claude/agents/concertino-orchestrator.md` contains
  text stating sub-agents have no `SendMessage` tool and cannot address the
  orchestrator

### Requirement: Mandatory artifact-inspection fallback
The orchestrator role document SHALL instruct that whenever the orchestrator
is not already holding a sub-agent's return value at a phase boundary — not
only when the harness cannot wait inline — it must inspect the worktree
(report file, new commits, `workflow-state.md`) and report what it finds,
rather than ending its turn believing a message will arrive later.

#### Scenario: Fallback is not conditioned on harness inability alone
- **WHEN** the orchestrator role document's Phase 2 spawn/resume/final-gate
  steps are read
- **THEN** the artifact-inspection fallback is stated as applying whenever
  the orchestrator is not holding a result, in addition to the
  harness-cannot-wait-inline case

### Requirement: No new SendMessage-shaped instructions leak into Codex/OpenCode
Rendering `core/roles/orchestrator.md` for `codex` or `opencode` SHALL NOT
introduce new text that names `SendMessage` as a mechanism sub-agents use
against the orchestrator's default sequential single-thread path, and SHALL
NOT increase confusion by contradicting each harness's own `harnessResume`
block in the same rendered file.

#### Scenario: Codex/OpenCode renders gain no new SendMessage-named mechanics
- **WHEN** `core/roles/orchestrator.md` is rendered for `codex` and for
  `opencode` via `concertino sync`, before and after this change
- **THEN** no new occurrence of `SendMessage` naming a mechanism sub-agents
  use to reach the orchestrator is introduced into either rendered file's
  shared (non-harness-specific) prose
