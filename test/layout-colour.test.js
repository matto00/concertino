'use strict';

// The layout-module sibling to test/format-colour.test.js: `isTTY` is false
// under `node --test` (stdout is a pipe), so nothing exercises the focused
// box's coloured border unless a test forces it before requiring the module.
// Exact same pattern as format-colour.test.js and drilldown.test.js's own
// "role gutter" test — force isTTY, clear the require cache, require fresh.

process.stdout.isTTY = true;
for (const m of ['../lib/ui/format', '../lib/ui/layout']) {
  delete require.cache[require.resolve(m)];
}

const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../lib/ui/format');
const layout = require('../lib/ui/layout');

test('the fixture really is emitting colour', () => {
  assert.equal(process.stdout.isTTY, true);
  assert.equal(f.cyan('x'), '\x1b[36mx\x1b[0m');
});

test('a focused box\'s border carries the bold/cyan colour under isTTY', () => {
  const out = layout.box(['x'], { width: 20, focused: true, title: 'TICKETS' });
  assert.match(out[0], /\x1b\[1m\x1b\[36m/, 'top border should be bold+cyan');
  assert.match(out[1], /\x1b\[1m\x1b\[36m┃/, 'the left vertical should be bold+cyan');
});

test('an unfocused box\'s border carries no colour even under isTTY', () => {
  const out = layout.box(['x'], { width: 20, focused: false });
  assert.doesNotMatch(out[0], /\x1b\[/);
  assert.doesNotMatch(out[1], /\x1b\[/);
});

test('the border colour never bleeds into the content — content keeps its own colour untouched', () => {
  const yellowLine = f.yellow('needs your attention');
  const out = layout.box([yellowLine], { width: 40, focused: true });
  // The content row still contains the original yellow escape, unmodified.
  assert.match(out[1], /\x1b\[33mneeds your attention\x1b\[0m/);
});

test('a coloured, focused title is truncated the same way an overlong content line would be, and stays in budget', () => {
  const colouredTitle = f.yellow('a very long title that will not fit in this narrow focused box');
  const out = layout.box(['x'], { width: 18, focused: true, title: colouredTitle });
  assert.equal(f.visibleLength(out[0]), 18);
});

test('hsplit() composed of one focused and one unfocused box preserves each border\'s own colouring', () => {
  const focused = layout.box(['tickets row'], { width: 20, focused: true });
  const unfocused = layout.box(['epics row'], { width: 20, focused: false });
  const out = layout.hsplit([{ lines: unfocused, width: 20 }, { lines: focused, width: 20 }]);
  assert.doesNotMatch(out[0].split(' ')[0], /\x1b\[/); // left (unfocused) half has none
  assert.match(out[0], /\x1b\[1m\x1b\[36m/); // right (focused) half does
});
