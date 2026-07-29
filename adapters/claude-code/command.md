---
description: Drive the {{project}} ticket-delivery workflow end-to-end for a ticket (Concertino orchestrator).
---

Spawn the `concertino-orchestrator` agent to drive the end-to-end ticket-delivery
workflow for the ticket referenced in `$ARGUMENTS`.

## Arguments

`$ARGUMENTS` contains a ticket id (e.g. `{{idExample}}`), optionally followed by
a trailing `--agent-merge` or `--no-agent-merge` flag (e.g.
`{{idExample}} --agent-merge`). Extract the ticket id and, if present, the
flag. If neither flag is present, the override is "unset" — the orchestrator
falls back to the project's `agentMerge.enabled` config default.

## What to do

Make a single `Agent` call with `subagent_type: concertino-orchestrator`. Prompt:

> TICKET_ID=`<extracted-id>`. AGENT_MERGE_OVERRIDE=`<true|false|unset>`. Run the
> full ticket-delivery workflow end-to-end: Setup → Planning →
> Execution/Evaluation loop → Delivery → Post-merge cleanup. Surface any
> `ESCALATION`, `BLOCKER`, or final PR presentation back to me.

When the orchestrator returns:

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
