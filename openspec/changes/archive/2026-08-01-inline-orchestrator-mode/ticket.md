# CON-49: concertino-deliver: --inline mode to run Orchestrator in the calling session (no subagent spawn)

## Description

`.claude/commands/concertino-deliver.md` always does the same thing regardless of what session invoked it: "Make a single `Agent` call with `subagent_type: concertino-orchestrator`." That's a deliberate cold-spawn for a reason — historically, `/concertino-deliver` was issued from one long-lived driver session running many tickets sequentially, and a cold orchestrator subagent kept each ticket's context isolated from the others.

That assumption no longer holds for one-off tickets. Tickets are now increasingly dispatched by starting a **fresh, dedicated session per ticket** (one tmux pane per ticket, e.g. this session for CON-30). That session is already cold-started for exactly one ticket — spawning a *further* `concertino-orchestrator` subagent from inside it buys no isolation it doesn't already have, while adding:

* an extra agent hop for every escalation/status relay (more surface for the exact class of bug in chain-of-command-stall — a background child finishes but the parent orchestrator's own turn never gets resumed to notice; fewer hops between the human and the agent actually driving Setup→Planning→Execution→Delivery means fewer places that resume-notification gap can occur),
* a full extra model context (today's default model map spawns the orchestrator as its own `sonnet` invocation on top of the calling session — pure overhead when the calling session could just *be* the orchestrator).

## Proposed change

Add a third independent trailing flag to `/concertino-deliver`, alongside the existing `--agent-merge`/`--no-agent-merge` and `fast`/`slow` tokens (each already parsed independently per `concertino-deliver.md`'s Arguments section): `--inline`.

* `--inline` **present:** the calling session does not spawn a `concertino-orchestrator` subagent. Instead it reads `.claude/agents/concertino-orchestrator.md` directly and carries out the Orchestrator role itself, in its own turn, for the given `TICKET_ID`/`AGENT_MERGE_OVERRIDE`/`SPEED` — spawning executor/evaluator/skeptic/auditor sub-agents directly rather than through an intermediary orchestrator.
* `--inline` **absent (default, unchanged):** today's behavior — spawn `concertino-orchestrator` as a cold subagent, exactly as now.

This is the one-off-ticket path. It's the counterpart to the future epic-driver mode (not yet designed/ticketed) where one driver session queues an entire epic's tickets and dispatches `/concertino-deliver <ticket>` **without** `--inline` per ticket — there, the driver persists across many tickets, so each still wants its own cold, isolated orchestrator subagent, same as today. `--inline` is additive, not a default-behavior change.

## Tool-scope question — MUST escalate to the human, do not self-approve

`concertino-orchestrator.md`'s frontmatter scopes it to a specific tool list (`Read, Write, Edit, Bash, Grep, Glob, Agent, SendMessage, TaskCreate/Update/Get/List, mcp__linear__*`). A raw interactive session invoking `--inline` inherits *its own* full tool set, which may be broader (e.g. `WebSearch`, `mcp__playwright__*`) than what the orchestrator role is meant to have access to.

This is likely an acceptable gap in practice, but **whoever plans this must raise it as a Planning `ESCALATION` to the human (Matt) rather than self-approving it** — do not silently decide either way. Present the concrete tool-set delta found for the harness in play and let the human decide whether `--inline` mode needs an explicit self-imposed guardrail ("even though broader tools are available, use only this list") written into the command's inline instructions, or whether the gap is acceptable as-is.

## Ground truth checked

* `.claude/commands/concertino-deliver.md`: current Arguments section, the single unconditional `Agent` call.
* `.claude/agents/concertino-orchestrator.md`: full role instructions (Setup→Planning→Execution/Evaluation→Delivery→Cleanup), its tool list, and the "Harness resume model" section — which already discusses top-level-session-vs-subagent behavior, so the role itself needs little to no change; this is about how the top-level session picks the role up.
* Precedent: CON-15 ("Orchestrator role must never end its turn waiting for a sub-agent") — same chain-of-command concern, already partially addressed at the role level; this ticket reduces the chain's *length* rather than hardening a single link.
