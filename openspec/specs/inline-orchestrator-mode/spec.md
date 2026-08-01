# inline-orchestrator-mode Specification

## Purpose
Defines the `--inline` flag on `/concertino-deliver`: how it's parsed as a third independent trailing token, what it makes the calling Claude Code session do instead of spawning a `concertino-orchestrator` subagent, the human-approved tool-scope guardrail it carries, and why it's a documented no-op under Codex.
## Requirements
### Requirement: `/concertino-deliver` accepts an independent `--inline` trailing token
`adapters/claude-code/command.md` (and its rendered `.claude/commands/concertino-deliver.md`) SHALL parse an optional trailing `--inline` token from `$ARGUMENTS`, independently of the existing `--agent-merge`/`--no-agent-merge` flag and the existing `fast`/`slow` speed token — each is its own independently optional trailing token, matching the existing parsing model documented in the Arguments section.

#### Scenario: `--inline` present
- **WHEN** `$ARGUMENTS` is `CON-1 --inline`
- **THEN** the ticket id is extracted as `CON-1` and inline mode is active for this invocation

#### Scenario: `--inline` absent
- **WHEN** `$ARGUMENTS` is `CON-1` (no `--inline` token)
- **THEN** inline mode is not active; behavior is unchanged from before this change

#### Scenario: `--inline` combined with the other independent tokens
- **WHEN** `$ARGUMENTS` is `CON-1 --agent-merge fast --inline` (order-independent, each token extracted separately)
- **THEN** the ticket id, the agent-merge override, the speed token, and inline mode are each extracted independently, with no interaction between them

### Requirement: `--inline` present skips the `concertino-orchestrator` subagent spawn
When `--inline` is present, the calling Claude Code session SHALL NOT make an `Agent` call with `subagent_type: concertino-orchestrator`. Instead it SHALL read `.claude/agents/concertino-orchestrator.md` directly and carry out the Orchestrator role itself, in its own turn, for the given `TICKET_ID`/`AGENT_MERGE_OVERRIDE`/`SPEED` — driving Setup → Planning → Execution/Evaluation → Delivery → Post-merge cleanup, and spawning the executor/evaluator/skeptic/auditor sub-agents directly exactly as `concertino-orchestrator` would.

#### Scenario: Inline session drives the full workflow itself
- **WHEN** `--inline` is present and the ticket-delivery workflow is run
- **THEN** the calling session itself performs every phase (Setup, Planning, Execution/Evaluation, Delivery, Cleanup) and spawns executor/evaluator/skeptic/auditor sub-agents directly, with no intermediary `concertino-orchestrator` subagent in the chain

#### Scenario: Escalations and pauses are handled directly, without a relay hop
- **WHEN** inline mode is active and the workflow reaches an `ESCALATION`, a `BLOCKER`, or a pause awaiting a human "merged" confirmation
- **THEN** the calling session surfaces it directly to the human and waits for the answer in its own turn, without relaying through or resuming a separate `concertino-orchestrator` subagent (there is none)

### Requirement: `--inline` absent preserves today's cold-spawn behavior unchanged
When `--inline` is not present, `/concertino-deliver` SHALL behave exactly as before this change: make a single `Agent` call with `subagent_type: concertino-orchestrator`, and relay `ESCALATION`/`BLOCKER`/pause-for-"merged" between the human and that subagent.

#### Scenario: Default behavior is a no-op change
- **WHEN** `/concertino-deliver` is invoked without `--inline`
- **THEN** the calling session spawns `concertino-orchestrator` as a cold subagent and relays escalations/pauses exactly as it did before this change existed

### Requirement: Inline mode instructs the session to self-limit to the orchestrator role's tool list
Because a raw interactive Claude Code session invoking `--inline` inherits its own full tool set — which may be broader than `concertino-orchestrator`'s frontmatter-scoped tool list (`Read, Write, Edit, Bash, Grep, Glob, Agent, SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList`, plus the configured ticket-provider MCP tools) — the rendered inline-mode instructions in `.claude/commands/concertino-deliver.md` SHALL explicitly tell the session to use only that tool list while carrying out the orchestrator role, even though broader tools remain available to it.

#### Scenario: Inline-mode instructions name the guardrail explicitly
- **WHEN** a reader reaches the inline-mode branch of the rendered `/concertino-deliver` command
- **THEN** it explicitly states the orchestrator role's allowed tool list and instructs the session to use only those tools for the duration of the inline-driven workflow, even though the session's own broader tool set remains technically available

### Requirement: Codex accepts `--inline` as a documented no-op
`adapters/codex/prompt.md` (and its rendered `.codex/prompts/concertino-deliver.md`) SHALL document that `--inline` is accepted but has no effect under Codex, because Codex's orchestration is already sequential and inline in a single thread with no subagent-spawn primitive to skip.

#### Scenario: Codex session invoked with `--inline`
- **WHEN** a Codex session is invoked with `--inline` present in the arguments
- **THEN** the workflow proceeds exactly as it would without the flag, and the documentation explains why the flag is a no-op in this harness rather than leaving its absence unexplained

