'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { wrap } = require('../lib/ui/textwrap');

// Moved out of test/ticketview.test.js (CON-18 task 1.3) — this is the same
// word-wrap ticketview.js used inline, extracted into its own module so
// drilldown.js's TICKET panel can share it. Behavior is unchanged.

test('wrap keeps lines within budget', () => {
  const lines = wrap('one two three four five six seven eight nine ten', 20);
  for (const l of lines) assert.ok(l.length <= 20);
});

test('wrap preserves blank lines between paragraphs', () => {
  const lines = wrap('first paragraph\n\nsecond paragraph', 40);
  assert.ok(lines.includes(''));
});

test('wrap enforces a floor of 10 columns even for a narrower width', () => {
  const lines = wrap('one two three', 2);
  for (const l of lines) assert.ok(l.length <= 10);
});

test('a single word longer than the width is still emitted whole, not split', () => {
  const lines = wrap('supercalifragilisticexpialidocious', 10);
  assert.deepEqual(lines, ['supercalifragilisticexpialidocious']);
});

test('empty or missing text wraps to a single blank line, not an error', () => {
  assert.deepEqual(wrap('', 20), ['']);
  assert.deepEqual(wrap(null, 20), ['']);
});
