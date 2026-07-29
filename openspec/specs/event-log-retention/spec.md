# event-log-retention Specification

## Purpose
Defines the configurable retention policy for `.concertino/runs/<TICKET>/events.jsonl`, the `concertino prune` operation that removes only terminal (`run.end`-emitting), expired run logs while never touching an active run's log, and the incremental offset-cached `lib/ui/store.js#readAll` read path that lets the dashboard's per-second poll cost scale with changed bytes rather than total project history.
## Requirements
### Requirement: Retention window is configurable with a documented default
`dashboard.retentionDays` in `concertino.config.json` SHALL bound how long a
terminal run's event log is kept under `.concertino/runs/<TICKET>/` before it
becomes eligible for pruning. When absent, the default SHALL be 30 days. The
field and default SHALL be documented in `docs/dashboard.md` and declared in
`config/concertino.schema.json` under the `dashboard` block.

#### Scenario: Default applies when unset
- **WHEN** `dashboard.retentionDays` is absent from `concertino.config.json`
- **THEN** pruning treats the retention window as 30 days

#### Scenario: Configured value overrides the default
- **WHEN** `dashboard.retentionDays` is set to a positive integer `N`
- **THEN** pruning treats the retention window as `N` days

### Requirement: A run without a terminal event is never pruned
Pruning SHALL only consider a run's log eligible for removal if the log
contains a `run.end` event. A log with no `run.end` event SHALL be treated as
belonging to an active run and SHALL never be removed, regardless of the
log file's age.

#### Scenario: Active run's log survives an aggressive retention window
- **GIVEN** a run's log has no `run.end` event
- **AND** the log file's mtime is older than the configured retention window
- **WHEN** pruning runs
- **THEN** the run's log directory is not removed

#### Scenario: Terminal run's log is pruned once past the retention window
- **GIVEN** a run's log contains a `run.end` event
- **AND** the log file's mtime is older than the configured retention window
- **WHEN** pruning runs
- **THEN** the run's entire `.concertino/runs/<TICKET>/` directory is removed

#### Scenario: Terminal run's log is kept while inside the retention window
- **GIVEN** a run's log contains a `run.end` event
- **AND** the log file's mtime is within the configured retention window
- **WHEN** pruning runs
- **THEN** the run's log directory is not removed

### Requirement: Pruning is exposed as an explicit command and a startup boundary
Pruning SHALL be runnable explicitly via `concertino prune [--dry-run]`, and
SHALL also run once, best-effort, at `concertino watch` startup before the
poll loop begins. Pruning SHALL NOT run on the dashboard's per-second poll
loop. A `--dry-run` invocation SHALL report what would be removed without
modifying disk. A pruning failure at `watch` startup SHALL NOT prevent the
dashboard from starting.

#### Scenario: Explicit prune removes eligible logs
- **WHEN** a user runs `concertino prune`
- **THEN** every eligible run's log directory is removed and reported

#### Scenario: Dry run reports without deleting
- **WHEN** a user runs `concertino prune --dry-run`
- **THEN** eligible run directories are reported as would-be-removed
- **AND** no file or directory under `.concertino/runs/` is modified

#### Scenario: Watch startup prunes once before polling
- **WHEN** `concertino watch` starts
- **THEN** pruning runs exactly once before the first poll
- **AND** a pruning error does not stop the dashboard from starting

### Requirement: The dashboard's read path scales with changed bytes, not total history
`lib/ui/store.js#readAll` SHALL support an optional cache parameter keyed by
ticket that stores the last-read byte offset, file size, mtime, and parsed
events/malformed count for that ticket's log. When the file's size and mtime
are unchanged since the cached read, `readAll` SHALL return the previously
parsed result without re-reading or re-parsing the file. When the file has
grown, `readAll` SHALL parse only the bytes appended since the cached offset.
`lib/ui/watch.js` SHALL hold one such cache instance for the lifetime of the
dashboard process and pass it to every poll's `readAll` call.

#### Scenario: Unchanged log is not re-parsed
- **GIVEN** a cache instance already holds a parsed result for a ticket
- **AND** that ticket's log file's size and mtime have not changed
- **WHEN** `readAll` is called again with the same cache
- **THEN** the returned events for that ticket are the same object as the
  previously cached result, not a freshly parsed one

#### Scenario: Appended lines are picked up incrementally
- **GIVEN** a cache instance already holds a parsed result for a ticket
- **WHEN** new complete lines are appended to that ticket's log
- **AND** `readAll` is called again with the same cache
- **THEN** the returned events include the previously parsed events plus the
  newly appended ones

#### Scenario: A truncated or rewritten log resets cleanly
- **GIVEN** a cache instance already holds a parsed result for a ticket
- **WHEN** that ticket's log file shrinks (truncated or rewritten)
- **AND** `readAll` is called again with the same cache
- **THEN** the file is read fresh from the start and the cache entry is
  rebuilt, without throwing

#### Scenario: A pruned ticket's cache entry is evicted
- **GIVEN** a cache instance holds a parsed result for a ticket
- **WHEN** that ticket's run directory no longer exists on disk
- **AND** `readAll` is called again with the same cache
- **THEN** the cache entry for that ticket is removed and the ticket is
  absent from the returned map

