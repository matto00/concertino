## Why

`core/scripts/cleanup.sh`'s fast-forward step raises a blocking escalation when it can't fast-forward
local `main` cleanly, and re-attempts once on a `retry` answer — but if that retry still doesn't land
on `updated`/`current`, the script only writes an `echo >&2` note before falling straight through to
`run.end status=delivered`. That note never reaches the dashboard or the event log, so a run whose
`retry` didn't actually fix anything is indistinguishable from a run that finished cleanly. CON-90
through CON-94's event tails show exactly this: `retry` answered, `run.end status=delivered` about a
second later, no trace of whether the retry actually worked. (Resolved via escalation, CON-99: the
run should still terminate as `delivered` when the PR is genuinely merged — the fast-forward is a
Phase-4 nicety, not a reason to fail an already-shipped ticket — but this outcome must stop being
silent.)

## What Changes

- `core/scripts/cleanup.sh`: when the post-`retry` fast-forward attempt still isn't `updated`/
  `current` (i.e. it's still `dirty`, `diverged`, `failed`, `fetch-failed`, or `no-local-base`), emit
  a `gate.warning` telemetry event via `emit-event.sh` — the same event kind and dashboard-visibility
  mechanism `assert-phase.sh delivery`'s stale-base warning already established (`delivery-stale-base-warning`,
  CON-80) — carrying `gate=phase:cleanup`, the ticket, and enough detail to distinguish a
  confirmed-still-behind outcome from an unknown one (the retry itself couldn't fetch/resolve the
  local base). This is in addition to, not a replacement for, the existing stderr note.
- Phase 4's behavior is otherwise unchanged: `cleanup.sh --phase4` still always exits 0, `run.end
  status=delivered` still fires unconditionally, and no new blocking escalation is introduced. The fix
  is purely about making an already-known outcome visible, not about gating on it.
- `openspec/specs/main-fast-forward/spec.md`: the existing "second unresolved failure...SHALL log a
  note and proceed without re-escalating" requirement is extended to also require the `gate.warning`
  telemetry event described above.

## Capabilities

### New Capabilities

(none — this extends the existing `main-fast-forward` capability's telemetry, it doesn't introduce a
new one)

### Modified Capabilities

- `main-fast-forward`: the "An unresolvable fast-forward escalates with a bounded retry/skip loop"
  requirement's second-consecutive-failure behavior now also emits a `gate.warning` event (in addition
  to the existing stderr note), so the run's event log — and therefore the dashboard — can distinguish
  this outcome from a clean run. The bounded retry/skip loop itself, and the "always exits 0" contract,
  are unchanged.

## Impact

- `core/scripts/cleanup.sh` (source of truth) and its synced copy `scripts/concertino/cleanup.sh`
  (re-synced via `concertino sync`, not hand-edited directly).
- `openspec/specs/main-fast-forward/spec.md`.
- `test/scripts/cleanup.test.sh` (new coverage for the `gate.warning` emission on both the
  confirmed-still-behind and unknown-state second-failure outcomes).
- No dashboard/reducer changes required: `gate.warning` is an already-established event kind that
  surfaces generically in the run's event log/timeline without needing new reducer handling (mirroring
  how `delivery-stale-base-warning`'s own `gate.warning` events already work with no dedicated
  reducer case).
