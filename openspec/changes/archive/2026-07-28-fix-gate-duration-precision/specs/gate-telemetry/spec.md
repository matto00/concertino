## MODIFIED Requirements

### Requirement: gate.result events carry a duration
Every `gate.result` event emitted by `core/scripts/assert-phase.sh` or `core/scripts/start-servers.sh` SHALL include a `duration_ms` field: an integer count of milliseconds, measured with millisecond-resolution timestamps (not derived from whole-second deltas), around the work that specific gate performed (the phase's checks in `assert-phase.sh`; the reuse-check-or-start sequence for one server in `start-servers.sh`).

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

#### Scenario: Sub-second gate reports true millisecond resolution
- **WHEN** a gate's checks complete in under one second
- **THEN** the emitted `gate.result` event's `duration_ms` field reflects the
  true elapsed milliseconds rather than always being `0` or another multiple
  of `1000`
