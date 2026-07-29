'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBanner, handleKey, suppressedOnOwnScreen, RESERVED_KEY } = require('../lib/ui/banner');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function liveRun(over) {
  return Object.assign({
    ticket: 'HEL-338',
    escalation: { question: "can't fast-forward local main (dirty tree)", raisedAt: 1000, role: 'script' },
    escalationStale: false,
  }, over);
}

const OPTS = { cols: 78, now: 1000 + 4 * 60000 };  // "4m ago"

// --- rendering ---------------------------------------------------------

test('nothing is live: no banner', () => {
  assert.equal(renderBanner([], OPTS), null);
  assert.equal(renderBanner(null, OPTS), null);
});

test('a live escalation renders a banner naming its ticket and question', () => {
  const out = plain(renderBanner([liveRun({})], OPTS));
  assert.match(out, /HEL-338/);
  assert.match(out, /can't fast-forward local main/);
});

test('names who raised it and how long ago', () => {
  const out = plain(renderBanner([liveRun({})], OPTS));
  assert.match(out, /script/);
  assert.match(out, /4m ago/);
});

test('advertises the reserved reply key', () => {
  const out = plain(renderBanner([liveRun({})], OPTS));
  assert.match(out, new RegExp('\\[' + RESERVED_KEY + '\\] reply'));
});

test('multiple live escalations: names the oldest, counts the rest', () => {
  const oldest = liveRun({ ticket: 'HEL-1', escalation: { question: 'q1', raisedAt: 500, role: 'orchestrator' } });
  const middle = liveRun({ ticket: 'HEL-2', escalation: { question: 'q2', raisedAt: 800, role: 'orchestrator' } });
  const newest = liveRun({ ticket: 'HEL-3', escalation: { question: 'q3', raisedAt: 900, role: 'orchestrator' } });
  // Deliberately passed out of order — renderBanner trusts its caller's sort
  // (watch.js's computeLiveEscalations already sorts oldest-first), so this
  // also exercises "index 0 is what gets named" rather than re-sorting here.
  const out = plain(renderBanner([oldest, middle, newest], OPTS));
  assert.match(out, /HEL-1/);
  assert.doesNotMatch(out, /HEL-2/);
  assert.doesNotMatch(out, /HEL-3/);
  assert.match(out, /\+2 more/);
});

test('a single live escalation states no "+N more"', () => {
  const out = plain(renderBanner([liveRun({})], OPTS));
  assert.doesNotMatch(out, /more/);
});

test('disappears once resolved: an empty live set renders nothing', () => {
  // Mirrors what watch.js's draw() actually does: reducer.js clears
  // run.escalation on answer/timeout, computeLiveEscalations() drops the run
  // from the set it passes in here, and this returns null on the very next
  // poll — no extra "clearing" logic anywhere in this module.
  assert.equal(renderBanner([], OPTS), null);
});

// --- reply box in progress ------------------------------------------------

test('an open reply box renders the typed value', () => {
  const out = plain(renderBanner([liveRun({})], Object.assign({}, OPTS, { reply: { value: 'stashed it, retry', error: null } })));
  assert.match(out, /stashed it, retry/);
  assert.match(out, /↵ send/);
  assert.match(out, /esc cancel/);
});

test('a reply-write error is shown on the banner', () => {
  const out = plain(renderBanner([liveRun({})], Object.assign({}, OPTS, { reply: { value: 'x', error: 'already answered' } })));
  assert.match(out, /already answered/);
});

// --- suppression on the escalation's own dedicated screen -----------------

test('shown on the fleet screen', () => {
  assert.equal(suppressedOnOwnScreen('fleet', null, [liveRun({})]), false);
});

test('shown on a different run\'s escalation screen', () => {
  assert.equal(suppressedOnOwnScreen('escalation', 'HEL-999', [liveRun({})]), false);
});

test('shown on the drilldown, launch pad, ticket view, and launch plan screens', () => {
  for (const mode of ['drilldown', 'launchpad', 'ticketview', 'launchplan']) {
    assert.equal(suppressedOnOwnScreen(mode, 'HEL-338', [liveRun({})]), false, mode);
  }
});

test('suppressed on its own escalation\'s dedicated screen', () => {
  assert.equal(suppressedOnOwnScreen('escalation', 'HEL-338', [liveRun({})]), true);
});

test('never suppressed when nothing is live (moot, but must not throw)', () => {
  assert.equal(suppressedOnOwnScreen('escalation', 'HEL-338', []), false);
});

// --- keys return actions, never mutate ------------------------------------

test('no reply box open: every key is a no-op (routing "g" happens in watch.js)', () => {
  assert.equal(handleKey('g', { reply: null }), null);
  assert.equal(handleKey('x', { reply: null }), null);
});

test('typing builds up the reply value', () => {
  const action = handleKey('x', { reply: { value: 'hi', error: null }, ticket: 'HEL-338' });
  assert.deepEqual(action, { type: 'banner-reply-type', char: 'x' });
});

test('backspace removes a character', () => {
  const action = handleKey('\x7f', { reply: { value: 'hi', error: null }, ticket: 'HEL-338' });
  assert.deepEqual(action, { type: 'banner-reply-backspace' });
});

test('escape cancels without writing anything', () => {
  const action = handleKey('\x1b', { reply: { value: 'hi', error: null }, ticket: 'HEL-338' });
  assert.deepEqual(action, { type: 'banner-cancel-reply' });
});

test('enter on a non-empty reply submits it for the targeted ticket', () => {
  const action = handleKey('\r', { reply: { value: '  retry  ', error: null }, ticket: 'HEL-338' });
  assert.deepEqual(action, { type: 'banner-submit-reply', ticket: 'HEL-338', value: 'retry' });
});

test('enter on an empty reply cancels instead of submitting blank', () => {
  const action = handleKey('\r', { reply: { value: '   ', error: null }, ticket: 'HEL-338' });
  assert.deepEqual(action, { type: 'banner-cancel-reply' });
});
