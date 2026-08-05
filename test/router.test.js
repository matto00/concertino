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

test('the drill-down screen renders through the router', () => {
  const state = { mode: 'drilldown', runs: [fleetRun({ ticket: 'HEL-334', phase: 'Evaluation' })], drillTicket: 'HEL-334' };
  const out = plain(router.render(state, { cols: 78, now: 5000 }));
  assert.match(out, /HEL-334/);
  assert.match(out, /Evaluation/);
});

test('handleKey dispatches to the drill-down screen', () => {
  const state = { mode: 'drilldown', runs: [fleetRun({ ticket: 'HEL-334', status: 'running' })], drillTicket: 'HEL-334' };
  assert.deepEqual(router.handleKey('k', state), { type: 'confirm-action', action: 'kill' });
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

// --- launch pad / ticket viewer / launch plan --------------------------------

test('the launch pad renders through the router', () => {
  const lp = {
    status: { enabled: true, reason: null, message: null },
    cache: { fetchedAt: 1000, tickets: [{ identifier: 'CON-1', title: 'x', epicId: 'p1', epicName: 'Pipeline v2', state: { name: 'Todo', type: 'unstarted' } }], epics: [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }] },
    pane: 'tickets', epicIndex: 0, ticketIndex: 0, selected: new Set(), mode: 'parallel',
    refreshing: false, error: null, project: 'concertino', defaultConcurrency: 2,
  };
  const state = { mode: 'launchpad', runs: [], launchPad: lp };
  const out = router.render(state, { cols: 78, now: 2000 });
  assert.match(out, /NEW RUN/);
  assert.match(out, /Pipeline v2/);
});

test('handleKey dispatches to the launch pad screen', () => {
  const lp = {
    status: { enabled: true, reason: null, message: null },
    cache: { fetchedAt: 1000, tickets: [], epics: [] },
    pane: 'tickets', epicIndex: 0, ticketIndex: 0, selected: new Set(), mode: 'parallel',
    refreshing: false, error: null, project: '', defaultConcurrency: 2,
  };
  const state = { mode: 'launchpad', runs: [], launchPad: lp };
  assert.deepEqual(router.handleKey('\x1b', state), { type: 'back' });
});

test('the ticket viewer renders through the router', () => {
  const state = {
    mode: 'ticketview',
    launchPad: { viewingTicket: 'CON-1', cache: { tickets: [{ identifier: 'CON-1', title: 'a ticket', description: 'body text', comments: [] }] } },
  };
  const out = router.render(state, { cols: 78 });
  assert.match(out, /CON-1/);
  assert.match(out, /body text/);
});

test('the launch plan renders through the router', () => {
  const state = {
    mode: 'launchplan',
    runs: [],
    launchPlan: {
      tickets: [{ identifier: 'CON-338', title: 'x' }], mode: 'parallel', concurrency: 2,
      harness: 'claude', harnesses: ['claude'], baseBranch: 'main', commitSha: null,
      worktreeBase: '.concertino/worktrees', launchCommand: 'claude "/concertino-deliver {{TICKET}}"',
      portsCfg: {},
    },
  };
  const out = router.render(state, { cols: 78 });
  assert.match(out, /LAUNCH PLAN/);
  assert.match(out, /CON-338/);
});

// --- CON-78: the sessions screen ---------------------------------------------

test('the sessions screen renders through the router', () => {
  const state = { mode: 'sessions', sessionsData: [{ pid: 1, harness: 'claude', managed: false, tmux: null, cwd: '/a', ageMs: 1000, version: null, nearTicket: null }], sessionsSelected: 0 };
  const out = plain(router.render(state, { cols: 100 }));
  assert.match(out, /claude/);
  assert.match(out, /sessions/i);
});

test('handleKey dispatches to the sessions screen', () => {
  const state = { mode: 'sessions', sessionsData: [] };
  assert.deepEqual(router.handleKey('\x1b', state), { type: 'back' });
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
