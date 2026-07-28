# CON-8: start-servers.sh emits no gate.result when a server never becomes healthy

Priority: Medium
URL: https://linear.app/helioapp/issue/CON-8/start-serverssh-emits-no-gateresult-when-a-server-never-becomes

## Description

Follow-up from CON-1 (PR #3).

`core/scripts/start-servers.sh` emits `gate.result` with `status=pass` when a
server is started or reused, but the failure path has no emission at all —
`wait_for` failing leads straight to `exit 1`:

```sh
if ! wait_for "$url" "$timeout"; then
  ...
  exit 1
fi
...
# gate.result status=pass emitted only after this point
```

So in the telemetry stream, a server that never comes up is indistinguishable
from a server that was never configured: both produce zero `server:<label>`
events. The drill-down gate panel shows nothing where the most informative
failure in the run actually happened, and the fleet screen's `gates N/M`
count silently loses its denominator for that gate.

CON-1's design doc lists this as an explicit non-goal ("a server that never
becomes healthy is treated as an environmental `BLOCKER`, not a gate
result"), which is a defensible scoping call for that ticket but leaves the
gap open. The BLOCKER path tells the human something is wrong; it doesn't put
a row in the gate panel, and the panel is what the drill-down design leans
on.

## Suggested approach

Emit `gate.result` with `status=fail`, `duration_ms`, and a `first_error`
(e.g. the health URL and timeout that elapsed) immediately before the
`exit 1`, guarded with `|| true` like every other emit. This is symmetric
with what `assert-phase.sh` now does on its failing path. Decide whether it
should coexist with or replace the BLOCKER treatment — they answer different
questions, so coexisting is probably right.

## Acceptance criteria

* A server that fails its health wait produces a `gate.result` event with
  `gate=server:<label>`, `status=fail`, `duration_ms`, and `first_error`.
* The existing stdout/stderr output and the `exit 1` are unchanged.
* Telemetry still cannot fail the run — the new emit is `|| true`.
* `scripts/concertino/start-servers.sh` re-rendered via `concertino sync` so
  it stays byte-identical to `core/scripts/`.
* The `gate-telemetry` spec (`openspec/specs/gate-telemetry/spec.md`) is
  updated — it currently scopes `first_error` to `assert-phase.sh` only.
* `test/scripts/start-servers.test.sh` covers the new failure emission.
