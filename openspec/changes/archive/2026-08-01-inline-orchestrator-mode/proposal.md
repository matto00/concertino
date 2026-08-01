## Why

`/concertino-deliver` always spawns `concertino-orchestrator` as a cold subagent, even when the calling session was itself started fresh for exactly one ticket (the increasingly common one-tmux-pane-per-ticket pattern). In that case the extra subagent hop buys no context isolation the calling session doesn't already have, while adding an extra escalation/status relay hop (more surface for the chain-of-command-stall class of bug — CON-15) and a full extra model context for no benefit.

## What Changes

- Add a third independent trailing flag to `/concertino-deliver`, parsed the same way as the existing `--agent-merge`/`--no-agent-merge` and `fast`/`slow` tokens: `--inline`.
- `--inline` present: the calling session does not spawn a `concertino-orchestrator` subagent. It reads `.claude/agents/concertino-orchestrator.md` directly and carries out the Orchestrator role itself, in its own turn, for the given `TICKET_ID`/`AGENT_MERGE_OVERRIDE`/`SPEED` — spawning executor/evaluator/skeptic/auditor sub-agents directly.
- `--inline` absent (default): unchanged — spawn `concertino-orchestrator` as a cold subagent, exactly as today.
- Document, in the rendered command file, the tool-scope gap this mode introduces (a raw interactive session inherits its own full tool set, not the orchestrator role's frontmatter-scoped list) and the explicit self-imposed guardrail the human (Matt) has approved for it (see Impact/Escalation below).
- Codex: `--inline` is accepted and parsed identically, but Codex's orchestration is already always sequential/inline in a single thread (no subagent spawn primitive per `core/roles/orchestrator.md`'s "Per-spawn model overrides" section) — so for Codex, `--inline` is a documented no-op: the flag is recognized (not an error) but changes nothing about how Codex already runs `/concertino-deliver`.

## Capabilities

### New Capabilities
- `inline-orchestrator-mode`: the `--inline` flag on `/concertino-deliver` (Claude Code), what the calling session does instead of spawning `concertino-orchestrator`, the self-imposed tool-scope guardrail, and Codex's no-op handling of the same flag.

### Modified Capabilities
(none — `core/roles/orchestrator.md`'s own instructions are unchanged; `orchestrator-turn-discipline` already covers the top-level-vs-sub-agent turn distinction this mode relies on, and continues to apply unmodified whether the role is read by a spawned subagent or carried out inline by the calling session.)

## Impact

- `adapters/claude-code/command.md` (source template for `.claude/commands/concertino-deliver.md`): add `--inline` parsing and the inline-execution branch, plus the self-imposed tool-scope guardrail text.
- `adapters/codex/prompt.md` (source template for `.codex/prompts/concertino-deliver.md`): document `--inline` as an accepted, no-op flag for Codex, with a one-line pointer to why (Codex has no subagent-spawn primitive to skip).
- No changes to `core/roles/orchestrator.md`, `bin/concertino`'s sync logic, `adapters/claude-code/agents.json`, or any script under `scripts/concertino/` — this is purely a change to what the *calling* session does before/instead of the `Agent` call; the Orchestrator role's own instructions are read and followed identically either way.
- **Escalation resolved during planning:** the tool-scope gap (raw interactive session inherits a broader tool set than `concertino-orchestrator`'s frontmatter list) is real but accepted as-is for this change, with one guardrail: the rendered command file's inline-mode branch must explicitly instruct the session to use only the orchestrator role's tool list (`Read, Write, Edit, Bash, Grep, Glob, Agent, SendMessage, TaskCreate/Update/Get/List, mcp__linear__*`/configured ticket-provider tools) even though broader tools remain available to it. See `design.md` for the exact wording placement.
