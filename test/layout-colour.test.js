'use strict';

// The layout-module sibling to test/format-colour.test.js: `isTTY` is false
// under `node --test` (stdout is a pipe), so nothing exercises the focused
// box's coloured border unless a test forces it before requiring the module.
// Exact same pattern as format-colour.test.js and drilldown.test.js's own
// "role gutter" test — force isTTY, clear the require cache, require fresh.
// Also pin TERM/COLORTERM so SUPPORTS_256 is deterministic (Task 7.2).

process.stdout.isTTY = true;
delete process.env.TERM;
delete process.env.COLORTERM;
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

test('an unfocused box\'s border carries f.dim colour even under isTTY', () => {
  const out = layout.box(['x'], { width: 20, focused: false });
  assert.match(out[0], /\x1b\[2m/); // f.dim (SGR 2)
  assert.match(out[1], /\x1b\[2m/);
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
  assert.match(out[0].split(' ')[0], /\x1b\[2m/); // left (unfocused) half has f.dim
  assert.match(out[0], /\x1b\[1m\x1b\[36m/); // right (focused) half does
});

test('box() with fillRow: (a) fills the full padded width including padding columns', () => {
  const out = layout.box(['abc'], { width: 20, fillRow: 0 });
  const filledRow = out[1];
  // CR3(a): The fill must span the FULL padded width, not just inner content
  // Check that fill opens near the start and closes near the end
  assert.match(filledRow, /\x1b\[7m/, 'fillRow row should contain fill escape');
  // Verify the fill covers the padding too: look for fill→content→padding→fill pattern
  assert.match(filledRow, /\x1b\[7m[^]*\x1b\[0m\x1b\[2m[│┃]/, 'fill must span padding and close before border');
});

test('box() with fillRow: (b) non-fillRow rows contain no fill escape at all', () => {
  const out = layout.box(['row0', 'row1', 'row2'], { width: 20, fillRow: 1 });
  // CR3(b): Unfilled rows must have NO fill escape anywhere in their segment
  const unfilled0 = out[1];
  assert.doesNotMatch(unfilled0, /\x1b\[7m/, 'non-fillRow row 0 should contain NO fill escape');
  // Row 2 unfilled
  const unfilled2 = out[3];
  assert.doesNotMatch(unfilled2, /\x1b\[7m/, 'non-fillRow row 2 should contain NO fill escape');
});

test('box() with fillRow: (c) truncated row closes fill immediately before border', () => {
  const longContent = 'x'.repeat(30);
  const out = layout.box([longContent], { width: 20, fillRow: 0 });
  const filledRow = out[1];
  // CR3(c): The fill's closing reset must occur immediately before the right border
  // (not just "somewhere" — distinguish from border's own reset)
  assert.match(filledRow, /\x1b\[0m\x1b\[2m[│┃]/, 'fill must close with reset immediately before right border');
});

test('box() with fillRow: (d) survives downstream re-truncation with correct width', () => {
  const out = layout.box(['a'.repeat(20)], { width: 30, fillRow: 0 });
  const filledRow = out[1];
  // Re-truncate (mimicking launchpad.js:375 at cols=50)
  const reTruncated = f.truncate(filledRow, 10);
  // CR3(d): The re-truncated line must be exactly 10 visible columns and end with reset
  const visLen = f.visibleLength(reTruncated);
  assert.equal(visLen, 10, `re-truncated line must be exactly 10 columns, got ${visLen}`);
  // Must end with a reset, not an open fill
  assert.ok(reTruncated.endsWith('\x1b[0m'), 're-truncated line must end with closing reset');
  assert.doesNotMatch(reTruncated, /\x1b\[7m$/, 're-truncated line must not end with fill open');
});
