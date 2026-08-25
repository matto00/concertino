# CON-140: Orchestrator ends its turn "waiting" for a sub-agent instead of polling, deadlocking the run until a human nudges

## Description

The orchestrator repeatedly ends its turn with a status line like:

> "Executor is now working on cycle 2 to produce durable live-trial evidence. Waiting for it to complete."
> "Waiting for the resumed executor to report actual completion status."

and then stops. Sub-agent completion notifications are **not reliable** in the Claude Code adapter, so nothing wakes it. The run sits idle indefinitely until a human notices and sends a nudge telling it to poll its sub-agents directly.

Observed twice in one four-ticket batch (HEL-671 and HEL-630) on 2026-08-24/25, and it matches a long-standing pattern already recorded in the driver's operating notes. A third occurrence (HEL-651) happened the same night.

ALL THREE of those runs had spawn briefs that explicitly instructed the orchestrator NOT to end its turn waiting on a sub-agent, and to poll directly instead — and it still happened. Per-run prose in the spawn brief does NOT fix this. The correct behavior has to live in the role definition itself, not just be appended as a one-off instruction.

## Root cause to confirm

The orchestrator role prompt describes spawning sub-agents but does not state what to do while one is in flight. The model's natural completion is to report status and yield, which reads as cooperative but is terminal in a system where the wake signal may never arrive. Confirm whether the role doc anywhere implies a notification will arrive, and remove or correct that if so — this is a root cause, not just a missing instruction.

## Proposed fix

In the orchestrator role definition (`core/`, so it survives `concertino sync`):

* State explicitly that sub-agent completion notifications are unreliable and must never be waited on.
* Require the orchestrator to determine sub-agent state with its own tools — read the run directory's report/evidence files, the worktree's `git log`/`git status`, and the artifacts the sub-agent claims to have written — rather than yielding.
* Make "ending a turn to wait on a sub-agent" an explicit anti-pattern, distinct from the legitimate reasons to end a turn: the run is genuinely finished, or a decision is needed from the coordinator. If a decision is needed, the turn must state the question explicitly with a recommendation — never merely report that it is waiting.
* Consider a mechanical assertion: a phase script that fails if the orchestrator yields while a spawned sub-agent has no terminal record.

## Acceptance Criteria

- [ ] Orchestrator role doc states the no-waiting rule and the poll-directly requirement, in `core/` so a render cannot revert it
- [ ] The legitimate turn-ending conditions are enumerated, with "waiting on a sub-agent" explicitly excluded
- [ ] Demonstrated: a run where a sub-agent completes without a notification and the orchestrator proceeds on its own — not merely a doc change asserted to work
- [ ] Any language implying a notification will arrive is removed
- [ ] Renders verified for the Claude Code adapter (Codex/OpenCode parity is CON-135's scope, not this ticket's)

## Related

* CON-127 (granted sub-agents SendMessage for mid-flight self-notify — helps, but self-notify is fire-and-forget and non-authoritative, so it does not solve this)
* CON-139 (sub-agent self-notify misdelivers to `main` because ORCHESTRATOR_AGENT_REF is unresolvable at spawn — closely related; a working self-notify path would reduce but not remove the need for polling)

## Run-specific constraints (from human driver)

- Claude Code adapter only; Codex/OpenCode parity (CON-135) is out of scope.
- The mechanical-assertion phase-script idea must be explicitly scoped in/out via an ESCALATION to the human — never silently dropped or silently implemented.
- A doc change alone is NOT sufficient evidence. Acceptance criterion #3 demands an actual demonstration of a sub-agent completing without a notification and the orchestrator proceeding on its own by polling. If a full end-to-end demonstration isn't achievable, executor/evaluator must say so plainly and describe exactly what was verified vs. not.
