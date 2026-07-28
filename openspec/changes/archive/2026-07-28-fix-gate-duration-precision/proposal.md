## Why

`gate.result` events emitted by `assert-phase.sh` and `start-servers.sh` carry a `duration_ms` field, but it is measured with whole-second `date +%s` deltas multiplied by 1000. Every value is therefore a multiple of 1000: a 40 ms `setup` gate and a 999 ms gate both report `0`. For the drill-down gate panel — the sole consumer this field exists for — the timings column is a coarse second-bucket, not a measurement, and the fastest gates (`setup`, `cleanup`) read `0 ms` essentially always. CON-1's design doc consciously accepted this for cost reasons, but the cost is small: `emit-event.sh` already has a working, portable `now_ms()` that is 8 lines long.

## What Changes

- Replace the `date +%s` / `* 1000` duration measurement in `core/scripts/assert-phase.sh` and `core/scripts/start-servers.sh` with true millisecond-resolution timestamps, matching `emit-event.sh`'s existing `now_ms()` behavior (GNU `date +%s%3N`, falling back to `node -e 'Date.now()'` on BSD/macOS where `%3N` is unsupported).
- Duplicate the 8-line `now_ms()` helper into `assert-phase.sh` and `start-servers.sh` rather than sourcing `emit-event.sh`, matching this codebase's existing convention that these scripts stay standalone (no cross-sourcing between procedure scripts).
- Apply the identical fix to the rendered copies in `scripts/concertino/` (this project runs concertino on itself; `core/scripts/` is the source of truth, `scripts/concertino/` is kept in sync via `concertino sync`).
- No change to field name, type, JSON shape, or the `READY`/`PASS`/`FAIL` stdout contracts — this is a precision fix only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gate-telemetry`: tighten the `duration_ms` requirement's wording so "an integer count of milliseconds" is explicit about resolution (measured with millisecond-resolution timestamps, not derived from whole-second deltas), and add a scenario covering sub-second gates.

## Impact

- `core/scripts/assert-phase.sh`, `core/scripts/start-servers.sh` (source of truth)
- `scripts/concertino/assert-phase.sh`, `scripts/concertino/start-servers.sh` (synced rendered copies)
- `test/scripts/assert-phase.test.sh`, `test/scripts/start-servers.test.sh` (new assertions for non-1000-multiple durations)
- No reducer, dashboard, schema-version, or event-shape changes (the consumer side already handles `duration_ms` as a plain integer).
