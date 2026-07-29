# CON-14: Procedure scripts build filesystem paths from an unsanitised TICKET_ID

Priority: High
URL: https://linear.app/helioapp/issue/CON-14/procedure-scripts-build-filesystem-paths-from-an-unsanitised-ticket-id

## Description

`persist-evidence.sh` builds its destination as `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/` from `TICKET_ID` with no validation. `emit-event.sh` has the same exposure for `<TICKET_ID>/events.jsonl`.

Raised as a non-blocking observation by CON-10's evaluator, carried through both evaluation cycles and the final skeptic gate, and correctly judged not a regression that ticket introduced — it is pre-existing in `emit-event.sh` and was inherited.

### Why it is worth closing

A ticket id containing `..` walks out of the runs directory. `../../../..` reaches anywhere the agent can write. It is not a privilege escalation — the agent already has that access — but it turns a malformed or hostile ticket identifier into arbitrary file placement, and the launch pad will soon be feeding ticket ids into this path programmatically rather than from something a human typed.

The project has already been bitten twice by trusting a ticket id:

* Interpolating one into a shell command was a **confirmed injection** — `$(touch …)` executed. Fixed by validating against a ticket-shaped pattern before substitution.
* Letting one contain `.` made tmux window targets ambiguous, orphaning a window while the dashboard kept rendering it as healthy. Fixed by narrowing the same pattern.

This is the third context that trusts the same value, and the guard already exists.

## Acceptance criteria

* `emit-event.sh` and `persist-evidence.sh` validate `TICKET_ID` before using it in a path, reusing the shell `looks_like_ticket` pattern that `assert-phase.sh`, `start-servers.sh` and `cleanup.sh` already share — `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` — so there stays one definition rather than a fourth.
* A rejected ticket id degrades the way tier-2 telemetry already does: **emit nothing** rather than write somewhere wrong. A dropped event renders honestly through the degradation ladder; a misplaced file does not.
* `persist-evidence.sh` refusing must not fail the run — it stays `|| true` at its call sites, and the caller omits `ref` rather than emitting a bad one, exactly as the FAIL fallback does today.
* Tests cover a traversal attempt (`../escape`) and confirm nothing is written outside the runs directory.

## Notes

Worth checking whether any other script derives a path from a ticket id — this keeps surfacing one call site at a time, and a sweep now is cheaper than a fourth ticket.
