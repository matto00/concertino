'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { killConfirmed, restartConfirmed } = require('../lib/ui/control');

// A fake session that records call order, so "kill happened before the
// refused spawn" is something a test can actually see rather than infer.
function fakeSession(spawnShouldThrow) {
  const calls = [];
  return {
    calls,
    kill(ticket) { calls.push({ op: 'kill', ticket }); },
    spawn(ticket, cmd) {
      calls.push({ op: 'spawn', ticket, cmd });
      if (spawnShouldThrow) throw new Error('tmux exited 1');
    },
  };
}

function run(over) {
  return Object.assign({
    ticket: 'HEL-334', status: 'running', endStatus: null, window: { alive: true, idleMs: 0 },
  }, over);
}

const launchCommand = 'claude "/concertino-deliver {{TICKET}}"';
// The real submitTicket, not a mock — the ordering bug is specifically about
// what happens BEFORE submitTicket's own validation runs, so a fake submit
// would hide the bug rather than reproduce it.
const { submitTicket } = require('../lib/ui/prompt');

// --- Important 1: restart must validate before it destroys anything --------

test('restart on a window whose name is not ticket-shaped is refused, and nothing is killed', () => {
  const session = fakeSession(false);
  const runs = [run({ ticket: 'adopted-window' })];
  const result = restartConfirmed('adopted-window', runs, session, launchCommand, submitTicket);
  assert.equal(result.spawned, false);
  assert.equal(result.error, 'not a ticket id');
  assert.deepEqual(session.calls, [], 'kill must never fire for an unspawnable ticket');
});

test('restart on a spawnable ticket kills THEN spawns, in that order', () => {
  const session = fakeSession(false);
  const runs = [run({ ticket: 'HEL-334' })];
  const result = restartConfirmed('HEL-334', runs, session, launchCommand, submitTicket);
  assert.equal(result.spawned, true);
  assert.deepEqual(session.calls.map((c) => c.op), ['kill', 'spawn']);
});

// --- Important 2: kill/restart must re-check liveness at execution time ----
// The confirmation can sit on screen across many one-second poll cycles. If
// the run finished in that window, the fake session here stands in for "the
// user's 'y' landed on a run that is no longer live" — nothing should be
// killed or spawned.

test('kill is refused once the run has gone stale (finished) since the confirm opened', () => {
  const session = fakeSession(false);
  const runs = [run({ ticket: 'HEL-334', status: 'done', endStatus: 'delivered' })];
  killConfirmed('HEL-334', runs, session);
  assert.deepEqual(session.calls, [], 'a finished run must not be killed');
});

test('kill is refused once the run has vanished entirely since the confirm opened', () => {
  const session = fakeSession(false);
  killConfirmed('HEL-334', [], session);
  assert.deepEqual(session.calls, [], 'a vanished run must not be killed');
});

test('restart is refused once the run has gone stale (finished) since the confirm opened', () => {
  const session = fakeSession(false);
  const runs = [run({ ticket: 'HEL-334', status: 'failed', endStatus: 'failed' })];
  const result = restartConfirmed('HEL-334', runs, session, launchCommand, submitTicket);
  assert.equal(result.spawned, false);
  assert.deepEqual(session.calls, [], 'a finished run must not be killed or respawned');
});

// --- Both bugs together: a refused spawn must never have killed first ------

test('a refused restart (invalid ticket) leaves the original window untouched — the exact Important-1 reproduction', () => {
  // "adopted-window" is exactly the shape of a window the dashboard never
  // spawned: TICKET_RE requires a trailing digit, this has none. The
  // reducer still treats any live tmux window as restartable, so this is
  // reachable from the real UI (open the drill-down, press r, y).
  const session = fakeSession(false);
  const runs = [run({ ticket: 'adopted-window' })];
  restartConfirmed('adopted-window', runs, session, launchCommand, submitTicket);
  assert.equal(session.calls.length, 0,
    'kill must never fire before validation determines a replacement is possible');
});
