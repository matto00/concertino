'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { toggleCompareSelection } = require('../lib/ui/compare-selection');

function run(over) {
  return Object.assign({ ticket: 'CON-1', status: 'done' }, over);
}

test('toggling an unmarked DONE ticket appends it', () => {
  const next = toggleCompareSelection([], 'CON-1', run({ ticket: 'CON-1' }));
  assert.deepEqual(next, ['CON-1']);
});

test('toggling a second unmarked DONE ticket appends it, preserving insertion order', () => {
  const next = toggleCompareSelection(['CON-1'], 'CON-2', run({ ticket: 'CON-2' }));
  assert.deepEqual(next, ['CON-1', 'CON-2']);
});

test('toggling an already-marked ticket removes it', () => {
  const next = toggleCompareSelection(['CON-1', 'CON-2'], 'CON-1', run({ ticket: 'CON-1' }));
  assert.deepEqual(next, ['CON-2']);
});

test('unmarking frees a slot for a third run to be marked', () => {
  let sel = ['CON-1', 'CON-2'];
  sel = toggleCompareSelection(sel, 'CON-1', run({ ticket: 'CON-1' })); // unmark
  sel = toggleCompareSelection(sel, 'CON-3', run({ ticket: 'CON-3' })); // mark
  assert.deepEqual(sel, ['CON-2', 'CON-3']);
});

// --- the 2-run cap ----------------------------------------------------------

test('marking a third, unmarked run while two are already marked is a no-op — neither existing selection is evicted', () => {
  const next = toggleCompareSelection(['CON-1', 'CON-2'], 'CON-3', run({ ticket: 'CON-3' }));
  assert.deepEqual(next, ['CON-1', 'CON-2']);
});

// --- DONE-only ---------------------------------------------------------------

test('toggling a non-DONE run is a no-op', () => {
  assert.deepEqual(toggleCompareSelection([], 'CON-1', run({ status: 'running' })), []);
  assert.deepEqual(toggleCompareSelection([], 'CON-1', run({ status: 'failed' })), []);
  assert.deepEqual(toggleCompareSelection([], 'CON-1', run({ status: 'queued' })), []);
});

test('toggling with no resolvable run at all is a no-op (never throws)', () => {
  assert.deepEqual(toggleCompareSelection([], 'CON-1', null), []);
  assert.deepEqual(toggleCompareSelection([], 'CON-1', undefined), []);
});

test('unmarking an already-marked ticket succeeds even when the run argument is absent/non-DONE', () => {
  // Unmarking must never be blocked by the DONE check — only marking is.
  assert.deepEqual(toggleCompareSelection(['CON-1'], 'CON-1', null), []);
  assert.deepEqual(toggleCompareSelection(['CON-1'], 'CON-1', run({ status: 'failed' })), []);
});

// --- purity --------------------------------------------------------------

test('never mutates the input selection array', () => {
  const original = ['CON-1'];
  const snapshot = original.slice();
  toggleCompareSelection(original, 'CON-2', run({ ticket: 'CON-2' }));
  toggleCompareSelection(original, 'CON-1', run({ ticket: 'CON-1' }));
  assert.deepEqual(original, snapshot);
});

// --- the shared-selection scenario itself (spec.md's own framing) ----------

test('a selection toggled from one call site is visible to a later call regardless of "which screen" toggled it', () => {
  // The helper itself has no notion of "screen" — this test documents that
  // toggleCompareSelection is the ONE implementation both controllers call,
  // so marking via one call site and reading the resulting array from
  // "the other" is just... the same array. (See controllers/archive.js and
  // controllers/fleet.js's own matching 'toggle-compare-select' cases.)
  let sel = [];
  sel = toggleCompareSelection(sel, 'CON-1', run({ ticket: 'CON-1' })); // "marked from fleet"
  sel = toggleCompareSelection(sel, 'CON-2', run({ ticket: 'CON-2' })); // "marked from archive"
  assert.deepEqual(sel, ['CON-1', 'CON-2']);
});
