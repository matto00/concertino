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

