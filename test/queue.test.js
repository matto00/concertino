'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createQueue, tick, isIdle, shouldTick, reconcileRestored, createRestoredQueue,
} = require('../lib/ui/queue');

function run(ticket, status, endedAt) {
  const r = { ticket, status };
  if (endedAt !== undefined) r.endedAt = endedAt;
  return r;
}

// --- respecting the cap -----------------------------------------------------

test('a fresh queue launches up to the cap on its first tick', () => {
  const q = createQueue(['CON-1', 'CON-2', 'CON-3'], 2);
  const { toLaunch, queue } = tick(q, []);
  assert.deepEqual(toLaunch, ['CON-1', 'CON-2']);
  assert.deepEqual(queue.pending, ['CON-3']);
  assert.deepEqual(Array.from(queue.inFlight).sort(), ['CON-1', 'CON-2']);
});

test('sequential is maxConcurrent 1 — the same function, not a second code path', () => {
  const q = createQueue(['CON-1', 'CON-2', 'CON-3'], 1);
  const { toLaunch, queue } = tick(q, []);
  assert.deepEqual(toLaunch, ['CON-1']);
  assert.deepEqual(queue.pending, ['CON-2', 'CON-3']);
});

test('a queue at the cap launches nothing more this tick', () => {
  let q = createQueue(['CON-1', 'CON-2', 'CON-3'], 2);
  q = tick(q, []).queue;
  // Both CON-1 and CON-2 are still running — nothing has finished.
  const { toLaunch, queue } = tick(q, [run('CON-1', 'running'), run('CON-2', 'running')]);
  assert.deepEqual(toLaunch, []);
  assert.deepEqual(queue.pending, ['CON-3']);
});

// --- starts the next ticket on run.end (reducer status 'done'/'failed') ----

test('a delivered run frees its slot and the next pending ticket starts', () => {
  let q = createQueue(['CON-1', 'CON-2', 'CON-3'], 2);
  q = tick(q, []).queue; // CON-1, CON-2 launched
  const { toLaunch, queue } = tick(q, [run('CON-1', 'done'), run('CON-2', 'running')]);
  assert.deepEqual(toLaunch, ['CON-3']);
  assert.deepEqual(queue.pending, []);
  assert.deepEqual(Array.from(queue.inFlight).sort(), ['CON-2', 'CON-3']);
});

test('a failed run.end also frees its slot, exactly like a delivered one', () => {
  let q = createQueue(['CON-1', 'CON-2'], 1);
  q = tick(q, []).queue; // CON-1 launched
  const { toLaunch } = tick(q, [run('CON-1', 'failed')]);
  assert.deepEqual(toLaunch, ['CON-2']);
});

// --- starts the next ticket on a dead window (no run.end at all) -----------
// reducer.js already reports a dead window with no run.end as status
// 'failed' (see reducer.test.js's own "a dead window with no run.end is
// failed, not running") — the queue does not need a separate "window died"
// signal, only the same status it already trusts everywhere else.

test('a ticket missing from `runs` entirely (window gone, nothing tracked it) frees its slot', () => {
  let q = createQueue(['CON-1', 'CON-2'], 1);
  q = tick(q, []).queue; // CON-1 launched, in flight
  // CON-1 vanished from the fleet snapshot outright — no run object at all.
  const { toLaunch } = tick(q, []);
  assert.deepEqual(toLaunch, ['CON-2']);
});

test('a run still reported as unknown or needs-you stays counted against the cap', () => {
  let q = createQueue(['CON-1', 'CON-2'], 1);
  q = tick(q, []).queue;
  const first = tick(q, [run('CON-1', 'unknown')]);
  assert.deepEqual(first.toLaunch, []);
  const second = tick(first.queue, [run('CON-1', 'needs-you')]);
  assert.deepEqual(second.toLaunch, []);
});

// --- launchCommand round-trips as metadata, untouched by tick() ------------

test('the queue carries its launchCommand through every tick unchanged', () => {
  let q = createQueue(['CON-1', 'CON-2'], 1, 'codex "/concertino-deliver {{TICKET}}"');
  assert.equal(q.launchCommand, 'codex "/concertino-deliver {{TICKET}}"');
  q = tick(q, []).queue;
  assert.equal(q.launchCommand, 'codex "/concertino-deliver {{TICKET}}"');
  q = tick(q, [run('CON-1', 'done')]).queue;
  assert.equal(q.launchCommand, 'codex "/concertino-deliver {{TICKET}}"');
});

// CON-22: the batch's single resolved speed is already baked into
// launchCommand by the time it reaches createQueue() — launchplan.js's
// withSpeedFlag (applied by watch.js at plan-creation/cycle-speed time, the
// exact same seam --agent-merge/--no-agent-merge already goes through) — so
// there is no separate "speed" field for this module to thread; it rides
// through as part of the same opaque launchCommand string every ticket in
// the batch launches with, unchanged by tick(), exactly as the test above
// already proves for an agent-merge-flavored command. This test names that
// explicitly for a speed-flavored one, so "the batch carries one speed for
// the whole batch" is provable at the queue layer, not just inferred from
// the launchCommand test already covering "any string, unchanged".
test('a speed token baked into launchCommand (via withSpeedFlag) rides through the queue unchanged for the whole batch', () => {
  let q = createQueue(['CON-1', 'CON-2', 'CON-3'], 2, 'claude "/concertino-deliver {{TICKET}} fast"');
  assert.equal(q.launchCommand, 'claude "/concertino-deliver {{TICKET}} fast"');
  const first = tick(q, []);
  assert.deepEqual(first.toLaunch, ['CON-1', 'CON-2']);
  assert.equal(first.queue.launchCommand, 'claude "/concertino-deliver {{TICKET}} fast"');
  const second = tick(first.queue, [run('CON-1', 'done'), run('CON-2', 'running')]);
  assert.deepEqual(second.toLaunch, ['CON-3']);
  // CON-3 — launched later, on a subsequent tick — carries the SAME speed
  // as CON-1/CON-2 did: one speed for the whole batch, not per-ticket.
  assert.equal(second.queue.launchCommand, 'claude "/concertino-deliver {{TICKET}} fast"');
});

// --- isIdle ------------------------------------------------------------------

test('a queue with nothing pending and nothing in flight is idle', () => {
  let q = createQueue(['CON-1'], 1);
  assert.equal(isIdle(q), false);
  q = tick(q, []).queue;
  assert.equal(isIdle(q), false); // CON-1 is in flight
  q = tick(q, [run('CON-1', 'done')]).queue;
  assert.equal(isIdle(q), true);
});

test('isIdle is true for null/undefined — a dropped queue needs no special-casing at the call site', () => {
  assert.equal(isIdle(null), true);
  assert.equal(isIdle(undefined), true);
});

test('an empty queue is idle immediately', () => {
  assert.equal(isIdle(createQueue([], 2)), true);
});

// --- maxConcurrent floor -----------------------------------------------------

test('maxConcurrent below 1 is floored to 1, never zero', () => {
  const q = createQueue(['CON-1'], 0);
  assert.equal(q.maxConcurrent, 1);
});

// --- never re-admit a ticket that already has a live run --------------------
// Reproduced by hand against real tmux: `tmux new-window -n CON-9` when a
// window of that name already exists succeeds and creates a SECOND window
// with the same name — after which `capture-pane -t sess:CON-9` and
// `kill-window -t sess:CON-9` both fail with "can't find window", ambiguous
// target. tick() must never produce a toLaunch entry for a ticket `runs`
// already shows live, whether that ticket was started by hand, by another
// queue, or is simply still sitting in `queue.pending` from before it went
// live.

test('a pending ticket already live in `runs` (started by hand, or by another batch) is never launched', () => {
  const q = createQueue(['CON-9'], 2);
  // CON-9 is already running — nobody put it there via this queue.
  const { toLaunch, queue } = tick(q, [run('CON-9', 'running')]);
  assert.deepEqual(toLaunch, []);
  assert.deepEqual(queue.pending, []);
  assert.deepEqual(Array.from(queue.inFlight), []);
});

test('a live pending ticket is reported as dropped, not silently discarded', () => {
  const q = createQueue(['CON-9', 'CON-10'], 2);
  const { dropped, toLaunch } = tick(q, [run('CON-9', 'running')]);
  assert.deepEqual(dropped, ['CON-9']);
  assert.deepEqual(toLaunch, ['CON-10']);
});

test('a ticket that goes live WHILE queued (not live on an earlier tick) is dropped the moment it is noticed', () => {
  let q = createQueue(['CON-1', 'CON-9'], 1);
  q = tick(q, []).queue; // CON-1 launched, CON-9 still pending — nothing live yet
  // CON-9 started running by hand while it sat in the pending list.
  const { dropped, toLaunch, queue } = tick(q, [run('CON-1', 'running'), run('CON-9', 'running')]);
  assert.deepEqual(dropped, ['CON-9']);
  assert.deepEqual(toLaunch, []);
  assert.deepEqual(queue.pending, []);
});

test('a dropped ticket is gone for good, not held to relaunch once the external run finishes', () => {
  let q = createQueue(['CON-9'], 1);
  const first = tick(q, [run('CON-9', 'running')]);
  assert.deepEqual(first.dropped, ['CON-9']);
  assert.equal(isIdle(first.queue), true);
  // The external run now finishes — CON-9 is no longer live anywhere. A
  // dropped ticket must not reappear and launch: it was never re-added to
  // `pending`, so there is nothing left in this queue to revisit.
  const second = tick(first.queue, [run('CON-9', 'done')]);
  assert.deepEqual(second.toLaunch, []);
  assert.deepEqual(second.dropped, []);
});

test('a needs-you or unknown status also counts as live for admission — only done/failed frees the ticket to be considered', () => {
  const q = createQueue(['CON-9'], 1);
  assert.deepEqual(tick(q, [run('CON-9', 'needs-you')]).toLaunch, []);
  assert.deepEqual(tick(q, [run('CON-9', 'unknown')]).toLaunch, []);
});

// --- CON-29: `confirmed` is a mandatory, always-explicit field -------------
// watch.js's tick guard is `queue.confirmed !== false` — unambiguous only if
// every queue object either factory produces sets this field explicitly,
// never leaves it absent/undefined (design.md Decision 5a).

test('createQueue always sets confirmed: true explicitly', () => {
  const q = createQueue(['CON-1'], 1);
  assert.equal(q.confirmed, true);
});

test('tick() carries confirmed: true forward on every returned queue', () => {
  let q = createQueue(['CON-1', 'CON-2'], 1);
  q = tick(q, []).queue;
  assert.equal(q.confirmed, true);
  q = tick(q, [run('CON-1', 'done')]).queue;
  assert.equal(q.confirmed, true);
});

// --- shouldTick: the guard watch.js's poll loop uses at the tick() call site

test('shouldTick is true for a normal, same-session confirmed queue', () => {
  assert.equal(shouldTick(createQueue(['CON-1'], 1)), true);
});

test('shouldTick is false for a restored, not-yet-confirmed queue', () => {
  const record = { pending: ['CON-1'], inFlight: [], maxConcurrent: 1, sessionId: 's1', writtenAt: 1 };
  const restored = createRestoredQueue(record, []);
  assert.equal(shouldTick(restored), false);
});

test('shouldTick is false for null/undefined — no queue at all never ticks', () => {
  assert.equal(shouldTick(null), false);
  assert.equal(shouldTick(undefined), false);
});

// --- reconcileRestored: filters a persisted record's pending/inFlight ------
// against the exact isRunLive predicate tick() itself uses (design.md
// Decision 5 / 5a).

test('a pending id already live in the fleet snapshot is dropped on restore', () => {
  const record = { pending: ['CON-1', 'CON-2'], inFlight: [] };
  const { pending } = reconcileRestored(record, [run('CON-1', 'running')]);
  assert.deepEqual(pending, ['CON-2']);
});

test('a pending id not live survives reconciliation', () => {
  const record = { pending: ['CON-1', 'CON-2'], inFlight: [] };
  const { pending } = reconcileRestored(record, [run('CON-1', 'done')]);
  assert.deepEqual(pending, ['CON-1', 'CON-2']);
});

test('reconciliation that drops every pending id is correctly reported as empty', () => {
  const record = { pending: ['CON-1'], inFlight: [] };
  const { pending } = reconcileRestored(record, [run('CON-1', 'running')]);
  assert.deepEqual(pending, []);
});

test('a still-running in-flight id keeps occupying its concurrency slot after restore', () => {
  const record = { pending: [], inFlight: ['CON-1'] };
  const { inFlight } = reconcileRestored(record, [run('CON-1', 'running')]);
  assert.deepEqual(Array.from(inFlight), ['CON-1']);
});

test('a finished in-flight id frees its slot on restore', () => {
  const record = { pending: [], inFlight: ['CON-1'] };
  const { inFlight } = reconcileRestored(record, [run('CON-1', 'done')]);
  assert.deepEqual(Array.from(inFlight), []);
});

test('an in-flight id missing from the fleet snapshot entirely also frees its slot', () => {
  const record = { pending: [], inFlight: ['CON-1'] };
  const { inFlight } = reconcileRestored(record, []);
  assert.deepEqual(Array.from(inFlight), []);
});

// --- CON-37: completedDuringDowntime — a pending id that finished during
// the downtime is dropped and reported distinctly from a plain "not live"
// drop (design.md Decision 3).

test('a pending id terminal with endedAt after writtenAt is dropped from pending and reported as completed during downtime', () => {
  const record = { pending: ['CON-1', 'CON-2'], inFlight: [], writtenAt: 1000 };
  const { pending, completedDuringDowntime } = reconcileRestored(record, [run('CON-1', 'done', 2000)]);
  assert.deepEqual(pending, ['CON-2']);
  assert.deepEqual(completedDuringDowntime, ['CON-1']);
});

test('a pending id terminal with endedAt at or before writtenAt survives into pending, not reported as completed during downtime', () => {
  const atWrittenAt = { pending: ['CON-1'], inFlight: [], writtenAt: 1000 };
  const equal = reconcileRestored(atWrittenAt, [run('CON-1', 'done', 1000)]);
  assert.deepEqual(equal.pending, ['CON-1']);
  assert.deepEqual(equal.completedDuringDowntime, []);

  const before = { pending: ['CON-1'], inFlight: [], writtenAt: 1000 };
  const stale = reconcileRestored(before, [run('CON-1', 'failed', 500)]);
  assert.deepEqual(stale.pending, ['CON-1']);
  assert.deepEqual(stale.completedDuringDowntime, []);
});

test('a pending id with no run object at all survives into pending — unaffected, still indistinguishable from never-started', () => {
  const record = { pending: ['CON-1'], inFlight: [], writtenAt: 1000 };
  const { pending, completedDuringDowntime } = reconcileRestored(record, []);
  assert.deepEqual(pending, ['CON-1']);
  assert.deepEqual(completedDuringDowntime, []);
});

test('a pending id with a terminal status but no endedAt (a dead window, no run.end) survives into pending', () => {
  const record = { pending: ['CON-1'], inFlight: [], writtenAt: 1000 };
  const { pending, completedDuringDowntime } = reconcileRestored(record, [run('CON-1', 'failed')]);
  assert.deepEqual(pending, ['CON-1']);
  assert.deepEqual(completedDuringDowntime, []);
});

test('createRestoredQueue returns null when every pending id is dropped via completedDuringDowntime and no in-flight id survives', () => {
  const record = { pending: ['CON-1', 'CON-2'], inFlight: [], maxConcurrent: 1, sessionId: 's', writtenAt: 1000 };
  const runs = [run('CON-1', 'done', 2000), run('CON-2', 'failed', 3000)];
  const reconciled = reconcileRestored(record, runs);
  assert.deepEqual(reconciled.completedDuringDowntime, ['CON-1', 'CON-2']);
  assert.deepEqual(reconciled.pending, []);
  const restored = createRestoredQueue(record, runs);
  assert.equal(restored, null);
});

test('createRestoredQueue accepts a pre-computed reconciled result (the single-reconciliation-pass path watch.js uses) and agrees with the two-arg form', () => {
  const record = {
    pending: ['CON-1', 'CON-2'], inFlight: [], maxConcurrent: 1, sessionId: 's', writtenAt: 1000,
  };
  // CON-1 completed during the downtime (diverted to completedDuringDowntime);
  // CON-2 has no run at all, so it genuinely survives into `pending`.
  const runs = [run('CON-1', 'done', 2000)];
  const reconciled = reconcileRestored(record, runs);
  const viaReconciled = createRestoredQueue(record, runs, reconciled);
  const viaRunsOnly = createRestoredQueue(record, runs);
  assert.deepEqual(viaReconciled.pending, ['CON-2']);
  assert.deepEqual(viaReconciled.pending, viaRunsOnly.pending);
});

// --- createRestoredQueue: the restore-time counterpart to createQueue ------

test('createRestoredQueue builds a paused, unconfirmed queue with reconciled pending and reconstructed inFlight', () => {
  const record = {
    pending: ['CON-2', 'CON-3'], inFlight: ['CON-1'], maxConcurrent: 1,
    launchCommand: 'codex "/concertino-deliver {{TICKET}}"', sessionId: 'sess-1', writtenAt: 5000,
  };
  const restored = createRestoredQueue(record, [run('CON-1', 'running'), run('CON-2', 'running')]);
  assert.deepEqual(restored.pending, ['CON-3']); // CON-2 already live, dropped
  assert.deepEqual(Array.from(restored.inFlight), ['CON-1']); // still live, slot kept
  assert.equal(restored.maxConcurrent, 1);
  assert.equal(restored.launchCommand, 'codex "/concertino-deliver {{TICKET}}"');
  assert.equal(restored.confirmed, false);
  assert.deepEqual(restored.restoredFrom, { sessionId: 'sess-1', writtenAt: 5000 });
});

test('a maxConcurrent:1 restored queue with its one ticket still live never lets confirm launch a second one', () => {
  const record = { pending: ['CON-2'], inFlight: ['CON-1'], maxConcurrent: 1, sessionId: 's', writtenAt: 1 };
  const restored = createRestoredQueue(record, [run('CON-1', 'running')]);
  assert.equal(restored.confirmed, false);
  restored.confirmed = true; // exactly what watch.js's confirm-restored-queue action does
  const { toLaunch, queue: nextQueue } = tick(restored, [run('CON-1', 'running')]);
  assert.deepEqual(toLaunch, [], 'the slot is still occupied by CON-1 — CON-2 must not launch on top of it');
  assert.deepEqual(Array.from(nextQueue.inFlight), ['CON-1']);
  assert.deepEqual(nextQueue.pending, ['CON-2']);
});

test('reconciliation leaving both pending and inFlight empty restores nothing (null), not an empty confirmable queue', () => {
  const record = { pending: ['CON-1'], inFlight: ['CON-2'], maxConcurrent: 1, sessionId: 's', writtenAt: 1 };
  const restored = createRestoredQueue(record, [run('CON-1', 'running'), run('CON-2', 'done')]);
  assert.equal(restored, null);
});

test('createRestoredQueue of a null/missing record is null', () => {
  assert.equal(createRestoredQueue(null, []), null);
  assert.equal(createRestoredQueue(undefined, []), null);
});

test('inFlight-only restore (every pending id already claimed, but a slot is legitimately occupied) still restores', () => {
  const record = { pending: [], inFlight: ['CON-1'], maxConcurrent: 1, sessionId: 's', writtenAt: 1 };
  const restored = createRestoredQueue(record, [run('CON-1', 'running')]);
  assert.notEqual(restored, null);
  assert.deepEqual(restored.pending, []);
  assert.deepEqual(Array.from(restored.inFlight), ['CON-1']);
});

// --- confirming a restored queue never mutates pending/inFlight ------------

test('confirming a restored queue (flipping `confirmed`) never touches pending or inFlight contents', () => {
  const record = {
    pending: ['CON-2', 'CON-3'], inFlight: ['CON-1'], maxConcurrent: 2, sessionId: 's', writtenAt: 1,
  };
  const restored = createRestoredQueue(record, [run('CON-1', 'running')]);
  const pendingBefore = restored.pending.slice();
  const inFlightBefore = Array.from(restored.inFlight).sort();

  restored.confirmed = true; // exactly what watch.js's confirm-restored-queue action does

  assert.deepEqual(restored.pending, pendingBefore);
  assert.deepEqual(Array.from(restored.inFlight).sort(), inFlightBefore);
  assert.equal(shouldTick(restored), true);
});
