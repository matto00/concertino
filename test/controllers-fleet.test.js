'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fleetCtl = require('../lib/ui/controllers/fleet');

// CON-98: the FAILED-row remediation actions (design.md Decisions 2/3) —
// 'address-failure', 'open-mark-done-confirm'/'cancel-mark-done'/
// 'confirm-mark-done'. Drives the real controller against a minimal ctx,
// mirroring test/controllers-sessions.test.js's/controllers-drilldown.test.js's
// own precedent: a fake ctx.deps (submitTicket/writeOverrideEvent never touch
// a real tmux session or a real events.jsonl) and a fake ctx.session.
//
// fleet.js's own screen-level tests (test/fleet.test.js) already cover
// handleKey resolving these actions in the first place — this file covers
// only what the controller does once dispatched.

function ctx(over) {
  const S = { runs: [], markDoneConfirm: null, addressFailureNotice: null };
  return Object.assign({
    S,
    root: '/tmp/concertino-fake-root',
    session: { name: 'concertino' },
    deps: {
      submitTicket: () => ({ spawned: true, error: null }),
      writeOverrideEvent: () => {},
    },
  }, over);
}

const apply = (c, action) => fleetCtl.handle(action, c);

function run(over) {
  return Object.assign({
    ticket: 'HEL-9', status: 'failed', harness: 'claude-code',
    // CON-110: a NEEDS YOU/RUNNING row's own 2-line renderRun (unlike FAILED/
    // DONE's 1-line renderFinishedRow) reads these — omitted fields crash
    // window.js's sectionNaturalHeight, which submit-search's own
    // scrollToShow call now reaches for a runs-backed jump target.
    gates: [], telemetry: 'full', phase: null, changeName: 'a-change',
    escalation: null, window: { alive: true, idleMs: 0 }, elapsedMs: 60000,
  }, over);
}

// --- 'address-failure' ------------------------------------------------------

test('address-failure on a claude-code run spawns via submitTicket with the address-failure command', () => {
  const calls = [];
  const c = ctx({
    deps: {
      submitTicket: (ticket, command, session) => { calls.push({ ticket, command, session }); return { spawned: true, error: null }; },
      writeOverrideEvent: () => {},
    },
  });
  c.S.runs = [run({})];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticket, 'HEL-9');
  assert.match(calls[0].command, /\/concertino-address-failure \{\{TICKET\}\}/);
  assert.match(calls[0].command, /^claude /);
  assert.equal(calls[0].session, c.session);
  assert.equal(c.S.addressFailureNotice, null);
});

test('address-failure on a non-claude-code run shows an inline notice instead of spawning', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: (...args) => { calls.push(args); return { spawned: true, error: null }; }, writeOverrideEvent: () => {} } });
  c.S.runs = [run({ harness: 'codex' })];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0, 'no tmux window should be created or replaced');
  assert.match(c.S.addressFailureNotice, /codex/);
  assert.match(c.S.addressFailureNotice, /not.*available|isn't available/);
});

test('address-failure re-resolves the run fresh from S.runs — a stale/vanished ticket is a no-op', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: (...args) => { calls.push(args); return { spawned: true, error: null }; }, writeOverrideEvent: () => {} } });
  c.S.runs = []; // the run is gone by the time this resolved
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0);
  assert.equal(c.S.addressFailureNotice, null);
});

test('address-failure surfaces a failed spawn as the notice, rather than swallowing it', () => {
  const c = ctx({ deps: { submitTicket: () => ({ spawned: false, error: 'could not start HEL-9: boom' }), writeOverrideEvent: () => {} } });
  c.S.runs = [run({})];
  assert.equal(apply(c, { type: 'address-failure', ticket: 'HEL-9' }), true);
  assert.equal(c.S.addressFailureNotice, 'could not start HEL-9: boom');
});

// --- 'open-mark-done-confirm' / 'cancel-mark-done' --------------------------

test('open-mark-done-confirm sets S.markDoneConfirm to the given ticket', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'open-mark-done-confirm', ticket: 'HEL-9' }), true);
  assert.deepEqual(c.S.markDoneConfirm, { ticket: 'HEL-9' });
});

test('cancel-mark-done clears S.markDoneConfirm without writing anything', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'cancel-mark-done' }), true);
  assert.equal(c.S.markDoneConfirm, null);
  assert.equal(calls.length, 0);
});

// --- 'confirm-mark-done' -----------------------------------------------------

test('confirm-mark-done writes a run.override event for the resolved run and clears the confirm', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.runs = [run({})];
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'confirm-mark-done', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [c.root, 'HEL-9', 'done']);
  assert.equal(c.S.markDoneConfirm, null);
});

test('confirm-mark-done re-resolves the run fresh from S.runs — a vanished run writes nothing but still clears the confirm', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...args) => calls.push(args) } });
  c.S.runs = []; // gone by the time 'y' actually landed
  c.S.markDoneConfirm = { ticket: 'HEL-9' };
  assert.equal(apply(c, { type: 'confirm-mark-done', ticket: 'HEL-9' }), true);
  assert.equal(calls.length, 0);
  assert.equal(c.S.markDoneConfirm, null);
});

// --- CON-110: the `/` search prompt's own controller actions -----------
// tasks.md 3.1-3.5, design.md Decision 3/4. 'open-prompt'/'prompt-type'/
// etc.'s own tests (above/elsewhere) mirror this shape; 'submit-search'
// additionally exercises applyJumpAction — the shared helper 'jump'/
// 'focus-queue'/'focus-quickstart' themselves now also go through.

// selected/scrollOffset/focus are asserted untouched on all four of
// open/type/backspace/cancel — spec.md's "opening search SHALL NOT itself
// change selected, scrollOffset, or focus" and "typing into ... never
// mutates any of the three" requirements.
function selectionCtx() {
  const c = ctx({});
  c.S.selected = 3;
  c.S.scrollOffset = 2;
  c.S.focus = 'runs';
  return c;
}
function assertSelectionUntouched(c) {
  assert.equal(c.S.selected, 3);
  assert.equal(c.S.scrollOffset, 2);
  assert.equal(c.S.focus, 'runs');
}

test('open-search sets S.search to an empty value, touching nothing else', () => {
  const c = selectionCtx();
  assert.equal(apply(c, { type: 'open-search' }), true);
  assert.deepEqual(c.S.search, { value: '' });
  assertSelectionUntouched(c);
});

test('search-type appends the typed character, touching nothing else', () => {
  const c = selectionCtx();
  c.S.search = { value: 'CO' };
  assert.equal(apply(c, { type: 'search-type', char: 'N' }), true);
  assert.deepEqual(c.S.search, { value: 'CON' });
  assertSelectionUntouched(c);
});

test('search-backspace trims the last character, touching nothing else', () => {
  const c = selectionCtx();
  c.S.search = { value: 'CON-1' };
  assert.equal(apply(c, { type: 'search-backspace' }), true);
  assert.deepEqual(c.S.search, { value: 'CON-' });
  assertSelectionUntouched(c);
});

test('cancel-search clears S.search and touches nothing else', () => {
  const c = ctx({});
  c.S.search = { value: 'CON-1' };
  c.S.selected = 3;
  c.S.scrollOffset = 2;
  c.S.focus = 'runs';
  assert.equal(apply(c, { type: 'cancel-search' }), true);
  assert.equal(c.S.search, null);
  assert.equal(c.S.selected, 3);
  assert.equal(c.S.scrollOffset, 2);
  assert.equal(c.S.focus, 'runs');
});

// --- 'submit-search' ---------------------------------------------------

function searchCtx(over) {
  return ctx(Object.assign({
    quickStartEligible: () => [],
    queuedTitles: () => null,
    computeScreenRows: () => 20,
  }, over));
}

test('submit-search with a match in QUEUED sets focus/queueFocus without touching selected/scrollOffset', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-1', status: 'running' })];
  c.S.selected = 0;
  c.S.scrollOffset = 0;
  c.S.queueState = { pending: ['HEL-77'], maxConcurrent: 1 };
  c.S.search = { value: '77' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.focus, 'queue');
  assert.equal(c.S.queueFocus, 0);
  assert.equal(c.S.selected, 0);
  assert.equal(c.S.scrollOffset, 0);
  assert.equal(c.S.search, null, 'the prompt closes on a successful jump');
});

test('submit-search with a match in QUICK START sets focus/quickStartFocus', () => {
  const c = searchCtx({ quickStartEligible: () => [{ identifier: 'CON-88', title: 'an urgent ticket', priority: 1 }] });
  c.S.runs = [];
  c.S.search = { value: 'urgent' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.focus, 'quickstart');
  assert.equal(c.S.quickStartFocus, 0);
  assert.equal(c.S.search, null);
});

test('submit-search with a match in a runs-backed section (FAILED) sets selected/focus=runs and closes the prompt', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'failed' }), run({ ticket: 'HEL-1', status: 'running' })];
  c.S.selected = 1;
  c.S.focus = 'runs';
  c.S.search = { value: 'HEL-9' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.selected, 0);
  assert.equal(c.S.focus, 'runs');
  assert.equal(c.S.search, null);
});

test('submit-search with a match in NEEDS YOU sets selected/focus=runs and closes the prompt', () => {
  const c = searchCtx({});
  c.S.runs = [
    run({ ticket: 'HEL-1', status: 'needs-you' }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ];
  c.S.selected = 1;
  c.S.focus = 'runs';
  c.S.search = { value: 'HEL-1' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.selected, 0);
  assert.equal(c.S.focus, 'runs');
  assert.equal(c.S.search, null);
});

test('submit-search with a match in RUNNING sets selected/focus=runs and closes the prompt', () => {
  const c = searchCtx({});
  c.S.runs = [
    run({ ticket: 'HEL-1', status: 'needs-you' }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ];
  c.S.selected = 0;
  c.S.focus = 'runs';
  c.S.search = { value: 'HEL-2' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.selected, 1);
  assert.equal(c.S.focus, 'runs');
  assert.equal(c.S.search, null);
});

test('submit-search with a match in DONE sets selected/focus=runs and closes the prompt', () => {
  const c = searchCtx({});
  c.S.runs = [
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-2', status: 'done', endStatus: 'merged' }),
  ];
  c.S.selected = 0;
  c.S.focus = 'runs';
  c.S.search = { value: 'HEL-2' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.selected, 1);
  assert.equal(c.S.focus, 'runs');
  assert.equal(c.S.search, null);
});

test('submit-search with a match resolves against a title (changeName), not just the ticket id', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'failed', changeName: 'share-button-feature' })];
  c.S.selected = -1;
  c.S.search = { value: 'share-button' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.selected, 0);
  assert.equal(c.S.search, null);
});

test('submit-search with no match is a no-op — the prompt stays open, unchanged', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'failed' })];
  c.S.selected = 0;
  c.S.focus = 'runs';
  c.S.search = { value: 'zzz-no-such-match' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.deepEqual(c.S.search, { value: 'zzz-no-such-match' });
  assert.equal(c.S.selected, 0);
  assert.equal(c.S.focus, 'runs');
});

test('submit-search with an empty query is a no-op (matchesQuery treats empty as matching nothing)', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'failed' })];
  c.S.search = { value: '' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.deepEqual(c.S.search, { value: '' });
});

test('submit-search with S.search already null is a defensive no-op', () => {
  const c = searchCtx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'failed' })];
  c.S.search = null;
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.search, null);
});

test('submit-search resolves a QUEUED match\'s title via ctx.queuedTitles()', () => {
  const c = searchCtx({ queuedTitles: () => new Map([['HEL-77', 'a very specific queued title']]) });
  c.S.runs = [];
  c.S.queueState = { pending: ['HEL-77'], maxConcurrent: 1 };
  c.S.search = { value: 'very specific' };
  assert.equal(apply(c, { type: 'submit-search' }), true);
  assert.equal(c.S.focus, 'queue');
  assert.equal(c.S.queueFocus, 0);
});
