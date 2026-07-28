## Why

`core/scripts/start-servers.sh` emits `gate.result status=pass` when a server
starts or is reused, but its failure path (`wait_for` timing out) goes
straight to `exit 1` with no emission at all. A server that never becomes
healthy is telemetrically indistinguishable from a server that was never
configured — both produce zero `server:<label>` events — so the drill-down
gate panel has no row for the most informative failure in the run, and the
fleet screen's `gates N/M` count silently loses its denominator for that
gate. CON-1 scoped this out deliberately; this change closes the gap.

## What Changes

- `core/scripts/start-servers.sh` emits `gate.result` with `status=fail`,
  `duration_ms`, and `first_error` (the health URL and timeout elapsed)
  immediately before its existing `exit 1`, guarded with `|| true` like every
  other emit in the script.
- This coexists with the existing BLOCKER/environmental treatment (the
  `FAIL ... exit 1` behavior is unchanged) — the new emission only adds a row
  to the telemetry stream; it does not change how the orchestrator or human
  is alerted.
- The existing stdout/stderr `FAIL <reason>` line and `exit 1` are unchanged,
  byte for byte.
- `scripts/concertino/start-servers.sh` is re-rendered from `core/` via
  `concertino sync` so the two copies stay byte-identical.
- The `gate-telemetry` spec (`openspec/specs/gate-telemetry/spec.md`) is
  updated: the "Failing gate.result events carry the first error line"
  requirement currently scopes `first_error` to `assert-phase.sh` only; it is
  broadened to also cover `start-servers.sh`'s new failure emission.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gate-telemetry`: `start-servers.sh` now emits a failing `gate.result`
  (`status=fail`, `duration_ms`, `first_error`) when a server fails its
  health wait, symmetric with `assert-phase.sh`'s existing failing-path
  emission. Three requirements in the spec are modified: "gate.result events
  carry a duration" gains a failing server-start scenario; "Failing
  gate.result events carry the first error line" broadens scope from
  "`assert-phase.sh` only" to "`assert-phase.sh` or `start-servers.sh`" and
  gains a server-health-timeout scenario; "Existing stdout and
  telemetry-safety contracts are preserved" gains a scenario asserting
  `start-servers.sh`'s failure stderr/exit-code stay unchanged.

## Impact

- `core/scripts/start-servers.sh` (source of truth).
- `scripts/concertino/start-servers.sh` (re-rendered copy, via `concertino sync`).
- `openspec/specs/gate-telemetry/spec.md` (delta: broaden `first_error` scope).
- `test/scripts/start-servers.test.sh`: new case covering the failure-path
  emission (`status=fail`, numeric `duration_ms`, non-empty `first_error`),
  and confirming stdout/stderr/exit-code are unchanged.
- No change to `lib/ui/reducer.js` — it already reads `duration_ms` and
  `first_error` generically off any `gate.result` event.
