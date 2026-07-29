'use strict';

// The launch pad's queue runner. Holds `dashboard.maxConcurrent` and decides
// which pending tickets to start on every poll — never spawns anything
// itself, so it is testable purely against a fixture `runs` array, no tmux,
// no submitTicket, no network.
//
// Sequential is `maxConcurrent: 1` — the degenerate case of this same
// function, not a second code path. Feed it a queue created with
// maxConcurrent 1 and it launches one ticket, waits for that run to reach a
// terminal state, and launches the next — exactly "sequential" with no
// branch anywhere that says so.
//
// This module itself holds no on-disk state and never touches the
// filesystem — tick() only describes one poll's worth of "given what's
// pending and what's currently live, what should start now". Persistence
// (CON-29) lives one layer up: watch.js writes the queue this module
// returns to lib/ui/queue-cache.js on every tick and reads it back at
// startup, reconciling it through createRestoredQueue()/reconcileRestored()
// below — the same "already live" predicate (isRunLive) tick() itself uses
// — before ever handing a restored queue back to tick(). See watch.js's own
// comment on the `queueState` variable and design.md for the restore flow.

// `launchCommand` is carried on the queue purely as metadata for whoever
// calls tick() — the batch may have picked a non-default harness ('h') or
// speed ('s', CON-22 — see launchplan.js's withSpeedFlag) on the launch plan
// screen, and the queue must keep using THAT command for every ticket it
// starts later, not whatever watch.js's own default happens to be at the
// time. tick() below never reads or writes it; it only has to survive the
// round trip — this is also how "one speed for the whole batch" holds: there
// is no per-ticket speed field to diverge, only the one shared command
// string every ticket in the batch launches with.
//
// `confirmed: true` is always set explicitly here, never left absent/
// undefined (CON-29) — a queue built by createQueue() is a same-session
// queue the operator just confirmed via the launch plan's own Enter, as
// opposed to createRestoredQueue()'s `confirmed: false`. watch.js's tick
// guard (shouldTick(), below) is `queue.confirmed !== false`, which is only
// unambiguous everywhere if every queue object either factory produces sets
// this field explicitly — see design.md Decision 5a.
function createQueue(tickets, maxConcurrent, launchCommand) {
  return {
    pending: (tickets || []).slice(),
    // Tickets this queue has launched and is still waiting to see finish.
    // A Set, not a count: tick() needs to know WHICH tickets to stop
    // tracking once their run ends, not just how many.
    inFlight: new Set(),
    maxConcurrent: Math.max(1, maxConcurrent || 1),
    launchCommand: launchCommand || null,
    confirmed: true,
  };
}

// A run counts against the cap for exactly as long as the reducer considers
// it live — mirrors drilldown.js's own isLive split (not done, not failed).
// Reusing that exact predicate name here would create a require cycle
// (drilldown -> fleet, queue -> drilldown -> ...), so the two-line
// definition is duplicated rather than imported; the tests pin both to the
// same reducer statuses so they cannot silently drift apart.
function isRunLive(run) {
  return !!run && run.status !== 'done' && run.status !== 'failed';
}

// Advances the queue against the latest fleet snapshot (`runs`, straight from
// reducer.reduce — the same array watch.js already recomputes every poll).
// Returns { toLaunch, dropped, queue }: `toLaunch` is the list of tickets the
// CALLER should now hand to submitTicket (this module never does that itself
// — see the file comment), `dropped` is any pending ticket this tick refused
// to ever launch (see below), and `queue` is the next state to hold onto.
//
// A ticket leaves `inFlight` the moment its run is no longer live — whether
// that is a clean `run.end` or a dead window with none, the reducer has
// already collapsed both into the same `done`/`failed` statuses this
// function trusts everywhere else in the codebase (see reducer.js's
// deriveStatus). The queue does not need, and does not want, a separate
// signal for "the window died" versus "it finished" — a freed slot is a
// freed slot either way.
//
// Judgement call: a PENDING ticket that `runs` already shows live (started by
// hand, by another batch, or — race — twice from the same launch plan before
// this ticket ever reached the top of the queue) is DROPPED here, not held
// until that run finishes.
//
// The alternative — park it and launch a fresh run once the existing one
// reaches a terminal state — was considered and rejected: the run occupying
// that ticket right now was never started by THIS queue, so there is no
// guarantee it ever finishes on any timescale the queue should wait on (a
// `needs-you` escalation can sit for hours), and tick() runs every poll
// against a plain array/Set with no timeout — "wait for it" would mean this
// pending ticket sits invisibly in `queue.pending` forever, occupying no
// capacity slot but never explained on screen either. Dropping is a decision
// made once, immediately, and is exactly what the launch pad's own
// `inlineStatus` already tells the human at selection time: this ticket is
// `▲ running`, so queuing it again was never going to do anything. The
// caller surfaces the drop as a notice (see watch.js) so it is silent to the
// tmux layer but never silent to the human.
function tick(queue, runs) {
  const byTicket = new Map();
  for (const r of runs || []) byTicket.set(r.ticket, r);

  const inFlight = new Set();
  for (const ticket of queue.inFlight) {
    if (isRunLive(byTicket.get(ticket))) inFlight.add(ticket);
  }

  // Filtered every tick, not just once at creation: a ticket can go from
  // "not live" to "live" (started by hand, or by a different queue) at any
  // point while it sits in this queue's pending list, and the check has to
  // catch that the moment it happens, not only at confirm-launch time.
  const pending = [];
  const dropped = [];
  for (const ticket of queue.pending) {
    if (isRunLive(byTicket.get(ticket))) dropped.push(ticket);
    else pending.push(ticket);
  }

  const toLaunch = [];
  while (pending.length && inFlight.size < queue.maxConcurrent) {
    const next = pending.shift();
    // Belt-and-braces against the same hazard queue.tick exists to prevent:
    // a ticket cannot be BOTH pending and already inFlight (this queue would
    // never put it in both), but re-checking here means a future caller that
    // hands tick() a hand-edited queue object still cannot re-admit a ticket
    // this same queue already launched and is still tracking.
    if (inFlight.has(next)) { dropped.push(next); continue; }
    toLaunch.push(next);
    inFlight.add(next);
  }

  return {
    toLaunch,
    dropped,
    // `confirmed: true` explicitly, always — tick() only ever runs on a
    // queue shouldTick() already accepted (never `false`, per watch.js's
    // guard), and the very next tick's own queueState.confirmed must stay
    // unambiguous too (CON-29, design.md Decision 5a). `restoredFrom` (if
    // the queue originated from a restore) is carried forward unchanged —
    // it is diagnostic-only metadata past the point of confirmation, but
    // there is no reason to drop it once it exists.
    queue: Object.assign(
      { pending, inFlight, maxConcurrent: queue.maxConcurrent, launchCommand: queue.launchCommand, confirmed: true },
      queue.restoredFrom ? { restoredFrom: queue.restoredFrom } : {},
    ),
  };
}

// Nothing left pending and nothing left to wait on — the batch is done and
// watch.js can drop the queue entirely rather than ticking a permanently
// empty one forever.
function isIdle(queue) {
  return !queue || (queue.pending.length === 0 && queue.inFlight.size === 0);
}

// Whether watch.js's poll loop should call tick() at all for this queue
// (CON-29). Pulled out as its own pure predicate — rather than inlining
// `queueState.confirmed !== false` at the one call site — so the "an
// unconfirmed restored queue never ticks" contract is unit-testable without
// mocking watch.js's interactive poll loop (see test/queue.test.js). `!==
// false` (not `=== true`) is deliberate: a queue with no `confirmed` field
// at all would still tick, matching the "absent is never actually produced,
// but if it somehow were, fail open toward the pre-CON-29 behaviour rather
// than silently freezing a queue" stance — every real queue object always
// sets the field explicitly (createQueue/createRestoredQueue), so this
// leniency is belt-and-braces, not a relied-upon path.
function shouldTick(queue) {
  return !!queue && queue.confirmed !== false;
}

// Reconciles a persisted queue-cache record (lib/ui/queue-cache.js's shape)
// against a fleet snapshot at restore time, using the exact same "already
// live" predicate tick() itself uses for its own pending filter (CON-29,
// design.md Decision 5). Returns `{ pending, inFlight }`: `pending` is the
// still-eligible pending ticket ids (any id `runs` already shows live is
// dropped, exactly as tick() would drop it on its very first tick), and
// `inFlight` is a Set of the persisted in-flight ids that are STILL live —
// a ticket genuinely still running at restart time must keep occupying its
// concurrency slot (design.md Decision 5a), or a maxConcurrent:1 batch can
// silently become concurrent across a restart. An id that fell out of
// `runs` entirely, or whose run reached a terminal state, is simply not
// live — it is dropped from `inFlight` (the slot frees, mirroring tick()'s
// own inFlight pruning) but a still-pending id in that state legitimately
// SURVIVES into the reconciled pending list (it was never running, so there
// is nothing to drop it for).
function reconcileRestored(record, runs) {
  const byTicket = new Map();
  for (const r of runs || []) byTicket.set(r.ticket, r);

  const pendingSource = (record && Array.isArray(record.pending)) ? record.pending : [];
  const pending = pendingSource.filter((ticket) => !isRunLive(byTicket.get(ticket)));

  const inFlightSource = (record && Array.isArray(record.inFlight)) ? record.inFlight : [];
  const inFlight = new Set(inFlightSource.filter((ticket) => isRunLive(byTicket.get(ticket))));

  return { pending, inFlight };
}

// Builds the restored, paused/unconfirmed queue object watch.js assigns to
// queueState at startup (CON-29) — the restore-time counterpart to
// createQueue() above. Returns null (never an empty-but-confirmable queue)
// when reconciliation leaves both `pending` and `inFlight` empty: an empty
// restored queue would render a confirm affordance that does nothing, which
// is worse UX than not mentioning it at all (design.md Decision 5,
// "Combined restore result").
function createRestoredQueue(record, runs) {
  if (!record) return null;
  const { pending, inFlight } = reconcileRestored(record, runs);
  if (!pending.length && !inFlight.size) return null;
  return {
    pending,
    inFlight,
    maxConcurrent: Math.max(1, record.maxConcurrent || 1),
    launchCommand: record.launchCommand || null,
    confirmed: false,
    restoredFrom: { sessionId: record.sessionId || null, writtenAt: record.writtenAt },
  };
}

module.exports = {
  createQueue, tick, isIdle, isRunLive, shouldTick, reconcileRestored, createRestoredQueue,
};
