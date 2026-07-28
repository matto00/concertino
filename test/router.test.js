'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const router = require('../lib/ui/router');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function fleetRun(over) {
  return Object.assign({
    ticket: 'HEL-1', project: 'helio', changeName: 'a-change', branch: null,
    phase: null, cycle: null, gates: [], lastVerdict: null, escalation: null,
    escalationStale: false, events: [], startedAt: null, endedAt: null,
    endStatus: null, elapsedMs: 60000, window: { alive: true, idleMs: 0 },
    status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

test('the fleet screen renders through the router', () => {
  const state = { mode: 'fleet', runs: [fleetRun({})], selected: 0, prompt: null };
  const out = router.render(state, { cols: 78 });
  assert.match(out, /helio/);
  assert.match(out, /1 run/);
});

test('the escalation screen renders through the router', () => {
  const esc = fleetRun({
    ticket: 'HEL-338', status: 'needs-you',
    escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1000, role: 'orchestrator' },
  });
  const state = { mode: 'escalation', runs: [esc], escalationTicket: 'HEL-338' };
  const out = plain(router.render(state, { cols: 78, now: 5000 }));
  assert.match(out, /add zod@3\?/);
  assert.match(out, /\[a\]pprove/);
});

test('an unknown mode degrades safely instead of throwing or rendering the fleet', () => {
  const state = { mode: 'launch-pad-not-built-yet', runs: [fleetRun({})] };
  assert.doesNotThrow(() => router.render(state, { cols: 78 }));
  const out = router.render(state, { cols: 78 });
  assert.doesNotMatch(out, /helio/);          // did not silently fall back to fleet
  assert.match(out, /unknown screen/);
});

test('handleKey dispatches to the current screen', () => {
  const state = { mode: 'fleet', runs: [fleetRun({}), fleetRun({ ticket: 'HEL-2' })], selected: 0, prompt: null };
  assert.deepEqual(router.handleKey('j', state), { type: 'move', delta: 1 });
});

test('handleKey on an unknown mode is a no-op, not a throw', () => {
  const state = { mode: 'nope', runs: [] };
  assert.equal(router.handleKey('j', state), null);
});

test('a run whose escalation cleared still renders through the escalation screen honestly', () => {
  // The router does not know the escalation cleared — that transition is
  // watch.js's job (see draw() falling back to 'fleet'). Rendering the
  // escalation screen against a run with no live escalation must still be
  // safe, not throw, and never invent a question that is not there.
  const state = { mode: 'escalation', runs: [fleetRun({ ticket: 'HEL-9', escalation: null })], escalationTicket: 'HEL-9' };
  const out = plain(router.render(state, { cols: 78, now: 1000 }));
  assert.match(out, /no escalation/i);
});
