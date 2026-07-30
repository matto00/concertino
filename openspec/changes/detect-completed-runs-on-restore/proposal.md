## Why

CON-29's queue-restore reconciliation (`lib/ui/queue.js`'s `reconcileRestored`)
only checks `queue.isRunLive` against the startup fleet snapshot, so it
cannot distinguish a pending ticket that never started from one whose run
reached a terminal state (`done`/`failed`) while the dashboard was down —
both are simply "not live." This is a known, explicitly documented gap in
CON-29's design (`design.md` Decision 5's Open Questions), never turned into
its own ticket until now. An operator confirming a restored queue can
re-launch a ticket that already delivered successfully during the downtime.

The data needed to close this gap is already computed at zero extra cost:
`watch.js`'s startup restore block already runs one `reduce(store.readAll(...))`
pass over every ticket's `events.jsonl` (not just currently-live ones) to
build the very `startupRuns` snapshot `reconcileRestored` already reads. A
ticket that finished during the downtime already shows up in that snapshot
with `status: 'done'`/`'failed'` and an `endedAt` timestamp — reconciliation
just isn't using that information yet, so no additional file reads are
needed to fix this (closing the design doc's own "N extra file reads"
concern as a non-issue in practice).

## What Changes

- `queue.reconcileRestored` additionally checks each pending id's run in the
  fleet snapshot for a terminal status (`done`/`failed`) whose `endedAt` is
  after the persisted record's own `writtenAt` — i.e. it finished *during*
  the downtime, not before the queue was even written. A pending id matching
  that condition is dropped from the reconciled `pending` list (never
  re-offered) and reported separately as `completedDuringDowntime`, instead
  of surviving into `pending` indistinguishably from a ticket that never ran.
- `watch.js`'s startup restore block surfaces `completedDuringDowntime`
  through a new sticky notice, independent of `queueState` (so it is not
  lost even when every pending ticket completed during the downtime and
  nothing survives to restore — see design.md Decision 4 for why nesting it
  inside the restored queue object, the first draft's approach, silently
  discarded it in exactly that case).
- `lib/ui/screens/fleet.js` renders that notice as its own tail line (e.g.
  "N ticket(s) completed while you were away and were not restored: CON-12,
  CON-14"), shown whenever the notice is non-empty — whether or not a queue
  was also restored — rather than silently omitting the dropped ids with no
  explanation.
- No change to `inFlight` reconciliation's existing behavior (an in-flight
  ticket that finished during the downtime already correctly frees its slot
  today) — this change only affects `pending`, where the ambiguity actually
  lives.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `fleet-queue-visibility`: restore-time reconciliation of a persisted
  queue's `pending` list now also drops (and separately reports) any ticket
  id whose run reached a terminal state during the downtime, instead of
  re-offering it identically to a ticket that never started.

## Impact

- `lib/ui/queue.js`: `reconcileRestored`, `createRestoredQueue`.
- `lib/ui/watch.js`: new `restoreNotice` sticky variable (parallel to the
  existing `queueNotice`), set in the startup restore block and threaded
  through to `draw()`'s render options.
- `lib/ui/screens/fleet.js`: `buildHeadTail` renders `restoreNotice` as its
  own tail line, independent of the existing restored-queue banner.
- Tests: `test/queue.test.js`, `test/fleet.test.js` (or wherever the
  restored-queue banner is currently covered), and `test/watch.test.js` if
  the startup restore block is covered there.
