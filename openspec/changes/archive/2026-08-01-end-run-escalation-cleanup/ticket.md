# CON-48: Orchestrator sessions persist indefinitely after run.end if they ask a follow-up question in plain chat

## Description

CON-16's orchestrator emitted `run.end` (status=delivered) and passed its `phase:cleanup` gate — fully correct, complete telemetry, worktree removed, PR merged, Linear marked Done. The reducer therefore (correctly, per the telemetry) resolves this run as `done`.

But the tmux window and the underlying `claude` process were both still alive over an hour later. Attaching found the orchestrator had, *after* `run.end`, asked a genuine follow-up question in plain chat — "Want me to open a follow-up ticket for the sync drift, or leave it for now?" — with **zero telemetry**: no `escalation.raised`, nothing the dashboard could ever have surfaced. A human had to attach blind to discover a live, pending question sitting behind a ticket the dashboard was confidently showing as finished. Once answered (it filed CON-45), the session then sat at a bare idle prompt indefinitely — no further work, no exit, nothing to reap.

## Why this is worse than it looks

This is the same failure class CON-15 fixed from the other direction. CON-15 made sure the orchestrator never ends its turn *too early*, with a sub-agent outstanding. This is the mirror-image bug: the orchestrator doesn't end its turn *at all* once its actual work is genuinely done, if it has something left to say. And because it happens *after* `run.end`, it is invisible in exactly the place operators are trained to stop looking — the DONE section.

It also interacts badly with CON-34's reap logic: CON-34 correctly refuses to reap a run whose window is still alive even after `run.end` (exactly the right call in isolation — an orchestrator finishing up Phase 4 after emitting `run.end` must not be killed mid-cleanup). But that same conservative correctness means a session stuck in *this* bug — done with everything, just sitting on an unstructured question — will never be reaped either, and will persist forever with no distinguishing signal from a legitimately-still-finishing one.

## Proposed change — two parts, requested together

**1. Harden the end-of-run procedure so a session cannot linger indefinitely.** Once Phase 4 cleanup is genuinely complete (worktree removed, PR/ticket state settled), the orchestrator's role instructions must require it to actually end its turn / exit — not continue sitting at an interactive prompt available for further conversation. Define precisely what "genuinely complete" means so this doesn't reopen CON-15's original hazard in reverse (ending too early with real work still pending).

**2. Any post-cleanup suggestion (like "should I file a follow-up ticket?") must go through the escalation mechanism, not bare chat.** This gives it: an `escalation.raised` event (dashboard visibility — NEEDS YOU, not a falsely-idle DONE row), the existing structured answer flow, and a natural, already-defined point after which the orchestrator's turn actually ends (once the escalation is answered or times out, per whatever the `--await` timeout bug ticket resolves that to). This directly satisfies the requirement that follow-up suggestions be *caught* rather than sprung on whoever happens to attach.

## Scope note

Depends on (or should at minimum land alongside) the `--await` timeout bug — routing follow-up suggestions through escalation is only a real fix if the escalation wait itself reliably survives long enough to be answered through the dashboard rather than falling back to the exact bare-chat pattern this ticket is trying to eliminate.

## Notes

CON-6 (fleet view cannot scroll the DONE section) is currently blocking direct verification of whether more sessions are stuck this way via the dashboard itself — checked manually via `tmux list-windows`/`ps` instead for this ticket's own investigation. Only one straggler (CON-16) was found at time of filing; all other delivered runs tonight had already been closed.
