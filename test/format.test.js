'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dur, truncate, padTo, bar, sparkline, visibleLength, stripUnsafeControls } = require('../lib/ui/format');

test('dur renders seconds, minutes, and hours', () => {
  assert.equal(dur(0), '0s');
  assert.equal(dur(23000), '23s');
  assert.equal(dur(8 * 60000), '8m');
  assert.equal(dur(64 * 60000), '1h04m');
  assert.equal(dur(null), '—');
});

test('truncate uses an ellipsis and never exceeds the width', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('panel-resize-handles', 10), 'panel-res…');
  assert.equal(truncate('panel-resize-handles', 10).length, 10);
});

test('truncate counts visible columns, not escape bytes', () => {
  const coloured = '\x1b[33m' + 'x'.repeat(70) + '\x1b[0m';
  const out = truncate(coloured, 60);
  // Exactly the budget — the old raw-length version lost 5 columns to the
  // escape bytes it was wrongly counting.
  assert.equal(visibleLength(out), 60);
});

test('truncate never leaves an unterminated colour', () => {
  const coloured = '\x1b[33m' + 'x'.repeat(70) + '\x1b[0m';
  assert.ok(truncate(coloured, 60).endsWith('\x1b[0m'));
  // ...and does not add a redundant reset when the cut lands after one.
  const already = '\x1b[33mab\x1b[0m' + 'y'.repeat(70);
  assert.equal(visibleLength(truncate(already, 10)), 10);
});

test('padTo pads and truncates to an exact width', () => {
  assert.equal(padTo('ab', 5), 'ab   ');
  assert.equal(padTo('abcdefgh', 5).length, 5);
});

test('padTo pads coloured strings to their visible width', () => {
  // Raw length counts the escape bytes as content, so a short coloured string
  // got no padding at all and every column after it shifted left.
  assert.equal(visibleLength(padTo('\x1b[33mab\x1b[0m', 9)), 9);
});

// --- neutralising control bytes that are not this project's own colour codes
// Slice 3 renders full ticket titles/descriptions/comments straight from
// Linear — free text editable by anyone with tracker write access, not just
// the orchestrator writing escalation questions. The old ANSI regex only
// recognised `\x1b[...m` (colour); every other control byte fell through
// charWidth's 1-column default and rode along verbatim into the terminal.

test('stripUnsafeControls removes an OSC (window-title) sequence entirely', () => {
  // ESC ] 0 ; <title> BEL — sets the terminal's window title.
  const payload = 'evil-title\x1b]0;pwned\x07-rest';
  const out = stripUnsafeControls(payload);
  assert.doesNotMatch(out, /\x1b/);
  assert.doesNotMatch(out, /\x07/);
  assert.equal(out, 'evil-title-rest');
});

test('stripUnsafeControls removes a non-colour CSI (cursor movement / erase)', () => {
  // ESC [ 2 J clears the screen; ESC [ H moves the cursor home.
  const payload = 'before\x1b[2J\x1b[Hafter';
  assert.equal(stripUnsafeControls(payload), 'beforeafter');
});

test('stripUnsafeControls removes a bare/lone ESC with nothing legible following', () => {
  assert.equal(stripUnsafeControls('a\x1bb'), 'ab');
});

test('stripUnsafeControls removes raw C0 controls — BEL, CR, a literal newline', () => {
  assert.equal(stripUnsafeControls('a\x07b\rc\nd'), 'abcd');
});

test('stripUnsafeControls removes C1 controls (8-bit escape equivalents)', () => {
  assert.equal(stripUnsafeControls('a\x9bb'), 'ab'); // 0x9b: 8-bit CSI
});

test('stripUnsafeControls leaves this project\'s own SGR colour codes untouched', () => {
  const coloured = '\x1b[33mhello\x1b[0m';
  assert.equal(stripUnsafeControls(coloured), coloured);
});

test('stripUnsafeControls leaves ordinary text, including wide/emoji glyphs, untouched', () => {
  assert.equal(stripUnsafeControls('add zod@3? 🎉 日本語'), 'add zod@3? 🎉 日本語');
});

test('truncate strips an OSC sequence embedded in a ticket title rather than emitting it', () => {
  const hostile = 'CON-9 ' + '\x1b]0;pwned\x07' + 'rest of title';
  const out = truncate(hostile, 200);
  assert.doesNotMatch(out, /\x1b/);
  assert.equal(out, 'CON-9 rest of title');
});

test('truncate strips a cursor-movement CSI so it cannot reach the terminal via a coloured line', () => {
  const hostile = '\x1b[33mCON-9\x1b[2J\x1b[0m';
  const out = truncate(hostile, 200);
  assert.doesNotMatch(out, /\x1b\[2J/);
  // The colour itself must still work.
  assert.match(out, /\x1b\[33m/);
  assert.ok(out.endsWith('\x1b[0m'));
});

test('visibleLength no longer overcounts (or is corrupted by) a non-colour escape', () => {
  const hostile = 'CON-9' + '\x1b[2J' + 'rest';
  // Before the fix this counted every byte of the stripped CSI as one column
  // each; after stripping, only the real 9 visible characters remain.
  assert.equal(visibleLength(hostile), 9);
});

test('padTo pads to the correct width even when the input carries a hostile escape', () => {
  const hostile = 'ab\x1b]0;title\x07';
  assert.equal(visibleLength(padTo(hostile, 5)), 5);
  assert.equal(padTo(hostile, 5), 'ab   ');
});

test('bar renders a proportional progress bar', () => {
  assert.equal(bar(0, 4), '░░░░');
  assert.equal(bar(1, 4), '▪▪▪▪');
  assert.equal(bar(0.5, 4), '▪▪░░');
  assert.equal(bar(2, 4), '▪▪▪▪');
});

test('sparkline maps each value to a block character scaled against the max', () => {
  assert.equal(sparkline([0, 7]), '▁█');
  assert.equal(sparkline([1, 2, 3, 4, 5, 6, 7]), '▂▃▄▅▆▇█');
});

test('sparkline renders an all-minimum line for an all-zero array, without dividing by zero', () => {
  assert.equal(sparkline([0, 0, 0, 0, 0, 0, 0]), '▁▁▁▁▁▁▁');
});

test('sparkline\'s output length always equals the input length', () => {
  assert.equal(sparkline([]).length, 0);
  assert.equal(sparkline([3]).length, 1);
  assert.equal(sparkline([3, 1, 4, 1, 5, 9, 2, 6]).length, 8);
});
