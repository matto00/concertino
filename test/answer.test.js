'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./support/tmp');
const store = require('../lib/ui/store');

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
  const dir = mkTmpDir('concertino-answer-');
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

// CON-156 (cycle 2, finding 1): raises a REAL escalation.raised event through
// the actual script — not a hand-built fixture line — so the CLI's
// readEscalationShape() has real ground truth to check `--sub`/`--total`
// against, exactly as it would for a real orchestrator-raised escalation.
// --raise-only never blocks, so this is safe to call synchronously.
function raiseEscalation(root, ticket, args) {
  const script = path.join(root, 'scripts', 'concertino', 'emit-event.sh');
  execFileSync(script, ['escalation', '--raise-only', 'ticket=' + ticket, 'role=orchestrator'].concat(args),
    { cwd: root });
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
    const first = runAnswer(root, ['CON-3', 'yes', '--sub', '1', '--total', '2']);
    assert.equal(first.status, 0, first.out);

    const replay = runAnswer(root, ['CON-3', 'no', '--sub', '1', '--total', '2']);
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
    const r1 = runAnswer(root, ['CON-4', 'yes', '--sub', '1', '--total', '2']);
    assert.equal(r1.status, 0, r1.out);
    assert.equal(readEvents(root, 'CON-4').filter((e) => e.kind === 'escalation.answered').length, 0,
      'a partial sub-answer must not record escalation.answered');

    const r2 = runAnswer(root, ['CON-4', 'rename', '--sub', '2', '--total', '2']);
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
    const { out, status } = runAnswer(root, ['CON-5', 'yes', '--sub', '1', '--total', '3']);
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
    const { out, status } = runAnswer(root, ['CON-6', 'yes', '--sub=1', '--total=1']);
    assert.equal(status, 0, out);
    const events = readEvents(root, 'CON-6');
    assert.equal(events.filter((e) => e.kind === 'escalation.answered').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// CON-151: `--sub` is documented/confirmed in 1-based human terms (the
// confirmation message has always printed "sub N/total" as 1-based) but was
// silently applied 0-based to the underlying array write. `--sub 1` on a
// 3-part escalation must land in the FIRST slot (array index 0), and the
// confirmation must name the same sub-question it just wrote — not one off
// in either direction.
test('--sub 1 (first sub-question, 1-based) writes to subAnswers[0] and confirms "sub 1/N"', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-151-a', 'first-answer', '--sub', '1', '--total', '3']);
    assert.equal(status, 0, out);
    assert.match(out, /sub 1\/3/, 'confirmation must name the sub-question actually written, 1-based');
    const state = readAnswerJson(root, 'CON-151-a');
    assert.deepEqual(state.subAnswers, ['first-answer', null, null],
      '--sub 1 must land in the first slot, not the second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub <total> (last sub-question, 1-based) writes to the last slot and completes the escalation', () => {
  const root = newRoot();
  try {
    runAnswer(root, ['CON-151-b', 'a', '--sub', '1', '--total', '3']);
    runAnswer(root, ['CON-151-b', 'b', '--sub', '2', '--total', '3']);
    const { out, status } = runAnswer(root, ['CON-151-b', 'c', '--sub', '3', '--total', '3']);
    assert.equal(status, 0, out);
    assert.match(out, /sub 3\/3/);
    const state = readAnswerJson(root, 'CON-151-b');
    assert.deepEqual(state.subAnswers, ['a', 'b', 'c']);
    assert.equal(state.complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub 0 is out of range (1-based) and is rejected before writing anything', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-151-c', 'x', '--sub', '0', '--total', '3']);
    assert.notEqual(status, 0);
    assert.match(out, /out of range/i);
    assert.match(out, /\(valid range: 1-3\)/, 'error should name the valid 1-based range, in 1-based terms (not leak the 0-based slot, e.g. "-1")');
    assert.equal(fs.existsSync(path.join(root, '.concertino', 'runs', 'CON-151-c', 'answer.json')), false,
      'an out-of-range --sub must not write anything');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub <total+1> is out of range (1-based) and is rejected before writing anything', () => {
  const root = newRoot();
  try {
    const { out, status } = runAnswer(root, ['CON-151-d', 'x', '--sub', '4', '--total', '3']);
    assert.notEqual(status, 0);
    assert.match(out, /out of range/i);
    assert.equal(fs.existsSync(path.join(root, '.concertino', 'runs', 'CON-151-d', 'answer.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-156 (cycle 2, finding 1): the CLI validates --sub/--total against --
// the ticket's REAL escalation.raised shape, never trusting the caller's
// claim alone. Reproduces the review's "most likely real trigger" first.

test('reproduced: `concertino answer T "..."` with no --sub on a REAL multi-part escalation is refused, not silently recorded', () => {
  const root = newRoot();
  const ticket = 'CON-1561';
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([
      { question: 'Fold in toast?', options: ['fold-in', 'standalone'] },
      { question: 'Follow-up severity?', options: ['High', 'Medium'] },
    ]),
  ]);
  try {
    const { out, status } = runAnswer(root, [ticket, 'both yes']);
    assert.notEqual(status, 0, 'must be refused, not exit 0');
    assert.match(out, /multi-part/i);
    assert.match(out, /--sub/);
    assert.equal(readEvents(root, ticket).filter((e) => e.kind === 'escalation.answered').length, 0,
      'no escalation.answered — the "silent hang" this exists to prevent');
    assert.equal(fs.existsSync(path.join(root, '.concertino', 'runs', ticket, 'answer.json')), false,
      'nothing should have been written at all');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub/--total on a REAL single-question escalation is refused', () => {
  const root = newRoot();
  const ticket = 'CON-1562';
  raiseEscalation(root, ticket, ['question=q', 'options=approve,deny']);
  try {
    const { out, status } = runAnswer(root, [ticket, 'approve', '--sub', '1', '--total', '1']);
    assert.notEqual(status, 0);
    assert.match(out, /single-question/i);
    assert.equal(fs.existsSync(path.join(root, '.concertino', 'runs', ticket, 'answer.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a --total mismatched against the REAL sub-question count is refused, not silently resized', () => {
  const root = newRoot();
  const ticket = 'CON-1563';
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([
      { question: 'a?', options: ['y', 'n'] },
      { question: 'b?', options: ['y', 'n'] },
      { question: 'c?', options: ['y', 'n'] },
    ]),
  ]);
  try {
    // Two genuine answers recorded first, against the real total of 3.
    const r1 = runAnswer(root, [ticket, 'y', '--sub', '1', '--total', '3']);
    assert.equal(r1.status, 0, r1.out);
    const r2 = runAnswer(root, [ticket, 'n', '--sub', '2', '--total', '3']);
    assert.equal(r2.status, 0, r2.out);

    // A caller now (mistakenly) claims --total 2 instead of the real 3.
    const bad = runAnswer(root, [ticket, 'z', '--sub', '3', '--total', '2']);
    assert.notEqual(bad.status, 0, 'a mismatched --total must be refused outright');
    assert.match(bad.out, /does not match/i);
    assert.match(bad.out, /3/, 'error should name the real count');

    // The two already-recorded answers must survive untouched — this is the
    // "recovery silently discards existing answers" failure mode the review
    // found (store.writeSubAnswer's read-modify-write resets on a length
    // mismatch).
    // CON-179: real sub-questions were derivable, so each recorded slot now
    // carries its own question text alongside the value (never a bare
    // positional value) — the whole point being that a later
    // stored-text-vs-currently-raised mismatch is detectable.
    const state = readAnswerJson(root, ticket);
    assert.deepEqual(state.subAnswers.map(store.subAnswerValue), ['y', 'n', null]);
    assert.deepEqual(state.subAnswers[0], { question: 'a?', value: 'y' });
    assert.deepEqual(state.subAnswers[1], { question: 'b?', value: 'n' });
    assert.equal(state.subAnswers[2], null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sub with no --total on a REAL multi-part escalation derives --total automatically', () => {
  const root = newRoot();
  const ticket = 'CON-1564';
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([
      { question: 'a?', options: ['y', 'n'] },
      { question: 'b?', options: ['y', 'n'] },
    ]),
  ]);
  try {
    const r1 = runAnswer(root, [ticket, 'y', '--sub', '1']);
    assert.equal(r1.status, 0, r1.out);
    assert.match(r1.out, /sub 1\/2/);
    const r2 = runAnswer(root, [ticket, 'n', '--sub', '2']);
    assert.equal(r2.status, 0, r2.out);
    assert.match(r2.out, /sub 2\/2/);

    const state = readAnswerJson(root, ticket);
    assert.deepEqual(state.subAnswers.map(store.subAnswerValue), ['y', 'n']);
    assert.deepEqual(state.subAnswers[0], { question: 'a?', value: 'y' });
    assert.deepEqual(state.subAnswers[1], { question: 'b?', value: 'n' });
    assert.equal(state.complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a --total matching the REAL sub-question count is still accepted (no behaviour change for a correct caller)', () => {
  const root = newRoot();
  const ticket = 'CON-1565';
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([{ question: 'a?', options: ['y', 'n'] }]),
  ]);
  try {
    const { out, status } = runAnswer(root, [ticket, 'y', '--sub', '1', '--total', '1']);
    assert.equal(status, 0, out);
    const events = readEvents(root, ticket);
    assert.equal(events.filter((e) => e.kind === 'escalation.answered').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with no escalation.raised event at all, --sub/--total still requires an explicit, internally-consistent pair (unchanged legacy behaviour)', () => {
  const root = newRoot();
  try {
    // No raiseEscalation() call — mirrors every pre-existing test above that
    // never raised a real escalation. shape.found is false, so this can only
    // fall back to trusting the caller's own explicit pair.
    const { out, status } = runAnswer(root, ['CON-1566', 'y', '--sub', '1']);
    assert.notEqual(status, 0, 'no --total and no ground truth to derive it from must be refused');
    assert.match(out, /--total/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-156 (cycle 3, finding 1): the CLI must read the LATEST ------------
// escalation.raised for the ticket, not the first — a ticket can raise more
// than one escalation over its lifetime (this one resolves, then a later,
// differently-shaped one is raised). A reviewer's mutation ("use the first
// match instead of the last") survived cycle 2's test suite; these two tests
// close that gap by re-raising on the SAME ticket in both directions.

test('reads the LATEST escalation.raised: multi-part then single-question — --sub/--total is refused against the CURRENT (single-question) shape', () => {
  const root = newRoot();
  const ticket = 'CON1567';
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([
      { question: 'a?', options: ['y', 'n'] },
      { question: 'b?', options: ['y', 'n'] },
    ]),
  ]);
  // A second, later, single-question escalation on the SAME ticket — e.g.
  // the first resolved and a fresh one was raised afterward.
  raiseEscalation(root, ticket, ['question=q2', 'options=approve,deny']);
  try {
    const { out, status } = runAnswer(root, [ticket, 'approve', '--sub', '1', '--total', '2']);
    assert.notEqual(status, 0,
      'using the FIRST (multi-part) raise\'s shape here would wrongly accept this — the LATEST raise is single-question');
    assert.match(out, /single-question/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads the LATEST escalation.raised: single-question then multi-part — no --sub is refused against the CURRENT (multi-part) shape', () => {
  const root = newRoot();
  const ticket = 'CON1568';
  raiseEscalation(root, ticket, ['question=q1', 'options=approve,deny']);
  // A second, later, multi-part escalation on the SAME ticket.
  raiseEscalation(root, ticket, [
    'sub_questions=' + JSON.stringify([
      { question: 'a?', options: ['y', 'n'] },
      { question: 'b?', options: ['y', 'n'] },
    ]),
  ]);
  try {
    const { out, status } = runAnswer(root, [ticket, 'approve']);
    assert.notEqual(status, 0,
      'using the FIRST (single-question) raise\'s shape here would wrongly accept this — the LATEST raise is multi-part');
    assert.match(out, /multi-part/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
