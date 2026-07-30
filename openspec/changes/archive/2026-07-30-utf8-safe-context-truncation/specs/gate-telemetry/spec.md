## MODIFIED Requirements

### Requirement: Failing gate.result events carry the first error line
When `assert-phase.sh` or `start-servers.sh` emits a `gate.result` event with `status` `"fail"`, the event SHALL include a `first_error` field containing the first failure message recorded for that gate, trimmed at the source to a bounded length so the event stays well under the 4000-byte per-line cap enforced by `emit-event.sh`. That source-side trim to at most 200 characters SHALL NOT split a multi-byte UTF-8 character, regardless of the calling shell's locale — an all-ASCII message longer than 200 characters SHALL still be trimmed to exactly 200 characters, matching this requirement's pre-existing behavior.

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

#### Scenario: An oversized all-ASCII failure message is trimmed to exactly 200 characters
- **WHEN** a gate check fails with a message longer than 200 ASCII characters
- **THEN** the `gate.result` event's `first_error` field is exactly 200 characters long and is
  a prefix of the untrimmed message

#### Scenario: A multi-byte character at the trim boundary is never split
- **WHEN** a gate check fails with a message containing a multi-byte UTF-8 character (e.g. an
  emoji) positioned at or across the 200-character trim boundary
- **THEN** the `gate.result` event's `first_error` field is valid UTF-8 text ending on a whole
  character, never a partial multi-byte sequence, regardless of the environment's locale
