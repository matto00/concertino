'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./support/tmp');
const fleet = require('../lib/cli/fleet');

// `concertino fleet` (docs/superpowers/specs/2026-10-06-fleet-pane-design.md):
// a read-only JSON snapshot of .concertino/runs for the Claude Code fleet
// pane. buildSnapshot is the pure-ish core (fs reads, no writes); the CLI
// wrapper is exercised once as a subprocess at the bottom of this file.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const T0 = 1_700_000_000_000;

function writeRun(root, ticket, events, extra = {}) {
  const dir = path.join(root, '.concertino', 'runs', ticket);
  fs.mkdirSync(dir, { recursive: true });
  const lines = events.map((e, i) => JSON.stringify({
    t: T0 + i * 1000, project: 'p', ticket, role: 'script', ...e,
  }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n') + '\n');
  if (extra.ticketMd != null) {
    fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'ticket.md'), extra.ticketMd);
  }
  if (extra.answer != null) {
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(extra.answer));
  }
  return dir;
}

const START = { kind: 'run.start', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', harness: 'claude-code' };

test('buildSnapshot: live run carries reducer fields plus ticket_doc, pendingAnswer, timeline, currentAgent', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [
    START,
    { kind: 'phase.enter', phase: 'Execution', cycle: 1 },
    { kind: 'agent.spawn', agent: 'executor', cycle: 1 },
    { kind: 'gate.result', gate: 'phase:setup', status: 'pass', duration_ms: 10 },
  ], { ticketMd: '# Add the thing\n\nBody line one.\nBody line two.\n' });

  const snap = fleet.buildSnapshot(root, { now: T0 + 60_000 });
  assert.equal(snap.root, root);
  assert.equal(typeof snap.generatedAt, 'number');
  assert.equal(snap.runs.length, 1);
  const run = snap.runs[0];
  assert.equal(run.ticket, 'CON-1');
  assert.equal(run.phase, 'Execution');
  assert.equal(run.cycle, 1);
  assert.equal(run.changeName, 'thing');
  assert.equal(run.status, 'unknown');            // no tmux windows: liveness is the mod's job
  assert.deepEqual(run.ticket_doc, { title: 'Add the thing', excerpt: 'Body line one.\nBody line two.' });
  assert.equal(run.pendingAnswer, null);
  assert.equal(run.currentAgent, 'executor');
  assert.equal(run.timeline.length, 4);
  assert.deepEqual(run.timeline[1], { t: T0 + 1000, kind: 'phase.enter', phase: 'Execution', cycle: 1 });
  assert.deepEqual(run.timeline[3], { t: T0 + 3000, kind: 'gate.result', gate: 'phase:setup', status: 'pass' });
});

test('buildSnapshot: ticket_doc is null fields when evidence/ticket.md is missing; excerpt is capped at 1024 chars', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  writeRun(root, 'CON-2', [START], { ticketMd: '# Big\n' + 'x'.repeat(5000) });
  const byTicket = Object.fromEntries(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].ticket_doc, { title: null, excerpt: null });
  assert.equal(byTicket['CON-2'].ticket_doc.title, 'Big');
  assert.equal(byTicket['CON-2'].ticket_doc.excerpt.length, 1024);
});

test('buildSnapshot: pendingAnswer passes answer.json through, single and multi-part', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START], { answer: { answer: 'b' } });
  writeRun(root, 'CON-2', [START], { answer: { subAnswers: ['a', null], total: 2, complete: false } });
  const byTicket = Object.fromEntries(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].pendingAnswer, { answer: 'b' });
  assert.deepEqual(byTicket['CON-2'].pendingAnswer, { subAnswers: ['a', null], total: 2, complete: false });
});

test('buildSnapshot: timeline keeps the last 20 events and only whitelisted fields', () => {
  const root = mkTmpDir('concertino-fleet-');
  const events = [START];
  for (let i = 0; i < 30; i++) events.push({ kind: 'gate.result', gate: 'g' + i, status: 'pass', first_error: 'noise' });
  writeRun(root, 'CON-1', events);
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.timeline.length, 20);
  assert.equal(run.timeline[19].gate, 'g29');
  assert.equal(run.timeline[19].first_error, undefined);
});

test('buildSnapshot: done runs are excluded by default and included with all:true', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'delivered' }]);
  writeRun(root, 'CON-2', [START]);
  assert.deepEqual(fleet.buildSnapshot(root, { now: T0 }).runs.map((r) => r.ticket), ['CON-2']);
  assert.deepEqual(
    fleet.buildSnapshot(root, { now: T0, all: true }).runs.map((r) => r.ticket).sort(),
    ['CON-1', 'CON-2'],
  );
});

test('buildSnapshot: a failed run (run.end status != delivered) stays in the default view', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'abandoned-stale' }]);
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.status, 'failed');
});

test('buildSnapshot: no .concertino/runs directory yields runs: []', () => {
  const root = mkTmpDir('concertino-fleet-');
  assert.deepEqual(fleet.buildSnapshot(root, { now: T0 }).runs, []);
});

test('buildSnapshot: a malformed events.jsonl line is skipped, not thrown', () => {
  const root = mkTmpDir('concertino-fleet-');
  const dir = writeRun(root, 'CON-1', [START]);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{not json\n');
  const [run] = fleet.buildSnapshot(root, { now: T0 }).runs;
  assert.equal(run.malformed, 1);
});

test('resolveRoot: resolves the main checkout from a worktree', () => {
  const root = mkTmpDir('concertino-fleet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const wt = path.join(root, '.concertino', 'worktrees', 'feature', 'thing', 'CON-1');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: root });
  assert.equal(fs.realpathSync(fleet.resolveRoot(wt)), fs.realpathSync(root));
});

test('resolveRoot: outside a git repo returns the directory itself', () => {
  const dir = mkTmpDir('concertino-fleet-');
  assert.equal(fleet.resolveRoot(dir), dir);
});
