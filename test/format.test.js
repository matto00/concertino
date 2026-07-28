'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dur, truncate, padTo, bar, visibleLength } = require('../lib/ui/format');

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

test('bar renders a proportional progress bar', () => {
  assert.equal(bar(0, 4), '░░░░');
  assert.equal(bar(1, 4), '▪▪▪▪');
  assert.equal(bar(0.5, 4), '▪▪░░');
  assert.equal(bar(2, 4), '▪▪▪▪');
});
