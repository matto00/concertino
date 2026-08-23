## MODIFIED Requirements

### Requirement: Sub-agent results are documented as return-value-only
The rendered `.claude/agents/concertino-orchestrator.md` (Claude Code) SHALL state that a
sub-agent's authoritative result is delivered only as the return value of the `Agent`/
`SendMessage` call that spawned or resumed it — this remains true even though, as of the
`subagent-escalation-raise` capability, executor/evaluator/skeptic/auditor now hold a
`SendMessage` tool. It SHALL state precisely why the addition of that tool does not change the
core fact: the orchestrator's `Agent()`/`SendMessage` call to a sub-agent is a single blocking
call that does not return until the sub-agent's own turn has ended, so any message a sub-agent
sends before returning cannot be observed by the orchestrator until that same call returns anyway
— a `SendMessage` self-notify (per `subagent-escalation-raise`) is therefore a durable,
independently-timestamped record of a raise, never a way for the orchestrator to react to a
sub-agent mid-turn, before its return value is in hand.

#### Scenario: Rendered orchestrator file states the narrowed fact
- **WHEN** `core/roles/orchestrator.md` is rendered for the `claude-code` harness via
  `concertino sync`
- **THEN** the rendered `.claude/agents/concertino-orchestrator.md` states that a sub-agent's
  authoritative result is still only the return value of the call that spawned/resumed it, and
  explains that a sub-agent's own `SendMessage` self-notify cannot be observed before that same
  call returns

#### Scenario: The rendered file does not claim sub-agents have no SendMessage tool
- **WHEN** the rendered `.claude/agents/concertino-orchestrator.md` (claude-code) is read
- **THEN** it does not state that executor/evaluator/skeptic/auditor have no `SendMessage` tool
  (that claim is now false) — it instead states the narrower, still-true fact above

### Requirement: No new SendMessage-shaped instructions leak into Codex/OpenCode
Rendering any of `core/roles/{orchestrator,executor,evaluator,skeptic,auditor}.md` for `codex` or `opencode` SHALL NOT introduce new text naming `SendMessage`, and SHALL NOT increase confusion by
contradicting each harness's own `harnessResume` block in the same rendered file. This
requirement now also covers the four sub-agent role files (previously only the orchestrator file
was in scope), since `subagent-escalation-raise` adds new shared-prose sections to all of them.

#### Scenario: Codex/OpenCode renders show no new SendMessage occurrences
- **WHEN** `core/roles/{orchestrator,executor,evaluator,skeptic,auditor}.md` are rendered for
  `codex` and for `opencode`, before and after this change
- **THEN** the count of `SendMessage` occurrences in each rendered file is unchanged
