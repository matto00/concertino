# CON-1: Gate events carry no duration or error detail

## Description

The reducer reads `duration_ms` and `first_error` off `gate.result` events (`lib/ui/reducer.js`, the `gate.result` case), and the fleet screen surfaces a `gates N/M` count from them. But nothing in the codebase ever emits those two fields — `assert-phase.sh` and `start-servers.sh` emit only `gate`, `status` and `ticket`.

The consequence is invisible today because the fleet view only counts passes. It stops being invisible in slice 2: the drill-down design shows a gate panel with per-gate timings and the first error line of a failure, which is the single most useful thing on that screen. With no emitter, that panel renders empty.

### Why it matters

A gate result that says only `fail` tells you a run is stuck but not why. The whole point of the evidence-gated design is that a failure should be legible without attaching to the agent.

## Acceptance criteria

* `assert-phase.sh` and `start-servers.sh` emit `duration_ms` on every `gate.result`, measured around the work they actually do.
* On a failing gate, `first_error` carries the first line of the failure output, truncated to fit the 4000-byte event line cap.
* The existing `READY` / `PASS` / `FAIL` stdout contracts are unchanged, byte for byte.
* Telemetry still cannot fail a delivery run: every emit stays suffixed `|| true`.
* Shell tests cover a passing gate with a duration and a failing gate with a first-error line.

## Notes

`core/scripts/emit-event.sh` already truncates over-long lines via `write_line`, so a long error line degrades safely rather than tearing the log — but prefer trimming `first_error` at the source so the rest of the event survives.

## Metadata

- Priority: High
- URL: https://linear.app/helioapp/issue/CON-1/gate-events-carry-no-duration-or-error-detail
