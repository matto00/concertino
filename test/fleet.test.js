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

// --- a crashed run must not read like a shipped one ------------------------

test('a delivered run and a failed run render under different headings', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done',   endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  assert.match(out, /FAILED/);
  assert.match(out, /DONE/);
  // FAILED sorts above DONE, and each ticket sits under its own heading.
  assert.ok(out.indexOf('FAILED') < out.indexOf('HEL-2'), 'HEL-2 under FAILED');
  assert.ok(out.indexOf('HEL-2') < out.indexOf('DONE'), 'FAILED section comes first');
  assert.ok(out.indexOf('DONE') < out.indexOf('HEL-1'), 'HEL-1 under DONE');
});

test('an escalated run says so — the circuit breaker giving up is not a crash', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  assert.match(out, /escalated/);
});

test('a dead window does not render a growing elapsed time as its signal', () => {
  // The harness crashed at 2am: no run.end, so endedAt is null and elapsed has
  // been counting against `now` ever since. `8h32m` reads as progress.
  const out = renderFleet([
    run({ ticket: 'HEL-3', status: 'failed', endStatus: null, endedAt: null,
          elapsedMs: 8 * 3600000 + 32 * 60000, window: { alive: false, idleMs: null } }),
  ], OPTS);
  assert.match(out, /window exited/);
  assert.doesNotMatch(out, /8h32m/);
});

// --- unbounded history must not push NEEDS YOU off the top -----------------

function manyFinished(n, status) {
  return Array.from({ length: n }, (_, i) =>
    run({ ticket: 'HEL-' + (100 + i), status, endStatus: status === 'done' ? 'delivered' : 'failed',
          endedAt: 100, elapsedMs: 60000, window: null }));
}

test('a long history renders a bounded number of rows plus a "more" line', () => {
  const out = renderFleet(manyFinished(50, 'done'), { cols: 78, selected: 0 });
  const shown = out.split('\n').filter((l) => /HEL-1\d\d/.test(l)).length;
  assert.ok(shown <= 5, `expected at most 5 finished rows, got ${shown}`);
  assert.match(out, /… and 45 more/);
});

test('NEEDS YOU survives when finished runs would otherwise fill the screen', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
  ].concat(manyFinished(50, 'done'));

  const out = renderFleet(runs, { cols: 78, rows: 12, selected: 0 });
  const lines = out.split('\n');
  assert.ok(lines.length <= 12, `output is ${lines.length} lines, terminal is 12`);
  assert.match(out, /NEEDS YOU/);
  assert.match(out, /HEL-338/);
  assert.match(out, /add zod@3\?/);
  assert.match(out, /more/, 'the hidden history is still accounted for');
  // The header must survive too — it is above NEEDS YOU and scrolls off first.
  assert.match(out, /concertino/);
});

test('a tiny terminal still keeps every NEEDS YOU run', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q1', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'needs-you', escalation: { question: 'q2', options: [], raisedAt: 1 } }),
  ].concat(manyFinished(20, 'failed'));
  const out = renderFleet(runs, { cols: 78, rows: 14, selected: 0 });
  assert.match(out, /HEL-1/);
  assert.match(out, /HEL-2/);
  assert.ok(out.split('\n').length <= 14);
});

// --- only bound keys are advertised ----------------------------------------

test('the empty state does not advertise an unbound key', () => {
  const out = renderFleet([], OPTS);
  assert.doesNotMatch(out, /press n/);
});

test('escalation options avoid the keybinding idiom until something binds them', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
  ], OPTS);
  assert.match(out, /approve \/ deny/);
  assert.doesNotMatch(out, /\[a\]pprove/);
  assert.doesNotMatch(out, /\[d\]eny/);
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
