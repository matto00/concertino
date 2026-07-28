## MODIFIED Requirements

### Requirement: gate.result events carry a duration
Every `gate.result` event emitted by `core/scripts/assert-phase.sh` or `core/scripts/start-servers.sh` SHALL include a `duration_ms` field: an integer count of milliseconds measured around the work that specific gate performed (the phase's checks in `assert-phase.sh`; the reuse-check-or-start-and-health-wait sequence for one server in `start-servers.sh`, whether it ends in success or failure).

#### Scenario: Passing phase gate reports its duration
- **WHEN** `assert-phase.sh` runs a phase whose checks all succeed
- **THEN** the emitted `gate.result` event has `status` `"pass"` and a
  `duration_ms` field whose value is a non-negative integer

#### Scenario: Failing phase gate reports its duration
- **WHEN** `assert-phase.sh` runs a phase where at least one check fails
- **THEN** the emitted `gate.result` event has `status` `"fail"` and a
  `duration_ms` field whose value is a non-negative integer

#### Scenario: Server-start gate reports its duration
- **WHEN** `start-servers.sh` starts or reuses a healthy backend or frontend
  server
- **THEN** the emitted `gate.result` event for that server has a
  `duration_ms` field whose value is a non-negative integer

#### Scenario: Failing server-start gate reports its duration
- **WHEN** `start-servers.sh` starts a backend or frontend server that never
  becomes healthy within its configured timeout
- **THEN** the emitted `gate.result` event for that server has `status`
  `"fail"` and a `duration_ms` field whose value is a non-negative integer

### Requirement: Failing gate.result events carry the first error line
When `assert-phase.sh` or `start-servers.sh` emits a `gate.result` event with `status` `"fail"`, the event SHALL include a `first_error` field containing the first failure message recorded for that gate, trimmed at the source to a bounded length so the event stays well under the 4000-byte per-line cap enforced by `emit-event.sh`.

#### Scenario: Single check fails
- **WHEN** exactly one check fails during an `assert-phase.sh` phase
- **THEN** the emitted `gate.result` event's `first_error` field equals that
  check's failure message (trimmed to the source-side length bound)

#### Scenario: Multiple checks fail
- **WHEN** more than one check fails during an `assert-phase.sh` phase
- **THEN** the emitted `gate.result` event's `first_error` field equals only
  the *first* failure message encountered, not a concatenation of all of them

#### Scenario: Oversized failure message is trimmed at the source
- **WHEN** an `assert-phase.sh` failure message exceeds the source-side
  length bound
- **THEN** `first_error` is truncated to that bound before being handed to
  `emit-event.sh`, so the rest of the event's fields (`gate`, `status`,
  `duration_ms`, etc.) are never dropped by `emit-event.sh`'s whole-line
  truncation

#### Scenario: Server that never becomes healthy reports a first error
- **WHEN** `start-servers.sh` gives up waiting for a backend or frontend
  server to become healthy and is about to exit non-zero
- **THEN** the emitted `gate.result` event's `first_error` field identifies
  the health URL that was polled and the timeout that elapsed

### Requirement: Existing stdout and telemetry-safety contracts are preserved
Adding `duration_ms` and `first_error` SHALL NOT change any byte of `assert-phase.sh`'s or `start-servers.sh`'s existing `READY` / `PASS` / `FAIL` stdout or stderr contract, and every `gate.result` emission SHALL remain guarded so that a telemetry failure can never fail the calling script.

#### Scenario: stdout contract unchanged on pass
- **WHEN** `assert-phase.sh` or `start-servers.sh` succeeds
- **THEN** stdout contains exactly the same `PASS <phase>` / `READY
  <label>=<url>` lines, in the same format, as before this change

#### Scenario: stdout contract unchanged on failure
- **WHEN** `assert-phase.sh` fails a phase
- **THEN** stderr's `FAIL <reason>` lines and the process exit code are
  unchanged from before this change

#### Scenario: start-servers.sh failure output unchanged
- **WHEN** `start-servers.sh` gives up waiting for a server to become
  healthy
- **THEN** stderr's `FAIL <label> did not become healthy ...` line and the
  process exit code (`1`) are byte-for-byte unchanged from before this
  change

#### Scenario: telemetry failure never propagates
- **WHEN** `emit-event.sh` itself fails or cannot write (e.g. an unwritable
  run directory)
- **THEN** `assert-phase.sh` and `start-servers.sh` continue to their normal
  exit path (`|| true` on every emit call) rather than failing due to the
  telemetry call
