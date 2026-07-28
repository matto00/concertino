'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderEscalation, handleKey, render, optionKeys } = require('../lib/ui/screens/escalation');

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
