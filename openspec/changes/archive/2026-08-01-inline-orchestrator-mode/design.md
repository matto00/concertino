## Context

`.claude/commands/concertino-deliver.md` is rendered from `adapters/claude-code/command.md` by `concertino sync` (`bin/concertino`'s `emitClaude`). Today it unconditionally makes one `Agent` call with `subagent_type: concertino-orchestrator`, then relays `ESCALATION`/`BLOCKER` and any "wait for merged, then SendMessage to resume" pause back and forth between the human and that subagent.

`core/roles/orchestrator.md` already distinguishes top-level-session-vs-sub-agent behavior throughout ("Harness resume model", every spawn/resume instruction) — that distinction is about *whether the orchestrator itself is the top-level session*, which is exactly what `--inline` controls. The role's own instructions do not need to change; only how the calling session picks the role up does.

Constraint from Planning escalation (human-decided, `add_guardrail`): inline mode's rendered instructions must explicitly tell the session to use only the orchestrator role's tool list, even though the raw interactive session's own tool set may be broader.

Codex has no subagent-spawn primitive at all (`core/roles/orchestrator.md`'s "Per-spawn model overrides" section: "orchestration is sequential in a single thread"). `.codex/prompts/concertino-deliver.md` (rendered from `adapters/codex/prompt.md`) already has the orchestrator role's full instructions inlined into `AGENTS.md` and followed directly by the one Codex session — there is no separate "spawn a subagent" step to skip.

## Goals / Non-Goals

**Goals:**
- Add `--inline` as a third independent trailing token on `/concertino-deliver`, parsed the same way as `--agent-merge`/`--no-agent-merge` and `fast`/`slow` (each its own independent flag; not yet combinable into one parse pass, matching existing precedent).
- When present (Claude Code): the calling session reads `.claude/agents/concertino-orchestrator.md` itself and carries out Setup→Planning→Execution/Evaluation→Delivery→Cleanup in its own turn, spawning executor/evaluator/skeptic/auditor sub-agents directly via `Agent`/`SendMessage` exactly as `concertino-orchestrator` would.
- Bake in the human-approved tool-scope guardrail as explicit inline-mode instruction text.
- When absent (default): zero behavior change from today.
- Codex: accept and no-op the flag, with a one-line documented reason.

**Non-Goals:**
- No change to `core/roles/orchestrator.md` or any other role file — the role's instructions are read identically whether reached via subagent spawn or inline.
- No change to `bin/concertino`'s frontmatter/tool-composition logic (`adapters/claude-code/agents.json`) — the guardrail is instructional text in the rendered command file, not a mechanism that revokes tools the harness has already granted the session (no such revocation mechanism exists to call).
- No new escalation-relay code path — inline mode removes the relay hop entirely (the session *is* the orchestrator), it does not add a second one.
- Epic-driver mode (queueing many tickets, dispatching `/concertino-deliver` per ticket without `--inline`) is out of scope — not yet designed/ticketed, per the ticket's own note.

## Decisions

### Decision 1: `--inline` is parsed and documented as a third independent trailing token, alongside the existing two
Mirrors the existing `Arguments` section pattern exactly (each flag its own independent extraction, not combined parsing). Avoids inventing a new combined-flag grammar for this one addition — the existing two tokens already establish "trailing tokens, each independently optional" as the command's parsing model.

**Alternatives considered:** a combined flag grammar (e.g. `--inline --agent-merge fast` order-independent parsing rules written once) — rejected: bigger surface change than this ticket needs, and the existing text for the other two flags already tells the reader to extract each independently, so a third slots in the same way with no new prose pattern required.

### Decision 2: Inline branch's guardrail text goes directly in `adapters/claude-code/command.md`'s "What to do" section, as its own labeled subsection
The guardrail must be read by the session *carrying out* the orchestrator role — i.e., it must live in the file that session reads at the moment it decides to go inline, not in `core/roles/orchestrator.md` (which is read identically by a spawned subagent and by an inline session, and is not the file that determines which mode is active). Placing it in `command.md` keeps the guardrail colocated with the branch condition that makes it apply, and keeps `core/roles/orchestrator.md` — the harness-agnostic role definition also rendered for Codex — free of Claude-Code-only tool-scoping language that would be meaningless in Codex's single-thread execution model.

**Alternatives considered:** adding a `## Tool scope (inline mode)` section to `core/roles/orchestrator.md` itself — rejected per the reasoning above (wrong file: not read differentially by mode, and would leak a Claude-Code-specific concern into the Codex-shared role text).

### Decision 3: Codex's `--inline` handling is a documented no-op, not a rejected/unparsed flag
Per Context: Codex has no subagent-spawn step to skip, so making `--inline` an error would penalize a human who habitually types it (e.g. copy-pasting a Claude Code invocation into a Codex session) for no reason — the flag is simply irrelevant there. `adapters/codex/prompt.md` gets one sentence: `--inline` is accepted and has no effect, because Codex already runs the orchestrator role directly in this session.

**Alternatives considered:** silently ignoring the flag with no documentation — rejected: a future reader diffing Claude Code's and Codex's argument-handling would have no way to tell "not yet implemented" from "intentionally irrelevant" without this line.

## Risks / Trade-offs

- [Risk] The guardrail is instructional text, not an enforced mechanism — an inline session could still reach for a broader tool (e.g. `WebSearch`) if it judged it useful, same as any other harness instruction that relies on the model following it. → Mitigation: this is the explicit trade-off the human accepted (`add_guardrail`, not "revoke tools" — no such revocation mechanism exists to build). The guardrail text names the exact allowed list from `adapters/claude-code/agents.json`'s orchestrator role so there is no ambiguity about what "the orchestrator's tool list" means.
- [Risk] Drift between the guardrail's hardcoded tool list (written into `command.md`'s static text) and `agents.json`'s `orchestrator.baseTools` (+ configured `mcpTools`) if the latter changes later without updating the former. → Mitigation: keep the guardrail text scoped to naming the *categories* already stated in the ticket/proposal (`Read, Write, Edit, Bash, Grep, Glob, Agent, SendMessage, TaskCreate/Update/Get/List, mcp__linear__*`/configured ticket-provider tools) rather than re-deriving it at sync time — this is the same static-text tradeoff the rest of `command.md` already accepts for its Arguments prose (also not sync-time-generated from `agents.json`). A future ticket could template this from `agents.json` if drift becomes a real problem; not needed for this change.
- [Risk] A human running `--inline` from a session that is *not* actually a fresh, dedicated single-ticket session (e.g. a long-lived driver session that also happens to type `--inline` out of habit) loses the context isolation the default cold-spawn provides. → Mitigation: this is explicitly the human's call to make per invocation (documented in the command's Arguments prose as "the one-off-ticket path"); not a case this change can detect or prevent, and the default (no `--inline`) remains unchanged for the epic-driver use case.

## Migration Plan

Purely additive — no existing behavior changes when `--inline` is absent. Ship as one change: update `adapters/claude-code/command.md` and `adapters/codex/prompt.md`, run `concertino sync` (already part of this project's own dev loop) to re-render `.claude/commands/concertino-deliver.md` / `.codex/prompts/concertino-deliver.md`. No rollback concerns beyond reverting the two adapter template edits and re-syncing.
