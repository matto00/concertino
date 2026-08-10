'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const compareCtl = require('../lib/ui/controllers/compare');

function ctx(over) {
  const S = {
    mode: 'compare',
    runs: [],
    compareSelection: ['CON-1', 'CON-2'],
    compareReturnMode: 'archive',
    compareLeftScroll: 3,
    compareRightScroll: 5,
    compareFocus: 'right',
  };
  return Object.assign({ S }, over);
}

const apply = (c, action) => compareCtl.handle(action, c);

// --- back-to-origin-from-compare --------------------------------------------

test('back-to-origin-from-compare routes to archive when compareReturnMode is archive', () => {
  const c = ctx();
  c.S.compareReturnMode = 'archive';
  assert.equal(apply(c, { type: 'back-to-origin-from-compare' }), true);
  assert.equal(c.S.mode, 'archive');
});

test('back-to-origin-from-compare routes to fleet when compareReturnMode is fleet', () => {
  const c = ctx();
  c.S.compareReturnMode = 'fleet';
  apply(c, { type: 'back-to-origin-from-compare' });
  assert.equal(c.S.mode, 'fleet');
});

test('back-to-origin-from-compare defaults to fleet when compareReturnMode is null (defensive fallback)', () => {
  const c = ctx();
  c.S.compareReturnMode = null;
  apply(c, { type: 'back-to-origin-from-compare' });
  assert.equal(c.S.mode, 'fleet');
});

test('back-to-origin-from-compare resets compareReturnMode and each column\'s scroll offset', () => {
  const c = ctx();
  apply(c, { type: 'back-to-origin-from-compare' });
  assert.equal(c.S.compareReturnMode, null);
  assert.equal(c.S.compareLeftScroll, 0);
  assert.equal(c.S.compareRightScroll, 0);
  assert.equal(c.S.compareFocus, 'left');
});

test('back-to-origin-from-compare leaves compareSelection intact', () => {
  const c = ctx();
  apply(c, { type: 'back-to-origin-from-compare' });
  assert.deepEqual(c.S.compareSelection, ['CON-1', 'CON-2']);
});

// --- column focus ------------------------------------------------------------

test('switch-compare-focus sets which column scroll actions target', () => {
  const c = ctx();
  c.S.compareFocus = 'left';
  apply(c, { type: 'switch-compare-focus', focus: 'right' });
  assert.equal(c.S.compareFocus, 'right');
  apply(c, { type: 'switch-compare-focus', focus: 'left' });
  assert.equal(c.S.compareFocus, 'left');
});

// --- column scroll -------------------------------------------------------

test('compare-scroll moves the named column\'s own offset, never the other', () => {
  const c = ctx();
  c.S.compareLeftScroll = 2;
  c.S.compareRightScroll = 2;
  apply(c, { type: 'compare-scroll', column: 'left', delta: 3 });
  assert.equal(c.S.compareLeftScroll, 5);
  assert.equal(c.S.compareRightScroll, 2, 'scrolling left must never move right');
});

test('compare-scroll never goes negative', () => {
  const c = ctx();
  c.S.compareLeftScroll = 1;
  apply(c, { type: 'compare-scroll', column: 'left', delta: -10 });
  assert.equal(c.S.compareLeftScroll, 0);
});

test('compare-scroll on the right column moves compareRightScroll only', () => {
  const c = ctx();
  c.S.compareLeftScroll = 0;
  c.S.compareRightScroll = 1;
  apply(c, { type: 'compare-scroll', column: 'right', delta: 4 });
  assert.equal(c.S.compareRightScroll, 5);
  assert.equal(c.S.compareLeftScroll, 0);
});

// --- unrecognised actions ----------------------------------------------------

test('an action this controller does not own returns false', () => {
  const c = ctx();
  assert.equal(apply(c, { type: 'not-a-real-action' }), false);
});
