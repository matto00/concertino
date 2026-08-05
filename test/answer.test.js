'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// CON-76 escalation-answer-cli: exercises `bin/concertino answer` as a real
// subprocess (the same way the root orchestrator's Bash tool would call it),
// not by reaching into lib/cli/answer.js's cmdAnswer directly — it calls
// process.exit() on every path, which would kill the test runner's own
// process if invoked in-process.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const REAL_EMIT_EVENT = path.resolve(__dirname, '..', 'core', 'scripts', 'emit-event.sh');

// A throwaway project root with the one rendered artifact `concertino answer`
// shells out to (scripts/concertino/emit-event.sh) — mirrors what `concertino
// sync` actually copies into a real project, without going through sync
// itself. Also a real git repo: emit-event.sh resolves its writable root via
// `git rev-parse --git-common-dir` and silently no-ops outside one (see its
// own `main_checkout()`), so a non-repo fixture would make every
// escalation.answered assertion below false-negative rather than fail loudly.
function newRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-answer-'));
  const scriptsDir = path.join(dir, 'scripts', 'concertino');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(REAL_EMIT_EVENT, path.join(scriptsDir, 'emit-event.sh'));
  fs.chmodSync(path.join(scriptsDir, 'emit-event.sh'), 0o755);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function runAnswer(root, args) {
  try {
    const out = execFileSync('node', [BIN, 'answer'].concat(args, ['--out=' + root]), { encoding: 'utf8' });
    return { out, status: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  }
}

function readAnswerJson(root, ticket) {
  return JSON.parse(fs.readFileSync(path.join(root, '.concertino', 'runs', ticket, 'answer.json'), 'utf8'));
}

function readEvents(root, ticket) {
  const p = path.join(root, '.concertino', 'runs', ticket, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('a fresh single-question answer succeeds, matches the dashboard writer\'s shape, and records escalation.answered', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-1', 'approve']);
    assert.equal(status, 0, out);
    assert.deepEqual(readAnswerJson(root, 'CON-1'), { answer: 'approve' });
    const events = readEvents(root, 'CON-1');
    const answered = events.filter((e) => e.kind === 'escalation.answered');
    assert.equal(answered.length, 1);
    assert.equal(answered[0].answer, 'approve');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a second answer to an already-answered escalation is refused and reported, records no event', () => {
  const root = newRoot();
  try {
    const first = runAnswer(root, ['CON-2', 'approve']);
    assert.equal(first.status, 0, first.out);

    const second = runAnswer(root, ['CON-2', 'deny']);
    assert.notEqual(second.status, 0, 'a refused write must not report success via exit 0');
    assert.match(second.out, /already answered/i);

    // The winning answer is still the first one.
    assert.deepEqual(readAnswerJson(root, 'CON-2'), { answer: 'approve' });
    const events = readEvents(root, 'CON-2');
    assert.equal(events.filter((e) => e.kind === 'escalation.answered').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub/--total writes through writeSubAnswer, including its own already-answered-at-this-index refusal', () => {
  const root = newRoot();
  try {
    const first = runAnswer(root, ['CON-3', 'yes', '--sub', '0', '--total', '2']);
    assert.equal(first.status, 0, first.out);

    const replay = runAnswer(root, ['CON-3', 'no', '--sub', '0', '--total', '2']);
    assert.notEqual(replay.status, 0);
    assert.match(replay.out, /already answered/i);

    const state = readAnswerJson(root, 'CON-3');
    assert.deepEqual(state.subAnswers, ['yes', null]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a completing multi-part sub-answer records escalation.answered with the full sub_answers array', () => {
  const root = newRoot();
  try {
    const r1 = runAnswer(root, ['CON-4', 'yes', '--sub', '0', '--total', '2']);
    assert.equal(r1.status, 0, r1.out);
    assert.equal(readEvents(root, 'CON-4').filter((e) => e.kind === 'escalation.answered').length, 0,
      'a partial sub-answer must not record escalation.answered');

    const r2 = runAnswer(root, ['CON-4', 'rename', '--sub', '1', '--total', '2']);
    assert.equal(r2.status, 0, r2.out);

    const events = readEvents(root, 'CON-4');
    const answered = events.filter((e) => e.kind === 'escalation.answered');
    assert.equal(answered.length, 1);
    const subAnswers = JSON.parse(answered[0].sub_answers);
    assert.deepEqual(subAnswers, ['yes', 'rename']);

    const state = readAnswerJson(root, 'CON-4');
    assert.equal(state.complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a partial (non-completing) multi-part sub-answer succeeds but records no event', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-5', 'yes', '--sub', '0', '--total', '3']);
    assert.equal(status, 0, out);
    assert.match(out, /still open/i);
    assert.equal(readEvents(root, 'CON-5').filter((e) => e.kind === 'escalation.answered').length, 0);

    const state = readAnswerJson(root, 'CON-5');
    assert.deepEqual(state.subAnswers, ['yes', null, null]);
    assert.equal(state.complete, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts the --sub=<n> --total=<n> equals form too', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-6', 'yes', '--sub=0', '--total=1']);
    assert.equal(status, 0, out);
    const events = readEvents(root, 'CON-6');
    assert.equal(events.filter((e) => e.kind === 'escalation.answered').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
