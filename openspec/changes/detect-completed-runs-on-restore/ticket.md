# CON-37: Queue restore can't distinguish "never started" from "ran to completion during downtime"

## Description

CON-29's restore logic (`design.md` Decision 5, archived under
`openspec/changes/archive/2026-07-29-persist-restore-queue-tail/`) reconciles
a persisted queue's `pending` list against a one-off startup snapshot using
`queue.isRunLive`. That correctly drops any ticket the snapshot shows as
currently live. But a ticket whose run reached a **terminal** state during
the downtime (finished cleanly while the dashboard was closed) is
indistinguishable from one that never started at all — both are simply "not
live" in the snapshot, so both are restored as pending and re-offered to the
operator.

This is not an oversight — it's an explicitly documented, deliberately
accepted gap in the design doc itself:

> "this is a known, accepted gap: the design cannot distinguish 'never ran'
> from 'ran to completion while the dashboard was down' using only the live
> fleet snapshot, since a finished run's terminal event is available in its
> own event log but the fleet snapshot is keyed on windows/liveness, not
> exhaustive history. Mitigation: the restore affordance surfaces the ticket
> ids being restored so the operator can visually catch an already-completed
> ticket before confirming (open question ... on whether to cross-check
> completed runs' event logs here too)."

That "open question" was never turned into a ticket, so it's easy to lose
track of.

## Consequence

An operator resuming a restored queue could re-launch a ticket that already
delivered successfully during the downtime, if they don't catch it from the
ticket id list alone (which carries no status information — just an id).

## Proposed change

Cross-check each persisted `pending`/`inFlight` id's own event log
(`.concertino/runs/<ticket>/events.jsonl`) for a `run.end` at restore time,
not just the live fleet snapshot. A ticket with a `run.end` timestamped after
the queue file's own `writtenAt` completed during the downtime and should be
dropped from the restored pending list (or at minimum flagged distinctly in
the resume UI — "completed while you were away" — rather than rendered
identically to a genuinely never-started ticket).

Low/medium priority: the existing mitigation (surfacing ids for a human to
eyeball) is a real, if weaker, safety net, and this is a race that requires a
ticket to both finish AND the dashboard to restart inside the same window to
matter.

## Metadata

- Priority: Medium
- Linear URL: https://linear.app/helioapp/issue/CON-37/queue-restore-cant-distinguish-never-started-from-ran-to-completion
