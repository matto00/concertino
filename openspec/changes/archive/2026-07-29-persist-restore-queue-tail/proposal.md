## Why

`queueState` in `lib/ui/watch.js` is in-memory only: if the dashboard exits — crash, closed terminal, killed tmux session, OOM — the un-started tail of a batch is silently forgotten, with no resume on the next `concertino watch`. This was a deliberate, documented trade at the time the QUEUED section shipped (CON-28), made explicitly because there was no usage data yet on how often it happens. There now is: the queue's real use is unattended overnight batches, exactly the window where an unnoticed restart is most likely and most costly (a crash at hour one of an eight-hour batch means seven hours of nothing, discovered in the morning).

## What Changes

- Persist the queue's pending tail to `.concertino/cache/queue.json` on every `queue.tick()`, using the same durable-cache pattern (`lib/ui/cache.js`) already used for `linear.json`: write via temp file + rename, and treat any missing/malformed file as empty rather than an error.
- The persisted record carries only ticket ids and queue metadata (`maxConcurrent`, `launchCommand`, a session/timestamp marker) — never ticket bodies, which is where sensitive content lives.
- On `concertino watch` startup, read the queue file back. If it names a non-empty, non-stale pending tail, restore it into `queueState` in a **paused/unconfirmed** state rather than silently resuming launches — `queue.tick()` never fires for a restored queue until the operator explicitly confirms it.
- The QUEUED section (`lib/ui/screens/fleet.js`) renders a restored-but-unconfirmed queue with an explicit "resumed from a previous session — press X to continue" affordance, distinct from a normal in-session queue's rendering.
- Restoring a queue reconciles against the same "already live" predicate `queue.tick()` already uses (`isRunLive`), so a ticket started by hand or by another dashboard during the downtime is dropped from the restored pending list rather than being offered for double-launch. A ticket whose run reached a terminal state (done/failed) during the downtime is also dropped from the restored pending list.
- A restore is bounded by staleness: a queue file older than a fixed age bound (or lacking a valid session marker) is treated as empty/discarded rather than restored.
- The queue file is written on every tick (including ticks that leave the queue non-idle) and removed once the queue goes idle (`queue.isIdle`), mirroring how `queueState` itself is nulled out today.

## Capabilities

### New Capabilities
(none — this extends the existing queue/cache capabilities rather than introducing a new domain concept)

### Modified Capabilities
- `fleet-queue-visibility`: the QUEUED section must additionally render a distinct "resumed, unconfirmed" affordance for a queue restored from disk, and must gate that queue's ticks on explicit operator confirmation before any ticket in it can be launched.

## Impact

- `lib/ui/queue.js`: add persistence-shape helpers (serialize/deserialize a queue to the on-disk record) and a restore-reconciliation function reusing `isRunLive`.
- `lib/ui/cache.js` or a new sibling module (`lib/ui/queue-cache.js`) for `.concertino/cache/queue.json` read/write, following the exact `linear.json` read/write/temp-file pattern.
- `lib/ui/watch.js`: write the queue file on every `queue.tick()` call site, read it back at startup, gate a restored queue behind a confirmation flag before it participates in ticks, and remove the file once the queue goes idle.
- `lib/ui/screens/fleet.js`: render the "resumed — press X to continue" affordance for an unconfirmed restored queue; wire the confirm keypress.
- `.concertino/` is already fully gitignored, so `.concertino/cache/queue.json` requires no new gitignore entry.
