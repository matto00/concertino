# CON-7: gate.result duration_ms is quantized to whole seconds

## Description

Follow-up from CON-1 (PR #3).

`duration_ms` is now emitted on every `gate.result`, but it is measured with `date +%s` deltas multiplied by 1000:

```sh
START_TS="$(date +%s)"
...
DURATION_MS=$(( ($(date +%s) - START_TS) * 1000 ))
```

So every value is a multiple of 1000. A 40 ms `setup` gate reports `0`; a 999 ms gate reports `0`; a 1001 ms gate reports `1000`. For the drill-down gate panel — the consumer this field exists for — the timings column is effectively a coarse bucket, not a measurement, and the fastest gates (setup, cleanup, which are just filesystem stats) will read `0 ms` essentially always.

CON-1's design doc considered and consciously accepted this (see `openspec/changes/archive/2026-07-28-add-gate-event-duration-error/design.md`, "Alternative considered: `date +%s%3N`"), rejecting it because reusing millisecond timing "would require sourcing it or duplicating its BSD/macOS `%3N` fallback in two more places." That reasoning is about cost, and the cost is small: `core/scripts/emit-event.sh` already has a working, portable `now_ms()` at line 31 that is 8 lines long and already handles the BSD/macOS case by falling back to `node -e 'Date.now()'`.

## Suggested approach

Factor `now_ms()` out of `emit-event.sh` into something both `assert-phase.sh` and `start-servers.sh` can source (or duplicate the 8 lines, matching the existing convention that these scripts stay standalone), and measure with it. Keep the field name and type — this is a precision fix, not a contract change, so the reducer and the `gate-telemetry` spec need no update beyond possibly tightening the wording.

## Acceptance criteria

* `duration_ms` on `gate.result` reflects true millisecond resolution, not multiples of 1000.
* Portability is preserved: works where `date +%s%3N` is unsupported (macOS/BSD).
* The `READY` / `PASS` / `FAIL` stdout contracts stay byte-for-byte unchanged.
* Telemetry still cannot fail a run — every emit stays `|| true`.
* Tests assert a sub-second gate reports a non-zero, non-1000-multiple duration.

## Linear

- ID: CON-7
- URL: https://linear.app/helioapp/issue/CON-7/gateresult-duration-ms-is-quantized-to-whole-seconds
- Related: CON-1 (PR #3), design doc at `openspec/changes/archive/2026-07-28-add-gate-event-duration-error/design.md`
