'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderSessions, handleKey, render, routeHandleKey } = require('../lib/ui/screens/sessions');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function managedSession(over) {
  return Object.assign({
    pid: 111, harness: 'claude', binaryPath: '/usr/bin/claude', version: '1.2.3',
    cwd: '/home/dev/.concertino/worktrees/feature/x/CON-90', ageMs: 60000,
    tmux: { session: 'concertino', window: 'CON-90', windowId: '@1' },
    managed: true, ticket: 'CON-90', nearTicket: null,
  }, over);
}

function freelanceSession(over) {
  return Object.assign({
    pid: 222, harness: 'codex', binaryPath: '/usr/bin/codex', version: null,
    cwd: '/home/dev/some-project', ageMs: 120000,
    tmux: { session: 'scratch', window: 'work', windowId: '@2' },
    managed: false, ticket: null, nearTicket: null,
  }, over);
}

// --- render ------------------------------------------------------------------

test('renderSessions shows "discovering..." before the first discovery pass', () => {
  const out = renderSessions({ sessionsData: null }, { cols: 100 });
  assert.match(out, /discovering/);
});

test('renderSessions shows an explicit empty state when discovery found nothing', () => {
  const out = renderSessions({ sessionsData: [] }, { cols: 100 });
  assert.match(out, /no harness sessions discovered/);
});

test('a managed row shows its ticket id, not "freelance"', () => {
  const out = plain(renderSessions({ sessionsData: [managedSession({})], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /managed · CON-90/);
  assert.doesNotMatch(out, /freelance/);
});

test('a freelance row shows "freelance", not a ticket id', () => {
  const out = plain(renderSessions({ sessionsData: [freelanceSession({})], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /freelance/);
});

test('a freelance row with a near-ticket hint shows it as display-only context', () => {
  const sess = freelanceSession({ nearTicket: 'CON-90', cwd: '/home/dev/.concertino/worktrees/feature/x/CON-90' });
  const out = plain(renderSessions({ sessionsData: [sess], sessionsSelected: 0 }, { cols: 140 }));
  assert.match(out, /near ticket CON-90's worktree/);
});

test('a freelance row with no tmux location is shown as not attachable', () => {
  const sess = freelanceSession({ tmux: null });
  const out = plain(renderSessions({ sessionsData: [sess], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /not attachable/);
  const hints = out.split('\n').slice(-2).join('\n');
  assert.doesNotMatch(hints, /↵ attach/);
});

test('a freelance row with a known tmux location offers attach in the footer hints', () => {
  const sess = freelanceSession({});
  const out = plain(renderSessions({ sessionsData: [sess], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /↵ attach/);
});

test('a managed row always offers attach in the footer hints', () => {
  const out = plain(renderSessions({ sessionsData: [managedSession({})], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /↵ attach/);
});

test('every row (managed or freelance) offers the kill hint', () => {
  const out = plain(renderSessions({ sessionsData: [managedSession({})], sessionsSelected: 0 }, { cols: 120 }));
  assert.match(out, /k kill/);
});

test('a managed row\'s kill confirmation reads state.drillConfirm as the gate and state.sessionsConfirmTicket as the target', () => {
  const out = plain(renderSessions(
    { sessionsData: [managedSession({})], sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90' },
    { cols: 120 },
  ));
  assert.match(out, /kill CON-90\?/);
  assert.match(out, /y confirm/);
});

test('a managed confirm is NOT shown from drillConfirm alone — sessionsConfirmTicket must also be set', () => {
  const out = plain(renderSessions(
    { sessionsData: [managedSession({})], sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: null },
    { cols: 120 },
  ));
  assert.doesNotMatch(out, /kill CON-90\?/);
});

// Evaluator cycle-1 change request 1: a background auto-refresh can replace
// `sessionsData` (and reorder it) while a managed-row kill confirm sits on
// screen. The render must show the CAPTURED ticket, never whatever the
// (possibly now-different) session at `sessionsSelected` happens to be.
test('a managed row\'s confirm still shows the originally-confirmed ticket after a refresh reorders sessionsData', () => {
  // The session at index 0 was CON-90 when 'k' was pressed
  // (sessionsConfirmTicket captured it then); a refresh has since replaced
  // index 0 with a DIFFERENT managed session, CON-91.
  const reordered = [managedSession({ pid: 999, ticket: 'CON-91', tmux: { session: 'concertino', window: 'CON-91', windowId: '@9' } })];
  const out = plain(renderSessions(
    { sessionsData: reordered, sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90' },
    { cols: 120 },
  ));
  assert.match(out, /kill CON-90\?/, 'must still show the ORIGINALLY confirmed ticket');
  assert.doesNotMatch(out, /kill CON-91\?/, 'must never show the row that now happens to occupy the same index');
});

test('a freelance row\'s kill confirmation reads state.sessionsKillConfirm, not drillConfirm', () => {
  const sess = freelanceSession({});
  // drillConfirm set (as if a DIFFERENT, managed row were confirming) must
  // not leak into this freelance row's own confirm rendering.
  const out = plain(renderSessions(
    { sessionsData: [sess], sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90', sessionsKillConfirm: null },
    { cols: 120 },
  ));
  assert.doesNotMatch(out, /kill pid 222\?/);

  const confirming = plain(renderSessions(
    { sessionsData: [sess], sessionsSelected: 0, sessionsKillConfirm: { pid: 222, tmux: sess.tmux } }, { cols: 120 },
  ));
  assert.match(confirming, /kill pid 222\?/);
});

// The freelance render label is likewise sourced from the CAPTURED
// sessionsKillConfirm, not from the currently-selected row — a refresh
// reordering the list must not change what pid the confirmation displays.
test('a freelance row\'s confirm label reads the captured pid, not the currently-selected row\'s pid', () => {
  const reordered = [freelanceSession({ pid: 555 })];
  const out = plain(renderSessions(
    { sessionsData: reordered, sessionsSelected: 0, sessionsKillConfirm: { pid: 222, tmux: reordered[0].tmux } },
    { cols: 120 },
  ));
  assert.match(out, /kill pid 222\?/);
  assert.doesNotMatch(out, /kill pid 555\?/);
});

test('a failed kill/attach notice is rendered', () => {
  const out = plain(renderSessions(
    { sessionsData: [managedSession({})], sessionsSelected: 0, sessionsError: 'kill failed for CON-90: not-live' }, { cols: 120 },
  ));
  assert.match(out, /kill failed for CON-90/);
});

// --- handleKey -----------------------------------------------------------

test('Escape backs out to the fleet', () => {
  assert.deepEqual(handleKey('\x1b', { sessionsData: [] }), { type: 'back' });
});

test('r triggers a manual refresh', () => {
  assert.deepEqual(handleKey('r', { sessionsData: [managedSession({})] }), { type: 'refresh-sessions' });
});

test('arrow keys move the cursor; bare j/k do not (k is reserved for kill)', () => {
  const state = { sessionsData: [managedSession({}), freelanceSession({})], sessionsSelected: 0 };
  assert.deepEqual(handleKey('\x1b[B', state), { type: 'move-sessions', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', state), { type: 'move-sessions', delta: -1 });
  assert.notDeepEqual(handleKey('j', state), { type: 'move-sessions', delta: 1 });
});

test('Enter on a managed row attaches via the existing generic "attach" action', () => {
  const state = { sessionsData: [managedSession({})], sessionsSelected: 0 };
  assert.deepEqual(handleKey('\r', state), { type: 'attach', ticket: 'CON-90' });
});

test('Enter on a tmux-backed freelance row dispatches attach-session', () => {
  const sess = freelanceSession({});
  const state = { sessionsData: [sess], sessionsSelected: 0 };
  assert.deepEqual(handleKey('\r', state), { type: 'attach-session', session: 'scratch', windowId: '@2' });
});

test('Enter on a non-tmux freelance row is a no-op', () => {
  const state = { sessionsData: [freelanceSession({ tmux: null })], sessionsSelected: 0 };
  assert.equal(handleKey('\r', state), null);
});

test('k on a managed row opens the sessions-local open-managed-kill-confirm, carrying the ticket captured at k-press time', () => {
  const state = { sessionsData: [managedSession({})], sessionsSelected: 0 };
  assert.deepEqual(handleKey('k', state), { type: 'open-managed-kill-confirm', ticket: 'CON-90' });
});

test('y while a managed row is confirming dispatches kill-session-managed with the CAPTURED ticket, not the drill-down\'s kill-confirmed', () => {
  const state = { sessionsData: [managedSession({})], sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90' };
  assert.deepEqual(handleKey('y', state), { type: 'kill-session-managed', ticket: 'CON-90' });
});

test('any other key while a managed row is confirming cancels via the sessions-local action', () => {
  const state = { sessionsData: [managedSession({})], sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90' };
  assert.deepEqual(handleKey('x', state), { type: 'cancel-managed-kill-confirm' });
});

// Evaluator cycle-1 change request 1, the core regression: 'y' must act on
// the CAPTURED ticket even when a refresh has since replaced the row at
// `sessionsSelected` with an entirely different managed session.
test('y still targets the originally-confirmed ticket after a refresh reorders sessionsData underneath the confirm', () => {
  const reordered = [managedSession({ pid: 999, ticket: 'CON-91', tmux: { session: 'concertino', window: 'CON-91', windowId: '@9' } })];
  const state = { sessionsData: reordered, sessionsSelected: 0, drillConfirm: 'kill', sessionsConfirmTicket: 'CON-90' };
  assert.deepEqual(handleKey('y', state), { type: 'kill-session-managed', ticket: 'CON-90' });
});

test('k on a DIFFERENT managed row while nothing is confirming still resolves from the currently-selected row (no confirm is open yet)', () => {
  const rows = [managedSession({}), managedSession({ pid: 2, ticket: 'CON-91', tmux: { session: 'concertino', window: 'CON-91', windowId: '@9' } })];
  const state = { sessionsData: rows, sessionsSelected: 1 };
  assert.deepEqual(handleKey('k', state), { type: 'open-managed-kill-confirm', ticket: 'CON-91' });
});

test('k on a freelance row opens the sessions-local kill-session-confirm, carrying its tmux target', () => {
  const sess = freelanceSession({});
  const state = { sessionsData: [sess], sessionsSelected: 0 };
  assert.deepEqual(handleKey('k', state), { type: 'kill-session-confirm', pid: 222, tmuxTarget: sess.tmux });
});

test('y while a freelance row is confirming dispatches kill-session-confirmed', () => {
  const sess = freelanceSession({});
  const state = { sessionsData: [sess], sessionsSelected: 0, sessionsKillConfirm: { pid: 222, tmux: sess.tmux } };
  assert.deepEqual(handleKey('y', state), { type: 'kill-session-confirmed' });
});

test('any other key while a freelance row is confirming cancels via the sessions-local action', () => {
  const sess = freelanceSession({});
  const state = { sessionsData: [sess], sessionsSelected: 0, sessionsKillConfirm: { pid: 222, tmux: sess.tmux } };
  assert.deepEqual(handleKey('x', state), { type: 'cancel-session-kill-confirm' });
});

test('handleKey on an empty session list is a no-op for row-scoped keys', () => {
  const state = { sessionsData: [] };
  assert.equal(handleKey('\r', state), null);
  assert.equal(handleKey('k', state), null);
});

// --- router seam -----------------------------------------------------------

test('render/routeHandleKey are the uniform (state, opts) / (key, state) seam', () => {
  const state = { sessionsData: [managedSession({})], sessionsSelected: 0 };
  assert.equal(render(state, { cols: 100 }), renderSessions(state, { cols: 100 }));
  assert.deepEqual(routeHandleKey('\x1b', state), { type: 'back' });
});
