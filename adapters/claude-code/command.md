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

- **If the result is an `ESCALATION-PENDING` payload (CON-76)** — rather than a
  normal pause or completion — the orchestrator subagent has bubbled a raised
  escalation instead of blocking its own turn on it (see
  `core/roles/orchestrator.md`'s "How to raise one" and "Receiving a bubbled
  escalation" sections, and the `escalation-bubble-up` capability). You are the
  root: follow that same procedure yourself, in this turn, rather than treating
  the return as a normal pause:
  1. Present the question/options/context in your own chat transcript
     immediately, before doing anything else — if the escalation is one you
     already saw presented in this same payload, this is that same
     presentation, not a second one.
  2. Re-check TUI liveness fresh, right here, before polling — never reuse
     whatever `TUI_ATTACHED` value (if any) was observed when the escalation
     was raised, since a dashboard can attach or detach between raise and
     resolution (CON-126, `escalation-bubble-up`'s resolution-loop
     requirement):

     ```bash
     if scripts/concertino/tui-attached.sh; then
       scripts/concertino/emit-event.sh escalation --wait-only max_wait_sec=30 ticket=<id>
     fi
     ```

     - **TUI attached (`tui-attached.sh` exits 0):** poll for a dashboard
       answer with repeated short `--wait-only` calls as above, looping on
       exit 2, stopping on exit 0 (resolved) or exit 1 (the escalation's real
       deadline reached — handle exactly like a normal `--await` timeout:
       never an approval, keep waiting in chat for a reply). Between calls,
       remain able to accept a direct chat reply.
     - **TUI not attached (`tui-attached.sh` exits non-zero):** skip the
       `--wait-only` polling loop entirely — there is nothing on the
       dashboard side that could resolve it — and wait directly for the
       human's reply in chat instead. A timeout is never an approval; since
       this branch never polls against a deadline, there is no elapsed-time
       condition to mistake for one either.
  3. The moment the human replies in chat, write it through `concertino answer
     <ticket> <value> [--sub <index> --total <n>]` rather than acting on it
     directly, and branch on its result exactly as `core/roles/orchestrator.md`
     describes: refused (report which channel won, keep polling), resolving
     (proceed to step 4), or a non-resolving partial multi-part sub-answer
     (keep polling for the rest, do not proceed to step 4 yet).
  4. Once resolved (by either channel), **SendMessage** the same waiting
     `concertino-orchestrator` agent with the question, the answer, which
     channel resolved it, and the timestamp, and wait for its next result
     within this same turn before proceeding — this is an ordinary warm
     resume, not a further bubble, and does not restart the workflow.
  5. **Fallback when `SendMessage` is unavailable:** re-spawn
     `concertino-orchestrator` with a prompt beginning `TICKET_ID=<id>. RESUME —
     do not start over`, pointing it at `workflow-state.md` (its
     `PENDING_ESCALATION` field holds the still-open question) plus the
     resolution you were just given, so it continues without re-raising the
     same question.
- Relay any other `ESCALATION` / `BLOCKER` to the human and collect their answer.
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
sending or re-spawning anything. Per the `inline-orchestrator-mode` capability
(CON-76), this session never receives — and never needs to handle — an
`ESCALATION-PENDING` payload: there is no subagent hop to bubble across, so you
always present to chat and call `--await` directly, exactly as
`core/roles/orchestrator.md`'s "How to raise one" describes for the root branch.
The `ESCALATION-PENDING` handling above applies only to the default (non-inline)
branch.
