---
description: Drive the {{project}} ticket-delivery workflow end-to-end for a ticket (Concertino orchestrator).
---

Spawn the `concertino-orchestrator` agent to drive the end-to-end ticket-delivery
workflow for the ticket referenced in `$ARGUMENTS`.

## Arguments

`$ARGUMENTS` contains a ticket id (e.g. `{{idExample}}`), optionally followed by
a trailing `--agent-merge` or `--no-agent-merge` flag (e.g.
`{{idExample}} --agent-merge`), independently, optionally followed by a
trailing `fast` or `slow` speed token (e.g. `{{idExample}} fast`) — a
per-run trade of rigour against turnaround (see `core/roles/orchestrator.md`'s
`SPEED` input) — and independently, optionally followed by a trailing `--inline`
flag (e.g. `{{idExample}} --inline`). Extract the ticket id and, if present,
the flag, the speed token, and/or `--inline` — this ships speed-only,
agent-merge-only, or inline-only parsing (not yet combined in one invocation;
each is its own independent trailing token, extracted separately). If neither
agent-merge flag is present, the override is "unset" — the orchestrator falls
back to the project's `agentMerge.enabled` config default. If no speed token
is present, `SPEED` is "unset" — the orchestrator resolves it to `default`.
If `--inline` is absent, inline mode is not active.

## What to do

**If `--inline` is absent (default):**

Make a single `Agent` call with `subagent_type: concertino-orchestrator`. Prompt:

> TICKET_ID=`<extracted-id>`. AGENT_MERGE_OVERRIDE=`<true|false|unset>`.
> SPEED=`<fast|slow|unset>`. Run the full ticket-delivery workflow end-to-end:
> Setup → Planning → Execution/Evaluation loop → Delivery → Post-merge
> cleanup. Surface any `ESCALATION`, `BLOCKER`, or final PR presentation back
> to me.

**If `--inline` is present:**

Do not make an `Agent` call with `subagent_type: concertino-orchestrator`. Instead,
read `.claude/agents/concertino-orchestrator.md` directly, in this turn, and carry
out the Orchestrator role yourself for TICKET_ID=`<extracted-id>`,
AGENT_MERGE_OVERRIDE=`<true|false|unset>`, SPEED=`<fast|slow|unset>` — driving
Setup → Planning → Execution/Evaluation loop → Delivery → Post-merge cleanup in
your own turn, and spawning the executor/evaluator/skeptic/auditor sub-agents
directly (via `Agent`/`SendMessage`) exactly as `concertino-orchestrator` would.
This is the one-off-ticket path: a session already started fresh for exactly one
ticket gains nothing from a further cold orchestrator subagent hop, so it plays
the role itself instead of relaying to/from one.

**Tool-scope guardrail (inline mode only):** this session's own tool set may be
broader than `concertino-orchestrator`'s. While carrying out the orchestrator role
inline, use **only** that role's allowed tools — `Read`, `Write`, `Edit`, `Bash`,
`Grep`, `Glob`, `Agent`, `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskGet`,
`TaskList`, plus the configured ticket-provider MCP tools (e.g. `mcp__linear__*` /
`mcp__github__*`) — even though broader tools (e.g. `WebSearch`,
`mcp__playwright__*`) remain technically available to you. Do not reach for a tool
outside this list while driving the workflow, regardless of what else is in your
toolbox for this session.

## When the orchestrator returns

**If `--inline` is absent (default):**

- Relay any `ESCALATION` / `BLOCKER` to the human and collect their answer.
- If it pauses awaiting input (e.g. after PR creation, before cleanup), wait for the
  human's "merged" confirmation, then **SendMessage** the same orchestrator to
  continue — do not re-spawn. It keeps state in `workflow-state.md` and resumes from
  any phase. (When agent-merge resolved `true` for this run and the auditor
  returned `MERGE`, the orchestrator proceeds straight into cleanup instead of
  pausing here — nothing further to relay for that step.)
- **Fallback when `SendMessage` is unavailable:** re-spawn `concertino-orchestrator`
  with a prompt beginning `TICKET_ID=<id>. RESUME — do not start over`, telling it
  which phase was reached and to read `workflow-state.md` first. State is persisted,
  so this resumes rather than restarts — never re-implement or re-deliver completed work.

Do not implement, plan, or evaluate yourself — that is the orchestrator's job. Your
role is the seam between the user and the orchestrator agent.

**If `--inline` is present:** there is no separate subagent to relay to or from —
you *are* the orchestrator for this run. Surface any `ESCALATION`, `BLOCKER`, or
pause awaiting a "merged" confirmation directly to the human, in your own turn,
and continue the workflow yourself once you have their answer (still driving your
own spawned executor/evaluator/skeptic/auditor sub-agents as needed) rather than
sending or re-spawning anything.
