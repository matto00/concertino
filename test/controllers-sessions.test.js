'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const sessionsCtl = require('../lib/ui/controllers/sessions');

// Drives the real controller against a minimal ctx, mirroring
// test/controllers-drilldown.test.js's own precedent — a fake ctx.deps
// (discovery/control/killSessionTarget never touch a real /proc, real tmux,
// or a real process) and a fake ctx.session (never a real tmux session).

function ctx(over) {
  const S = { runs: [], sessionsData: null, sessionsSelected: 0, sessionsKillConfirm: null, sessionsError: null };
  return Object.assign({
    S,
    root: '/tmp',
    config: { harnesses: ['claude-code'] },
    session: { name: 'concertino' },
    deps: {
      discovery: { discover: () => [] },
      control: { killConfirmed: () => ({ killed: true }) },
      killSessionTarget: () => {},
    },
  }, over);
}

const apply = (c, action) => sessionsCtl.handle(action, c);

// --- open / refresh / move --------------------------------------------------

test('open-sessions runs discovery, resets the cursor/confirm/error, and sets mode', () => {
  const discovered = [{ pid: 1, managed: false }];
  const c = ctx({ deps: { discovery: { discover: () => discovered }, control: { killConfirmed: () => ({ killed: true }) }, killSessionTarget: () => {} } });
  c.S.sessionsSelected = 5;
  c.S.sessionsError = 'stale error';
  assert.equal(apply(c, { type: 'open-sessions' }), true);
  assert.equal(c.S.sessionsData, discovered);
  assert.equal(c.S.sessionsSelected, 0);
  assert.equal(c.S.sessionsError, null);
  assert.equal(c.S.mode, 'sessions');
});

test('open-sessions passes ctx.config and the dashboard\'s own tmux session name to discover()', () => {
  const calls = [];
  const c = ctx({
    config: { harnesses: ['codex'] },
    session: { name: 'my-concertino' },
    deps: { discovery: { discover: (opts) => { calls.push(opts); return []; } }, control: {}, killSessionTarget: () => {} },
  });
  apply(c, { type: 'open-sessions' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionName, 'my-concertino');
  assert.deepEqual(calls[0].config, { harnesses: ['codex'] });
});

test('open-sessions never throws even if discovery itself throws (defence in depth)', () => {
  const c = ctx({ deps: { discovery: { discover: () => { throw new Error('boom'); } }, control: {}, killSessionTarget: () => {} } });
  assert.doesNotThrow(() => apply(c, { type: 'open-sessions' }));
  assert.deepEqual(c.S.sessionsData, []);
});

test('refresh-sessions re-runs discovery and clamps a stale selection to the new length', () => {
  const c = ctx({ deps: { discovery: { discover: () => [{ pid: 1 }] }, control: {}, killSessionTarget: () => {} } });
  c.S.sessionsSelected = 9;
  apply(c, { type: 'refresh-sessions' });
  assert.equal(c.S.sessionsData.length, 1);
  assert.equal(c.S.sessionsSelected, 0);
});

test('move-sessions clamps within [0, length - 1]', () => {
  const c = ctx({});
  c.S.sessionsData = [{ pid: 1 }, { pid: 2 }, { pid: 3 }];
  c.S.sessionsSelected = 1;
  apply(c, { type: 'move-sessions', delta: 1 });
  assert.equal(c.S.sessionsSelected, 2);
  apply(c, { type: 'move-sessions', delta: 5 });
  assert.equal(c.S.sessionsSelected, 2);
  apply(c, { type: 'move-sessions', delta: -10 });
  assert.equal(c.S.sessionsSelected, 0);
});

test('move-sessions on an empty list is a no-op', () => {
  const c = ctx({});
  c.S.sessionsData = [];
  apply(c, { type: 'move-sessions', delta: 1 });
  assert.equal(c.S.sessionsSelected, 0);
});

// --- managed kill confirm: captures the target at k-press time -------------

test('open-managed-kill-confirm sets the boolean gate (drillConfirm) AND captures the target ticket', () => {
  const c = ctx({});
  apply(c, { type: 'open-managed-kill-confirm', ticket: 'CON-90' });
  assert.equal(c.S.drillConfirm, 'kill');
  assert.equal(c.S.sessionsConfirmTicket, 'CON-90');
});

test('cancel-managed-kill-confirm clears both the gate and the captured target', () => {
  const c = ctx({});
  c.S.drillConfirm = 'kill';
  c.S.sessionsConfirmTicket = 'CON-90';
  apply(c, { type: 'cancel-managed-kill-confirm' });
  assert.equal(c.S.drillConfirm, null);
  assert.equal(c.S.sessionsConfirmTicket, null);
});

// --- managed kill: delegates to control.killConfirmed, surfaces failure ----

test('kill-session-managed calls the SAME control.killConfirmed the drill-down uses', () => {
  const calls = [];
  const c = ctx({
    deps: {
      discovery: { discover: () => [] },
      control: { killConfirmed: (ticket, runs, session) => { calls.push({ ticket, runs, session }); return { killed: true }; } },
      killSessionTarget: () => {},
    },
  });
  c.S.runs = [{ ticket: 'CON-90' }];
  c.S.drillConfirm = 'kill';
  c.S.sessionsConfirmTicket = 'CON-90';
  apply(c, { type: 'kill-session-managed', ticket: 'CON-90' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticket, 'CON-90');
  assert.equal(calls[0].runs, c.S.runs);
  assert.equal(calls[0].session, c.session);
  assert.equal(c.S.drillConfirm, null);
  assert.equal(c.S.sessionsConfirmTicket, null);
  assert.equal(c.S.sessionsError, null);
});

// Evaluator cycle-1 change request 1, the core regression exercised at the
// controller layer: open-managed-kill-confirm captures 'CON-90'; a refresh
// then REPLACES S.sessionsData with a completely different session at the
// same index (as the poll timer's own gated auto-refresh legitimately can,
// mid-confirm); the eventual kill-session-managed dispatch (driven by the
// CAPTURED ticket the sessions screen's handleKey reads, never by
// re-deriving from S.sessionsData) must still target CON-90, not whatever
// now occupies S.sessionsData[0].
test('a refresh between open-managed-kill-confirm and the eventual kill never changes what gets killed', () => {
  const calls = [];
  const c = ctx({
    deps: {
      discovery: { discover: () => [{ pid: 999, managed: true, ticket: 'CON-91', tmux: { session: 'concertino', window: 'CON-91', windowId: '@9' } }] },
      control: { killConfirmed: (ticket) => { calls.push(ticket); return { killed: true }; } },
      killSessionTarget: () => {},
    },
  });
  c.S.runs = [{ ticket: 'CON-90' }, { ticket: 'CON-91' }];

  // Operator selects CON-90's row and presses k.
  apply(c, { type: 'open-managed-kill-confirm', ticket: 'CON-90' });
  assert.equal(c.S.sessionsConfirmTicket, 'CON-90');

  // The poll timer's bounded auto-refresh fires while the confirm is still
  // up — sessionsData is replaced/reordered, but the pending confirm's own
  // captured target must be untouched by it.
  apply(c, { type: 'refresh-sessions' });
  assert.equal(c.S.sessionsData[0].ticket, 'CON-91', 'sanity: the refresh really did change what is at index 0');
  assert.equal(c.S.sessionsConfirmTicket, 'CON-90', 'the captured target survives the refresh unchanged');
  assert.equal(c.S.drillConfirm, 'kill', 'the confirm itself also survives the refresh (still pending)');

  // The sessions screen's own handleKey (test/sessions.test.js covers this
  // in isolation) reads S.sessionsConfirmTicket, not S.sessionsData, when
  // building the 'y' action — this asserts the controller side of that
  // contract: dispatching kill-session-managed with the CAPTURED ticket
  // kills CON-90, never CON-91.
  apply(c, { type: 'kill-session-managed', ticket: c.S.sessionsConfirmTicket });
  assert.deepEqual(calls, ['CON-90']);
});

test('a delegated kill failure is surfaced as S.sessionsError, not silently dropped', () => {
  const c = ctx({
    deps: {
      discovery: { discover: () => [] },
      control: { killConfirmed: () => ({ killed: false, reason: 'not-live' }) },
      killSessionTarget: () => {},
    },
  });
  c.S.drillConfirm = 'kill';
  apply(c, { type: 'kill-session-managed', ticket: 'CON-90' });
  assert.equal(c.S.drillConfirm, null);
  assert.match(c.S.sessionsError, /CON-90/);
  assert.match(c.S.sessionsError, /not-live/);
});

// --- freelance kill: kill-session-confirm / cancel / kill-session-confirmed -

test('kill-session-confirm captures the target at the moment k was pressed', () => {
  const c = ctx({});
  const tmuxTarget = { session: 'scratch', window: 'work', windowId: '@2' };
  apply(c, { type: 'kill-session-confirm', pid: 222, tmuxTarget });
  assert.deepEqual(c.S.sessionsKillConfirm, { pid: 222, tmux: tmuxTarget });
});

test('cancel-session-kill-confirm clears the confirm without acting', () => {
  const c = ctx({});
  c.S.sessionsKillConfirm = { pid: 222, tmux: null };
  apply(c, { type: 'cancel-session-kill-confirm' });
  assert.equal(c.S.sessionsKillConfirm, null);
});

test('kill-session-confirmed with a tmux target calls killSessionTarget (not a bare SIGTERM)', () => {
  const calls = [];
  const c = ctx({
    deps: {
      discovery: { discover: () => [] },
      control: {},
      killSessionTarget: (session, windowId) => calls.push({ session, windowId }),
    },
  });
  c.S.sessionsKillConfirm = { pid: 222, tmux: { session: 'scratch', window: 'work', windowId: '@2' } };
  apply(c, { type: 'kill-session-confirmed' });
  assert.deepEqual(calls, [{ session: 'scratch', windowId: '@2' }]);
  assert.equal(c.S.sessionsKillConfirm, null);
  assert.equal(c.S.sessionsError, null);
});

test('kill-session-confirmed with no tmux target sends SIGTERM to the pid directly', () => {
  const calls = [];
  const realKill = process.kill;
  process.kill = (pid, sig) => { calls.push({ pid, sig }); };
  try {
    const c = ctx({});
    c.S.sessionsKillConfirm = { pid: 333, tmux: null };
    apply(c, { type: 'kill-session-confirmed' });
    assert.deepEqual(calls, [{ pid: 333, sig: 'SIGTERM' }]);
    assert.equal(c.S.sessionsError, null);
  } finally {
    process.kill = realKill;
  }
});

test('a freelance kill failure (e.g. ESRCH — already exited) is surfaced, not silently dropped', () => {
  const realKill = process.kill;
  process.kill = () => { const e = new Error('kill ESRCH'); throw e; };
  try {
    const c = ctx({});
    c.S.sessionsKillConfirm = { pid: 444, tmux: null };
    apply(c, { type: 'kill-session-confirmed' });
    assert.match(c.S.sessionsError, /444/);
    assert.match(c.S.sessionsError, /ESRCH/);
  } finally {
    process.kill = realKill;
  }
});

test('kill-session-confirmed with no confirm captured is a safe no-op', () => {
  const c = ctx({});
  assert.doesNotThrow(() => apply(c, { type: 'kill-session-confirmed' }));
});

// --- unrecognised actions ----------------------------------------------------

test('an action this controller does not own returns false', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'not-a-real-action' }), false);
});
