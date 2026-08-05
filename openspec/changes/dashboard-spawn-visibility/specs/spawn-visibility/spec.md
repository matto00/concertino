## ADDED Requirements

### Requirement: Spawning a ticket writes a `run.spawn` event synchronously
When the dashboard creates a tmux window for a ticket (`session.spawn()`), it SHALL append a `run.spawn` event to that ticket's `.concertino/runs/<TICKET>/events.jsonl`, in-process, before returning from the call that created the window — never deferred to a later poll, and never dependent on the launched agent itself emitting anything. The event SHALL carry at minimum `t` (the spawn's own epoch-millisecond timestamp), `kind: "run.spawn"`, and `ticket`, in the same wire shape (`t`/`kind`/`project`/`ticket`/`role` plus any extra fields) that `scripts/concertino/emit-event.sh` already produces, so existing log readers require no special-casing for which process wrote a given line.

#### Scenario: A freshly spawned ticket has a run directory immediately
- **WHEN** the dashboard spawns a new tmux window for ticket `CON-90`
- **THEN** `.concertino/runs/CON-90/events.jsonl` exists immediately afterward and contains a `run.spawn` event for `CON-90`, even though `setup-worktree.sh` has not run yet

#### Scenario: A spawn write failure never blocks the real spawn
- **WHEN** the dashboard cannot write to `.concertino/runs/<TICKET>/events.jsonl` (e.g. a permissions error)
- **THEN** the tmux window is still created and `session.spawn()` still returns/throws exactly as it would have without the write — the failed telemetry write is swallowed, never surfaced as a spawn failure

#### Scenario: Omitting the dashboard root is a no-op, not a crash
- **WHEN** `session.spawn()` is called on a session created without a root (e.g. an existing test double, or any future caller that hasn't threaded a root through)
- **THEN** the tmux window is created exactly as before and no `run.spawn` event is written — behavior identical to today for that caller

### Requirement: `run.spawn` does not change what `run.telemetry` means
The reducer SHALL record a `run.spawn` event's timestamp on the run (as `spawnedAt`) without classifying it as tier-2 or tier-3 telemetry. `run.telemetry` SHALL continue to reflect only the presence of `run.start`/`gate.result` (`'partial'`) or `phase.enter`/etc. (`'full'`) events; a run whose only event is `run.spawn` SHALL still report `telemetry: 'none'`.

#### Scenario: A spawn-only run still reports no telemetry
- **WHEN** a run's event log contains only a `run.spawn` event
- **THEN** `run.telemetry` is `'none'`, and `run.spawnedAt` is set to that event's timestamp

### Requirement: A live, pre-`run.start` window renders distinctly as starting
The fleet row and the drill-down screen SHALL render a live window whose run has `telemetry: 'none'` and a known `spawnedAt` with a distinct "starting" label including elapsed time since spawn, rather than the generic "no telemetry" wording used when a window is mid-workflow but underinstrumented. This SHALL NOT change the run's underlying `status` (still `'running'`) or which section it renders in (still RUNNING/NEEDS-YOU, per existing bucketing) — only the label text changes.

#### Scenario: A freshly launched ticket's fleet row reads "starting"
- **WHEN** a run has `status: 'running'`, `telemetry: 'none'`, `window.alive: true`, and a `spawnedAt` 12 seconds before now
- **THEN** its fleet row displays a "starting" label with an elapsed time around 12 seconds, not the bare "no telemetry" string

#### Scenario: A run predating this feature keeps today's wording
- **WHEN** a run has `status: 'running'`, `telemetry: 'none'`, `window.alive: true`, and no `spawnedAt`
- **THEN** its fleet row and drill-down header render exactly as they did before this change ("no telemetry"), with no crash and no fabricated elapsed time

### Requirement: A window that dies before `run.start` surfaces as a distinct failure
A dead window whose run never received a `run.start` event (`telemetry: 'none'`, no `endStatus`) SHALL render with a label distinct from a window that dies after making some workflow progress. It SHALL still land in the FAILED section (status `'failed'`, unchanged from today) and remain attachable/inspectable via the existing scrollback/attach mechanism — it SHALL NOT disappear from the fleet.

#### Scenario: A window that dies during startup reads "failed to start"
- **WHEN** a run has `status: 'failed'`, `endedAt: null`, `endStatus: null`, and `telemetry: 'none'`
- **THEN** its fleet row and drill-down both display a "failed to start" label, not the generic "window exited" label

#### Scenario: A window that dies mid-workflow still reads "window exited"
- **WHEN** a run has `status: 'failed'`, `endedAt: null`, `endStatus: null`, and `telemetry` of `'partial'` or `'full'`
- **THEN** its fleet row and drill-down display "window exited", unchanged from today

### Requirement: A spawn-only run is never reaped or pruned as terminal
A run whose event log contains a `run.spawn` event but no `run.end` event SHALL never be selected for reaping (`reap.js`) or retention pruning (`retention.js`), regardless of whether its tmux window is alive or dead — the same guarantee already given to any other run with no `run.end`, made explicit for this event kind.

#### Scenario: A dead, spawn-only window is not reaped
- **WHEN** a run's only event is `run.spawn`, its tmux window is dead, and no `run.end` has ever been recorded
- **THEN** `reap.js`'s reap-selection logic returns false for this run — it is left listed, not reaped

#### Scenario: A dead, spawn-only run is not pruned by retention
- **WHEN** a run's only event is `run.spawn` and no `run.end` has ever been recorded
- **THEN** retention pruning treats this run as ineligible for deletion, regardless of the log file's age
