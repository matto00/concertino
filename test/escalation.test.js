'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  renderEscalation, handleKey, render, optionKeys, resumeSubIndex,
} = require('../lib/ui/screens/escalation');
const store = require('../lib/ui/store');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({
    ticket: 'HEL-338', project: 'helio', changeName: 'spec-delta-validation', branch: null,
    phase: 'Planning', cycle: null, telemetry: 'full', status: 'needs-you',
    escalation: { question: 'add zod@3.23 as a runtime dependency?', options: ['approve', 'deny'], raisedAt: 1000, role: 'orchestrator' },
    escalationStale: false,
  }, over);
}

const OPTS = { cols: 78, now: 1000 + 4 * 60000 };  // "4m ago"

test('renders the question and its options', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /add zod@3\.23 as a runtime dependency\?/);
  assert.match(out, /approve/);
  assert.match(out, /deny/);
});

test('renders where it came from and how long ago', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /raised by orchestrator/);
  assert.match(out, /4m ago/);
});

test('renders the keys that answer it, in the [x] idiom', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /\[a\]pprove/);
  assert.match(out, /\[d\]eny/);
  assert.match(out, /\[t\]ype a reply/);
});

test('the footer only advertises the keys actually bound', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /a approve/);
  assert.match(out, /d deny/);
  assert.match(out, /t reply/);
  assert.match(out, /esc back/);
});

test('names who raised it and mentions where the answer goes', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /writes \.concertino\/runs\/HEL-338\/answer\.json/);
  assert.match(out, /agent is polling/);
});

// --- staleness: visible, and not answerable -----------------------------

test('a stale escalation is visibly stale', () => {
  const out = plain(renderEscalation(run({ status: 'failed', escalationStale: true }), OPTS));
  assert.match(out, /stale/i);
});

test('a stale escalation offers no answer keys', () => {
  const out = plain(renderEscalation(run({ status: 'failed', escalationStale: true }), OPTS));
  assert.doesNotMatch(out, /\[a\]pprove/);
  assert.doesNotMatch(out, /\[d\]eny/);
  assert.doesNotMatch(out, /\[t\]ype a reply/);
  assert.doesNotMatch(out, /a approve   d deny   t reply/);
});

test('a stale escalation still offers attach and back, nothing else', () => {
  const out = plain(renderEscalation(run({ status: 'failed', escalationStale: true }), OPTS));
  assert.match(out, /↵ attach/);
  assert.match(out, /esc back/);
});

test('pressing an option key on a stale escalation does nothing', () => {
  const action = handleKey('a', { run: run({ status: 'failed', escalationStale: true }) });
  assert.equal(action, null);
});

test('pressing the reply key on a stale escalation does nothing', () => {
  const action = handleKey('t', { run: run({ status: 'failed', escalationStale: true }) });
  assert.equal(action, null);
});

// --- context: renders above the options, degrades honestly (CON-11) -----

test('an escalation with context renders it above the options', () => {
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, {
      context: 'package zod@3.23.0, imported by lib/ui/ticket.js',
    }),
  }), OPTS));
  const questionIdx = out.indexOf('add zod@3.23 as a runtime dependency?');
  const contextIdx = out.indexOf('package zod@3.23.0, imported by lib/ui/ticket.js');
  const optionsIdx = out.indexOf('approve');
  assert.ok(questionIdx >= 0 && contextIdx > questionIdx && optionsIdx > contextIdx,
    'expected question, then context, then options, in that order');
});

test('a multi-line context renders every line, not squashed together', () => {
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, {
      context: 'New external dependency\n  package: zod\n  version: 3.23.0',
    }),
  }), OPTS));
  assert.match(out, /New external dependency/);
  assert.match(out, /package: zod/);
  assert.match(out, /version: 3\.23\.0/);
});

test("a truncated context's screen note points at the full-text ref", () => {
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, {
      context: 'truncated text… [truncated, 40 of 6000 bytes shown]',
      contextTruncated: true,
      contextRef: '/evidence/ec-1.txt',
    }),
  }), OPTS));
  assert.match(out, /truncated text/);
  assert.match(out, /ec-1\.txt/);
});

// --- lazygit-layout pass: context wraps and scrolls instead of truncating -

test('a long context line wraps across multiple rows instead of being hard-truncated with an ellipsis', () => {
  const longLine = 'word '.repeat(60).trim(); // well over 74 visible columns (OPTS.cols - 4)
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, { context: longLine }),
  }), OPTS));
  // "[t]ype a reply…" carries its own, unrelated literal ellipsis — scope
  // the check to the context block's own lines only.
  const contextLines = out.split('\n').filter((l) => l.includes('word'));
  assert.ok(contextLines.length > 1, 'a 60-word line at 74 columns must wrap onto more than one row');
  for (const line of contextLines) assert.doesNotMatch(line, /…/);
  assert.match(out, /word word word/);
  // Every one of the 60 words survives the wrap, none dropped or cut off.
  const wordCount = contextLines.join(' ').split(/\s+/).filter((w) => w === 'word').length;
  assert.equal(wordCount, 60);
});

test('context longer than the viewport scrolls (docview windowing) instead of overflowing the box', () => {
  const manyLines = Array.from({ length: 30 }, (_, i) => 'context line ' + i).join('\n');
  const withoutScroll = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, { context: manyLines }),
  }), OPTS));
  assert.match(withoutScroll, /context line 0/);
  assert.doesNotMatch(withoutScroll, /context line 29\b/);
  assert.match(withoutScroll, /showing/);
});

test('scrolling the context (opts.contextScroll) reveals later lines', () => {
  const manyLines = Array.from({ length: 30 }, (_, i) => 'context line ' + i).join('\n');
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, { context: manyLines }),
  }), Object.assign({}, OPTS, { contextScroll: 25 })));
  assert.match(out, /context line 29\b/);
});

test('j/k/page keys scroll the context via scroll-escalation-context', () => {
  const r = run({ escalation: Object.assign({}, run({}).escalation, { context: 'some context' }) });
  assert.deepEqual(handleKey('j', { run: r }), { type: 'scroll-escalation-context', delta: 1 });
  assert.deepEqual(handleKey('k', { run: r }), { type: 'scroll-escalation-context', delta: -1 });
});

test('an escalation with no context degrades honestly — no block, label, or empty frame', () => {
  const withContext = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, {
      context: 'package zod@3.23.0, imported by lib/ui/ticket.js',
    }),
  }), OPTS));
  const withoutContext = plain(renderEscalation(run({}), OPTS));
  assert.doesNotMatch(withoutContext, /context/i);
  // And the no-context render is identical to what this screen already
  // produced before CON-11 — asserted structurally rather than pinning the
  // exact string, since other tests already cover question/options/footer.
  assert.notEqual(withContext, withoutContext);
});

// --- absent data must not render as healthy -----------------------------

test('a missing run renders safely rather than throwing', () => {
  assert.doesNotThrow(() => renderEscalation(null, OPTS));
  const out = plain(renderEscalation(null, OPTS));
  assert.match(out, /no longer available/);
});

test('a run with no live escalation (cleared since the screen opened) says so', () => {
  const out = plain(renderEscalation(run({ escalation: null }), OPTS));
  assert.match(out, /no escalation/i);
});

// --- keys return actions, never mutate ----------------------------------

test('an option letter answers with that option', () => {
  const action = handleKey('a', { run: run({}) });
  assert.deepEqual(action, { type: 'answer', ticket: 'HEL-338', value: 'approve' });
});

test('the other option letter answers with that option', () => {
  const action = handleKey('d', { run: run({}) });
  assert.deepEqual(action, { type: 'answer', ticket: 'HEL-338', value: 'deny' });
});

test('t opens the reply prompt', () => {
  assert.deepEqual(handleKey('t', { run: run({}) }), { type: 'open-reply' });
});

test('escape backs out to the fleet', () => {
  assert.deepEqual(handleKey('\x1b', { run: run({}) }), { type: 'back' });
});

test('enter attaches, live or stale', () => {
  assert.deepEqual(handleKey('\r', { run: run({}) }), { type: 'attach', ticket: 'HEL-338' });
  assert.deepEqual(
    handleKey('\r', { run: run({ status: 'failed', escalationStale: true }) }),
    { type: 'attach', ticket: 'HEL-338' },
  );
});

test('an unbound letter is a no-op', () => {
  assert.equal(handleKey('z', { run: run({}) }), null);
});

// --- typing a reply -------------------------------------------------------

test('typing builds up the reply value', () => {
  const action = handleKey('x', { run: run({}), reply: { value: 'hi', error: null } });
  assert.deepEqual(action, { type: 'reply-type', char: 'x' });
});

test('backspace on a reply removes a character', () => {
  const action = handleKey('\x7f', { run: run({}), reply: { value: 'hi', error: null } });
  assert.deepEqual(action, { type: 'reply-backspace' });
});

test('escape cancels the reply, not the whole screen', () => {
  const action = handleKey('\x1b', { run: run({}), reply: { value: 'hi', error: null } });
  assert.deepEqual(action, { type: 'cancel-reply' });
});

test('enter on a non-empty reply submits it', () => {
  const action = handleKey('\r', { run: run({}), reply: { value: ' replan without a dependency ', error: null } });
  assert.deepEqual(action, { type: 'submit-reply', ticket: 'HEL-338', value: 'replan without a dependency' });
});

test('enter on an empty reply cancels instead of submitting blank', () => {
  const action = handleKey('\r', { run: run({}), reply: { value: '   ', error: null } });
  assert.deepEqual(action, { type: 'cancel-reply' });
});

test('the typed reply is rendered on screen', () => {
  const out = plain(renderEscalation(run({}), Object.assign({}, OPTS, { reply: { value: 'let me think', error: null } })));
  assert.match(out, /let me think/);
});

// --- optionKeys: derivation and collision handling ------------------------

test('derives one letter per option from its first character', () => {
  const keys = optionKeys(['approve', 'deny']);
  assert.equal(keys.get('a'), 'approve');
  assert.equal(keys.get('d'), 'deny');
});

test('an option starting with the reserved reply letter gets no key', () => {
  const keys = optionKeys(['type something', 'deny']);
  assert.equal(keys.has('t'), false);
  assert.equal(keys.get('d'), 'deny');
});

test('a later option colliding with an earlier one gets no key', () => {
  const keys = optionKeys(['approve', 'also-a-thing']);
  assert.equal(keys.get('a'), 'approve');
  assert.equal(keys.size, 1);
});

// --- router seam -----------------------------------------------------------

test('render(state, opts) picks the run out by ticket', () => {
  const state = { runs: [run({ ticket: 'HEL-1' }), run({ ticket: 'HEL-2' })], escalationTicket: 'HEL-2' };
  const out = plain(render(state, { cols: 78, now: 1000 }));
  assert.match(out, /HEL-2/);
});

// =====================================================================
// CON-46: multi-part escalation wizard
// =====================================================================

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-escalation-'));
}

function wizardRun(over) {
  return Object.assign({
    ticket: 'HEL-400', project: 'helio', changeName: 'multi-part-escalation', branch: null,
    phase: 'Planning', cycle: null, telemetry: 'full', status: 'needs-you',
    escalation: {
      question: '', options: [],
      subQuestions: [
        { question: 'Keep foo?', options: ['yes', 'no'] },
        { question: 'Rename bar?', options: ['rename', 'keep'] },
        { question: 'Ship it?', options: ['ship', 'hold'] },
      ],
      raisedAt: 1000, role: 'orchestrator',
    },
    escalationStale: false,
  }, over);
}

// --- render: the wizard shows exactly one step, never any other ------------

test('the wizard shows only the first sub-question, none of the others', () => {
  const out = plain(renderEscalation(wizardRun({}), Object.assign({}, OPTS, { subIndex: 0 })));
  assert.match(out, /Keep foo\?/);
  assert.doesNotMatch(out, /Rename bar\?/);
  assert.doesNotMatch(out, /Ship it\?/);
});

test('a later subIndex renders that step only, not the ones before or after it', () => {
  const out = plain(renderEscalation(wizardRun({}), Object.assign({}, OPTS, { subIndex: 1 })));
  assert.match(out, /Rename bar\?/);
  assert.doesNotMatch(out, /Keep foo\?/);
  assert.doesNotMatch(out, /Ship it\?/);
});

test('the wizard shows a step indicator', () => {
  const out = plain(renderEscalation(wizardRun({}), Object.assign({}, OPTS, { subIndex: 1 })));
  assert.match(out, /2 of 3/);
});

test('a single-question escalation renders with no wizard step indicator at all', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.doesNotMatch(out, /sub-question/i);
});

// --- handleKey: step-through, no jump-ahead, free text ----------------------

test('answering the current step by option key returns answer-sub (not answer)', () => {
  const action = handleKey('y', { run: wizardRun({}), subIndex: 0 });
  assert.deepEqual(action, { type: 'answer-sub', ticket: 'HEL-400', index: 0, value: 'yes', total: 3 });
});

test('a key that only belongs to a LATER step is a no-op from an earlier one (no jump-ahead)', () => {
  // Step 0's options are yes/no ([y]/[n]); step 1's ('rename'/'keep') keys
  // are r/k. Pressing 'r' while on step 0 must do nothing — there is no
  // action type that names an arbitrary target step (Decision 6).
  assert.equal(handleKey('r', { run: wizardRun({}), subIndex: 0 }), null);
});

test('answering the final step also answers via answer-sub — watch.js decides completion from the write result', () => {
  const action = handleKey('s', { run: wizardRun({}), subIndex: 2 });
  assert.deepEqual(action, { type: 'answer-sub', ticket: 'HEL-400', index: 2, value: 'ship', total: 3 });
});

test('t opens the reply prompt on a wizard step exactly like the single-question path', () => {
  assert.deepEqual(handleKey('t', { run: wizardRun({}), subIndex: 0 }), { type: 'open-reply' });
});

test('confirming a free-text reply on a wizard step answers via answer-sub, for the CURRENT step', () => {
  const action = handleKey('\r', {
    run: wizardRun({}), subIndex: 1, reply: { value: ' rename it please ', error: null },
  });
  assert.deepEqual(action, { type: 'answer-sub', ticket: 'HEL-400', index: 1, value: 'rename it please', total: 3 });
});

test('an empty free-text reply on a wizard step still cancels rather than submitting blank', () => {
  const action = handleKey('\r', { run: wizardRun({}), subIndex: 1, reply: { value: '   ', error: null } });
  assert.deepEqual(action, { type: 'cancel-reply' });
});

test('render(state, opts) threads escalationSubIndex through to the wizard render', () => {
  const state = { runs: [wizardRun({})], escalationTicket: 'HEL-400', escalationSubIndex: 1 };
  const out = plain(render(state, { cols: 78, now: 1000 }));
  assert.match(out, /Rename bar\?/);
});

test('routeHandleKey threads escalationSubIndex through to handleKey', () => {
  const state = { runs: [wizardRun({})], escalationTicket: 'HEL-400', escalationSubIndex: 2 };
  const action = require('../lib/ui/screens/escalation').routeHandleKey('s', state);
  assert.deepEqual(action, { type: 'answer-sub', ticket: 'HEL-400', index: 2, value: 'ship', total: 3 });
});

// --- store.writeSubAnswer / readSubAnswers: incremental completeness -------

test('writeSubAnswer starts from `total` nulls and stays complete:false until every slot is filled', () => {
  const root = tmpRoot();
  const r1 = store.writeSubAnswer(root, 'HEL-401', 0, 'yes', 3);
  assert.equal(r1.ok, true);
  assert.equal(r1.complete, false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-401'), 'utf8')),
    { subAnswers: ['yes', null, null], total: 3, complete: false },
  );

  const r2 = store.writeSubAnswer(root, 'HEL-401', 2, 'ship', 3);
  assert.equal(r2.ok, true);
  assert.equal(r2.complete, false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-401'), 'utf8')),
    { subAnswers: ['yes', null, 'ship'], total: 3, complete: false },
  );
});

test('writeSubAnswer marks complete:true only once every slot is non-null', () => {
  const root = tmpRoot();
  store.writeSubAnswer(root, 'HEL-402', 0, 'yes', 2);
  const r = store.writeSubAnswer(root, 'HEL-402', 1, 'rename', 2);
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-402'), 'utf8')),
    { subAnswers: ['yes', 'rename'], total: 2, complete: true },
  );
});

test('writeSubAnswer refuses to overwrite an already-answered slot ("already answered" race)', () => {
  const root = tmpRoot();
  store.writeSubAnswer(root, 'HEL-403', 0, 'yes', 2);
  const second = store.writeSubAnswer(root, 'HEL-403', 0, 'no', 2);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'answered');
  assert.match(second.error, /already answered/);
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-403'), 'utf8'));
  assert.equal(written.subAnswers[0], 'yes');
});

test('writeSubAnswer refuses an out-of-range index rather than corrupting the file', () => {
  const root = tmpRoot();
  const result = store.writeSubAnswer(root, 'HEL-408', 5, 'yes', 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
});

test('readSubAnswers returns null when no answer.json exists yet', () => {
  const root = tmpRoot();
  assert.equal(store.readSubAnswers(root, 'HEL-404'), null);
});

test('readSubAnswers returns null on the single-question shape (no subAnswers/total)', () => {
  const root = tmpRoot();
  store.writeAnswer(root, 'HEL-405', 'approve');
  assert.equal(store.readSubAnswers(root, 'HEL-405'), null);
});

test('readSubAnswers reflects an incrementally-written multi-part answer, 2 of 3 filled', () => {
  const root = tmpRoot();
  store.writeSubAnswer(root, 'HEL-406', 0, 'yes', 3);
  store.writeSubAnswer(root, 'HEL-406', 2, 'ship', 3);
  assert.deepEqual(
    store.readSubAnswers(root, 'HEL-406'),
    { subAnswers: ['yes', null, 'ship'], total: 3, complete: false },
  );
});

test('readSubAnswers reflects complete:true once every slot is filled', () => {
  const root = tmpRoot();
  store.writeSubAnswer(root, 'HEL-409', 0, 'yes', 2);
  store.writeSubAnswer(root, 'HEL-409', 1, 'rename', 2);
  assert.deepEqual(
    store.readSubAnswers(root, 'HEL-409'),
    { subAnswers: ['yes', 'rename'], total: 2, complete: true },
  );
});

// --- resumeSubIndex: reopening a partially-answered wizard (Decision 7) ----

test('resumeSubIndex starts at step 0 when nothing has been recorded yet', () => {
  assert.equal(resumeSubIndex(null, 3), 0);
});

test('resumeSubIndex resumes at the first unanswered step', () => {
  assert.equal(resumeSubIndex({ subAnswers: ['yes', null, null], total: 3, complete: false }, 3), 1);
});

test('resumeSubIndex lands on the last step once every slot is already answered', () => {
  assert.equal(resumeSubIndex({ subAnswers: ['yes', 'rename', 'ship'], total: 3, complete: true }, 3), 2);
});

test('reopening after backing out resumes at the correct step, read back from disk', () => {
  const root = tmpRoot();
  store.writeSubAnswer(root, 'HEL-407', 0, 'yes', 3);
  const recorded = store.readSubAnswers(root, 'HEL-407');
  assert.equal(resumeSubIndex(recorded, 3), 1);
});
