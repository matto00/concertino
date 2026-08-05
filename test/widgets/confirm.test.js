'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../../lib/ui/format');
const { confirmLines } = require('../../lib/ui/widgets/confirm');

test('confirmLines returns exactly two lines', () => {
  const lines = confirmLines({ warning: 'this is a warning', confirmHint: 'y confirm x   (any other key) cancel' });
  assert.equal(lines.length, 2);
});

test('confirmLines indents the warning line by two spaces, unmodified otherwise', () => {
  const [warningLine] = confirmLines({ warning: 'a plain warning', confirmHint: 'y confirm' });
  assert.equal(warningLine, '  a plain warning');
});

test('confirmLines wraps the confirm hint in f.dim with a two-space indent', () => {
  const [, hintLine] = confirmLines({ warning: 'w', confirmHint: 'y confirm clear   (any other key) cancel' });
  assert.equal(hintLine, f.dim('  y confirm clear   (any other key) cancel'));
});

test('confirmLines is pure: called twice with the same arguments returns the same two lines', () => {
  const args = { warning: 'kill CON-1?', confirmHint: 'y confirm   (any other key) cancel' };
  assert.deepEqual(confirmLines(args), confirmLines(args));
});
