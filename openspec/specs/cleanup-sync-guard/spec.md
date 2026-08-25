# cleanup-sync-guard Specification

## Purpose
Lets `cleanup.sh` skip its automatic `concertino sync` call via an env-gated flag, without hardcoding sync permanently off for every consuming project.
## Requirements
### Requirement: cleanup.sh supports an env-gated automatic-sync skip
`core/scripts/cleanup.sh` SHALL check a `CONCERTINO_CLEANUP_SKIP_SYNC` environment variable before
triggering its automatic `concertino sync` call as part of the Phase-4 cleanup flow. When that
variable is set to a truthy value, the automatic sync call SHALL be skipped; when unset or falsy,
the automatic sync call SHALL fire exactly as it does today. This is an env-gated capability, not
a hardcoded-disabled port of any checkout-local guard.

#### Scenario: Sync fires when the guard is unset
- **WHEN** `CONCERTINO_CLEANUP_SKIP_SYNC` is unset (the default) and `cleanup.sh` reaches its
  Phase-4 automatic-sync step
- **THEN** `concertino sync` SHALL run as it does today

#### Scenario: Sync is skipped when the guard is set
- **WHEN** `CONCERTINO_CLEANUP_SKIP_SYNC` is set to a truthy value
- **THEN** `cleanup.sh` SHALL skip the automatic `concertino sync` call and SHALL NOT otherwise
  alter the rest of the Phase-4 cleanup flow (worktree removal, server teardown, etc.)

#### Scenario: The guard is independent of CON-131's exit-code defect
- **WHEN** `cleanup.sh`'s git operations fail for reasons unrelated to this guard
- **THEN** this requirement makes no claim about `cleanup.sh`'s exit code in that case (tracked
  separately by CON-131); this guard governs only whether the automatic sync call fires

### Requirement: other_runs_live() bounds staleness by last-event age, not run.end presence alone
`core/scripts/cleanup.sh`'s `other_runs_live()` SHALL treat a run as live only when it has a
`"kind":"run.start"` event, has no `"kind":"run.end"` event, AND its most recent logged event's
`t` timestamp is within a staleness window from the current time. A run whose most recent event
is older than the staleness window SHALL NOT be treated as live, regardless of whether `run.end`
was ever written. The staleness window SHALL default to 6 hours and SHALL be overridable via a
`CONCERTINO_LIVE_RUN_STALE_HOURS` environment variable (falling back to the default when unset
or non-numeric), mirroring the existing `CONCERTINO_CLEANUP_SKIP_SYNC` env-gate pattern in the
same file. When the most recent event's timestamp cannot be extracted (no parseable line with a
numeric `t` field found scanning backwards from the end of the file), the run SHALL be treated as
live (today's presence-based fallback), never as not-live.

#### Scenario: A stuck run past the staleness window is no longer reported live
- **WHEN** a run's `events.jsonl` has `run.start`, no `run.end`, and its last event's timestamp
  is older than the staleness window (default 6 hours, or the configured
  `CONCERTINO_LIVE_RUN_STALE_HOURS` value)
- **THEN** `other_runs_live()` SHALL NOT report that run as live, and Phase-4's automatic
  `concertino sync` re-render SHALL proceed as if that run did not exist

#### Scenario: A genuinely active run within the staleness window is still reported live
- **WHEN** a run's `events.jsonl` has `run.start`, no `run.end`, and its last event's timestamp
  is within the staleness window
- **THEN** `other_runs_live()` SHALL report that run as live exactly as it does today, and
  Phase-4's automatic `concertino sync` re-render SHALL be skipped

#### Scenario: A completed run (run.end present) is never reported live, independent of staleness
- **WHEN** a run's `events.jsonl` has both `run.start` and `run.end`
- **THEN** `other_runs_live()` SHALL NOT report that run as live, regardless of the staleness
  window or its last event's age (unchanged from today's behavior)

#### Scenario: An unparsable last-event timestamp fails closed to live
- **WHEN** a run's `events.jsonl` has `run.start`, no `run.end`, and no line (scanning backwards
  from the end of the file) parses as a JSON object with a numeric `t` field
- **THEN** `other_runs_live()` SHALL report that run as live (fail closed toward skipping sync,
  never toward rewriting shared artifacts under a possibly-still-live run)

