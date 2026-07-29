# CON-34: Reap finished runs' tmux windows automatically instead of leaving strays

Priority: High
URL: https://linear.app/helioapp/issue/CON-34/reap-finished-runs-tmux-windows-automatically-instead-of-leaving

## Problem

Nothing ever removes a run's tmux window. When a delivery finishes, its window stays in the `concertino` session forever — either dead (`pane_dead=1`, held by `remain-on-exit`) or alive and idling at a prompt.

Both cost something:

* **Dead windows** accumulate as visual noise. They have to be closed by hand, and in practice they are not, so the session fills with finished work.
* **Live-but-finished windows** are worse: each idle Claude session holds a full process tree including its MCP servers (helio-mcp + playwright-mcp per session). Several finished-but-alive runs is real memory for zero benefit.

Observed directly: after a batch, the session held windows for CON-2, CON-4, CON-14, CON-17 and CON-25 — every one of them a completed, merged, Done ticket — alongside only two genuinely live runs. All five had to be closed manually.

## Proposed change

The dashboard already mutates tmux state (`lib/ui/session.js` spawns; `lib/ui/control.js` kills and restarts), so reaping is within its existing remit rather than a new kind of responsibility. On each poll, close the windows of runs that have definitively finished.

## The trap — do not reap on liveness alone

This is the primary design constraint and the reason this ticket is not a two-line change.

`lib/ui/reducer.js` derives status in a specific order:

```js
if (run.endStatus) return run.endStatus === 'delivered' ? 'done' : 'failed';
if (run.window && !run.window.alive) return 'failed';
```

That second line is **tier-1 telemetry** — tmux process state, the tier this project treats as free and unable to lie. It is the *only* signal that catches a run which died without ever emitting `run.end`: a crash, an OOM kill, a `kill -9`, a harness that exited before Phase 4.

If reaping deletes a window whose run never emitted `run.end`, that evidence is destroyed. The run stops resolving to `failed` and falls through to `unknown` — and a crashed run would render as an unexplained gap rather than a failure. That is a direct violation of the project's governing property: **absent data must never render as healthy data**.

So the rule must be:

> **Reap only runs that emitted a terminal** `run.end`**.** A window that died *without* one must be preserved, because that window is the sole remaining evidence that the run existed and failed.

Any implementation needs a test asserting that a dead window with no `run.end` is never reaped, and still resolves to `failed`.

## Second decision: reap live windows too?

A run can emit `run.end` and keep running — the orchestrator emits it during Phase 4 and may still be finishing up (archiving the change, updating the ticket, hygiene checks). Two candidate policies:

1. **Conservative** — reap only when `run.end` is present **and** the pane is already dead. Cannot ever truncate live work. Clears the visual noise but does not reclaim the idle-session memory.
2. **Aggressive** — reap on `run.end` regardless of liveness. Reclaims the memory, but risks killing an orchestrator mid-Phase-4 if `run.end` is emitted before the last steps complete.

Recommend shipping (1) as the default with (2) available behind config, or (2) gated on a grace period after `run.end`. Worth checking where `run.end` actually sits relative to the final Phase 4 steps in `core/roles/orchestrator.md` before choosing — if it is genuinely the last thing emitted, (2) is safe and strictly better.

## Preserve scrollback before killing

Killing a window discards its scrollback, which is sometimes the only record of what an agent said at the end — particularly the human-facing merge instructions and any final escalation. Before reaping, capture it:

```
tmux capture-pane -p -S - -t concertino:<TICKET> > .concertino/runs/<TICKET>/session-scrollback.txt
```

This is already being done by hand during manual cleanups and should simply be part of the reap. Note the capture is bounded in practice (~47 lines) because Claude Code uses the alternate screen buffer, so it is cheap. `.concertino/` is gitignored in full, so this inherits that; confirm it does not widen what is written to disk in a way that matters, since agent output can quote ticket bodies.

## Notes

* Reaping must never touch `__concertino__`, the session's holder window.
* Test-created sessions (`concertino-smoke-<pid>`) already isolate themselves into their own tmux session and self-clean; they are out of scope and must stay untouched.
* Interacts with the retention work from CON-4: that prunes event logs, this prunes windows. Neither should assume the other ran.
