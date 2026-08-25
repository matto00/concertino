## Why

`other_runs_live()` in `core/scripts/cleanup.sh` treats any run with `run.start` and no `run.end`
as live, forever. A run whose orchestrator ends its final turn on an unresolved Phase-4 escalation
(timeout or otherwise) never writes `run.end`, so it is misreported as "still live" by every
subsequent Phase-4 cleanup indefinitely — confirmed live in this repo against helio's HEL-560
(13 days stale, PR already merged) and HEL-395 (previously found, 3+ days). This silently skips
the automatic `concertino sync` re-render that keeps shared rendered artifacts from drifting stale,
and surfaces a false "concurrent run is still live" claim to humans in orchestrator reports.

## What Changes

- `other_runs_live()` gains a time-based staleness bound: a run whose last logged event is older
  than a configurable threshold is no longer treated as live, regardless of whether `run.end` was
  ever written. Default threshold is generous enough to cover legitimately long-running deliveries
  (observed: 1+ hour, multi-hour-with-API-outages) without leaving a false positive open for days.
- The threshold is overridable via an env var (mirroring `CONCERTINO_CLEANUP_SKIP_SYNC`'s existing
  pattern in the same file) for a project that needs a different bound.
- No PID-based liveness is introduced — `tui-attached.sh`'s PID/lockfile pattern does not transfer
  cleanly here (no single PID or lockfile exists per ticket run, and PID liveness breaks across
  reboots, which this repo's runs can span) — the design doc records why this was rejected.
- A genuinely live concurrent run (recent activity, no terminal event) must still be detected as
  live — this is a hard requirement, verified with an explicit test fixture, not just an assumed
  property of "lowering the bar."

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cleanup-sync-guard`: `other_runs_live()`'s liveness determination gains a time-based staleness
  bound in addition to the existing `run.start`/`run.end` check, so a run's false-positive "live"
  window is bounded rather than indefinite.

## Impact

- `core/scripts/cleanup.sh` (`other_runs_live()`) — the only code change.
- `.concertino.env` documentation surface, if a new env var is introduced for the threshold.
- No renderer/template changes — `scripts/concertino/cleanup.sh` is regenerated from `core/` by
  `concertino sync`, per CON-133/CON-140/CON-138 precedent (fix must land in `core/`).
