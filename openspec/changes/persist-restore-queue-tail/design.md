## Context

`lib/ui/watch.js` holds `queueState` (built by `lib/ui/queue.js`) purely in memory. `queue.tick()` runs every poll, decides which pending tickets to launch against the live fleet snapshot, and returns the next `queue` state. The comment at `watch.js`'s `queueState` declaration documents the original trade explicitly and names the exact hazards a persistence fix has to answer: was a queued ticket launched by hand in the meantime, was it cancelled, is the cached ticket data stale, is the queue file itself just old. CON-28 added the `QUEUED` fleet section (`lib/ui/screens/fleet.js`) that a restore affordance can now render into. The existing `.concertino/cache/linear.json` (`lib/ui/cache.js`) is the established durable-cache pattern: temp-file + rename, and "cold/malformed reads as empty" rather than erroring.

## Goals / Non-Goals

**Goals:**
- Survive a dashboard crash/close/OOM during an unattended batch without losing the un-started tail.
- Never auto-launch anything the operator has not explicitly seen and confirmed after a restart — restoring a queue must be strictly safer than the status quo, not a new way to double-launch or run something unattended.
- A restored queue's concurrency accounting must match what it would have been had the dashboard never restarted: a ticket genuinely still in flight at restart time must continue to occupy a concurrency slot, so a `maxConcurrent: 1` (sequential) batch cannot silently become two tickets running at once across a restart.
- Reuse `queue.js`'s existing live-run predicate (`isRunLive`) for reconciliation rather than inventing a second notion of "already running".
- Keep the persisted file minimal: ticket ids + queue metadata only, no ticket bodies (`.concertino/` is gitignored, but the file is still not a place for sensitive content to accumulate).

**Non-Goals:**
- Persisting or resuming a queue across a *deliberate* quit with the tail explicitly discarded (the existing `quitConfirm` double-press flow already covers deliberate exit; this change is about crashes/closes, not about changing that flow's semantics).
- Multi-dashboard coordination beyond what the existing "drop if already live" check already provides — this change does not add locking or a notion of dashboard ownership.
- Re-attaching to or displaying in-flight runs as anything other than a concurrency-slot placeholder — the run itself is already durable via tmux + its own event log; restore only needs to remember that it occupies a slot, not to resume tracking its lifecycle in any richer sense than `queue.tick()` already does for a same-session queue.

## Decisions

### Decision 1: New sibling module `lib/ui/queue-cache.js`, not folded into `cache.js`
`cache.js`'s docstring and shape (`{ fetchedAt, tickets, epics }`) are specific to the Linear ticket fetch. Rather than overload it with a second, differently-shaped payload, add `lib/ui/queue-cache.js` that follows the exact same pattern (`cacheDir` reuse, temp-file + rename write, "malformed reads as empty" read) but owns its own path (`.concertino/cache/queue.json`) and record shape. This mirrors the codebase's existing convention of one small, single-purpose module per concern (`queue.js`, `cache.js`, `linear.js` are all already split this way) rather than growing a shared "misc persistence" module.

### Decision 2: Persisted record shape
```
{
  sessionId: <string>,       // random id, minted once per createQueue() call
  writtenAt: <epoch ms>,     // Date.now() at write time
  maxConcurrent: <number>,
  launchCommand: <string|null>,
  pending: [<ticket id>, ...],
  inFlight: [<ticket id>, ...],  // reconstructed into the restored queue's
                                   // concurrency accounting at restore time
                                   // (Decision 5a) — not diagnostics-only
}
```
No ticket titles, descriptions, or any other Linear payload — restoring re-resolves display titles from `cache.read(root)` exactly as the live queue already does today (`watch.js`'s `queuedTitles` lookup), so nothing sensitive needs to round-trip through the queue file.

`inFlight` is written for more than diagnostics (revised from an earlier draft of this design): it is the only record of how many concurrency slots were occupied at crash time, and restore must reconstruct that occupancy — see Decision 5a.

### Decision 3: Write on every `tick()` call site, delete on idle
`watch.js` has exactly one call site for `queue.tick()` (per its own comment). Immediately after that call, if the returned queue is non-idle, write it; if `queue.isIdle()` is true, delete the file (mirrors the existing `queueState = queue.isIdle(...) ? null : result.queue` line). This keeps the on-disk file's lifetime identical to the in-memory `queueState`'s, so there is exactly one steady invariant to reason about: **the file exists if and only if the last known in-memory queue was non-idle**, with the one exception being the just-restored, not-yet-confirmed window described in Decision 5.

### Decision 4: Staleness bound via `sessionId` + age, not a strict single-instance lock
A restore is only attempted when the file's `writtenAt` is within a fixed bound (24 hours — generous enough to cover an overnight batch discovered the next morning, tight enough that a three-day-old file is never sprung back to life, per the ticket's explicit requirement). `sessionId` is not used for locking (no second dashboard instance is prevented from running); it exists purely so a future diagnostic ("this queue was written by session X") has something to key on. Age, not session identity, is the actual staleness gate.

### Decision 5: Restore lands in a paused/unconfirmed state; reconciliation happens at restore time, against one explicit startup snapshot, not deferred

**What snapshot reconciliation runs against.** `watch.js` initialises `runs = []` at startup and only ever populates `runs` inside `draw()`'s `reduce(store.readAll(...), sampleWindows(now), now)` call — and `draw()`'s own `queue.tick()` call site deliberately runs *before* that `reduce()` in every subsequent poll, against the *previous* poll's snapshot (see `draw()`'s comment on why). There is no "first computed `runs` snapshot" available before the first `draw()`/poll — restore cannot piggyback on one implicitly. Startup therefore SHALL compute one **explicit, one-off** `reduce(store.readAll(root), sampleWindows(now), now)` pass — the same call `draw()` makes every poll, just invoked once, synchronously, before entering the alt-screen/poll-timer loop and before `queueState` is assigned. That pass's `runs` is the only snapshot restore-time reconciliation uses; the regular per-poll `draw()` loop is otherwise unchanged and does not reuse or cache this startup snapshot.

**Reconciling `pending`.** If a record passes the staleness bound, its `pending` list is reconciled against that startup snapshot using `queue.isRunLive` (the exact predicate `tick()` already uses) — any pending ticket already live is dropped right there, exactly as `tick()` would drop it, so the restored count the operator sees is already accurate rather than "N, some of which may vanish once you confirm." A ticket whose run reached a terminal state during the downtime is also absent from `runs` reconciliation concerns (it is simply not live, so it survives reconciliation and is legitimately re-offered) — **this is a known, accepted gap**: the design cannot distinguish "never ran" from "ran to completion while the dashboard was down" using only the live fleet snapshot, since a finished run's terminal event is available in its own event log but the fleet snapshot is keyed on windows/liveness, not exhaustive history. Mitigation: the restore affordance surfaces the ticket ids being restored so the operator can visually catch an already-completed ticket before confirming (open question, see below, on whether to cross-check completed runs' event logs here too).

### Decision 5a: Reconciling `inFlight` — a restored ticket still running must keep occupying its concurrency slot

`queue.tick()`'s concurrency accounting (`inFlight.size < maxConcurrent`) is queue-local state, never derived from `runs` — restoring `pending` correctly while leaving `inFlight` empty would let a ticket genuinely still running at restart time occupy zero tracked slots, so the very next tick after confirmation could launch a fresh ticket on top of it. For a `maxConcurrent: 1` (sequential) batch this silently turns "one at a time" into "two running at once" across a restart — exactly the hazard this change exists to close, not a diagnostics-only concern.

Restore therefore reconstructs `inFlight` the same way it reconciles `pending`: each id in the persisted record's `inFlight` list is checked with `queue.isRunLive` against the startup snapshot (Decision 5), and every id still live is seeded into the restored queue's `inFlight` Set — occupying a concurrency slot exactly as it would have had the dashboard never restarted. An `inFlight` id that is no longer live (the run finished or died during the downtime) is simply dropped, freeing that slot, mirroring how `tick()` already prunes `inFlight` on every poll.

**Combined restore result.** `queueState` is assigned `{ pending: <reconciled pending>, inFlight: <reconstructed Set>, maxConcurrent, launchCommand, confirmed: false, restoredFrom: { sessionId, writtenAt } }`, and `watch.js`'s tick call site is guarded: `if (queueState && queueState.confirmed !== false) { ...call queue.tick()... }`. `confirmed` is a mandatory field on every queue object `createQueue` produces, restored or not — a normal same-session queue built by `createQueue` at the launch-plan confirm site MUST set `confirmed: true` explicitly (never left absent/undefined), so the `!== false` guard is unambiguous everywhere: absent/undefined only ever occurs on a malformed object, never on one either code path actually produces. An unconfirmed queue renders in the QUEUED section (fleet.js) with the "resumed from a previous session — press X to continue" affordance instead of normal queue rows; confirming sets `confirmed: true` (no other field changes) and the very next poll's tick call proceeds exactly as a same-session queue would — including respecting whatever concurrency slots the reconstructed `inFlight` Set already occupies.

If reconciliation leaves both `pending` and `inFlight` empty (everything already live-and-tracked, finished, or nothing left), no queue is restored at all — an empty restored queue would be confirmable but produce no observable effect, which is worse UX than not mentioning it. If `inFlight` alone is non-empty (every pending ticket was already claimed, but a slot is still legitimately occupied), the queue is still restored unconfirmed so the operator can see that occupancy and the confirm affordance reflects it, even though confirming would produce no immediate launch.

### Decision 6: Confirmation keybinding
Reuse the fleet screen's existing single-key action-dispatch convention (`request-quit`/`cancel-quit` are the closest analog). Add a `confirm-restored-queue` action bound to a key that is not already claimed in fleet mode's key map, gated on `queueState && queueState.confirmed === false` being true (mirrors how `request-quit` is gated on non-empty `queueState`). Exact key TBD by the executor from the current fleet.js key map (avoid a collision with existing single-letter bindings).

## Risks / Trade-offs

- [Risk] A ticket that completed successfully during the downtime is indistinguishable, from the fleet snapshot alone, from one that was never started, and could be re-offered on restore. → Mitigation: the restore banner names every restored ticket id explicitly so the operator can catch this before pressing confirm; re-launching an already-`done` ticket is also not silently destructive (it starts a fresh run/worktree under the normal flow), so the worst case is a wasted run, not data loss.
- [Risk] Persisting on every tick adds a filesystem write to the poll loop's hot path whenever a queue is active. → Mitigation: `cache.js`'s existing write is already accepted as cheap enough for this exact loop (writes on every successful Linear fetch); a small JSON payload with the same temp-file+rename pattern carries the same cost profile. Only writes when `queueState` is non-null, so an idle dashboard pays nothing.
- [Risk] A crash between the temp-file write and the rename could theoretically leave a stale temp file. → Mitigation: identical to `cache.js`'s existing handling — the rename is the atomic commit point, and a leftover `.tmp` file is simply ignored (never read) rather than needing cleanup.
- [Trade-off] The design does not attempt to reconcile against per-ticket event logs to detect "ran to completion while down" — chosen deliberately to keep restore-time work O(pending) against the already-computed fleet snapshot rather than adding N additional file reads to startup. Accepted per Decision 5's mitigation.

## Migration Plan

Purely additive: no existing on-disk format changes, no schema migration. Deploying is "ship the new code"; a dashboard upgraded mid-batch will simply start writing `queue.json` on its very next tick. No rollback concern beyond reverting the code — an orphaned `queue.json` from a newer version is safely ignored by an older dashboard that has no reader for it (and by `cache.js`'s own precedent, a `queue-cache.js` reader on a *malformed or unrecognized* file must also degrade to "nothing to restore," not throw).

## Open Questions

- Should restore additionally cross-check each candidate pending ticket's own `.concertino/runs/<ticket>/events.jsonl` for a terminal event during the downtime window, closing the Decision 5 gap at the cost of N extra file reads at startup? Left to the executor's judgment given the actual cost observed; not required for this change to satisfy the ticket's stated safety property (never auto-launch unconfirmed), since the operator confirmation step remains the actual backstop.
- Exact confirmation keybinding — left to the executor, constrained only by "no collision with fleet.js's existing key map."
