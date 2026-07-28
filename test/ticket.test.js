'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { looksLikeTicket } = require('../lib/ui/ticket');

test('accepts ordinary ticket shapes', () => {
  for (const t of ['CON-777', 'HEL-1', '#42', 'a.b_c-9', 'ABC123']) {
    assert.ok(looksLikeTicket(t), `expected ${JSON.stringify(t)} to look like a ticket`);
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
