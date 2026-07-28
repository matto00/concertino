'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createQueue, tick, isIdle } = require('../lib/ui/queue');

function run(ticket, status) {
  return { ticket, status };
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
