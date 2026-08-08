---
description: Audit a FAILED {{project}} run and resume/re-drive delivery to a fix (Concertino orchestrator).
---

Spawn the `concertino-orchestrator` agent to audit the FAILED run referenced in
`$ARGUMENTS`, restore whatever it needs, and resume the ordinary ticket-delivery
workflow to correct and finish it — this is the dashboard's `a` ("address") key
on a FAILED fleet row, not a separate role from `/concertino-deliver`.

## Arguments

`$ARGUMENTS` contains a ticket id (e.g. `{{idExample}}`) — the same shape
`/concertino-deliver` accepts, minus its optional trailing flags: this command
is only ever invoked by the dashboard, against a run it already knows is
FAILED, so there is no agent-merge/speed/inline token to parse here. Extract
the ticket id.

## What to do

Make a single `Agent` call with `subagent_type: concertino-orchestrator`. Prompt:

> TICKET_ID=`<extracted-id>`. ADDRESS_FAILURE=true. This run previously ended
> in FAILED. Run the Address-Failure entry point (`core/roles/orchestrator.md`):
> audit `.concertino/runs/<TICKET_ID>/events.jsonl` in full first, restore the
> worktree via `setup-worktree.sh`, resume planning state from
> `workflow-state.md` (or reconstruct it from persisted evidence, or fall back
> to a fresh delivery run if neither exists), persist the audit as evidence,
> then continue the ordinary Execution → Evaluation → final gate → Delivery →
> Cleanup loop — passing the audit's findings to the first resumed executor
> call the same way an ordinary FAIL cycle passes `EVALUATION_REPORT_PATH`.
> Surface any `ESCALATION`, `BLOCKER`, or final PR presentation back to me.

## When the orchestrator returns

Identical to `/concertino-deliver`'s own "When the orchestrator returns"
section (`adapters/claude-code/command.md`) — the `ESCALATION-PENDING` bubble
handling, `ESCALATION`/`BLOCKER` relay, the "merged" pause, and the
`SendMessage`-unavailable `RESUME — do not start over` fallback all apply
unchanged. This command differs only in how the orchestrator's turn *begins*
(the Address-Failure entry point instead of ordinary Setup), never in how it
ends or resumes across a compaction — the orchestrator is the same agent
either way, given a different starting instruction.

Do not implement, plan, or evaluate yourself — that is the orchestrator's job.
Your role is the seam between the user and the orchestrator agent.
