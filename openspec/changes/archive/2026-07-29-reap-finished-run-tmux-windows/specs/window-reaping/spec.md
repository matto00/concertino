## ADDED Requirements

### Requirement: A finished run's tmux window is reaped automatically
On every `concertino watch` poll, the dashboard SHALL close ("reap") the
tmux window of any run for which BOTH hold: the run's event log contains a
terminal `run.end` event, AND tmux reports the run's window pane as dead
(`pane_dead=1`). Reaping SHALL close the window (`tmux kill-window`) so it no
longer appears in `tmux list-windows` for the dashboard's session.

#### Scenario: A terminal run with a dead pane is reaped
- **GIVEN** a run's event log contains a `run.end` event
- **AND** the run's tmux window pane is dead (`pane_dead=1`)
- **WHEN** the dashboard polls
- **THEN** the run's tmux window is closed
- **AND** it no longer appears in `tmux list-windows` on the next poll

#### Scenario: A terminal run whose window is still alive is left alone
- **GIVEN** a run's event log contains a `run.end` event
- **AND** the run's tmux window pane is still alive
- **WHEN** the dashboard polls
- **THEN** the run's tmux window is NOT closed

### Requirement: A run without a terminal event is never reaped
Reaping SHALL only ever consider a run whose event log contains a `run.end`
event. A run whose window pane is dead but whose log has no `run.end` event
(a crash, an OOM kill, `kill -9`, or a harness that exited before Phase 4)
SHALL NEVER be reaped, regardless of how long the dead window has been
sitting there. This window is the only evidence that the run existed and
failed; removing it must not be possible.

#### Scenario: A dead window with no run.end is preserved
- **GIVEN** a run's tmux window pane is dead (`pane_dead=1`)
- **AND** the run's event log contains no `run.end` event
- **WHEN** the dashboard polls, however many times
- **THEN** the run's tmux window is NOT closed
- **AND** the run continues to resolve to status `failed`

### Requirement: Scrollback is captured before a window is killed
Before closing a reapable window, the dashboard SHALL capture that window's
full pane history (`tmux capture-pane -p -S -`, from the start of scrollback)
and write it to `.concertino/runs/<TICKET>/session-scrollback.txt`. A failure
to capture or write the scrollback SHALL NOT prevent the window from being
closed.

#### Scenario: Scrollback is written before the window closes
- **GIVEN** a run is eligible for reaping
- **WHEN** the dashboard reaps its window
- **THEN** `.concertino/runs/<TICKET>/session-scrollback.txt` contains that
  window's full pane history
- **AND** the window is subsequently closed

#### Scenario: A capture failure does not block the kill
- **GIVEN** a run is eligible for reaping
- **AND** capturing its scrollback fails (e.g. tmux transiently unavailable)
- **WHEN** the dashboard reaps its window
- **THEN** the window is still closed

### Requirement: Reaping never touches the session placeholder or isolated test sessions
Reaping SHALL never close the dashboard session's placeholder window
(`__concertino__`) and SHALL only ever act on windows within the dashboard's
own configured tmux session — never on windows belonging to a
`concertino-smoke-<pid>` test session or any other session.

#### Scenario: The placeholder window is never reaped
- **GIVEN** the dashboard's tmux session has emitted no run.end for any real
  run
- **WHEN** the dashboard polls
- **THEN** the `__concertino__` placeholder window is never closed by reaping

### Requirement: Reaping runs once per poll, in the dashboard's own loop
Reaping SHALL run on every poll of `concertino watch`'s poll loop
(nominally once per second), operating on the same run/window snapshot that
poll's render is based on. Reaping SHALL NOT run as part of `concertino
prune` or any other separate command.

#### Scenario: A window that finishes and dies becomes reaped within one poll cycle
- **GIVEN** the dashboard is running
- **WHEN** a run emits `run.end` and its tmux window pane subsequently dies
- **THEN** the run's window is reaped on the next poll after both conditions hold
