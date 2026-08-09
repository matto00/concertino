'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fleetCtl = require('../lib/ui/controllers/fleet');

// CON-98: the FAILED-row remediation actions (design.md Decisions 2/3) —
// 'address-failure', 'open-mark-done-confirm'/'cancel-mark-done'/
// 'confirm-mark-done'. Drives the real controller against a minimal ctx,
// mirroring test/controllers-sessions.test.js's/controllers-drilldown.test.js's
// own precedent: a fake ctx.deps (submitTicket/writeOverrideEvent never touch
// a real tmux session or a real events.jsonl) and a fake ctx.session.
//
// fleet.js's own screen-level tests (test/fleet.test.js) already cover
// handleKey resolving these actions in the first place — this file covers
// only what the controller does once dispatched.

function ctx(over) {
  const S = { runs: [], markDoneConfirm: null, addressFailureNotice: null };
  return Object.assign({
    S,
    root: '/tmp/concertino-fake-root',
    session: { name: 'concertino' },
    deps: {
      submitTicket: () => ({ spawned: true, error: null }),
      writeOverrideEvent: () => {},
    },
  }, over);
}

const apply = (c, action) => fleetCtl.handle(action, c);

function run(over) {
  return Object.assign({ ticket: 'HEL-9', status: 'failed', harness: 'claude-code' }, over);
}

// --- 'address-failure' ------------------------------------------------------

test('address-failure on a claude-code run spawns via submitTicket with the address-failure command', () => {
  const calls = [];
  const c = ctx({
    deps: {
      submitTicket: (ticket, command, session) => { calls.push({ ticket, command, session }); return { spawned: true, error: null }; },
      writeOverrideEvent: () => {},
    },
  });
  c.S.runs = [run({})];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticket, 'HEL-9');
  assert.match(calls[0].command, /\/concertino-address-failure \{\{TICKET\}\}/);
  assert.match(calls[0].command, /^claude /);
  assert.equal(calls[0].session, c.session);
  assert.equal(c.S.addressFailureNotice, null);
});

test('address-failure on a non-claude-code run shows an inline notice instead of spawning', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: (...args) => { calls.push(args); return { spawned: true, error: null }; }, writeOverrideEvent: () => {} } });
  c.S.runs = [run({ harness: 'codex' })];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0, 'no tmux window should be created or replaced');
  assert.match(c.S.addressFailureNotice, /codex/);
  assert.match(c.S.addressFailureNotice, /not.*available|isn't available/);
});

test('address-failure re-resolves the run fresh from S.runs — a stale/vanished ticket is a no-op', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: (...args) => { calls.push(args); return { spawned: true, error: null }; }, writeOverrideEvent: () => {} } });
  c.S.runs = []; // the run is gone by the time this resolved
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0);
  assert.equal(c.S.addressFailureNotice, null);
});

test('address-failure surfaces a failed spawn as the notice, rather than swallowing it', () => {
  const c = ctx({ deps: { submitTicket: () => ({ spawned: false, error: 'could not start HEL-9: boom' }), writeOverrideEvent: () => {} } });
  c.S.runs = [run({})];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(c.S.addressFailureNotice, 'could not start HEL-9: boom');
});

// --- 'open-mark-done-confirm' / 'cancel-mark-done' --------------------------

test('open-mark-done-confirm sets S.markDoneConfirm to the given ticket', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'open-mark-done-confirm', ticket: 'HEL-9' }), true);
  assert.deepEqual(c.S.markDoneConfirm, { ticket: 'HEL-9' });
});

test('cancel-mark-done clears S.markDoneConfirm without writing anything', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'cancel-mark-done' }), true);
  assert.equal(c.S.markDoneConfirm, null);
  assert.equal(calls.length, 0);
});

// --- 'confirm-mark-done' -----------------------------------------------------

test('confirm-mark-done writes a run.override event for the resolved run and clears the confirm', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.runs = [run({})];
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'confirm-mark-done', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [c.root, 'HEL-9', 'done']);
  assert.equal(c.S.markDoneConfirm, null);
});

test('confirm-mark-done re-resolves the run fresh from S.runs — a vanished run writes nothing but still clears the confirm', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.runs = []; // gone by the time 'y' actually landed
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'confirm-mark-done', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0);
  assert.equal(c.S.markDoneConfirm, null);
});
