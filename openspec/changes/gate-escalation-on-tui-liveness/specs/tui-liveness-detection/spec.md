## ADDED Requirements

### Requirement: A single script authoritatively answers whether a TUI is attached
`core/scripts/tui-attached.sh` (rendered by `concertino sync` to `scripts/concertino/tui-attached.sh`, exactly as every other procedure script) SHALL be the single authority answering "is a Concertino TUI attached to this run?", exiting 0 when attached and non-zero (1) when not attached or the state is ambiguous. It SHALL determine this by resolving the main checkout the same way `emit-event.sh` resolves it, reading `.concertino/cache/watch.lock` (the same pidfile `lib/ui/watch-lock.js` writes for CON-68's single-writer guard), and checking PID liveness of the recorded `pid` via the same liveness definition `lib/ui/watch-lock.js`'s `pidAlive()` uses (a process-signal-0 probe where a permission-denied result still counts as alive) — never consulting `heartbeatAt`.

#### Scenario: A live dashboard is detected as attached
- **GIVEN** a `concertino watch` process is running against this repo and holds `.concertino/cache/watch.lock` with its own live pid
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 0

#### Scenario: No lockfile means not attached
- **GIVEN** `.concertino/cache/watch.lock` does not exist
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 1

#### Scenario: A stale lock from a dead process is not attached
- **GIVEN** `.concertino/cache/watch.lock` records a pid that no longer exists (the dashboard crashed or was killed without releasing its lock)
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 1 — a dead holder's stale lock is never read as "attached"

#### Scenario: A torn or unparsable lockfile is not attached
- **GIVEN** `.concertino/cache/watch.lock` exists but is not valid JSON, or is missing a numeric `pid` field
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 1, matching `lib/ui/watch-lock.js`'s own "torn or absent is treated as absent" contract

#### Scenario: Any unexpected failure resolves to not-attached
- **GIVEN** the main checkout cannot be resolved, or any other unexpected error occurs while checking
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 1 — ambiguity never resolves toward "attached"

#### Scenario: A live pid owned by another user still counts as attached
- **GIVEN** `.concertino/cache/watch.lock` records a pid that is alive but owned by a different user (a permission-denied result on a liveness probe)
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 0 — this matches `lib/ui/watch-lock.js`'s own `pidAlive()` definition (permission-denied is treated as "exists, not ours" — still alive), and the check uses that exact definition rather than a shell primitive with different EPERM semantics

#### Scenario: Heartbeat freshness is never consulted
- **GIVEN** `.concertino/cache/watch.lock` records a live pid but a `heartbeatAt` far in the past (the dashboard is blocked inside a long-running foreground operation, e.g. `tmux attach`)
- **WHEN** `scripts/concertino/tui-attached.sh` is run
- **THEN** it exits 0 — liveness is decided by pid signal-0, never by heartbeat age, exactly mirroring `watch-lock.js`'s own ownership criterion
