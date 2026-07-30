## 1. `lib/ui/queue.js`: reconciliation

- [x] 1.1 In `reconcileRestored(record, runs)`, for each pending ticket id
      not already dropped for being live, look up its run in `runs` and
      check whether `run.status` is `'done'`/`'failed'` and `run.endedAt` is
      a number strictly greater than `record.writtenAt`. If so, drop it from
      `pending` and add it to a new `completedDuringDowntime` array instead.
- [x] 1.2 Return `completedDuringDowntime` (always an array, possibly empty)
      alongside the existing `pending`/`inFlight` from `reconcileRestored`.
- [x] 1.3 Refactor `createRestoredQueue(record, runs)` to call
      `reconcileRestored` exactly once (either directly, or by having
      `watch.js` call `reconcileRestored` once and pass the already-computed
      `{ pending, inFlight, completedDuringDowntime }` in) — there must be
      exactly one reconciliation pass over `runs`, not two independently
      computed ones, so `completedDuringDowntime` can never diverge from
      what `pending`/`inFlight` were actually reconciled against.
- [x] 1.4 Do **not** thread `completedDuringDowntime` onto
      `createRestoredQueue`'s return value or nest it under `restoredFrom`.
      `createRestoredQueue`'s existing "both `pending` and `inFlight` empty
      -> return `null`" rule is unchanged by this ticket (confirmed correct
      by design.md Decision 3) — `completedDuringDowntime` must remain
      readable by the caller (`watch.js`) independently of whatever
      `createRestoredQueue` itself returns, including `null`. Do not repeat
      the first draft's mistake of nesting it somewhere only reachable
      through a non-null queue object.

## 2. `lib/ui/watch.js`

- [x] 2.1 Add a new module-scoped `restoreNotice` variable (parallel to the
      existing `queueNotice` variable — same sticky "set once, persists
      until overwritten" lifecycle, no expiry logic needed) initialized to
      `null`.
- [x] 2.2 In the startup restore block (around the existing
      `queue.createRestoredQueue(queueRecord, startupRuns)` call site),
      obtain `completedDuringDowntime` from the single reconciliation pass
      (task 1.3) and, if non-empty, set `restoreNotice` to a message naming
      the dropped ticket ids (e.g. "N ticket(s) completed while you were
      away and were not restored: CON-12, CON-14"). This must run
      regardless of whether `createRestoredQueue` returns a non-null queue
      or `null`.
- [x] 2.3 Thread `restoreNotice` through to `draw()`'s render options
      alongside the existing `queueNotice`/`queueState` (same call site,
      same pattern as the existing options object).

## 3. `lib/ui/screens/fleet.js`: banner

- [x] 3.1 In `buildHeadTail`, render `restoreNotice` (new option, distinct
      from `queueNotice`) as its own tail line whenever it is non-empty —
      gated ONLY on the notice itself being present, not on `queueState`
      being non-null and not on `queueState.confirmed === false`. It may
      render with or without the existing "resumed from a previous session"
      line, in either order combination.
- [x] 3.2 Use the same `f.yellow`/truncate pattern as the existing restore
      affordance line, truncated to the available column width the same way
      `queueNotice` already is.

## 4. Tests

- [x] 4.1 `test/queue.test.js`: a pending id whose run is terminal with
      `endedAt > record.writtenAt` is dropped from `pending` and appears in
      `completedDuringDowntime`.
- [x] 4.2 `test/queue.test.js`: a pending id whose run is terminal with
      `endedAt <= record.writtenAt` survives into `pending` and does NOT
      appear in `completedDuringDowntime`.
- [x] 4.3 `test/queue.test.js`: a pending id with no run object in `runs` at
      all survives into `pending`, `completedDuringDowntime` stays empty —
      unaffected by this change (still indistinguishable from "never
      started" for a genuinely absent run, since there is nothing to
      distinguish it with).
- [x] 4.4 `test/queue.test.js`: `createRestoredQueue` still returns `null`
      when every pending id is dropped via `completedDuringDowntime` and no
      persisted `inFlight` id survives — confirms task 1.4's invariant is
      actually upheld, not just asserted in prose. Assert this using
      whatever entry point task 1.3 settles on for computing
      `completedDuringDowntime` (e.g. call `reconcileRestored` directly
      alongside `createRestoredQueue` in the test and check both).
- [x] 4.5 `test/queue.test.js`: the existing "reconciliation that empties
      both pending and in-flight restores nothing" test still passes
      unmodified.
- [x] 4.6 `test/fleet.test.js`: the new banner line renders from a
      `restoreNotice`-shaped option independent of `queueState` — including
      the case where `restoreNotice` is set but `queueState` is `null`
      (nothing left to restore, but something finished during the
      downtime), and the case where `queueState` is a normal restored queue
      with `restoreNotice` absent (no such line rendered).
- [x] 4.7 `test/watch.test.js` (if the startup restore block is covered
      there): confirm `restoreNotice` gets set when reconciliation drops the
      entire pending list via `completedDuringDowntime`, even though
      `queueState` stays unassigned in that case. N/A: verified the startup
      restore block (`queue.createRestoredQueue`/the `startupRuns` one-off
      reduce pass) is not covered by `test/watch.test.js` today (confirmed by
      `grep -n "createRestoredQueue|startupRuns" test/watch.test.js` — no
      matches), so this task's condition does not apply.

## 5. Verification

- [x] 5.1 Run the full test suite and lint; fix any regressions.
- [x] 5.2 Manually trace through `openspec validate` for this change to
      confirm the spec delta is well-formed.
