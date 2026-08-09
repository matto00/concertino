## 1. Root-cause write-up (AC bullet 1)

- [x] 1.1 Confirm the mechanism in `core/scripts/cleanup.sh:164-196`: on a `retry` answer whose
      re-attempted `attempt_fast_forward` still doesn't land on `updated`/`current`, only an
      `echo >&2` note is written before falling through to `run.end status=delivered` — no
      re-raise, no telemetry, nothing the dashboard can see. Record this confirmation (this is
      what `proposal.md`'s "Why" and `design.md`'s "Context" already capture from the
      orchestrator's own read of the file — verify it still holds against the current code before
      implementing).

## 2. Implement the `gate.warning` telemetry (AC bullet 2)

- [x] 2.1 In `core/scripts/cleanup.sh`, after the existing `retry` block's note logic (the
      `if`/`elif` at `:181-194`), add: whenever the retried `attempt_fast_forward` does not resolve
      to `updated` or `current` (i.e. any of `dirty`, `diverged`, `failed`, `fetch-failed`, or
      `no-local-base`), emit a `gate.warning` event via `emit-event.sh`, mirroring
      `assert-phase.sh delivery`'s existing `gate.warning` call site (`core/scripts/assert-phase.sh`
      around line 169) for shape/style: `ticket="$T"`, `gate=phase:cleanup`, `resolved=false`, and
      `reason=` distinguishing the two cases:
      - `fetch-failed`/`no-local-base` → a reason stating the base state is unknown (reuse
        `UNKNOWN_REASON` from the existing `fetch-failed`/`no-local-base` branch).
      - `dirty`/`diverged`/`failed` → a reason stating `main` remains behind (reuse `FF_REASON`
        from the existing branch, same as the stderr `NOTE` text).
      Call `emit-event.sh` the same best-effort way every other call site in this script already
      does (`... || true`) — a telemetry failure must never fail `cleanup.sh --phase4`.
- [x] 2.2 Do NOT change: the existing `retry`/`skip` bounded-loop shape (still exactly one
      re-attempt), `cleanup.sh --phase4`'s exit code, or the unconditional `run.end
      status=delivered` at the bottom of the script.
- [x] 2.3 Re-sync `scripts/concertino/cleanup.sh` from `core/scripts/cleanup.sh` (the two are
      identical, synced copies — confirm via `concertino sync` or by diffing after the edit,
      whichever this repo's normal workflow uses) so the two do not drift.

## 3. Spec

- [x] 3.1 Confirm `openspec/changes/gate-cleanup-retry-outcome/specs/main-fast-forward/spec.md`'s
      MODIFIED requirement matches the implemented behavior exactly (field names `resolved=`/
      `reason=`, `gate=phase:cleanup`, and the four scenarios).

## 4. Tests

- [x] 4.1 In `test/scripts/cleanup.test.sh`, add coverage for: a `retry` that resolves the dirty/
      diverged/failed state (no `gate.warning` emitted — existing behavior, add an explicit
      `hasnt` assertion if not already covered).
- [x] 4.2 Add coverage for: a `retry` whose re-attempt still lands on `dirty` (or `diverged`/
      `failed`) — assert a `gate.warning` event is present with `gate=phase:cleanup`,
      `resolved=false`, and a `reason=` naming `main` as still behind; assert `cleanup.sh` still
      exits 0 and `run.end status=delivered` is still emitted.
- [x] 4.3 Add coverage for: a `retry` whose re-attempt lands on `fetch-failed` or `no-local-base`
      — assert a `gate.warning` event is present with `resolved=false` and a `reason=` naming the
      state as unknown (not "behind"); assert `cleanup.sh` still exits 0 and `run.end
      status=delivered` is still emitted.
- [x] 4.4 Add coverage for: the first escalation answered `skip` (no retry at all) — assert no
      `gate.warning` event is emitted (this path was already covered by the existing note logic
      being skipped entirely; confirm the new code doesn't accidentally fire here too).
- [x] 4.5 Run the full existing `test/scripts/cleanup.test.sh` suite plus
      `test/scripts/assert-phase.test.sh` (shares the `gate.warning` pattern) to confirm no
      regressions.

## 5. Verification gates

- [x] 5.1 `openspec validate gate-cleanup-retry-outcome --strict` passes.
- [x] 5.2 Run this repo's normal test/verification command(s) (see `package.json`/CI config) and
      confirm they pass, including the new/updated `cleanup.test.sh` coverage.
