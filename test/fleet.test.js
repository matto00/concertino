'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderFleet } = require('../lib/ui/screens/fleet');

function run(over) {
  return Object.assign({
    ticket: 'HEL-1', project: 'helio', changeName: 'a-change', branch: null,
    worktree: null, devPort: null, backendPort: null, harness: null, model: null,
    phase: null, cycle: null, gates: [], lastVerdict: null, escalation: null,
    escalationStale: false, events: [], startedAt: null, endedAt: null,
    endStatus: null, elapsedMs: 60000, window: { alive: true, idleMs: 0 },
    status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

const OPTS = { cols: 78, selected: 0 };

test('renders a header with the project and counts', () => {
  const out = renderFleet([run({})], OPTS);
  assert.match(out, /helio/);
  assert.match(out, /1 run/);
});

test('groups escalated runs under NEEDS YOU', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331', status: 'running' }),
  ], OPTS);
  assert.match(out, /NEEDS YOU/);
  assert.ok(out.indexOf('HEL-338') < out.indexOf('HEL-331'), 'escalation must come first');
  assert.match(out, /add zod@3\?/);
});

test('shows phase and cycle for fully instrumented runs', () => {
  const out = renderFleet([run({ phase: 'Evaluation', cycle: 2, gates: [
    { name: 'test', status: 'pass' }, { name: 'lint', status: 'pass' },
    { name: 'build', status: 'fail' },
  ] })], OPTS);
  assert.match(out, /Evaluation/);
  assert.match(out, /cycle 2/);
  assert.match(out, /2\/3/);
});

test('a partially instrumented run says so instead of inventing a phase', () => {
  const out = renderFleet([run({ telemetry: 'partial', phase: null })], OPTS);
  assert.match(out, /phase unknown/);
  assert.doesNotMatch(out, /Evaluation/);
});

test('an uninstrumented run reports no telemetry and its idle time', () => {
  const out = renderFleet([run({ telemetry: 'none', phase: null, window: { alive: true, idleMs: 11 * 60000 } })], OPTS);
  assert.match(out, /no telemetry/);
  assert.match(out, /idle 11m/);
});

test('a stale escalation on a dead run is labelled stale', () => {
  const out = renderFleet([run({
    status: 'failed', escalationStale: true,
    escalation: { question: 'q', options: [], raisedAt: 1 },
  })], OPTS);
  assert.match(out, /stale/);
});

test('malformed events are surfaced in the footer', () => {
  const out = renderFleet([run({ malformed: 2 })], OPTS);
  assert.match(out, /2 malformed events/);
});

test('an empty fleet renders a hint rather than a blank screen', () => {
  const out = renderFleet([], OPTS);
  assert.match(out, /no active runs/i);
});

test('no rendered line exceeds the terminal width', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', changeName: 'an-extremely-long-change-name-that-will-not-fit-anywhere',
          escalation: { question: 'a very long escalation question that should be truncated to fit the terminal', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331' }),
  ], { cols: 60, selected: 0 });
  // eslint-disable-next-line no-control-regex
  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of out.split('\n')) {
    assert.ok(visible(line).length <= 60, `line too long (${visible(line).length}): ${line}`);
  }
});
