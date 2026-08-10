'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderArchive, handleKey, render, routeHandleKey,
  filterArchiveRuns, observedHarnesses, nextHarness,
  formatDateBound, parseDateBoundValue, FOCUS_ORDER,
} = require('../lib/ui/screens/archive');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({
    ticket: 'CON-1', changeName: 'a change', harness: 'claude-code',
    status: 'done', startedAt: Date.UTC(2026, 6, 1, 0, 0, 0),
  }, over);
}

function baseState(over) {
  return Object.assign({
    runs: [],
    archiveQuery: null,
    archiveHarnessFilter: null,
    archiveDateFrom: null,
    archiveDateTo: null,
    archiveSelected: 0,
    archiveFocus: 'query',
    archiveDatePrompt: null,
  }, over);
}

// --- filterArchiveRuns: substring ------------------------------------------

test('an empty/whitespace-only query matches every run (the explicit bypass, not rowMatches\' own empty-matches-nothing default)', () => {
  const runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' })];
  assert.equal(filterArchiveRuns(runs, baseState()).length, 2);
  assert.equal(filterArchiveRuns(runs, baseState({ archiveQuery: '' })).length, 2);
  assert.equal(filterArchiveRuns(runs, baseState({ archiveQuery: '   ' })).length, 2);
});

test('a non-empty query narrows by ticket id or title, case-insensitively, via the reused rowMatches', () => {
  const runs = [
    run({ ticket: 'CON-1', changeName: 'add a share button' }),
    run({ ticket: 'CON-2', changeName: 'unrelated' }),
  ];
  const byTicket = filterArchiveRuns(runs, baseState({ archiveQuery: 'con-1' }));
  assert.deepEqual(byTicket.map((r) => r.ticket), ['CON-1']);

  const byTitle = filterArchiveRuns(runs, baseState({ archiveQuery: 'SHARE' }));
  assert.deepEqual(byTitle.map((r) => r.ticket), ['CON-1']);
});

// --- filterArchiveRuns: harness ---------------------------------------------

test('an unset harness filter applies no harness filtering', () => {
  const runs = [run({ harness: 'claude-code' }), run({ harness: 'codex' })];
  assert.equal(filterArchiveRuns(runs, baseState()).length, 2);
});

test('a set harness filter narrows to exactly that harness', () => {
  const runs = [
    run({ ticket: 'CON-1', harness: 'claude-code' }),
    run({ ticket: 'CON-2', harness: 'codex' }),
  ];
  const filtered = filterArchiveRuns(runs, baseState({ archiveHarnessFilter: 'codex' }));
  assert.deepEqual(filtered.map((r) => r.ticket), ['CON-2']);
});

// --- filterArchiveRuns: date range -------------------------------------------

test('with neither date bound set, a run with no startedAt is still included', () => {
  const runs = [run({ startedAt: null })];
  assert.equal(filterArchiveRuns(runs, baseState()).length, 1);
});

test('with either date bound set, a run with no startedAt is excluded', () => {
  const runs = [run({ startedAt: null })];
  assert.equal(filterArchiveRuns(runs, baseState({ archiveDateFrom: 1000 })).length, 0);
  assert.equal(filterArchiveRuns(runs, baseState({ archiveDateTo: 1000 })).length, 0);
});

test('a run whose startedAt falls outside the [from, to] bound is excluded', () => {
  const inRange = run({ ticket: 'CON-1', startedAt: Date.UTC(2026, 6, 15) });
  const before = run({ ticket: 'CON-2', startedAt: Date.UTC(2026, 5, 1) });
  const after = run({ ticket: 'CON-3', startedAt: Date.UTC(2026, 7, 1) });
  const state = baseState({ archiveDateFrom: Date.UTC(2026, 6, 1), archiveDateTo: Date.UTC(2026, 6, 30) });
  const filtered = filterArchiveRuns([inRange, before, after], state);
  assert.deepEqual(filtered.map((r) => r.ticket), ['CON-1']);
});

// --- filterArchiveRuns: filters combine --------------------------------------

test('filters combine — a run matching the substring but not the harness is excluded', () => {
  const runs = [
    run({ ticket: 'CON-1', changeName: 'share button', harness: 'claude-code' }),
    run({ ticket: 'CON-2', changeName: 'share dialog', harness: 'codex' }),
  ];
  const state = baseState({ archiveQuery: 'share', archiveHarnessFilter: 'claude-code' });
  assert.deepEqual(filterArchiveRuns(runs, state).map((r) => r.ticket), ['CON-1']);
});

// --- a run beyond the fleet's own display cap is still listed ---------------

// tasks.md 6.4: the direct proof of proposal.md's core claim. The fleet
// view's own FAILED/DONE sections cap themselves to MAX_FINISHED (5,
// lib/ui/screens/fleet/sections.js) — collapsing anything beyond that into
// "… and N more" (see fleet-search.test.js's own "includes every row in a
// bucket, even beyond MAX_FINISHED" test, which uses the identical
// reference count). The archive screen's own filtering must never impose
// that same cap: every one of 8 (> 5) FAILED runs must still be listed.
test('a run beyond the fleet view\'s own DONE/FAILED display cap (MAX_FINISHED = 5) is still listed here', () => {
  const runs = [];
  for (let i = 0; i < 8; i++) runs.push(run({ ticket: 'CON-' + i, status: 'failed' }));
  const filtered = filterArchiveRuns(runs, baseState({ runs }));
  assert.equal(filtered.length, 8, 'every FAILED run must be listed, not just the fleet view\'s own capped subset');
});

// --- observedHarnesses / nextHarness -----------------------------------------

test('observedHarnesses: distinct, non-null values in first-seen order', () => {
  const runs = [
    run({ harness: 'claude-code' }), run({ harness: 'codex' }),
    run({ harness: 'claude-code' }), run({ harness: null }),
  ];
  assert.deepEqual(observedHarnesses(runs), ['claude-code', 'codex']);
});

test('nextHarness: from "any" (null), cycles to the first observed value', () => {
  assert.equal(nextHarness(null, ['claude-code', 'codex']), 'claude-code');
});

test('nextHarness: advances through the observed list', () => {
  assert.equal(nextHarness('claude-code', ['claude-code', 'codex']), 'codex');
});

test('nextHarness: wraps from the last observed value back to "any" (null)', () => {
  assert.equal(nextHarness('codex', ['claude-code', 'codex']), null);
});

test('nextHarness: no observed harnesses at all stays "any"', () => {
  assert.equal(nextHarness(null, []), null);
});

// --- date bound formatting/parsing ------------------------------------------

test('formatDateBound: null is null (renders as "any")', () => {
  assert.equal(formatDateBound(null), null);
});

test('formatDateBound/parseDateBoundValue: round-trip a local calendar date for dateFrom (start of day)', () => {
  const result = parseDateBoundValue('2026-07-01', 'dateFrom');
  assert.equal(result.ok, true);
  const d = new Date(result.ms);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(formatDateBound(result.ms), '2026-07-01');
});

test('parseDateBoundValue: dateTo resolves to the end of that local day', () => {
  const result = parseDateBoundValue('2026-07-01', 'dateTo');
  assert.equal(result.ok, true);
  const d = new Date(result.ms);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
});

test('parseDateBoundValue: an empty/whitespace value is ok with ms=null (the "clear this bound" case)', () => {
  assert.deepEqual(parseDateBoundValue('', 'dateFrom'), { ok: true, ms: null });
  assert.deepEqual(parseDateBoundValue('   ', 'dateTo'), { ok: true, ms: null });
});

test('parseDateBoundValue: an unparseable value is rejected, not thrown', () => {
  assert.deepEqual(parseDateBoundValue('not-a-date', 'dateFrom'), { ok: false });
  assert.deepEqual(parseDateBoundValue('2026-13-40', 'dateFrom'), { ok: false });
  // Rolled-over "dates" (Date would silently normalise Feb 30 -> Mar 2) are
  // caught by the field round-trip check, not accepted as a nearby date.
  assert.deepEqual(parseDateBoundValue('2024-02-30', 'dateFrom'), { ok: false });
});

// --- render ------------------------------------------------------------------

test('the substring input holds focus by default', () => {
  const state = baseState({ runs: [run({})] });
  assert.equal(state.archiveFocus, 'query');
});

test('typing a substring narrows the rendered list live', () => {
  const runs = [run({ ticket: 'CON-1', changeName: 'match me' }), run({ ticket: 'CON-2', changeName: 'no' })];
  const out = plain(renderArchive(baseState({ runs, archiveQuery: 'match' }), { cols: 100 }));
  assert.match(out, /CON-1/);
  assert.doesNotMatch(out, /CON-2/);
});

test('an empty substring filter shows every run', () => {
  const runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' })];
  const out = plain(renderArchive(baseState({ runs }), { cols: 100 }));
  assert.match(out, /CON-1/);
  assert.match(out, /CON-2/);
});

test('render shows "no runs match" when the filtered list is empty', () => {
  const runs = [run({ ticket: 'CON-1', changeName: 'zzz' })];
  const out = plain(renderArchive(baseState({ runs, archiveQuery: 'nope' }), { cols: 100 }));
  assert.match(out, /no runs match/);
});

test('render shows the open date prompt\'s error notice', () => {
  const state = baseState({
    runs: [], archiveFocus: 'dateFrom',
    archiveDatePrompt: { bound: 'dateFrom', value: 'not-a-date', error: 'expected YYYY-MM-DD' },
  });
  const out = plain(renderArchive(state, { cols: 100 }));
  assert.match(out, /expected YYYY-MM-DD/);
});

// --- handleKey: focus cycling -------------------------------------------

test('Tab moves focus to the next zone, in FOCUS_ORDER', () => {
  assert.deepEqual(FOCUS_ORDER, ['query', 'harness', 'dateFrom', 'dateTo', 'list']);
  assert.deepEqual(handleKey('\t', baseState({ archiveFocus: 'query' })), { type: 'archive-focus-next' });
});

test('Shift-Tab moves focus backward', () => {
  assert.deepEqual(handleKey('\x1b[Z', baseState({ archiveFocus: 'harness' })), { type: 'archive-focus-prev' });
});

// --- handleKey: per-focus dispatch ---------------------------------------

test('query focus: typing produces archive-query-type', () => {
  assert.deepEqual(handleKey('x', baseState({ archiveFocus: 'query' })), { type: 'archive-query-type', char: 'x' });
});

test('query focus: backspace produces archive-query-backspace', () => {
  assert.deepEqual(handleKey('\x7f', baseState({ archiveFocus: 'query' })), { type: 'archive-query-backspace' });
});

test('query focus: Enter is a no-op (filtering is already live)', () => {
  assert.equal(handleKey('\r', baseState({ archiveFocus: 'query' })), null);
});

test('harness focus: Enter cycles the harness filter', () => {
  assert.deepEqual(handleKey('\r', baseState({ archiveFocus: 'harness' })), { type: 'cycle-archive-harness' });
});

test('harness focus: space also cycles the harness filter', () => {
  assert.deepEqual(handleKey(' ', baseState({ archiveFocus: 'harness' })), { type: 'cycle-archive-harness' });
});

test('date-from focus: Enter opens the date prompt for dateFrom', () => {
  assert.deepEqual(handleKey('\r', baseState({ archiveFocus: 'dateFrom' })), { type: 'open-archive-date-prompt', bound: 'dateFrom' });
});

test('date-to focus: Enter opens the date prompt for dateTo', () => {
  assert.deepEqual(handleKey('\r', baseState({ archiveFocus: 'dateTo' })), { type: 'open-archive-date-prompt', bound: 'dateTo' });
});

test('list focus: j/k move the cursor', () => {
  assert.deepEqual(handleKey('j', baseState({ archiveFocus: 'list' })), { type: 'move-archive-selection', delta: 1 });
  assert.deepEqual(handleKey('k', baseState({ archiveFocus: 'list' })), { type: 'move-archive-selection', delta: -1 });
  assert.deepEqual(handleKey('\x1b[B', baseState({ archiveFocus: 'list' })), { type: 'move-archive-selection', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', baseState({ archiveFocus: 'list' })), { type: 'move-archive-selection', delta: -1 });
});

test('list focus: Enter on a selected row opens its drill-down via the existing action, unmodified', () => {
  const runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' })];
  const state = baseState({ runs, archiveFocus: 'list', archiveSelected: 1 });
  assert.deepEqual(handleKey('\r', state), { type: 'open-drilldown', ticket: 'CON-2' });
});

test('list focus: Enter with no matching runs is a no-op', () => {
  const state = baseState({ runs: [], archiveFocus: 'list' });
  assert.equal(handleKey('\r', state), null);
});

// --- handleKey: esc ---------------------------------------------------------

test('esc (no prompt open, any focus) returns back', () => {
  for (const focus of FOCUS_ORDER) {
    assert.deepEqual(handleKey('\x1b', baseState({ archiveFocus: focus })), { type: 'back' });
  }
});

// --- handleKey: the date prompt intercepts everything (design.md Decision 6) --

test('while the date prompt is open, typing/backspace mutate the prompt, never archiveQuery', () => {
  const state = baseState({
    archiveFocus: 'dateFrom',
    archiveDatePrompt: { bound: 'dateFrom', value: '2026-0', error: null },
  });
  assert.deepEqual(handleKey('7', state), { type: 'archive-date-prompt-type', char: '7' });
  assert.deepEqual(handleKey('\x7f', state), { type: 'archive-date-prompt-backspace' });
});

test('while the date prompt is open, Enter submits it', () => {
  const state = baseState({
    archiveFocus: 'dateFrom',
    archiveDatePrompt: { bound: 'dateFrom', value: '2026-07-01', error: null },
  });
  assert.deepEqual(handleKey('\r', state), { type: 'submit-archive-date-prompt' });
});

test('while the date prompt is open, esc cancels the PROMPT only — never the generic "back"', () => {
  const state = baseState({
    archiveFocus: 'dateFrom',
    archiveDatePrompt: { bound: 'dateFrom', value: 'partial', error: null },
  });
  assert.deepEqual(handleKey('\x1b', state), { type: 'cancel-archive-date-prompt' });
});

test('while the date prompt is open, Tab does nothing to focus (the prompt owns every key)', () => {
  const state = baseState({
    archiveFocus: 'dateFrom',
    archiveDatePrompt: { bound: 'dateFrom', value: '', error: null },
  });
  assert.notDeepEqual(handleKey('\t', state), { type: 'archive-focus-next' });
});

// --- router seam -----------------------------------------------------------

test('render/routeHandleKey are the uniform (state, opts) / (key, state) seam', () => {
  const state = baseState({ runs: [run({})] });
  assert.equal(render(state, { cols: 100 }), renderArchive(state, { cols: 100 }));
  assert.deepEqual(routeHandleKey('\x1b', state), { type: 'back' });
});

// --- CON-114: run-comparison marking + trigger ------------------------------

test('render shows the marked-for-comparison indicator on a run in compareSelection', () => {
  const runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' })];
  const marked = plain(renderArchive(baseState({ runs, compareSelection: ['CON-1'] }), { cols: 100 }));
  const unmarked = plain(renderArchive(baseState({ runs, compareSelection: [] }), { cols: 100 }));
  assert.notEqual(marked, unmarked, 'a marked run must render differently than an unmarked one');
});

test('list focus: space dispatches toggle-compare-select for the run under the cursor', () => {
  const runs = [run({ ticket: 'CON-1' }), run({ ticket: 'CON-2' })];
  const state = baseState({ runs, archiveFocus: 'list', archiveSelected: 1 });
  assert.deepEqual(handleKey(' ', state), { type: 'toggle-compare-select', ticket: 'CON-2' });
});

test('list focus: space with no matching runs is a no-op', () => {
  const state = baseState({ runs: [], archiveFocus: 'list' });
  assert.equal(handleKey(' ', state), null);
});

test('list focus: c dispatches open-compare once exactly two runs are marked', () => {
  const state = baseState({ archiveFocus: 'list', compareSelection: ['CON-1', 'CON-2'] });
  assert.deepEqual(handleKey('c', state), { type: 'open-compare' });
});

test('list focus: c is a no-op with fewer than two runs marked', () => {
  assert.equal(handleKey('c', baseState({ archiveFocus: 'list', compareSelection: [] })), null);
  assert.equal(handleKey('c', baseState({ archiveFocus: 'list', compareSelection: ['CON-1'] })), null);
});

test('space/c outside list focus do not fire archive\'s own list-zone handling', () => {
  // query focus: space is an ordinary typed character, not a compare toggle.
  assert.deepEqual(handleKey(' ', baseState({ archiveFocus: 'query' })), { type: 'archive-query-type', char: ' ' });
});
