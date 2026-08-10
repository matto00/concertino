'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const archiveCtl = require('../lib/ui/controllers/archive');

function ctx(over) {
  const S = {
    mode: 'fleet',
    runs: [],
    archiveQuery: null,
    archiveHarnessFilter: null,
    archiveDateFrom: null,
    archiveDateTo: null,
    archiveSelected: 0,
    archiveFocus: 'query',
    archiveDatePrompt: null,
  };
  return Object.assign({ S }, over);
}

const apply = (c, action) => archiveCtl.handle(action, c);

function run(over) {
  return Object.assign({
    ticket: 'CON-1', changeName: 'a change', harness: 'claude-code',
    status: 'done', startedAt: Date.UTC(2026, 6, 1),
  }, over);
}

// --- open-archive ------------------------------------------------------

test('open-archive resets every archive* field to its default and sets mode', () => {
  const c = ctx();
  c.S.archiveQuery = 'stale';
  c.S.archiveHarnessFilter = 'codex';
  c.S.archiveDateFrom = 1000;
  c.S.archiveDateTo = 2000;
  c.S.archiveSelected = 5;
  c.S.archiveFocus = 'list';
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: 'x', error: 'y' };
  assert.equal(apply(c, { type: 'open-archive' }), true);
  assert.equal(c.S.archiveQuery, null);
  assert.equal(c.S.archiveHarnessFilter, null);
  assert.equal(c.S.archiveDateFrom, null);
  assert.equal(c.S.archiveDateTo, null);
  assert.equal(c.S.archiveSelected, 0);
  assert.equal(c.S.archiveFocus, 'query');
  assert.equal(c.S.archiveDatePrompt, null);
  assert.equal(c.S.mode, 'archive');
});

// --- focus cycling -------------------------------------------------------

test('archive-focus-next cycles forward through the fixed order, wrapping at the end', () => {
  const c = ctx();
  c.S.archiveFocus = 'query';
  apply(c, { type: 'archive-focus-next' });
  assert.equal(c.S.archiveFocus, 'harness');
  apply(c, { type: 'archive-focus-next' });
  assert.equal(c.S.archiveFocus, 'dateFrom');
  apply(c, { type: 'archive-focus-next' });
  assert.equal(c.S.archiveFocus, 'dateTo');
  apply(c, { type: 'archive-focus-next' });
  assert.equal(c.S.archiveFocus, 'list');
  apply(c, { type: 'archive-focus-next' });
  assert.equal(c.S.archiveFocus, 'query');
});

test('archive-focus-prev cycles backward, wrapping from the first back to the last', () => {
  const c = ctx();
  c.S.archiveFocus = 'query';
  apply(c, { type: 'archive-focus-prev' });
  assert.equal(c.S.archiveFocus, 'list');
});

// --- query typing/backspace ------------------------------------------------

test('archive-query-type appends to archiveQuery', () => {
  const c = ctx();
  apply(c, { type: 'archive-query-type', char: 'C' });
  apply(c, { type: 'archive-query-type', char: 'O' });
  assert.equal(c.S.archiveQuery, 'CO');
});

test('archive-query-backspace trims the last character', () => {
  const c = ctx();
  c.S.archiveQuery = 'CON';
  apply(c, { type: 'archive-query-backspace' });
  assert.equal(c.S.archiveQuery, 'CO');
});

test('query typing/backspace clamps archiveSelected back into range of the newly-filtered list', () => {
  const c = ctx();
  c.S.runs = [run({ ticket: 'CON-1', changeName: 'match' }), run({ ticket: 'CON-2', changeName: 'other' })];
  c.S.archiveSelected = 1;
  apply(c, { type: 'archive-query-type', char: 'm' });
  apply(c, { type: 'archive-query-type', char: 'a' });
  apply(c, { type: 'archive-query-type', char: 't' });
  apply(c, { type: 'archive-query-type', char: 'c' });
  apply(c, { type: 'archive-query-type', char: 'h' });
  // "match" narrows the list to exactly CON-1 — a stale cursor of 1 must clamp to 0.
  assert.equal(c.S.archiveSelected, 0);
});

// --- harness cycling ---------------------------------------------------

test('cycle-archive-harness advances through the observed values and wraps to "any"', () => {
  const c = ctx();
  c.S.runs = [run({ harness: 'claude-code' }), run({ harness: 'codex' })];
  assert.equal(c.S.archiveHarnessFilter, null);
  apply(c, { type: 'cycle-archive-harness' });
  assert.equal(c.S.archiveHarnessFilter, 'claude-code');
  apply(c, { type: 'cycle-archive-harness' });
  assert.equal(c.S.archiveHarnessFilter, 'codex');
  apply(c, { type: 'cycle-archive-harness' });
  assert.equal(c.S.archiveHarnessFilter, null);
});

test('cycle-archive-harness recomputes the observed set fresh each time (not fixed at open time)', () => {
  const c = ctx();
  c.S.runs = [run({ harness: 'claude-code' })];
  apply(c, { type: 'cycle-archive-harness' });
  assert.equal(c.S.archiveHarnessFilter, 'claude-code');
  // A second harness appears mid-session (a new run started with it).
  c.S.runs.push(run({ ticket: 'CON-2', harness: 'codex' }));
  apply(c, { type: 'cycle-archive-harness' });
  assert.equal(c.S.archiveHarnessFilter, 'codex');
});

// --- date prompt: open/type/backspace/cancel --------------------------------

test('open-archive-date-prompt seeds archiveDatePrompt from the currently-committed bound', () => {
  const c = ctx();
  // Bounds are stored as LOCAL-time ms epoch (design.md Decision 6) — built
  // with the local Date constructor here, matching how submit-archive-date-
  // prompt itself would have produced it, not Date.UTC (which would shift a
  // day in any timezone behind UTC).
  c.S.archiveDateFrom = new Date(2026, 6, 1).getTime();
  apply(c, { type: 'open-archive-date-prompt', bound: 'dateFrom' });
  assert.deepEqual(c.S.archiveDatePrompt, { bound: 'dateFrom', value: '2026-07-01', error: null });
});

test('open-archive-date-prompt seeds an empty value when the bound is unset', () => {
  const c = ctx();
  apply(c, { type: 'open-archive-date-prompt', bound: 'dateTo' });
  assert.deepEqual(c.S.archiveDatePrompt, { bound: 'dateTo', value: '', error: null });
});

test('archive-date-prompt-type appends to the prompt\'s own uncommitted value and clears any prior error', () => {
  const c = ctx();
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: '2026', error: 'expected YYYY-MM-DD' };
  apply(c, { type: 'archive-date-prompt-type', char: '-' });
  assert.equal(c.S.archiveDatePrompt.value, '2026-');
  assert.equal(c.S.archiveDatePrompt.error, null);
});

test('archive-date-prompt-backspace trims the prompt\'s own uncommitted value', () => {
  const c = ctx();
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: '2026-', error: null };
  apply(c, { type: 'archive-date-prompt-backspace' });
  assert.equal(c.S.archiveDatePrompt.value, '2026');
});

test('cancel-archive-date-prompt clears the prompt without touching archiveFocus or any committed filter', () => {
  const c = ctx();
  c.S.archiveFocus = 'dateFrom';
  c.S.archiveDateFrom = 12345;
  c.S.archiveQuery = 'kept';
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: 'garbage', error: null };
  apply(c, { type: 'cancel-archive-date-prompt' });
  assert.equal(c.S.archiveDatePrompt, null);
  assert.equal(c.S.archiveFocus, 'dateFrom');
  assert.equal(c.S.archiveDateFrom, 12345);
  assert.equal(c.S.archiveQuery, 'kept');
});

// --- date prompt: submit ----------------------------------------------------

test('submit-archive-date-prompt commits a valid date and clears the prompt', () => {
  const c = ctx();
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: '2026-07-01', error: null };
  apply(c, { type: 'submit-archive-date-prompt' });
  assert.equal(c.S.archiveDatePrompt, null);
  assert.equal(new Date(c.S.archiveDateFrom).getDate(), 1);
});

test('submit-archive-date-prompt on the dateTo bound commits to end-of-day', () => {
  const c = ctx();
  c.S.archiveDatePrompt = { bound: 'dateTo', value: '2026-07-01', error: null };
  apply(c, { type: 'submit-archive-date-prompt' });
  const d = new Date(c.S.archiveDateTo);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
});

test('submit-archive-date-prompt on an empty value clears the bound and the prompt', () => {
  const c = ctx();
  c.S.archiveDateFrom = 999;
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: '', error: null };
  apply(c, { type: 'submit-archive-date-prompt' });
  assert.equal(c.S.archiveDateFrom, null);
  assert.equal(c.S.archiveDatePrompt, null);
});

test('submit-archive-date-prompt on an unparseable value leaves the bound unchanged and sets an error, prompt stays open', () => {
  const c = ctx();
  c.S.archiveDateFrom = 999;
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: 'not-a-date', error: null };
  apply(c, { type: 'submit-archive-date-prompt' });
  assert.equal(c.S.archiveDateFrom, 999, 'the committed bound must be unchanged');
  assert.ok(c.S.archiveDatePrompt, 'the prompt must remain open');
  assert.match(c.S.archiveDatePrompt.error, /YYYY-MM-DD/);
});

test('a successful date-prompt commit clamps archiveSelected back into range of the newly-filtered list', () => {
  const c = ctx();
  c.S.runs = [run({ ticket: 'CON-1', startedAt: Date.UTC(2026, 6, 15) })];
  c.S.archiveSelected = 4;
  c.S.archiveDatePrompt = { bound: 'dateFrom', value: '2027-01-01', error: null }; // excludes the only run
  apply(c, { type: 'submit-archive-date-prompt' });
  assert.equal(c.S.archiveSelected, 0);
});

// --- list cursor movement ---------------------------------------------------

test('move-archive-selection clamps within [0, filtered length - 1]', () => {
  const c = ctx();
  c.S.runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' }), run({ ticket: 'CON-3' })];
  c.S.archiveSelected = 1;
  apply(c, { type: 'move-archive-selection', delta: 1 });
  assert.equal(c.S.archiveSelected, 2);
  apply(c, { type: 'move-archive-selection', delta: 5 });
  assert.equal(c.S.archiveSelected, 2);
  apply(c, { type: 'move-archive-selection', delta: -10 });
  assert.equal(c.S.archiveSelected, 0);
});

test('move-archive-selection on an empty filtered list is a no-op', () => {
  const c = ctx();
  c.S.runs = [];
  apply(c, { type: 'move-archive-selection', delta: 1 });
  assert.equal(c.S.archiveSelected, 0);
});

// --- unrecognised actions ----------------------------------------------------

test('an action this controller does not own returns false', () => {
  const c = ctx();
  assert.equal(apply(c, { type: 'not-a-real-action' }), false);
});
