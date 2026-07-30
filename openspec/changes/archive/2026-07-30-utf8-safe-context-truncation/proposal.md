## Why

`core/scripts/emit-event.sh`'s oversized-escalation-context truncation (added by CON-11)
cuts the context string at a raw byte boundary (`LC_ALL=C cut -b`) to fit the 4000-byte
event-line cap. A multi-byte UTF-8 character straddling that cut point is split, leaving a
lone continuation byte in the emitted JSON string. `JSON.parse` may then reject the whole
line — the reducer counts it malformed and drops it, so the escalation vanishes from the
dashboard rather than showing truncated. `core/scripts/assert-phase.sh`'s `first_error`
trimming (`${msg:0:200}`) is the same family of bug at a different layer: bash's substring
indexing is character-safe only when the ambient locale is UTF-8, and is silently
byte-oriented (splitting a multi-byte character the same way) in a `C`/`POSIX` locale — the
common case for a minimal CI or container environment. Neither cut currently guards against
this regardless of locale.

## What Changes

- `emit-event.sh`'s `write_escalation_raised()` binary search stops handing `cut -b`'s raw
  byte-boundary prefix to the marker/JSON builder. It backs off to the last whole UTF-8
  character before the cut, using a small node helper (node is already a hard dependency of
  this script) so behavior is identical regardless of the calling shell's locale.
- The truncation marker's reported byte count changes from "the byte budget requested for
  this candidate" to "the actual byte length of the (possibly further-backed-off) prefix
  shown" — so the marker never overstates how much context is inline.
- `assert-phase.sh`'s `fail()` stops relying on bash's locale-dependent `${msg:0:200}` and
  instead trims `FIRST_ERROR` with the same character-boundary-safe approach, so a message
  containing a multi-byte character at position ~200 never gets truncated into a partial
  sequence regardless of the environment's locale.
- New tests in `test/scripts/emit-event.test.sh` and `test/scripts/assert-phase.test.sh`
  place multi-byte characters (including a 4-byte emoji) deliberately across the existing
  truncation boundary and assert the emitted line is valid JSON whose decoded, truncated
  field ends on a whole character.

No new capability, no external dependency, no breaking change — this is a correctness fix
to logic introduced by CON-11 and to a pre-existing helper in `assert-phase.sh`, confined to
two scripts and their tests.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `escalation-context`: the "Oversized context is truncated visibly and the full text is
  persisted via persist-evidence.sh" requirement gains a normative guarantee that the
  truncation point never splits a UTF-8 character, and that the reported byte count in the
  marker is honest about what is actually shown inline.
- `gate-telemetry`: the "Failing gate.result events carry the first error line" requirement
  gains the same normative guarantee for `assert-phase.sh`'s `first_error` trimming — the
  200-character source-side trim never splits a multi-byte UTF-8 character, regardless of the
  calling shell's locale.

## Impact

- `core/scripts/emit-event.sh` (and its rendered copy `scripts/concertino/emit-event.sh`,
  refreshed via `concertino sync`).
- `core/scripts/assert-phase.sh` (and its rendered copy).
- `test/scripts/emit-event.test.sh`, `test/scripts/assert-phase.test.sh`.
- `openspec/specs/escalation-context/spec.md` (delta only — the observable contract for
  callers of `gather-escalation-context.sh` and the escalation screen is unchanged; only the
  emitter's own truncation-safety guarantee is strengthened).
- `openspec/specs/gate-telemetry/spec.md` (delta only — the `first_error` field's shape and
  meaning are unchanged; only its trimming's UTF-8 safety is strengthened).
