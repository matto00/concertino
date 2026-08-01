'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const layout = require('../lib/ui/layout');
const f = require('../lib/ui/format');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// --- box(): dimensions --------------------------------------------------

test('box() with an explicit height returns exactly height lines', () => {
  for (const height of [3, 5, 8, 12]) {
    const out = layout.box(['a', 'b', 'c'], { width: 30, height });
    assert.equal(out.length, height, `height:${height} produced ${out.length} lines`);
  }
});

test('box() with no height is exactly contentLines.length + 2 lines tall', () => {
  const out = layout.box(['one', 'two', 'three', 'four'], { width: 30 });
  assert.equal(out.length, 6);
});

test('every line of box() is exactly `width` visible columns, at several widths', () => {
  for (const width of [10, 20, 40, 60, 100]) {
    const out = layout.box(['short', 'a somewhat longer line of content here'], { width, title: 'PANEL' });
    for (const line of out) {
      assert.equal(f.visibleLength(line), width, `width:${width} line: ${JSON.stringify(line)}`);
    }
  }
});

test('padding never changes the row count, only the horizontal indentation', () => {
  const contentLines = ['alpha', 'beta', 'gamma'];
  const a = layout.box(contentLines, { width: 30, height: 8, padding: 1 });
  const b = layout.box(contentLines, { width: 30, height: 8, padding: 3 });
  assert.equal(a.length, b.length);
  assert.equal(a.length, 8);
  // Both still fit the requested width exactly.
  for (const line of a.concat(b)) assert.equal(f.visibleLength(line), 30);
});

test('content rows are exactly height - 2 regardless of padding', () => {
  const out1 = layout.box(['x'], { width: 20, height: 10, padding: 1 });
  const out2 = layout.box(['x'], { width: 20, height: 10, padding: 4 });
  assert.equal(out1.length - 2, 8);
  assert.equal(out2.length - 2, 8);
});

test('short content is blank-padded, long content is ellipsis-truncated, same as f.truncate/f.padTo', () => {
  const out = layout.box(['hi', 'this line is definitely far too long to fit in the box'], { width: 20 });
  const short = out[1];
  const long = out[2];
  assert.match(plain(short), /^\│ hi\s+\│$/);
  assert.match(plain(long), /…/);
  assert.equal(f.visibleLength(long), 20);
});

// --- box(): title overflow -----------------------------------------------

test('a title that fits renders verbatim in the top border', () => {
  const out = layout.box(['x'], { width: 30, title: 'GATES' });
  assert.match(plain(out[0]), /GATES/);
});

test('an overlong title is truncated with the same ellipsis convention as content, and the border still equals the requested width', () => {
  const out = layout.box(['x'], { width: 20, title: 'a title far too long for this narrow box' });
  assert.equal(f.visibleLength(out[0]), 20);
  assert.match(plain(out[0]), /…/);
});

test('an overlong coloured title is truncated the same way — the border visible length still equals width', () => {
  const colouredTitle = f.yellow('a title far too long for this narrow box to hold');
  const out = layout.box(['x'], { width: 20, title: colouredTitle });
  assert.equal(f.visibleLength(out[0]), 20);
});

// --- box(): wide (CJK/emoji) content --------------------------------------

test('wide CJK content is truncated/padded by visible columns, not code units', () => {
  const out = layout.box(['日本語のテストです。とても長い文字列'], { width: 20 });
  for (const line of out) assert.equal(f.visibleLength(line), 20);
});

test('emoji content stays within the visible-column budget', () => {
  const out = layout.box(['ship it 🎉🎉🎉 or hold for the 🚀 release?'], { width: 24 });
  for (const line of out) assert.equal(f.visibleLength(line), 24);
});

test('a wide CJK title is truncated to the border width', () => {
  const out = layout.box(['x'], { width: 16, title: '日本語のとても長いタイトルです' });
  assert.equal(f.visibleLength(out[0]), 16);
});

// --- box(): CON-42 icon-prefixed titles ------------------------------------
// The dashboard-iconography-pass change prefixes several box titles with a
// named glyph from lib/ui/icons.js (e.g. icons.ticket + ' [1] TICKET'). Those
// titles must degrade through box()'s existing truncation contract exactly
// like any other title — no new truncation logic was added for them.

test('an icon-prefixed title narrower than its own icon+label still truncates to the border width', () => {
  const icons = require('../lib/ui/icons');
  const title = icons.ticket + ' [1] TICKET — a much longer label than this narrow box can hold';
  const out = layout.box(['x'], { width: 16, title });
  assert.equal(f.visibleLength(out[0]), 16);
  assert.match(plain(out[0]), /…/);
});

test('an icon-prefixed title that fits renders the icon and the label both, verbatim', () => {
  const icons = require('../lib/ui/icons');
  const title = icons.gates + ' [3] GATES';
  const out = layout.box(['x'], { width: 30, title });
  assert.match(plain(out[0]), /◆ \[3\] GATES/);
});

// --- box(): focused vs unfocused character sets ---------------------------

test('an unfocused box uses the plain border character set', () => {
  const out = layout.box(['x'], { width: 20, focused: false });
  assert.match(plain(out[0]), /^┌/);
  assert.match(plain(out[0]), /┐$/);
  assert.match(plain(out[out.length - 1]), /^└/);
  assert.match(plain(out[1]), /^│/);
});

test('a focused box uses the heavier border character set', () => {
  const out = layout.box(['x'], { width: 20, focused: true });
  assert.match(plain(out[0]), /^┏/);
  assert.match(plain(out[0]), /┓$/);
  assert.match(plain(out[out.length - 1]), /^┗/);
  assert.match(plain(out[1]), /^┃/);
});

test('focused vs unfocused differ in character set even with isTTY false (no colour emitted)', () => {
  assert.ok(!process.stdout.isTTY, 'this test relies on running under node --test, where isTTY is false');
  const unfocused = plain(layout.box(['x'], { width: 20, focused: false })[0]);
  const focused = plain(layout.box(['x'], { width: 20, focused: true })[0]);
  assert.notEqual(unfocused, focused);
  assert.notEqual(unfocused[0], focused[0]);
});

// --- degrade(): threshold behaviour ----------------------------------------

test('degrade() is false comfortably above both thresholds', () => {
  assert.equal(layout.degrade(40, 10), false);
});

test('degrade() trips at or below MIN_BOX_WIDTH', () => {
  assert.equal(layout.degrade(layout.MIN_BOX_WIDTH - 1, 10), true);
  assert.equal(layout.degrade(layout.MIN_BOX_WIDTH, 10), false);
});

test('degrade() trips at or below MIN_BOX_HEIGHT', () => {
  assert.equal(layout.degrade(40, layout.MIN_BOX_HEIGHT - 1), true);
  assert.equal(layout.degrade(40, layout.MIN_BOX_HEIGHT), false);
});

test('degrade() trips when both width and height are below their floors', () => {
  assert.equal(layout.degrade(2, 1), true);
});

// --- hsplit(): composing pre-rendered boxes side by side -------------------

test('hsplit() zips two equal-height panes line by line with a one-column gap', () => {
  const left = layout.box(['aaa', 'bbb'], { width: 10 });
  const right = layout.box(['x', 'y'], { width: 8 });
  const out = layout.hsplit([{ lines: left, width: 10 }, { lines: right, width: 8 }]);
  assert.equal(out.length, left.length);
  for (const line of out) {
    assert.equal(f.visibleLength(line), 10 + 1 + 8);
  }
});

test('hsplit() pads a shorter pane out to match the taller one', () => {
  const left = layout.box(['a', 'b', 'c', 'd'], { width: 10 });
  const right = layout.box(['x'], { width: 8 });
  const out = layout.hsplit([{ lines: left, width: 10 }, { lines: right, width: 8 }]);
  assert.equal(out.length, left.length);
});

test('no hsplit() output line exceeds the sum of its panes\' widths plus the gap', () => {
  const left = layout.box(['a very long line of content indeed that keeps going'], { width: 30 });
  const right = layout.box(['another long line of content on the right side'], { width: 25 });
  const out = layout.hsplit([{ lines: left, width: 30 }, { lines: right, width: 25 }]);
  for (const line of out) assert.ok(f.visibleLength(line) <= 30 + 1 + 25);
});

// --- purity ----------------------------------------------------------------

test('box() and hsplit() are pure: identical arguments produce identical output', () => {
  const opts = { width: 24, height: 6, title: 'PANEL', focused: true, padding: 2 };
  const a = layout.box(['one', 'two'], opts);
  const b = layout.box(['one', 'two'], opts);
  assert.deepEqual(a, b);

  const panes = [{ lines: a, width: 24 }, { lines: b, width: 24 }];
  assert.deepEqual(layout.hsplit(panes), layout.hsplit(panes));
});

// --- selectionWindow(): the one shared "keep a selection visible" scroll ---

test('selectionWindow shows everything when total fits within maxVisible', () => {
  const w = layout.selectionWindow(3, 0, 5, 0);
  assert.deepEqual(w, { start: 0, count: 3, offset: 0 });
});

test('selectionWindow keeps offset 0 while the selection is still within the first window', () => {
  const w = layout.selectionWindow(20, 4, 10, 0);
  assert.deepEqual(w, { start: 0, count: 10, offset: 0 });
});

test('selectionWindow scrolls forward the minimum amount to keep a selection past the window visible', () => {
  const w = layout.selectionWindow(20, 12, 10, 0);
  // selectedIndex 12 must be the last visible row: start = 12 - 10 + 1 = 3
  assert.deepEqual(w, { start: 3, count: 10, offset: 3 });
});

test('selectionWindow scrolls backward when the selection moves above the current window', () => {
  const w = layout.selectionWindow(20, 2, 10, 8);
  assert.deepEqual(w, { start: 2, count: 10, offset: 2 });
});

test('selectionWindow clamps offset so the window never runs past the end of the list', () => {
  const w = layout.selectionWindow(12, 11, 10, 0);
  // last possible start is 12 - 10 = 2
  assert.deepEqual(w, { start: 2, count: 10, offset: 2 });
});

test('selectionWindow with a stale offset still resolves to a window containing the selection', () => {
  const w = layout.selectionWindow(20, 0, 10, 15);
  assert.deepEqual(w, { start: 0, count: 10, offset: 0 });
});

test('selectionWindow with zero total returns an empty window', () => {
  const w = layout.selectionWindow(0, 0, 10, 0);
  assert.deepEqual(w, { start: 0, count: 0, offset: 0 });
});

test('selectionWindow floors maxVisible at 1 to avoid a zero-row window with a non-empty list', () => {
  const w = layout.selectionWindow(5, 2, 0, 0);
  assert.deepEqual(w, { start: 2, count: 1, offset: 2 });
});

// --- fitSegments(): pack whole segments, never truncate mid-bar -----------

test('fitSegments joins every segment when they all fit', () => {
  assert.equal(layout.fitSegments(['a 10%', 'b 20%'], 20), 'a 10% · b 20%');
});

test('fitSegments drops trailing segments and appends an ellipsis when they do not all fit', () => {
  const result = layout.fitSegments(['aaaa 10%', 'bbbb 20%', 'cccc 30%'], 12);
  assert.equal(result, 'aaaa 10% …');
});

test('fitSegments never returns a partial segment — a segment that cannot fit at all becomes a bare ellipsis', () => {
  const result = layout.fitSegments(['aaaaaaaaaaaaaaaaaaaa'], 5);
  assert.equal(result, '…');
});

test('fitSegments respects a custom separator', () => {
  assert.equal(layout.fitSegments(['a', 'b'], 10, ' | '), 'a | b');
});

test('fitSegments returns an empty string for a non-positive max width', () => {
  assert.equal(layout.fitSegments(['a'], 0), '');
});
