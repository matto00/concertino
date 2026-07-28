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
// The queue does NOT persist across a dashboard restart (see watch.js's own
// comment on the `queue` variable for the reasoning) — this module only
// describes one poll's worth of "given what's pending and what's currently
// live, what should start now", which is exactly what a freshly-restarted,
// empty queue also computes correctly on its very first tick: there is
// nothing pending, so there is nothing to lose by forgetting.

// `launchCommand` is carried on the queue purely as metadata for whoever
// calls tick() — the batch may have picked a non-default harness on the
// launch plan screen (see launchplan.js's 'h' cycling), and the queue must
// keep using THAT command for every ticket it starts later, not whatever
// watch.js's own default happens to be at the time. tick() below never reads
// or writes it; it only has to survive the round trip.
function createQueue(tickets, maxConcurrent, launchCommand) {
  return {
    pending: (tickets || []).slice(),
    // Tickets this queue has launched and is still waiting to see finish.
    // A Set, not a count: tick() needs to know WHICH tickets to stop
    // tracking once their run ends, not just how many.
    inFlight: new Set(),
    maxConcurrent: Math.max(1, maxConcurrent || 1),
    launchCommand: launchCommand || null,
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
// Returns { toLaunch, queue }: `toLaunch` is the list of tickets the CALLER
// should now hand to submitTicket (this module never does that itself — see
// the file comment), and `queue` is the next state to hold onto.
//
// A ticket leaves `inFlight` the moment its run is no longer live — whether
// that is a clean `run.end` or a dead window with none, the reducer has
// already collapsed both into the same `done`/`failed` statuses this
// function trusts everywhere else in the codebase (see reducer.js's
// deriveStatus). The queue does not need, and does not want, a separate
// signal for "the window died" versus "it finished" — a freed slot is a
// freed slot either way.
function tick(queue, runs) {
  const byTicket = new Map();
  for (const r of runs || []) byTicket.set(r.ticket, r);

  const inFlight = new Set();
  for (const ticket of queue.inFlight) {
    if (isRunLive(byTicket.get(ticket))) inFlight.add(ticket);
  }

  const pending = queue.pending.slice();
  const toLaunch = [];
  while (pending.length && inFlight.size < queue.maxConcurrent) {
    const next = pending.shift();
    toLaunch.push(next);
    inFlight.add(next);
  }

  return {
    toLaunch,
    queue: { pending, inFlight, maxConcurrent: queue.maxConcurrent, launchCommand: queue.launchCommand },
  };
}

// Nothing left pending and nothing left to wait on — the batch is done and
// watch.js can drop the queue entirely rather than ticking a permanently
// empty one forever.
function isIdle(queue) {
  return !queue || (queue.pending.length === 0 && queue.inFlight.size === 0);
}

module.exports = { createQueue, tick, isIdle, isRunLive };
