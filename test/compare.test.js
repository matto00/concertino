'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  compareTimelineLines, compareGatesLines, renderCompare,
  handleKey, render, routeHandleKey,
} = require('../lib/ui/screens/compare');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({
    ticket: 'CON-1', changeName: 'a change',
    events: [
      { t: 1000, kind: 'run.start', role: 'script', harness: 'claude-code', model: 'opus' },
      { t: 2000, kind: 'phase.enter', role: 'orchestrator', phase: 'Execution' },
    ],
    gates: [
      { name: 'test', status: 'pass', durationMs: 4000, firstError: null },
      { name: 'build', status: 'fail', durationMs: 8000, firstError: 'TS2345 Panel.tsx:88' },
    ],
    status: 'done', elapsedMs: 120000,
  }, over);
}

function state(over) {
  return Object.assign({
    runs: [run({ ticket: 'CON-1', elapsedMs: 60000 }), run({ ticket: 'CON-2', elapsedMs: 180000 })],
    compareSelection: ['CON-1', 'CON-2'],
    compareLeftScroll: 0, compareRightScroll: 0, compareFocus: 'left',
  }, over);
}

// --- compareTimelineLines -------------------------------------------------

test('compareTimelineLines renders one line per event, with a compact role abbreviation', () => {
  const lines = compareTimelineLines(run({}), 60).map(plain);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /run started/);
  assert.match(lines[1], /phase → Execution/);
});

test('compareTimelineLines degrades to a fallback message when there are no events', () => {
  const lines = compareTimelineLines(run({ events: [] }), 60).map(plain);
  assert.match(lines[0], /no events recorded/);
});

test('compareTimelineLines truncates each line to the given width', () => {
  const lines = compareTimelineLines(run({}), 20);
  for (const l of lines) assert.ok(l.length <= 40, 'plausible upper bound given ANSI codes');
});

// --- compareGatesLines -----------------------------------------------------

test('compareGatesLines renders one line per gate, with icon/name/duration', () => {
  const lines = compareGatesLines(run({}), 40).map(plain);
  assert.match(lines[0], /test/);
  assert.match(lines[0], /4s/);
});

test('compareGatesLines degrades to a fallback message when there are no gates', () => {
  const lines = compareGatesLines(run({ gates: [] }), 40).map(plain);
  assert.match(lines[0], /no gate results recorded/);
});

// --- a gate's first error is shown when present (spec.md scenario) --------

test('a failing gate\'s first error renders indented beneath its gate line', () => {
  const lines = compareGatesLines(run({}), 40).map(plain);
  const errorLine = lines.find((l) => l.includes('TS2345'));
  assert.ok(errorLine, 'the first error text must be present somewhere in the gates lines');
  assert.match(errorLine, /└/);
});

test('a passing gate with no firstError renders no error line', () => {
  const lines = compareGatesLines(run({
    gates: [{ name: 'test', status: 'pass', durationMs: 1000, firstError: null }],
  }), 40).map(plain);
  assert.equal(lines.length, 1);
});

// --- renderCompare: both runs visible at once ------------------------------

test('both marked runs\' ticket ids appear in the render (each in its own column)', () => {
  const out = plain(renderCompare(state({}), { cols: 100 }));
  assert.match(out, /CON-1/);
  assert.match(out, /CON-2/);
});

test('both runs\' TIMELINE and GATES content render simultaneously, no panel switch needed', () => {
  const out = plain(renderCompare(state({}), { cols: 100 }));
  assert.match(out, /TIMELINE/);
  assert.match(out, /GATES/);
  assert.match(out, /run started/);
  assert.match(out, /test/); // gate name
});

// --- total duration + delta (spec.md scenario) ------------------------------

test('each run\'s total duration is shown, along with the difference between them', () => {
  const out = plain(renderCompare(state({}), { cols: 100 }));
  // CON-1: 60000ms -> 1m, CON-2: 180000ms -> 3m, delta 120000ms -> 2m.
  assert.match(out, /1m/);
  assert.match(out, /3m/);
  assert.match(out, /Δ 2m/);
});

test('with one run\'s duration unknown, no delta is shown (never a NaN/undefined leak)', () => {
  const s = state({
    runs: [run({ ticket: 'CON-1', elapsedMs: null }), run({ ticket: 'CON-2', elapsedMs: 60000 })],
  });
  const out = plain(renderCompare(s, { cols: 100 }));
  assert.doesNotMatch(out, /Δ/);
  assert.doesNotMatch(out, /NaN/);
  assert.doesNotMatch(out, /undefined/);
});

// --- degenerate: a marked run no longer present in state.runs -------------

test('a marked run pruned from state.runs renders a safe fallback, not a throw', () => {
  const s = state({ runs: [run({ ticket: 'CON-1' })] }); // CON-2 missing
  const out = plain(renderCompare(s, { cols: 100 }));
  assert.match(out, /one or both marked runs are no longer available/);
  assert.match(out, /esc back/);
});

// --- handleKey: esc dispatches the screen-specific action, not `back` ------

test('esc dispatches back-to-origin-from-compare, never the generic back', () => {
  assert.deepEqual(handleKey('\x1b', { compareFocus: 'left' }), { type: 'back-to-origin-from-compare' });
});

// --- handleKey: column focus + scroll --------------------------------------

test('Tab flips focus between columns', () => {
  assert.deepEqual(handleKey('\t', { compareFocus: 'left' }), { type: 'switch-compare-focus', focus: 'right' });
  assert.deepEqual(handleKey('\t', { compareFocus: 'right' }), { type: 'switch-compare-focus', focus: 'left' });
});

test('left/right arrows set focus directly', () => {
  assert.deepEqual(handleKey('\x1b[C', { compareFocus: 'left' }), { type: 'switch-compare-focus', focus: 'right' });
  assert.deepEqual(handleKey('\x1b[D', { compareFocus: 'right' }), { type: 'switch-compare-focus', focus: 'left' });
});

test('j/k and up/down arrows scroll the currently focused column', () => {
  assert.deepEqual(handleKey('j', { compareFocus: 'left' }), { type: 'compare-scroll', column: 'left', delta: 1 });
  assert.deepEqual(handleKey('k', { compareFocus: 'right' }), { type: 'compare-scroll', column: 'right', delta: -1 });
  assert.deepEqual(handleKey('\x1b[B', { compareFocus: 'left' }), { type: 'compare-scroll', column: 'left', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', { compareFocus: 'left' }), { type: 'compare-scroll', column: 'left', delta: -1 });
});

test('scrolling one column never names the other', () => {
  const action = handleKey('j', { compareFocus: 'left' });
  assert.equal(action.column, 'left');
  assert.notEqual(action.column, 'right');
});

// --- router seam -----------------------------------------------------------

test('render/routeHandleKey are the uniform (state, opts) / (key, state) seam', () => {
  const s = state({});
  assert.equal(render(s, { cols: 100 }), renderCompare(s, {
    cols: 100, leftScroll: s.compareLeftScroll, rightScroll: s.compareRightScroll, focus: s.compareFocus,
  }));
  assert.deepEqual(routeHandleKey('\x1b', s), { type: 'back-to-origin-from-compare' });
});
