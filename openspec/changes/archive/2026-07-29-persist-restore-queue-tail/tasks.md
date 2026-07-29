## 1. Queue persistence module

- [x] 1.1 Create `lib/ui/queue-cache.js` following `lib/ui/cache.js`'s pattern: `cacheDir` reuse (or its own path under `.concertino/cache/`), `path()`, `read()`, `write()` via temp-file + rename, `clear()`.
- [x] 1.2 `read()` returns "empty" (no queue) for a missing file, malformed JSON, or a record failing shape validation (must have `pending: string[]`, `maxConcurrent: number`, `writtenAt: number`) — never throws.
- [x] 1.3 `write(root, queue, sessionId, now)` serializes `{ sessionId, writtenAt, maxConcurrent, launchCommand, pending, inFlight }` — ticket ids and metadata only, no ticket bodies.
- [x] 1.4 Add a staleness check helper (e.g. `isStale(record, now, boundMs)`) with a default bound of 24 hours, used by the restore path in `watch.js`.

## 2. `queue.js` restore-reconciliation

- [x] 2.1 Add a `reconcileRestored(record, runs)` (or similarly named) function to `lib/ui/queue.js` that filters `record.pending` through the existing `isRunLive` predicate against `runs`, returning the still-eligible pending ids (mirrors `tick()`'s own pending-filter logic — reuse rather than duplicate where practical).
- [x] 2.2 The same function (or a paired one) also reconstructs `inFlight`: filter `record.inFlight` through `isRunLive` against the same `runs` snapshot, and return the still-live ids as the restored queue's `inFlight` Set — a ticket genuinely still running at restart time must keep occupying its concurrency slot (design.md Decision 5a), or a `maxConcurrent: 1` batch can silently become concurrent across a restart.
- [x] 2.3 `createQueue` (or a new `createRestoredQueue`) produces a queue object carrying the reconciled `pending`, the reconstructed `inFlight` Set, `confirmed: false`, and a `restoredFrom: { sessionId, writtenAt }` field when built from a restored record, vs. `confirmed: true` (mandatory, always set explicitly — never left absent/undefined, so `watch.js`'s `queueState.confirmed !== false` guard is unambiguous for every queue object either path produces) and an empty `inFlight` for a normal same-session queue.
- [x] 2.4 If reconciliation leaves both `pending` and `inFlight` empty, the caller (watch.js, task 3.3) must restore nothing rather than set an empty confirmable queue.
- [x] 2.5 Export whatever new functions/fields are needed from `lib/ui/queue.js`'s `module.exports`.

## 3. `watch.js` wiring

- [x] 3.1 At the existing single `queue.tick()` call site: after computing the next queue, write it via `queue-cache.js` when non-idle, delete the file when idle (mirroring the existing `queueState = queue.isIdle(...) ? null : result.queue` line).
- [x] 3.2 Guard the `queue.tick()` call itself so it is only invoked when `queueState.confirmed` is not `false` (an unconfirmed restored queue never ticks, never launches).
- [x] 3.3 On dashboard startup, before entering the alt-screen/poll-timer loop and before `queueState` is otherwise assigned, compute one explicit, one-off `reduce(store.readAll(root), sampleWindows(now), now)` pass — `runs = []` at that point in `watch.js` today, and `draw()`'s regular `queue.tick()` call site runs before its own `reduce()` every poll, so no "first computed runs snapshot" exists implicitly (design.md Decision 5). Read `queue-cache.js`, apply the staleness bound, reconcile `pending` and `inFlight` via `queue.reconcileRestored` against that one-off snapshot, and — only if any pending or in-flight ids remain (task 2.4) — set `queueState` to the restored, unconfirmed queue. This one-off snapshot is used only for this reconciliation and is not cached or reused by the regular per-poll `draw()` loop.
- [x] 3.4 Add a `confirm-restored-queue` (or similarly named) action/key handler in the fleet mode key-dispatch path that flips `queueState.confirmed` to `true` without altering pending/in-flight contents, gated on a restored-and-unconfirmed queue actually being present.
- [x] 3.5 Update the `queueState` doc comment (currently describing the in-memory-only trade) to describe the new persisted/restore behavior and point at `design.md`/this change instead of describing a still-open trade-off.

## 4. `fleet.js` rendering

- [x] 4.1 Render a distinct QUEUED-section affordance when `queueState.confirmed === false`: list the restored pending ticket ids (with cached titles where available, same lookup as the normal QUEUED rows) and a "resumed from a previous session — press <key> to continue" line naming the actual confirm key chosen in 3.4.
- [x] 4.2 Ensure the unconfirmed-queue rendering still participates correctly in the existing row-index / trimming contracts already specified for `QUEUED` (no regression to the CON-28 requirements around selection-index skipping and height-budget trimming).

## 5. Tests

- [x] 5.1 Unit tests for `queue-cache.js`: write-then-read round trip; missing file reads as empty; malformed JSON reads as empty; a record missing required fields reads as empty; staleness bound rejects an old `writtenAt`.
- [x] 5.2 Unit tests for `queue.js`'s reconciliation function: a pending id already live in `runs` is dropped; a pending id not live survives; an empty result after reconciliation is correctly reported as empty.
- [x] 5.3 Test (unit or integration, whichever the existing `watch.js`/`queue.js` test suite uses) that an unconfirmed restored queue's `tick()` is never invoked until confirmed, and that confirming does not mutate pending/in-flight contents.
- [x] 5.4 Fleet-screen render test for the new unconfirmed-queue affordance, and a regression check that the existing QUEUED row-index/trimming scenarios (from `fleet-queue-visibility`'s current spec) still pass unchanged for a normal (confirmed / same-session) queue.
- [x] 5.5 Confirm no ticket titles/descriptions ever appear in a written `queue.json` fixture (a persistence-shape assertion, not just a manual read).

## 6. Verification

- [x] 6.1 Run the full test suite and lint/typecheck gates used elsewhere in this repo's executor workflow.
- [x] 6.2 Manually verify (or via test harness) the end-to-end scenario: queue a batch, kill the dashboard process before any ticket starts, restart `concertino watch`, observe the unconfirmed affordance, confirm, observe ticks resume launching as normal.
