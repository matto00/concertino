# CON-126: Only invoke the escalation script when a Concertino TUI is actually attached

## Description

`scripts/concertino/emit-event.sh` describes itself as "the telemetry seam for the Concertino dashboard" — its escalation modes exist to light up `NEEDS YOU` on a `concertino watch` TUI and to read back an answer written by `lib/ui/controllers/escalation.js`. But `core/roles/orchestrator.md`'s "How to raise one" calls it unconditionally, in both topology branches:

* root branch → `emit-event.sh escalation --await ...` (blocking)
* Claude Code subagent branch → `emit-event.sh escalation --raise-only ...`

There is no TUI/dashboard detection anywhere in `core/`, `lib/`, or `bin/`. Nothing in the raise path asks whether a dashboard is running before deciding to talk to it.

## Problem

When no dashboard is attached — a plain Claude Code session invoked via `/concertino-deliver`, a cron/scheduled run, CI — the script calls are pointless at best and harmful at worst:

* `--await` blocks polling `.concertino/runs/<TICKET>/answer.json` for `dashboard.escalationTimeoutMinutes` (default 8) against a screen no human can reach. The wait can only ever end in timeout, so the run burns the full window before falling back to the channel that was available the whole time.
* `--raise-only` writes `escalation.raised` telemetry that no reader will consume for this run.

Observed live on CON-131's design-gate escalation this week: the orchestrator raised via `--await`, timed out against no dashboard, and the human answered in chat. The no-TUI path is the common case, not an edge case.

## Scope

* Add ONE detection seam answering "is a Concertino TUI attached to this run?" — a live-dashboard marker, an env var exported by `concertino watch`, or a store-level liveness check. Pick one, make it the single authority, document why.
* Gate the escalation script invocations on that signal, at the orchestrator's single raise call site (per CON-127's design.md explicit assumption: this composes by changing only that one call site).
* Document the no-TUI fallback explicitly: present in chat, collect the answer there, no script round-trip.
* Preserve when a TUI IS attached: `--await`'s exit-0/non-zero contract, the `TERM`/`INT` trap recording `escalation.timeout`, CON-76 dual-channel delivery, CON-46's multi-part wizard, and "a timeout is never an approval" on BOTH branches.
* `concertino answer <ticket> <value>` must remain the single authoritative write path for a chat-collected answer whenever a store exists to write to.

## Acceptance Criteria

- [ ] A single documented signal determines whether a Concertino TUI is attached to the current run, and the escalation raise path consults it before invoking `emit-event.sh`.
- [ ] With no TUI attached, raising an escalation performs no blocking `--await` wait and reaches the human in chat immediately.
- [ ] With a TUI attached, behaviour is unchanged: dashboard `NEEDS YOU`, dual-channel delivery, `--await`/`--raise-only` contracts, timeout trap, and multi-part wizard all still work.
- [ ] A timeout is still never treated as an approval on either branch.
- [ ] The no-TUI path is documented in `core/roles/orchestrator.md` alongside the existing topology branch, so an agent can tell which branch it is on without guessing.
- [ ] Detection is safe against staleness in the dangerous direction (a dead dashboard must never be mistaken for a live one); ambiguity resolves to "no TUI."
- [ ] `concertino answer <ticket> <value>` remains the single authoritative write path for a chat-collected answer.
