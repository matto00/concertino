'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../../lib/ui/format');
const icons = require('../../lib/ui/icons');
const { emptyState } = require('../../lib/ui/widgets/empty');

test('an empty-state message renders dim-styled', () => {
  const [line] = emptyState({ message: 'no active runs' });
  assert.equal(line, f.dim('no active runs'));
});

test('an empty-state message preserves its own leading indent verbatim', () => {
  const [line] = emptyState({ message: '  no active runs' });
  assert.equal(line, f.dim('  no active runs'));
});

test('an empty-state message can carry an icon prefix', () => {
  const [line] = emptyState({ icon: icons.ticket, message: 'no tickets' });
  assert.equal(line, f.dim(icons.ticket + ' no tickets'));
});

test('with no icon, the message text is unmodified other than the dim wrap', () => {
  const [line] = emptyState({ message: 'nothing left to quick-start' });
  assert.equal(line, f.dim('nothing left to quick-start'));
});
