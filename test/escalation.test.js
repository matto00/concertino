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
const escalationController = require('../lib/ui/controllers/escalation');
const { mkTmpDir } = require('./support/tmp');

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

// --- lazygit-layout pass: grow-to-fill (design.md Decision 2) -------------

test('with vertical space to spare, the content box grows to push the footer to the last row', () => {
  const out = plain(renderEscalation(run({}), Object.assign({}, OPTS, { rows: 30 })));
  const lines = out.split('\n');
  // rows: 30 reserves the trailing-newline row (the same `rows - 1`
  // convention fleet.js's grow-to-fill computation already uses), so the
  // footer must be the LAST line this frame emits, and the frame should
  // reach (not merely approach) that budget.
  assert.match(lines[lines.length - 1], /a approve   d deny   t reply   ↵ attach   esc back/);
  assert.equal(lines.length, 29, `expected the frame to grow to fill the 30-row budget, got ${lines.length} lines`);
});

test('with no rows budget given (0/absent), rendering is unaffected by this change', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  const lines = out.split('\n');
  assert.ok(lines.length < 20, 'unbounded render must stay tight to content, not pad out to some default height');
});

test('a tight budget below the content\'s natural height still shrinks the box exactly as before', () => {
  const outTight = plain(renderEscalation(run({}), Object.assign({}, OPTS, { rows: 8 })));
  const outUnbounded = plain(renderEscalation(run({}), OPTS));
  // A budget below the natural height must not grow anything — the frame is
  // identical to the unbounded render (no regression to the existing
  // narrow-terminal degrade behaviour).
  assert.equal(outTight, outUnbounded);
});

test('a stale escalation (fewer trailing rows) still grows to fill the budget, footer last', () => {
  const out = plain(renderEscalation(run({ status: 'failed', escalationStale: true }), Object.assign({}, OPTS, { rows: 30 })));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /↵ attach   esc back/);
  assert.equal(lines.length, 29);
});

test('an open reply (extra trailing rows) still grows to fill the budget, footer last', () => {
  const out = plain(renderEscalation(run({}), Object.assign({}, OPTS, { rows: 30, reply: { value: 'hello' } })));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /↵ send   esc cancel/);
  assert.equal(lines.length, 29);
});

test('a reply with a validation error (one more trailing row) still grows to fill the budget', () => {
  const out = plain(renderEscalation(run({}), Object.assign({}, OPTS, { rows: 30, reply: { value: 'hello', error: 'bad value' } })));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /↵ send   esc cancel/);
  assert.equal(lines.length, 29);
});

test('a notice (extra trailing rows) still grows to fill the budget', () => {
  const out = plain(renderEscalation(run({}), Object.assign({}, OPTS, { rows: 30, notice: 'something went wrong' })));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /a approve   d deny   t reply   ↵ attach   esc back/);
  assert.equal(lines.length, 29);
});

// --- CON-156 (cycle 2, finding 2): esc.malformedReason is surfaced on this ---
// screen — a human/agent looking at a stuck escalation must see the same
// diagnostic emit-event.sh wrote to escalation.malformed, not just infer
// something is wrong from the wait never ending.

test('a malformed answer.json reason is shown as a warning', () => {
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, {
      malformedReason: 'subAnswers is missing or not an array (expected an array of 2 answers, one per sub-question)',
    }),
  }), OPTS));
  assert.match(out, /answer\.json is malformed/);
  assert.match(out, /subAnswers is missing or not an array/);
});

test('no malformedReason renders no such warning', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.doesNotMatch(out, /answer\.json is malformed/);
});

test('a malformedReason (extra trailing rows) still grows to fill the budget', () => {
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, { malformedReason: 'bad shape' }),
  }), Object.assign({}, OPTS, { rows: 30 })));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /a approve   d deny   t reply   ↵ attach   esc back/);
  assert.equal(lines.length, 29);
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

// --- CON-53: the question wraps instead of being hard-truncated ----------

test('a long question wraps across multiple lines instead of being hard-truncated with an ellipsis', () => {
  const longQuestion = 'word '.repeat(60).trim(); // well over 74 visible columns (OPTS.cols - 4)
  const out = plain(renderEscalation(run({
    escalation: Object.assign({}, run({}).escalation, { question: longQuestion }),
  }), OPTS));
  const questionLines = out.split('\n').filter((l) => l.includes('word'));
  assert.ok(questionLines.length > 1, 'a 60-word question at 74 columns must wrap onto more than one row');
  for (const line of questionLines) assert.doesNotMatch(line, /…/);
  // Every one of the 60 words survives the wrap, none dropped or cut off.
  const wordCount = questionLines.join(' ').split(/\s+/).filter((w) => w === 'word').length;
  assert.equal(wordCount, 60);
});

test('a short question (fits on one line) renders identically to before this change', () => {
  const out = plain(renderEscalation(run({}), OPTS));
  assert.match(out, /add zod@3\.23 as a runtime dependency\?/);
  const questionLines = out.split('\n').filter((l) => l.includes('add zod@3.23 as a runtime dependency?'));
  assert.equal(questionLines.length, 1, 'a short question must render on exactly one line, unchanged');
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
  return mkTmpDir('concertino-escalation-');
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

// --- CON-179 (cycle-2 finding 4): a provenance-mismatched file must be
// recoverable, not permanently wedged -------------------------------------

test('writeSubAnswer discards a provenance-mismatched file and starts fresh, instead of refusing forever', () => {
  const root = tmpRoot();
  const REAL_QUESTIONS = [{ question: 'Keep foo?' }, { question: 'Rename bar?' }];
  // A file "complete" against a DIFFERENT question at index 1 (as if this
  // ticket's answer.json survived from a differently-ordered or different
  // raise of the same escalation -- the CON-151 shape CON-179 detects on
  // the read side). Every slot is non-null, so without recovery this would
  // refuse every future write as "already answered" forever.
  fs.mkdirSync(path.dirname(store.answerPath(root, 'HEL-410')), { recursive: true });
  fs.writeFileSync(store.answerPath(root, 'HEL-410'), JSON.stringify({
    subAnswers: [{ question: 'Keep foo?', value: 'yes' }, { question: 'Ship it?', value: 'now' }],
    total: 2,
    complete: true,
  }));

  // Without subQuestions, no ground truth to check against -- refuses, same
  // as before this fix (never silently discards without being told what the
  // real questions are).
  const noGroundTruth = store.writeSubAnswer(root, 'HEL-410', 0, 'no', 2, 'Keep foo?');
  assert.equal(noGroundTruth.ok, false);
  assert.equal(noGroundTruth.reason, 'answered');

  // With the real subQuestions supplied, the mismatch at index 1 is detected
  // and the whole file is discarded -- this write succeeds and starts a
  // fresh file, rather than refusing.
  const recovered = store.writeSubAnswer(root, 'HEL-410', 0, 'no', 2, 'Keep foo?', REAL_QUESTIONS);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.complete, false);
  // CON-179 (cycle-3 review, finding 3): the discard must not be silent --
  // both real answers ('yes' and 'now') were destroyed, and the caller must
  // be able to tell.
  assert.equal(recovered.discarded, true);
  assert.equal(recovered.discardedCount, 2);
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-410'), 'utf8'));
  assert.deepEqual(written.subAnswers, [{ question: 'Keep foo?', value: 'no' }, null]);
});

test('writeSubAnswer reports how many entries a discard destroyed, including a legacy entry taken as collateral', () => {
  const root = tmpRoot();
  const REAL_QUESTIONS = [{ question: 'a?' }, { question: 'b?' }, { question: 'c?' }, { question: 'd?' }];
  // 4-part file: one legacy (bare-value, no question -- never itself
  // classified as mismatched) entry, two well-formed matching entries, and
  // one mismatched entry. A mismatch anywhere discards the WHOLE file --
  // the legacy and matching entries are destroyed as collateral too.
  fs.mkdirSync(path.dirname(store.answerPath(root, 'HEL-413')), { recursive: true });
  fs.writeFileSync(store.answerPath(root, 'HEL-413'), JSON.stringify({
    subAnswers: [
      'legacy-value',
      { question: 'b?', value: 'yes' },
      { question: 'c?', value: 'no' },
      { question: 'WRONG QUESTION', value: 'now' },
    ],
    total: 4,
    complete: true,
  }));
  const result = store.writeSubAnswer(root, 'HEL-413', 0, 'redo', 4, 'a?', REAL_QUESTIONS);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.discarded, true);
  assert.equal(result.discardedCount, 4, 'all four prior entries -- legacy, both matching, and the mismatched one -- were dropped');
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-413'), 'utf8'));
  assert.deepEqual(written.subAnswers, [{ question: 'a?', value: 'redo' }, null, null, null]);
});

test('writeSubAnswer does NOT discard a file with no provenance mismatch, even when subQuestions is supplied', () => {
  const root = tmpRoot();
  const REAL_QUESTIONS = [{ question: 'Keep foo?' }, { question: 'Rename bar?' }];
  const first = store.writeSubAnswer(root, 'HEL-411', 0, 'yes', 2, 'Keep foo?', REAL_QUESTIONS);
  assert.equal(first.discarded, undefined, 'an ordinary write never reports a discard');
  const second = store.writeSubAnswer(root, 'HEL-411', 0, 'no', 2, 'Keep foo?', REAL_QUESTIONS);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'answered');
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-411'), 'utf8'));
  assert.deepEqual(written.subAnswers[0], { question: 'Keep foo?', value: 'yes' });
});

test('writeSubAnswer never treats a legacy (no-question) entry as a provenance mismatch', () => {
  const root = tmpRoot();
  const REAL_QUESTIONS = [{ question: 'Keep foo?' }, { question: 'Rename bar?' }];
  // Legacy shape: bare values, no question text recorded at all (files
  // already on disk before CON-179 shipped).
  store.writeSubAnswer(root, 'HEL-412', 0, 'yes', 2);
  const second = store.writeSubAnswer(root, 'HEL-412', 1, 'rename', 2, 'Rename bar?', REAL_QUESTIONS);
  assert.equal(second.ok, true);
  assert.equal(second.complete, true);
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-412'), 'utf8'));
  // The legacy slot survived untouched -- it was never discarded.
  assert.equal(written.subAnswers[0], 'yes');
});

test('controllers/escalation.js answerEscalationSub surfaces a discard as a notice, not silently', () => {
  const root = tmpRoot();
  const REAL_QUESTIONS = [{ question: 'Keep foo?' }, { question: 'Rename bar?' }];
  fs.mkdirSync(path.dirname(store.answerPath(root, 'HEL-414')), { recursive: true });
  fs.writeFileSync(store.answerPath(root, 'HEL-414'), JSON.stringify({
    subAnswers: [{ question: 'Keep foo?', value: 'yes' }, { question: 'WRONG', value: 'now' }],
    total: 2,
    complete: true,
  }));
  const S = {
    runs: [{ ticket: 'HEL-414', escalation: { subQuestions: REAL_QUESTIONS } }],
    escalationNotice: null,
  };
  let wentToFleet = false;
  const ctx = { S, root, deps: { store }, backToFleet: () => { wentToFleet = true; } };
  const handled = escalationController.handle(
    { type: 'answer-sub', ticket: 'HEL-414', index: 0, value: 'no', total: 2 }, ctx,
  );
  assert.equal(handled, true);
  assert.match(S.escalationNotice || '', /did not match|discarded/i);
  assert.match(S.escalationNotice || '', /2 prior answers/);
  assert.equal(wentToFleet, false, 'not complete yet -- only index 0 was (re)answered');
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-414'), 'utf8'));
  assert.deepEqual(written.subAnswers, [{ question: 'Keep foo?', value: 'no' }, null]);
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

// =====================================================================
// CON-107: the read-only historical (resolved/timed-out) detail view
// =====================================================================

function historyEntry(over) {
  return Object.assign({
    ticket: 'HEL-500', role: 'evaluator', question: 'drop the legacy column?',
    options: ['approve', 'deny'], subQuestions: undefined,
    raisedAt: 1000, resolved: true, decision: 'approve', resolvedAt: 5000, timedOut: false,
  }, over);
}

test('a resolved historical entry renders the full question, options, and decision', () => {
  const out = plain(renderEscalation(null, { cols: 78, now: 5000 + 4 * 60000, historical: historyEntry({}) }));
  assert.match(out, /drop the legacy column\?/);
  assert.match(out, /approve/);
  assert.match(out, /deny/);
  assert.match(out, /decision: approve/);
});

test('a resolved historical entry offers no option-key bindings', () => {
  const out = plain(renderEscalation(null, { cols: 78, now: 5000, historical: historyEntry({}) }));
  assert.doesNotMatch(out, /\[a\]pprove/);
  assert.doesNotMatch(out, /\[d\]eny/);
  assert.doesNotMatch(out, /\[t\]ype a reply/);
});

test('a resolved historical entry\'s footer is "esc back" only', () => {
  const out = plain(renderEscalation(null, { cols: 78, now: 5000, historical: historyEntry({}) }));
  const lines = out.trim().split('\n');
  assert.equal(lines[lines.length - 1].trim(), 'esc back');
});

test('a timed-out historical entry shows "no answer recorded" in place of a decision', () => {
  const out = plain(renderEscalation(null, {
    cols: 78, now: 5000, historical: historyEntry({ decision: null, timedOut: true }),
  }));
  assert.match(out, /no answer recorded/);
  assert.doesNotMatch(out, /decision:/);
});

test('a historical entry\'s meta shows who raised it and a resolvedAt-relative time', () => {
  const out = plain(renderEscalation(null, { cols: 78, now: 5000 + 4 * 60000, historical: historyEntry({}) }));
  assert.match(out, /raised by evaluator/);
  assert.match(out, /answered 4m ago/);
});

test('a timed-out historical entry\'s meta says "timed out", not "answered"', () => {
  const out = plain(renderEscalation(null, {
    cols: 78, now: 5000 + 4 * 60000, historical: historyEntry({ decision: null, timedOut: true }),
  }));
  assert.match(out, /timed out 4m ago/);
});

test('a multi-part historical entry shows the LAST sub-question, never the first', () => {
  const entry = historyEntry({
    subQuestions: [
      { question: 'Keep foo?', options: ['yes', 'no'] },
      { question: 'Rename bar?', options: ['rename', 'keep'] },
    ],
    decision: 'Keep foo?: yes; Rename bar?: rename',
  });
  const out = plain(renderEscalation(null, { cols: 78, now: 5000, historical: entry }));
  assert.match(out, /Rename bar\?/);
  // "Keep foo?" (subQuestions[0]) must never render as the QUESTION shown —
  // scoped to the lines above the decision line, which legitimately repeats
  // every sub-question's text as part of the flattened decision string
  // (Decision 1) — the requirement is "never re-entered step by step", not
  // "never mentioned anywhere on screen".
  const questionBlock = out.split('\n').slice(0, out.split('\n').findIndex((l) => l.includes('decision:')));
  assert.ok(!questionBlock.some((l) => l.includes('Keep foo?')), 'subQuestions[0] must never render as the shown question');
  assert.match(out, /2 sub-questions, see decision below/);
  assert.match(out, /decision: Keep foo\?: yes; Rename bar\?: rename/);
});

test('a single-question historical entry (or a 1-step multi-part) shows no sub-question count note', () => {
  const out = plain(renderEscalation(null, { cols: 78, now: 5000, historical: historyEntry({}) }));
  assert.doesNotMatch(out, /sub-questions/i);
});

test('opts.historical takes precedence over a live run, even when one is passed', () => {
  const out = plain(renderEscalation(run({}), { cols: 78, now: 5000, historical: historyEntry({}) }));
  assert.match(out, /drop the legacy column\?/);
  assert.doesNotMatch(out, /add zod@3\.23 as a runtime dependency\?/);
});

test('render(state, opts) threads escalationHistoryItem through as opts.historical', () => {
  const state = { runs: [], escalationTicket: null, escalationHistoryItem: historyEntry({}) };
  const out = plain(render(state, { cols: 78, now: 5000 }));
  assert.match(out, /drop the legacy column\?/);
  assert.match(out, /decision: approve/);
});

test('routeHandleKey on a historical view: only Escape is handled, mirroring a null run', () => {
  const state = { runs: [], escalationTicket: null, escalationHistoryItem: historyEntry({}) };
  assert.deepEqual(require('../lib/ui/screens/escalation').routeHandleKey('\x1b', state), { type: 'back' });
  assert.equal(require('../lib/ui/screens/escalation').routeHandleKey('a', state), null);
});
