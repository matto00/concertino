## ADDED Requirements

### Requirement: Discovery enumerates live harness processes system-wide
The dashboard SHALL be able to enumerate live harness processes on the local
machine, not only those inside its own tmux session, by matching each
process's binary name against the project's configured `harnesses` (mapped
through the existing CLI-binary/harness-id mapping) plus a static recognised
extras list (`hermes`, `copilot`, `qwen`). Each matched process SHALL be
reported with, at minimum, its pid, resolved binary path (best-effort), and
working directory (best-effort).

#### Scenario: A freelance claude session is discovered
- **GIVEN** a `claude` process is running in a terminal Concertino never
  spawned
- **WHEN** the sessions view refreshes
- **THEN** that process appears in the discovered session list with its pid
  and, when readable, its working directory

#### Scenario: An unreadable field never drops the session
- **GIVEN** a discovered harness process whose `/proc/<pid>/cwd` cannot be
  read (e.g. owned by a different user)
- **WHEN** the sessions view refreshes
- **THEN** the session still appears in the list, with its working directory
  rendered as unknown rather than the session being omitted

### Requirement: Discovery cross-references tmux windows system-wide
Discovery SHALL enumerate tmux panes across every tmux session on the
machine (not only Concertino's own), and SHALL attach a `session:window`
label to a discovered harness process when that process is a descendant
(within a bounded number of ancestor hops) of a tmux pane's process. A
harness process with no such tmux ancestor SHALL be reported with no tmux
location, never a fabricated one.

#### Scenario: A session started in an unrelated tmux window is labelled
- **GIVEN** a harness process running inside a tmux window that belongs to a
  tmux session Concertino did not create
- **WHEN** the sessions view refreshes
- **THEN** that session's tmux location shows the actual session and window
  it is running in

#### Scenario: A session started outside tmux entirely has no tmux location
- **GIVEN** a harness process launched directly in a terminal with no tmux
  involved
- **WHEN** the sessions view refreshes
- **THEN** that session's tmux location is reported as absent, not guessed

### Requirement: A session is classified as Concertino-managed or freelance
Discovery SHALL classify a discovered session as Concertino-managed (with a
resolved ticket id) only when its tmux cross-reference resolves to
Concertino's own tmux session with a window name matching the project's
ticket-id pattern. Every other discovered session SHALL be classified as
freelance, including one whose working directory happens to fall under a
Concertino worktree path — a matching working directory alone SHALL NOT be
sufficient for the Concertino-managed classification, since it does not
establish that the discovered process is the ticket's own tmux-window
process. This classification SHALL NOT require the ticket's run to have
emitted any telemetry event.

#### Scenario: A Concertino-launched window with no telemetry is still labelled
- **GIVEN** a tmux window inside Concertino's own tmux session, named for
  ticket `CON-90`, whose harness process has not yet emitted `run.start`
- **WHEN** the sessions view refreshes
- **THEN** that session is classified as Concertino-managed, labelled with
  ticket `CON-90`

#### Scenario: A freelance session is never mistaken for a managed one
- **GIVEN** a harness process whose tmux location (if any) is not
  Concertino's own tmux session
- **WHEN** the sessions view refreshes
- **THEN** that session is classified as freelance, with no ticket id,
  regardless of what its working directory is

#### Scenario: A freelance session inside a live ticket's worktree is still freelance
- **GIVEN** a harness process started by hand, with no tmux ancestor inside
  Concertino's own tmux session, whose working directory is under
  `.concertino/worktrees/` for ticket `CON-90`, and `CON-90` has a live
  Concertino-managed run elsewhere
- **WHEN** the sessions view refreshes
- **THEN** that process is classified as freelance, not Concertino-managed —
  its working directory may be shown as a display-only hint, but it is never
  attached to or killed via `CON-90`'s own run actions

### Requirement: Harness version is probed once per binary path and cached
When discovery first encounters a given resolved binary path, it SHALL
attempt to determine that harness's version via a bounded, best-effort probe
of that binary, and SHALL cache the result (including a failure) for the
lifetime of the dashboard process. Subsequent sessions running the same
binary path SHALL reuse the cached result without re-probing.

#### Scenario: Version is shown for a successfully probed binary
- **GIVEN** a discovered session's binary path has not been probed before in
  this dashboard process, and the probe succeeds
- **WHEN** the sessions view refreshes
- **THEN** that session's version is shown, and a second discovered session
  running the same binary path shows the same version without a second probe

#### Scenario: A failed probe is cached, not retried every poll
- **GIVEN** a binary path whose version probe fails or times out
- **WHEN** the sessions view refreshes again with another session on the
  same binary path
- **THEN** the version is shown as unknown, and the probe is not attempted
  again for that binary path in this dashboard process

### Requirement: Discovery never blocks or slows the fleet's own poll loop
Discovery SHALL only run when the sessions screen is open — on entering the
screen, on a bounded auto-refresh cadence while it remains open, and on an
explicit manual refresh — and SHALL NEVER run as part of the fleet screen's
unconditional per-second poll tick. Every individual discovery step (process
enumeration, tmux enumeration, version probing) SHALL be independently
error-handled so that an unavailable source degrades to an empty or partial
result rather than throwing.

#### Scenario: The fleet screen's poll tick is unaffected
- **GIVEN** the dashboard is showing the fleet screen (sessions view never
  opened)
- **WHEN** the poll loop ticks
- **THEN** no process/tmux discovery work is performed for that tick

#### Scenario: A missing discovery source degrades gracefully
- **GIVEN** `/proc` is unavailable (e.g. a non-Linux platform) or `tmux` is
  not installed
- **WHEN** the sessions view refreshes
- **THEN** the affected part of discovery returns an empty result and the
  sessions view renders without crashing, showing whatever other sessions
  (if any) were still discoverable

### Requirement: The sessions view is reachable from the fleet screen
The fleet screen SHALL offer a key binding that opens the sessions view, and
the sessions view SHALL offer a way back to the fleet screen.

#### Scenario: Opening and returning
- **GIVEN** the dashboard is showing the fleet screen
- **WHEN** the operator presses the sessions view's key binding
- **THEN** the sessions view is shown, populated with a fresh discovery pass
- **WHEN** the operator then presses Escape
- **THEN** the fleet screen is shown again

### Requirement: A Concertino-managed session's attach/kill delegates to the existing run actions
The dashboard SHALL perform the attach/kill action for a Concertino-managed
session attached to or killed from the sessions view via the same underlying
functions the drill-down screen uses for that ticket's run (`session.attach`
for attach, `control.killConfirmed` for kill) — no second implementation of
either operation SHALL exist. A failed kill SHALL be surfaced on the
sessions view itself with a one-line reason, even though the underlying
function call is shared with the drill-down screen.

#### Scenario: Attaching a managed session behaves identically to drill-down attach
- **GIVEN** a session in the sessions view classified as Concertino-managed
  for ticket `CON-90`
- **WHEN** the operator attaches to it from the sessions view
- **THEN** the dashboard attaches to `CON-90`'s tmux window exactly as
  attaching from the drill-down screen would

#### Scenario: Killing a managed session behaves identically to drill-down kill
- **GIVEN** a session in the sessions view classified as Concertino-managed
  for ticket `CON-90`, and a live run for `CON-90`
- **WHEN** the operator kills it from the sessions view (after confirming)
- **THEN** the dashboard kills `CON-90`'s run exactly as killing from the
  drill-down screen would, including the same confirmation step

#### Scenario: A delegated kill failure is surfaced on the sessions view
- **GIVEN** a session in the sessions view classified as Concertino-managed
  for ticket `CON-90`, whose run is no longer live (e.g. it already ended)
- **WHEN** the operator kills it from the sessions view (after confirming)
- **THEN** the sessions view shows a one-line failure notice explaining the
  kill did not happen, rather than silently doing nothing

### Requirement: A freelance session is attachable only when tmux-backed, and always killable
A freelance session with a known tmux `session:window` location SHALL be
attachable via a plain `tmux attach` to that location. A freelance session
with no known tmux location SHALL NOT offer attach (there is no terminal to
reattach to), and this SHALL be shown explicitly rather than silently
omitted. Every freelance session, tmux-backed or not, SHALL be killable
(behind a confirmation step): a tmux-backed one via killing its tmux window,
a non-tmux one via sending the process a termination signal.

#### Scenario: A tmux-backed freelance session can be attached
- **GIVEN** a freelance session with a known tmux `session:window` location
- **WHEN** the operator attaches to it from the sessions view
- **THEN** the dashboard attaches to that tmux session and window

#### Scenario: A non-tmux freelance session is marked not attachable
- **GIVEN** a freelance session with no known tmux location
- **WHEN** the sessions view renders it
- **THEN** it is shown as not attachable, and no attach action is offered
  for it

#### Scenario: A non-tmux freelance session can still be killed
- **GIVEN** a freelance session with no known tmux location
- **WHEN** the operator kills it from the sessions view (after confirming)
- **THEN** the dashboard sends a termination signal to that session's
  process

#### Scenario: A kill failure is surfaced, not silently dropped
- **GIVEN** a freelance session whose process has already exited, or is
  owned by a different user
- **WHEN** the operator attempts to kill it
- **THEN** the sessions view shows a one-line failure notice rather than
  crashing or silently doing nothing
