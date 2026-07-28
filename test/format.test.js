'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dur, truncate, padTo, bar } = require('../lib/ui/format');

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
