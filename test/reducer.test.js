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

// --- CON-22: speed/models on run.start -------------------------------------

test('folds run.start speed and models (JSON-string-valued, per emit-event.sh) into the run', () => {
  const modelsJson = JSON.stringify({ orchestrator: 'sonnet', executor: 'haiku', evaluator: 'haiku', skeptic: 'opus', auditor: 'sonnet' });
  const [run] = reduce(log('HEL-2', [
    { t: 100, kind: 'run.start', ticket: 'HEL-2', role: 'script',
      branch: 'feature/x/HEL-2', harness: 'claude-code', speed: 'fast', models: modelsJson },
  ]), [], NOW);

  assert.equal(run.speed, 'fast');
  assert.deepEqual(run.models, { orchestrator: 'sonnet', executor: 'haiku', evaluator: 'haiku', skeptic: 'opus', auditor: 'sonnet' });
});

test('a run predating this feature has no speed/models — absent, not malformed', () => {
  const [run] = reduce(log('HEL-3', [
    { t: 100, kind: 'run.start', ticket: 'HEL-3', role: 'script', branch: 'feature/x/HEL-3', harness: 'claude-code' },
  ]), [], NOW);

  assert.equal(run.speed, null);
  assert.equal(run.models, null);
});

test('a malformed models= value degrades to absent rather than throwing', () => {
  assert.doesNotThrow(() => reduce(log('HEL-4', [
    { t: 100, kind: 'run.start', ticket: 'HEL-4', role: 'script', branch: 'feature/x/HEL-4', models: '{not valid json' },
  ]), [], NOW));
  const [run] = reduce(log('HEL-4', [
    { t: 100, kind: 'run.start', ticket: 'HEL-4', role: 'script', branch: 'feature/x/HEL-4', models: '{not valid json' },
  ]), [], NOW);
  assert.equal(run.models, null);
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

test('an escalation.raised with context populates run.escalation.context', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'add zod?', options: 'approve,deny',
      context: 'package zod@3.23.0, imported by lib/ui/ticket.js' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation.context, 'package zod@3.23.0, imported by lib/ui/ticket.js');
  assert.equal(run.escalation.contextTruncated, false);
  assert.equal(run.escalation.contextRef, null);
});

test('an escalation.raised with truncated context carries the ref', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'q', options: 'approve,deny',
      context: 'truncated text… [truncated, 40 of 6000 bytes shown — full context: /r/evidence/escalation-context-1.txt]',
      context_truncated: true,
      context_ref: '/r/evidence/escalation-context-1.txt' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation.contextTruncated, true);
  assert.equal(run.escalation.contextRef, '/r/evidence/escalation-context-1.txt');
});

test('an escalation.raised with no context yields context: null and no truncation flag', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'q', options: 'approve,deny' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation.context, null);
  assert.equal(run.escalation.contextTruncated, false);
  assert.equal(run.escalation.contextRef, null);
});

// --- CON-46: multi-part sub_questions ---------------------------------

test('an escalation.raised with sub_questions parses it into run.escalation.subQuestions', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      sub_questions: JSON.stringify([
        { question: 'Keep foo?', options: ['yes', 'no'] },
        { question: 'Rename bar?', options: ['rename', 'keep'] },
      ]) },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.deepEqual(run.escalation.subQuestions, [
    { question: 'Keep foo?', options: ['yes', 'no'] },
    { question: 'Rename bar?', options: ['rename', 'keep'] },
  ]);
});

test('an escalation.raised with a malformed sub_questions degrades to absent, never throws', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'q', options: 'approve,deny', sub_questions: 'not valid json' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation.subQuestions, undefined);
  assert.equal(run.escalation.question, 'q');
});

test('an escalation.raised with no sub_questions at all leaves run.escalation.subQuestions undefined', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'q', options: 'approve,deny' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation.subQuestions, undefined);
});

test('an escalation.answered clears run.escalation for a multi-part escalation exactly as it does for single-question', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      sub_questions: JSON.stringify([{ question: 'Keep foo?', options: ['yes', 'no'] }]) },
    { t: 2, kind: 'escalation.answered', ticket: 'HEL-1', role: 'orchestrator', sub_answers: '["yes"]' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);
  assert.equal(run.escalation, null);
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

// --- CON-77: run.spawn / spawnedAt / startingMs ----------------------------

test('a run whose only event is run.spawn reports no telemetry with spawnedAt set', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 500, kind: 'run.spawn', ticket: 'HEL-1', project: 'helio', role: 'dashboard' },
  ]), [], NOW);
  assert.equal(run.telemetry, 'none');
  assert.equal(run.spawnedAt, 500);
  assert.equal(run.startedAt, null);
});

test('startingMs reflects now - spawnedAt while startedAt is still null', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 500, kind: 'run.spawn', ticket: 'HEL-1', role: 'dashboard' },
  ]), [], NOW);
  assert.equal(run.startingMs, NOW - 500);
});

test('startingMs reverts to null once run.start also lands', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 500, kind: 'run.spawn', ticket: 'HEL-1', role: 'dashboard' },
    { t: 700, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
  ]), [], NOW);
  assert.equal(run.startingMs, null);
  assert.equal(run.startedAt, 700);
  assert.equal(run.elapsedMs, NOW - 700);
});

// --- CON-3: an unrecognised phase.enter value is rejected, not applied ------

test('an unrecognised phase value does not set run.phase and increments run.malformed', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Phase 2', cycle: 1 },
  ]), [], NOW);
  assert.equal(run.phase, null);
  assert.equal(run.malformed, 1);
});

// --- CON-48: a live escalation raised after run.end is not stale, and wins
// the needs-you status over the endStatus done/failed short-circuit, for as
// long as the window is confirmed alive. ------------------------------------

test('run.end (delivered) followed by a live escalation, window alive: not stale, needs-you', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
    { t: 10, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'Want a follow-up ticket for the sync drift, or leave it for now?',
      options: 'open-ticket,leave-it' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);

  assert.equal(run.escalationStale, false);
  assert.equal(run.status, 'needs-you');
});

test('once that same follow-up escalation is answered, status reverts to done', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
    { t: 10, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator',
      question: 'Want a follow-up ticket for the sync drift, or leave it for now?',
      options: 'open-ticket,leave-it' },
    { t: 20, kind: 'escalation.answered', ticket: 'HEL-1', role: 'human', answer: 'leave-it' },
  ]), [{ ticket: 'HEL-1', alive: true, idleMs: 0 }], NOW);

  assert.equal(run.escalation, null);
  assert.equal(run.status, 'done');
});

test('run.end followed by escalation.raised with no window data at all is still stale (regression guard)', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'run.start', ticket: 'HEL-1', role: 'script' },
    { t: 9, kind: 'run.end', ticket: 'HEL-1', role: 'orchestrator', status: 'delivered' },
    { t: 10, kind: 'escalation.raised', ticket: 'HEL-1', role: 'orchestrator', question: 'q' },
  ]), [], NOW);

  assert.equal(run.escalationStale, true);
  assert.equal(run.status, 'done');
});

test('a valid phase.enter following an unrecognised one still applies correctly', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Phase 2', cycle: 1 },
    { t: 2, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Execution', cycle: 1 },
  ]), [], NOW);
  assert.equal(run.phase, 'Execution');
  assert.equal(run.malformed, 1);
});

test('a dropped envelope-malformed line and a rejected-phase event both count toward malformed, but only the phase.enter event appears in run.events', () => {
  const [run] = reduce(log('HEL-1', [
    { t: 1, kind: 'phase.enter', ticket: 'HEL-1', role: 'orchestrator', phase: 'Phase 2' },
  ], 1), [], NOW);
  assert.equal(run.malformed, 2);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].kind, 'phase.enter');
});

test('runs sort attention-first', () => {
  const events = new Map([
    ['HEL-DONE', { events: [{ t: 1, kind: 'run.end', ticket: 'HEL-DONE', role: 'orchestrator', status: 'delivered' }], malformed: 0 }],
    ['HEL-RUN',  { events: [{ t: 2, kind: 'phase.enter', ticket: 'HEL-RUN', role: 'orchestrator', phase: 'Execution' }], malformed: 0 }],
    ['HEL-ESC',  { events: [{ t: 3, kind: 'escalation.raised', ticket: 'HEL-ESC', role: 'orchestrator', question: 'q' }], malformed: 0 }],
    ['HEL-FAIL', { events: [{ t: 4, kind: 'run.end', ticket: 'HEL-FAIL', role: 'orchestrator', status: 'escalated' }], malformed: 0 }],
  ]);
  const windows = [
    { ticket: 'HEL-RUN', alive: true, idleMs: 0 },
    { ticket: 'HEL-ESC', alive: true, idleMs: 0 },
  ];
  const runs = reduce(events, windows, NOW);
  // Pins STATUS_ORDER (lib/ui/reducer.js) group-for-group against
  // buildSections' canonical section order (lib/ui/screens/fleet.js):
  // needs-you, failed, running, done. watch.js's `runs[selected]` attach
  // logic relies on this array's order matching the fleet screen's render
  // order — if a future reorder changes one without the other, this is the
  // test that should catch it before it becomes a "attached to the wrong
  // run" bug.
  assert.deepEqual(runs.map((r) => r.ticket), ['HEL-ESC', 'HEL-FAIL', 'HEL-RUN', 'HEL-DONE']);
});
