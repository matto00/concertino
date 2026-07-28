'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { looksLikeTicket } = require('../lib/ui/ticket');

test('accepts ordinary ticket shapes', () => {
  for (const t of ['CON-777', 'HEL-1', '#42', 'a_b_c-9', 'ABC123']) {
    assert.ok(looksLikeTicket(t), `expected ${JSON.stringify(t)} to look like a ticket`);
  }
});

// `.` used to be accepted here, but tmux treats `.` as the window/pane
// separator inside a target (`session:window.pane`), so a dotted ticket
// breaks session.js's addressing and orphans a window (see session.test.js).
// No real ticket provider uses dots in ticket ids.
test('rejects dotted values, which break tmux target addressing', () => {
  for (const t of ['a.b_c-9', 'CON-1.2', '.CON-1', 'CON-1.']) {
    assert.ok(!looksLikeTicket(t), `expected ${JSON.stringify(t)} to be rejected`);
  }
});

test('rejects values carrying shell metacharacters', () => {
  for (const t of [
    '$(touch /tmp/x)',
    '`touch /tmp/x`',
    'CON-1"; touch /tmp/x; echo "',
    'CON-1 && touch /tmp/x',
    'CON-1; touch /tmp/x',
    'CON-1 | touch /tmp/x',
    'CON-1\\ttouch',
    '$FOO',
    'CON 1',
  ]) {
    assert.ok(!looksLikeTicket(t), `expected ${JSON.stringify(t)} to be rejected`);
  }
});

test('rejects empty, whitespace-only and non-string values', () => {
  assert.ok(!looksLikeTicket(''));
  assert.ok(!looksLikeTicket('   '));
  assert.ok(!looksLikeTicket(undefined));
  assert.ok(!looksLikeTicket(null));
});

test('requires the pattern to match the whole value, not a substring', () => {
  assert.ok(!looksLikeTicket('CON-777 extra'));
  assert.ok(!looksLikeTicket('prefix CON-777'));
});
