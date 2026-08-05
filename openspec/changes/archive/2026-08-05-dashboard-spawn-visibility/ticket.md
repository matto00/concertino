# CON-77: Dashboard is blind to a spawned session until it emits run.start — a window that never reports is invisible

## Description

The fleet view derives every run from `.concertino/runs/<TICKET>/events.jsonl` (`store.listTickets` → `reducer.reduce`). A tmux window the dashboard itself spawned, which has not yet emitted `run.start`, therefore does not exist as far as the dashboard is concerned — even though the dashboard created it and can see it in `tmux list-windows`.

Observed 2026-08-05: `CON-75` was launched from the launch plan. The tmux window was created and alive:

```
$ tmux list-windows -t concertino
__concertino__  dead=0
CON-71          dead=0
CON-59          dead=1
CON-75          dead=0     <- alive, working
```

…but `.concertino/runs/CON-75/` did not exist at all, so the fleet showed nothing. The operator's reasonable conclusion was that the launch had failed, when in fact the session was running and burning tokens. `CON-59` had the same shape earlier — a dead window with no run directory, invisible in both directions.

`run.start` is emitted by `setup-worktree.sh`, i.e. only once the agent has understood its instructions and executed step 1. Everything before that — model loading, reading the role spec, planning, and **any failure to get that far at all** — happens in a window the dashboard does not render. That is precisely the window in which things go wrong on a new harness or a local model, so the blind spot lines up exactly with the cases that need visibility most.

## Shape of a fix

The spawn is a fact the dashboard owns — it called `session.spawn()`. It should record it rather than wait to be told:

* On spawn, write a minimal run record (or emit a `run.spawn` event) so the ticket appears immediately with an explicit `starting…` state.
* Reconcile against `tmux list-windows` each poll: a live window with no telemetry is `starting…`; a **dead** window that never emitted `run.start` is a hard failure and must surface as such, not vanish.
* Distinguish it from a genuine run in the UI — it has no phase, no gates, no evidence yet — but never omit it.

Note `reduce()` already receives the window snapshot (`sampleWindows`) alongside the event logs, so both halves are in hand at the same call site; the gap is that windows without a matching event log contribute nothing.

## Acceptance Criteria

* A ticket launched from the dashboard appears in the fleet within one poll, before any telemetry exists.
* A spawned window that dies without ever emitting `run.start` surfaces as a failure with its scrollback reachable, rather than disappearing.
* A live window with no telemetry renders distinctly from a run that is genuinely mid-phase.
* Reaping/retention still treat these correctly — an un-started window must not be reaped as though it were terminal.
