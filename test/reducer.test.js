'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { reduce } = require('../lib/ui/reducer');

// Helper: build the Map shape store.readAll() produces.
function log(ticket, events, malformed) {
  return new Map([[ticket, { events, malformed: malformed || 0 }]]);
}
const NOW = 1000000;

test('folds run.start into identity fields', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 100, kind: 'run.start', ticket: 'HEL-1', project: 'helio', role: 'script',
      branch: 'feature/panel-resize-handles/HEL-1', worktree: '/w/HEL-1',
      dev_port: 5334, backend_port: 8334, harness: 'claude', model: 'opus-5' },
  ]), [], NOW);

  assert.equal(run.branch, 'feature/panel-resize-handles/HEL-1');
  assert.equal(run.devPort, 5334);
  assert.equal(run.harness, 'claude');
  assert.equal(run.startedAt, 100);
});

test('derives changeName from the branch middle segment', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script', branch: 'feature/panel-resize-handles/HEL-1' },
  ]), [], NOW);
  assert.equal(run.changeName, 'panel-resize-handles');
});

test('tracks the latest phase and cycle', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Execution', cycle: 1 },
    { t: 2, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Evaluation', cycle: 2 },
  ]), [], NOW);
  assert.equal(run.phase, 'Evaluation');
  assert.equal(run.cycle, 2);
});

test('keeps only the latest result per gate name', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'fail', duration_ms: 900 },
    { t: 2, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'lint', status: 'pass', duration_ms: 100 },
    { t: 3, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'pass', duration_ms: 800 },
  ]), [], NOW);
  assert.equal(run.gates.length, 2);
  assert.equal(run.gates.find((g) => g.name === 'test').status, 'pass');
  assert.equal(run.gates.find((g) => g.name === 'test').durationMs, 800);
});

test('events are folded in timestamp order even when the file is not', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 30, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Delivery' },
    { t: 10, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Planning' },
  ]), [], NOW);
  assert.equal(run.phase, 'Delivery');
});

test('a pending escalation makes the run need you', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'add zod?', options: 'approve,deny' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.status, 'needs-you');
  assert.deepEqual(run.escalation.options, ['approve', 'deny']);
});

test('an answered escalation clears it', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
    { t: 2, kind: 'escalation.answered', ticket: 'HEL-1', role: 'human', answer: 'approve' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation, null);
  assert.equal(run.status, 'running');
});

test('a BLOCKER verdict needs you', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'verdict', ticket: 'HEL-1', role: 'evaluator', verdict: 'BLOCKER', ref: 'r.md' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.status, 'needs-you');
});

test('a dead window with no run.end is failed, not running', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Execution' },
  ]), [{ ticket: 'HEL-1', alive: false, idleMs: 0 }], NOW);
  assert.equal(run.status, 'failed');
});

test('an escalation on a delivered run is stale, with no window at all', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 2, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
  ]), [], NOW);
  assert.equal(run.status, 'done');
  assert.equal(run.escalationStale, true);
});

test('a run with no window and no run.end is unknown', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Planning' },
  ]), [], NOW);
  assert.equal(run.status, 'unknown');
});

test('a dead window holding an escalation marks it stale', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
  ]), [{ ticket: 'HEL-1', alive: false, idleMs: 0 }], NOW);
  assert.equal(run.status, 'failed');
  assert.equal(run.escalationStale, true);
});

test('run.end delivered is done', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
  ]), [], NOW);
  assert.equal(run.status, 'done');
  assert.equal(run.elapsedMs, 8);
});

test('telemetry tier is full when semantic events are present', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 2, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Planning' },
  ]), [], NOW);
  assert.equal(run.telemetry, 'full');
});

test('telemetry tier is partial with script events only', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 2, kind: 'gate.result', ticket: 'HEL-1', role: 'script', gate: 'test', status: 'pass' },
  ]), [], NOW);
  assert.equal(run.telemetry, 'partial');
  assert.equal(run.phase, null);
});

test('a window with no event log at all still produces a run', () => {
  const runs = reduce(new Map(), [{ ticket: 'HEL-9', alive: true, idleMs: 660000 }], NOW);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].telemetry, 'none');
  assert.equal(runs[0].status, 'running');
  assert.equal(runs[0].window.idleMs, 660000);
});

test('malformed count is carried through to the run', () => {
  const [run] = reduce(log('HEL-1', [{ t: 1, kind: 'note', ticket: 'HEL-1', role: 'script' }], 3), [], NOW);
  assert.equal(run.malformed, 3);
});

test('runs sort attention-first', () => {
  const events = new Map([
    ['HEL-DONE', { events: [{ t: 1, kind: 'run.end', ticket: 'HEL-DONE', role: 'orchestrator', status: 'delivered' }], malformed: 0 }],
    ['HEL-RUN',  { events: [{ t: 2, kind: 'phase.enter', ticket: 'HEL-RUN', role: 'orchestrator', phase: 'Execution' }], malformed: 0 }],
    ['HEL-ESC',  { events: [{ t: 3, kind: 'escalation.raised', ticket: 'HEL-ESC', role: 'orchestrator', question: 'q' }], malformed: 0 }],
  ]);
  const windows = [
    { ticket: 'HEL-RUN', alive: true, idleMs: 0 },
    { ticket: 'HEL-ESC', alive: true, idleMs: 0 },
  ];
  const runs = reduce(events, windows, NOW);
  assert.deepEqual(runs.map((r) => r.ticket), ['HEL-ESC', 'HEL-RUN', 'HEL-DONE']);
});
