# fleet-idle-tracking Specification

## Purpose
Defines how the dashboard's poll loop (`lib/ui/watch.js`) computes each fleet window's idle time from tmux's own per-window activity timestamp, recomputed statelessly on every poll, so it is accurate against byte-identical redraws and survives a dashboard restart.
## Requirements
### Requirement: Idle time is computed from tmux window activity on every poll
The dashboard's poll loop (`lib/ui/watch.js`) SHALL compute each alive
window's idle time as `now - activity * 1000`, where `activity` is the
window's `#{window_activity}` timestamp as returned by
`session.listWindows()`, recomputed on every poll — not only when the
window is first seen.

#### Scenario: Idle time reflects the current poll's activity timestamp
- **WHEN** the poll loop samples an alive window whose tmux
  `#{window_activity}` has advanced since the previous poll
- **THEN** the reported `idleMs` for that window decreases accordingly on
  this poll, without waiting for any subsequent poll

#### Scenario: A window that redraws identical pane content does not read as idle
- **WHEN** a window's process writes to its pane on every poll interval but
  the rendered content is byte-identical to the previous frame (e.g. a
  spinner holding on the same character)
- **THEN** the window's `idleMs` stays low (reflecting tmux's advancing
  `#{window_activity}`), and is not reported as idle merely because the
  visible content did not change

### Requirement: No per-poll pane-content sampling is used to determine idle time
The poll loop SHALL NOT capture pane content (`capture-pane`) or compare
content hashes as part of computing idle time. No per-ticket idle state
(e.g. a hash or a cached "since" timestamp) SHALL be retained across polls
for this purpose — idle time SHALL be derived solely from the current
poll's `activity` value.

#### Scenario: No capture-pane subprocess is invoked while sampling idle time
- **WHEN** the poll loop samples windows to compute idle time
- **THEN** it does not invoke `session.capture()` (or any other
  pane-content read) for that purpose

### Requirement: Idle time survives a dashboard restart
A window's reported idle time SHALL reflect its true last-activity time
even immediately after the dashboard process restarts, since it is derived
from tmux's own per-window activity timestamp rather than from state
private to the dashboard process.

#### Scenario: Dashboard restarts while a window has been idle for a while
- **WHEN** the dashboard process is restarted and then samples a window
  that has not produced any pane output for some duration prior to the
  restart
- **THEN** the reported `idleMs` reflects that full duration, not zero and
  not the time since the dashboard restarted

