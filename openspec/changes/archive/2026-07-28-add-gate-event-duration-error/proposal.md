## Why

The dashboard reducer (`lib/ui/reducer.js`, the `gate.result` case) already reads
`duration_ms` and `first_error` off `gate.result` events, and the fleet screen's
`gates N/M` count depends on them. No emitter ever writes those fields —
`core/scripts/assert-phase.sh` and `core/scripts/start-servers.sh` emit only
`gate`, `status`, and `ticket`. Today that's invisible because the fleet view
only counts passes. The slice-2 drill-down design adds a gate panel with
per-gate timings and the first error line of a failure — with no emitter, that
panel renders empty. This closes the gap before slice 2 needs it.

## What Changes

- `core/scripts/assert-phase.sh` measures wall-clock duration around the phase's
  checks and emits it as `duration_ms` (integer milliseconds) on every
  `gate.result` it already writes (both the pass and fail paths).
- `core/scripts/start-servers.sh` measures wall-clock duration around each
  server's start-and-health-wait and emits it as `duration_ms` on the
  `gate.result` it already writes on success.
- On `assert-phase.sh`'s failing path, the emitted `gate.result` gains
  `first_error`: the first line of the accumulated failure output, trimmed at
  the source to a safe length so the rest of the event line survives the
  4000-byte cap in `emit-event.sh`.
- No new emission call sites are added — `start-servers.sh` has no existing
  failure-path `gate.result` emit today (a server that never becomes healthy is
  a `BLOCKER`, not a gate result), so this change does not introduce one.
- The `READY` / `PASS` / `FAIL` stdout contracts of both scripts are unchanged,
  byte for byte. `duration_ms` and `first_error` are additive fields on the
  telemetry event only.
- Every emission stays `|| true` — telemetry can still never fail a delivery
  run.
- `scripts/concertino/assert-phase.sh` and `scripts/concertino/start-servers.sh`
  are re-rendered from `core/` via `concertino sync` so this project's own
  rendered copies match (per the documented core-edit workflow).

## Capabilities

### New Capabilities

- `gate-telemetry`: the contract for what a `gate.result` event carries —
  required fields (`gate`, `status`), and the conditions under which
  `duration_ms` and `first_error` are present, sized, and truncated.

### Modified Capabilities

(none — no existing specs directory; this is the first capability spec for the
gate-result event contract.)

## Impact

- `core/scripts/assert-phase.sh`, `core/scripts/start-servers.sh` (source of truth).
- `scripts/concertino/assert-phase.sh`, `scripts/concertino/start-servers.sh`
  (re-rendered copies, via `concertino sync`).
- New shell tests under `test/scripts/` covering a passing gate with a duration
  and a failing gate with a `first_error` line.
- No change to `lib/ui/reducer.js` — it already reads these fields.
- No change to the `emit-event.sh` truncation contract.
