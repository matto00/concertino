'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fleetCtl = require('../lib/ui/controllers/fleet');
const queue = require('../lib/ui/queue');

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
  const S = {
    mode: 'fleet',
    runs: [], markDoneConfirm: null, addressFailureNotice: null,
    // CON-109: every fleet controller test constructs S through this one
    // helper, so the multi-select fields are always present — mirrors
    // app-state.js's own createAppState() default exactly, keeping this
    // fixture in lockstep with the real initial state.
    multiSelect: { failed: new Set(), queued: new Set() },
    bulkConfirm: null, bulkResult: null,
    queueState: null, queueSessionId: null, focus: 'runs', queueFocus: null,
    // CON-114: every fleet controller test constructs S through this one
    // helper, so the run-comparison fields are always present — mirrors
    // multiSelect's own comment just above.
    compareSelection: [], compareReturnMode: null,
    compareLeftScroll: 0, compareRightScroll: 0, compareFocus: 'left',
    // CON-107: every fleet controller test constructs S through this one
    // helper, so the METRICS escalation-history focus fields are always
    // present — mirrors multiSelect's/compareSelection's own comments above.
    metricsEscalationFocus: 0, escalationHistoryItem: null, escalationTicket: null,
  };
  return Object.assign({
    S,
    root: '/tmp/concertino-fake-root',
    session: { name: 'concertino' },
    // CON-109: the bulk force-start handler's own deps — real queue.js
    // (pure, fixture-only, no filesystem/tmux — see its own header comment)
    // and a fake queueCache.write/launcher, mirroring
    // controllers-launchpad.test.js's own precedent.
    launcher: {
      launch: (ticket, launchCommand) => ({ spawned: true, error: null }),
      launchSpec: (ticket, spec) => ({ spawned: true, error: null }),
    },
    deps: {
      submitTicket: () => ({ spawned: true, error: null }),
      writeOverrideEvent: () => {},
      queue,
      queueCache: { write: () => {} },
    },
    // CON-107: the fresh-every-call escalation history 'move-metrics-focus'/
    // 'open-historical-escalation' both re-derive. Defaults to empty —
    // overridden per-test (via `over`) with a fixture list; tests that need
    // the real pairing walk exercise metricsFor directly instead, in
    // test/fleet.test.js.
    metricsEscalationHistory: () => [],
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

// --- CON-109: bulk multi-select (design.md, tasks.md 9.1/9.2) ---------

// --- 'toggle-multi-select' -----------------------------------------------

test('toggle-multi-select adds the ticket to the section\'s Set when absent', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'toggle-multi-select', section: 'failed', ticket: 'HEL-9' }), true);
  assert.deepEqual([...c.S.multiSelect.failed], ['HEL-9']);
  assert.deepEqual([...c.S.multiSelect.queued], []);
});

test('toggle-multi-select removes the ticket from the section\'s Set when already present', () => {
  const c = ctx({});
  c.S.multiSelect.failed.add('HEL-9');
  assert.equal(apply(c, { type: 'toggle-multi-select', section: 'failed', ticket: 'HEL-9' }), true);
  assert.deepEqual([...c.S.multiSelect.failed], []);
});

test('toggle-multi-select keeps FAILED and QUEUED sets fully independent', () => {
  const c = ctx({});
  apply(c, { type: 'toggle-multi-select', section: 'failed', ticket: 'HEL-9' });
  apply(c, { type: 'toggle-multi-select', section: 'queued', ticket: 'HEL-77' });
  assert.deepEqual([...c.S.multiSelect.failed], ['HEL-9']);
  assert.deepEqual([...c.S.multiSelect.queued], ['HEL-77']);
});

// --- 'open-bulk-*-confirm' / 'cancel-bulk-confirm' ------------------------

test('open-bulk-address-confirm sets S.bulkConfirm with section/kind/tickets', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'open-bulk-address-confirm', tickets: ['HEL-1', 'HEL-2'] }), true);
  assert.deepEqual(c.S.bulkConfirm, { section: 'failed', kind: 'address', tickets: ['HEL-1', 'HEL-2'] });
});

test('open-bulk-mark-done-confirm sets S.bulkConfirm with section/kind/tickets', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'open-bulk-mark-done-confirm', tickets: ['HEL-1'] }), true);
  assert.deepEqual(c.S.bulkConfirm, { section: 'failed', kind: 'mark-done', tickets: ['HEL-1'] });
});

test('open-bulk-force-start-confirm sets S.bulkConfirm with section/kind/tickets', () => {
  const c = ctx({});
  assert.equal(apply(c, { type: 'open-bulk-force-start-confirm', tickets: ['HEL-3'] }), true);
  assert.deepEqual(c.S.bulkConfirm, { section: 'queued', kind: 'force-start', tickets: ['HEL-3'] });
});

test('cancel-bulk-confirm clears S.bulkConfirm AND the corresponding multi-select set, without acting on any ticket', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...a) => calls.push(a), queue, queueCache: { write: () => {} } } });
  c.S.multiSelect.failed = new Set(['HEL-1', 'HEL-2']);
  c.S.bulkConfirm = { section: 'failed', kind: 'mark-done', tickets: ['HEL-1', 'HEL-2'] };
  assert.equal(apply(c, { type: 'cancel-bulk-confirm' }), true);
  assert.equal(c.S.bulkConfirm, null);
  assert.deepEqual([...c.S.multiSelect.failed], []);
  assert.equal(calls.length, 0);
});

test('cancel-bulk-confirm clears the QUEUED multi-select set for a force-start bulkConfirm', () => {
  const c = ctx({});
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.bulkConfirm = { section: 'queued', kind: 'force-start', tickets: ['HEL-3'] };
  assert.equal(apply(c, { type: 'cancel-bulk-confirm' }), true);
  assert.equal(c.S.bulkConfirm, null);
  assert.deepEqual([...c.S.multiSelect.queued], []);
});

// --- 'confirm-bulk-mark-done' ---------------------------------------------

test('confirm-bulk-mark-done: full success writes a run.override for every ticket and reports all ok:true', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...a) => calls.push(a), queue, queueCache: { write: () => {} } } });
  c.S.runs = [run({ ticket: 'HEL-1' }), run({ ticket: 'HEL-2' }), run({ ticket: 'HEL-3' })];
  c.S.multiSelect.failed = new Set(['HEL-1', 'HEL-2', 'HEL-3']);
  c.S.bulkConfirm = { section: 'failed', kind: 'mark-done', tickets: ['HEL-1', 'HEL-2', 'HEL-3'] };
  assert.equal(apply(c, { type: 'confirm-bulk-mark-done' }), true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((a) => a[1]).sort(), ['HEL-1', 'HEL-2', 'HEL-3']);
  assert.equal(c.S.bulkConfirm, null);
  assert.deepEqual([...c.S.multiSelect.failed], []);
  assert.equal(c.S.bulkResult.kind, 'mark-done');
  assert.equal(c.S.bulkResult.results.length, 3);
  assert.ok(c.S.bulkResult.results.every((r) => r.ok === true));
});

test('confirm-bulk-mark-done: a ticket no longer in S.runs is reported ok:false, not silently dropped', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: () => ({ spawned: true }), writeOverrideEvent: (...a) => calls.push(a), queue, queueCache: { write: () => {} } } });
  c.S.runs = [run({ ticket: 'HEL-1' })]; // HEL-2 already resolved some other way
  c.S.bulkConfirm = { section: 'failed', kind: 'mark-done', tickets: ['HEL-1', 'HEL-2'] };
  assert.equal(apply(c, { type: 'confirm-bulk-mark-done' }), true);
  assert.equal(calls.length, 1, 'only the still-present ticket is written');
  assert.equal(c.S.bulkResult.results.length, 2, 'both tickets are still reported, none dropped');
  const byTicket = Object.fromEntries(c.S.bulkResult.results.map((r) => [r.ticket, r]));
  assert.equal(byTicket['HEL-1'].ok, true);
  assert.equal(byTicket['HEL-2'].ok, false);
  assert.match(byTicket['HEL-2'].error, /stale|no longer present/);
});

test('confirm-bulk-mark-done with no S.bulkConfirm is a defensive no-op', () => {
  const c = ctx({});
  c.S.bulkConfirm = null;
  assert.equal(apply(c, { type: 'confirm-bulk-mark-done' }), true);
  assert.equal(c.S.bulkResult, null);
});

// --- 'confirm-bulk-address' -----------------------------------------------

test('confirm-bulk-address: partial failure (a spawn error) is reported per-row, not swallowed into one summary', () => {
  const calls = [];
  const c = ctx({
    deps: {
      submitTicket: (ticket) => {
        calls.push(ticket);
        return ticket === 'HEL-2' ? { spawned: false, error: 'tmux window creation error' } : { spawned: true, error: null };
      },
      writeOverrideEvent: () => {}, queue, queueCache: { write: () => {} },
    },
  });
  c.S.runs = [run({ ticket: 'HEL-1' }), run({ ticket: 'HEL-2' })];
  c.S.bulkConfirm = { section: 'failed', kind: 'address', tickets: ['HEL-1', 'HEL-2'] };
  assert.equal(apply(c, { type: 'confirm-bulk-address' }), true);
  assert.deepEqual(calls, ['HEL-1', 'HEL-2'], 'HEL-2\'s failure does not roll back or skip HEL-1\'s spawn');
  const byTicket = Object.fromEntries(c.S.bulkResult.results.map((r) => [r.ticket, r]));
  assert.equal(byTicket['HEL-1'].ok, true);
  assert.equal(byTicket['HEL-2'].ok, false);
  assert.match(byTicket['HEL-2'].error, /tmux window creation error/);
});

test('confirm-bulk-address: a non-claude-code ticket in the batch is reported ok:false with that reason', () => {
  const calls = [];
  const c = ctx({ deps: { submitTicket: (...a) => { calls.push(a); return { spawned: true }; }, writeOverrideEvent: () => {}, queue, queueCache: { write: () => {} } } });
  c.S.runs = [run({ ticket: 'HEL-1', harness: 'codex' })];
  c.S.bulkConfirm = { section: 'failed', kind: 'address', tickets: ['HEL-1'] };
  assert.equal(apply(c, { type: 'confirm-bulk-address' }), true);
  assert.equal(calls.length, 0, 'no tmux window created for a non-claude-code ticket');
  assert.equal(c.S.bulkResult.results[0].ok, false);
  assert.match(c.S.bulkResult.results[0].error, /codex/);
});

test('confirm-bulk-address clears bulkConfirm and multiSelect.failed', () => {
  const c = ctx({});
  c.S.runs = [run({ ticket: 'HEL-1' })];
  c.S.multiSelect.failed = new Set(['HEL-1']);
  c.S.bulkConfirm = { section: 'failed', kind: 'address', tickets: ['HEL-1'] };
  apply(c, { type: 'confirm-bulk-address' });
  assert.equal(c.S.bulkConfirm, null);
  assert.deepEqual([...c.S.multiSelect.failed], []);
});

// --- 'confirm-bulk-force-start' -------------------------------------------

test('confirm-bulk-force-start: full success admits every ticket from pending to inFlight and reports all ok:true', () => {
  const c = ctx({});
  c.S.queueState = queue.createQueue(['HEL-1', 'HEL-2', 'HEL-3'], 1, 'claude "/concertino-deliver {{TICKET}}"');
  c.S.multiSelect.queued = new Set(['HEL-1', 'HEL-2', 'HEL-3']);
  c.S.bulkConfirm = { section: 'queued', kind: 'force-start', tickets: ['HEL-1', 'HEL-2', 'HEL-3'] };
  assert.equal(apply(c, { type: 'confirm-bulk-force-start' }), true);
  assert.deepEqual(c.S.queueState.pending, []);
  assert.deepEqual([...c.S.queueState.inFlight].sort(), ['HEL-1', 'HEL-2', 'HEL-3']);
  assert.equal(c.S.bulkResult.kind, 'force-start');
  assert.ok(c.S.bulkResult.results.every((r) => r.ok === true));
  assert.equal(c.S.bulkConfirm, null);
  assert.deepEqual([...c.S.multiSelect.queued], []);
  assert.equal(c.S.focus, 'runs');
  assert.equal(c.S.queueFocus, null);
});

test('confirm-bulk-force-start: a ticket already admitted mid-batch (no longer pending) is reported, not double-started', () => {
  const c = ctx({});
  // HEL-2 already left `pending` — e.g. an ordinary tick() admitted it
  // between the confirmation opening and 'y' being pressed.
  c.S.queueState = queue.createQueue(['HEL-1', 'HEL-3'], 2, 'claude "/concertino-deliver {{TICKET}}"');
  c.S.queueState.inFlight.add('HEL-2');
  c.S.bulkConfirm = { section: 'queued', kind: 'force-start', tickets: ['HEL-1', 'HEL-2', 'HEL-3'] };
  assert.equal(apply(c, { type: 'confirm-bulk-force-start' }), true);
  const byTicket = Object.fromEntries(c.S.bulkResult.results.map((r) => [r.ticket, r]));
  assert.equal(byTicket['HEL-1'].ok, true);
  assert.equal(byTicket['HEL-2'].ok, false);
  assert.match(byTicket['HEL-2'].error, /no longer queued/);
  assert.equal(byTicket['HEL-3'].ok, true);
  // HEL-2 was not started a second time — inFlight has it exactly once.
  assert.equal([...c.S.queueState.inFlight].filter((t) => t === 'HEL-2').length, 1);
});

test('confirm-bulk-force-start: admits tickets IN LIST ORDER, each reflected in inFlight/maxConcurrent bookkeeping before the next is attempted', () => {
  const order = [];
  const c = ctx({
    launcher: {
      launch: (ticket) => { order.push(ticket); return { spawned: true, error: null }; },
      launchSpec: (ticket) => { order.push(ticket); return { spawned: true, error: null }; },
    },
  });
  c.S.queueState = queue.createQueue(['HEL-1', 'HEL-2'], 2, 'claude "/concertino-deliver {{TICKET}}"');
  c.S.bulkConfirm = { section: 'queued', kind: 'force-start', tickets: ['HEL-1', 'HEL-2'] };
  apply(c, { type: 'confirm-bulk-force-start' });
  assert.deepEqual(order, ['HEL-1', 'HEL-2']);
});

test('confirm-bulk-force-start: no active queue reports every ticket ok:false without throwing', () => {
  const c = ctx({});
  c.S.queueState = null;
  c.S.bulkConfirm = { section: 'queued', kind: 'force-start', tickets: ['HEL-1'] };
  assert.equal(apply(c, { type: 'confirm-bulk-force-start' }), true);
  assert.equal(c.S.bulkResult.results[0].ok, false);
});

// --- focus-transition clearing (design.md Risks / tasks.md 7.1/7.2) -------

test('focus-queue clears S.multiSelect.failed (leaving FAILED focus for QUEUED)', () => {
  const c = ctx({});
  c.S.multiSelect.failed = new Set(['HEL-1']);
  c.S.runs = [];
  assert.equal(apply(c, { type: 'focus-queue', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.failed], []);
});

test('focus-quickstart clears S.multiSelect.failed (leaving FAILED focus for QUICK START)', () => {
  const c = ctx({});
  c.S.multiSelect.failed = new Set(['HEL-1']);
  c.S.runs = [];
  assert.equal(apply(c, { type: 'focus-quickstart', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.failed], []);
});

test('exit-queue-focus clears S.multiSelect.queued', () => {
  const c = ctx({});
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.focus = 'queue';
  assert.equal(apply(c, { type: 'exit-queue-focus' }), true);
  assert.deepEqual([...c.S.multiSelect.queued], []);
  assert.equal(c.S.focus, 'runs');
});

// --- evaluator cycle-1 change request 1: 'jump'/'focus-quickstart' also
// clear S.multiSelect.queued when leaving 'queue' focus through a path
// OTHER than Escape ('exit-queue-focus') — a digit-jump to a
// FAILED/RUNNING/DONE section, or a mouse click on a mapped run row
// (watch.js's onKey), both dispatch 'jump' unconditional on S.focus.
// 'focus-quickstart' is reachable from either 'runs' or 'queue' the same way.

test('jump clears S.multiSelect.queued when leaving \'queue\' focus (digit-jump/mouse-click path, not just Escape)', () => {
  // 'jump' resolves through applyJumpAction -> scrollToShow, which reaches
  // for ctx.computeScreenRows() — provided here the same way searchCtx()
  // (above) already does for 'submit-search''s own jump resolution.
  const c = ctx({ computeScreenRows: () => 20 });
  c.S.focus = 'queue';
  c.S.queueFocus = 1;
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.runs = [run({ ticket: 'HEL-1', status: 'failed' })];
  assert.equal(apply(c, { type: 'jump', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.queued], []);
  assert.equal(c.S.focus, 'runs');
});

test('jump leaving \'runs\' focus (the ordinary case) does not touch S.multiSelect.queued — nothing to clear', () => {
  const c = ctx({ computeScreenRows: () => 20 });
  c.S.focus = 'runs';
  c.S.multiSelect.queued = new Set(['HEL-3']); // pre-existing, unrelated to this transition
  c.S.runs = [run({ ticket: 'HEL-1', status: 'failed' })];
  assert.equal(apply(c, { type: 'jump', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.queued], ['HEL-3'],
    'a queued selection made from a DIFFERENT focus (queue) that was never re-entered must survive an ordinary runs-focused jump');
});

test('jump clears S.multiSelect.queued but leaves S.multiSelect.failed alone — the two sets stay independent even mid-transition', () => {
  const c = ctx({ computeScreenRows: () => 20 });
  c.S.focus = 'queue';
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.multiSelect.failed = new Set(['HEL-9']);
  c.S.runs = [run({ ticket: 'HEL-1', status: 'failed' })];
  apply(c, { type: 'jump', index: 0 });
  assert.deepEqual([...c.S.multiSelect.queued], []);
  assert.deepEqual([...c.S.multiSelect.failed], ['HEL-9']);
});

test('focus-quickstart clears S.multiSelect.queued when leaving \'queue\' focus for QUICK START', () => {
  const c = ctx({});
  c.S.focus = 'queue';
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.runs = [];
  assert.equal(apply(c, { type: 'focus-quickstart', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.queued], []);
  assert.equal(c.S.focus, 'quickstart');
});

test('focus-quickstart still clears S.multiSelect.failed when leaving \'runs\' focus for QUICK START (pre-existing behavior, unregressed)', () => {
  const c = ctx({});
  c.S.focus = 'runs';
  c.S.multiSelect.failed = new Set(['HEL-9']);
  c.S.multiSelect.queued = new Set(['HEL-3']); // untouched by this 'runs'-focused transition
  c.S.runs = [];
  assert.equal(apply(c, { type: 'focus-quickstart', index: 0 }), true);
  assert.deepEqual([...c.S.multiSelect.failed], []);
  assert.deepEqual([...c.S.multiSelect.queued], ['HEL-3']);
});

test('focus-quickstart from \'queue\' focus clears BOTH sets: multiSelect.failed unconditionally, multiSelect.queued because it is the one actually being left', () => {
  const c = ctx({});
  c.S.focus = 'queue';
  c.S.multiSelect.failed = new Set(['HEL-9']); // a leftover from an earlier, unrelated FAILED session
  c.S.multiSelect.queued = new Set(['HEL-3']);
  c.S.runs = [];
  apply(c, { type: 'focus-quickstart', index: 0 });
  assert.deepEqual([...c.S.multiSelect.failed], []);
  assert.deepEqual([...c.S.multiSelect.queued], []);
});

// --- CON-107: METRICS' recent-escalations history focus/detail view --------

function historyEntry(over) {
  return Object.assign({
    ticket: 'HEL-9', role: 'evaluator', question: 'drop the column?',
    options: ['approve', 'deny'], subQuestions: undefined,
    raisedAt: 1000, resolved: false, decision: null, resolvedAt: null, timedOut: false,
  }, over);
}

test('focus-metrics sets S.focus/S.metricsEscalationFocus and clears S.multiSelect.failed', () => {
  const c = ctx({});
  c.S.multiSelect.failed = new Set(['HEL-1']);
  c.S.runs = [];
  assert.equal(apply(c, { type: 'focus-metrics', index: 0 }), true);
  assert.equal(c.S.focus, 'metrics');
  assert.equal(c.S.metricsEscalationFocus, 0);
  assert.deepEqual([...c.S.multiSelect.failed], []);
});

test('move-metrics-focus moves the cursor, clamped to the freshly re-derived history length', () => {
  const c = ctx({ metricsEscalationHistory: () => [historyEntry({}), historyEntry({ ticket: 'HEL-10' })] });
  c.S.focus = 'metrics';
  c.S.metricsEscalationFocus = 0;
  assert.equal(apply(c, { type: 'move-metrics-focus', delta: 1 }), true);
  assert.equal(c.S.metricsEscalationFocus, 1);
  // Clamped at the top of a 2-entry list — delta past the end stays put.
  assert.equal(apply(c, { type: 'move-metrics-focus', delta: 1 }), true);
  assert.equal(c.S.metricsEscalationFocus, 1);
  assert.equal(apply(c, { type: 'move-metrics-focus', delta: -1 }), true);
  assert.equal(c.S.metricsEscalationFocus, 0);
});

test('move-metrics-focus with an empty history is a no-op (draw()\'s own re-clamp keeps the cursor at 0)', () => {
  const c = ctx({ metricsEscalationHistory: () => [] });
  c.S.focus = 'metrics';
  c.S.metricsEscalationFocus = 0;
  assert.equal(apply(c, { type: 'move-metrics-focus', delta: 1 }), true);
  assert.equal(c.S.metricsEscalationFocus, 0);
});

test('exit-metrics-focus returns focus to \'runs\' without hiding the panel', () => {
  const c = ctx({});
  c.S.focus = 'metrics';
  assert.equal(apply(c, { type: 'exit-metrics-focus' }), true);
  assert.equal(c.S.focus, 'runs');
});

test('open-historical-escalation on a still-live entry dispatches through the exact same open-escalation handling', () => {
  const c = ctx({ metricsEscalationHistory: () => [historyEntry({ resolved: false })] });
  c.S.runs = [run({ ticket: 'HEL-9', status: 'needs-you', escalation: { question: 'q', options: [] } })];
  assert.equal(apply(c, { type: 'open-historical-escalation', index: 0 }), true);
  assert.equal(c.S.mode, 'escalation');
  assert.equal(c.S.escalationTicket, 'HEL-9');
  // Never the historical branch for a still-live entry.
  assert.equal(c.S.escalationHistoryItem, null);
});

test('open-historical-escalation on a resolved entry opens the read-only historical view, never reusing escalationTicket', () => {
  const entry = historyEntry({ resolved: true, decision: 'approve', resolvedAt: 2000 });
  const c = ctx({ metricsEscalationHistory: () => [entry] });
  assert.equal(apply(c, { type: 'open-historical-escalation', index: 0 }), true);
  assert.equal(c.S.mode, 'escalation');
  assert.equal(c.S.escalationHistoryItem, entry);
  assert.equal(c.S.escalationTicket, null, 'a historical view must never reuse escalationTicket');
});

test('open-historical-escalation with a stale/out-of-range index is a no-op', () => {
  const c = ctx({ metricsEscalationHistory: () => [historyEntry({})] });
  const before = Object.assign({}, c.S);
  assert.equal(apply(c, { type: 'open-historical-escalation', index: 99 }), true);
  assert.equal(c.S.mode, before.mode);
  assert.equal(c.S.escalationHistoryItem, null);
});

// --- CON-114: run-comparison marking + opening the compare screen ----------

test('toggle-compare-select marks a DONE run', () => {
  const c = ctx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'done' })];
  apply(c, { type: 'toggle-compare-select', ticket: 'HEL-9' });
  assert.deepEqual(c.S.compareSelection, ['HEL-9']);
});

test('toggle-compare-select is a no-op on a non-DONE run', () => {
  const c = ctx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'running' })];
  apply(c, { type: 'toggle-compare-select', ticket: 'HEL-9' });
  assert.deepEqual(c.S.compareSelection, []);
});

test('toggle-compare-select unmarks an already-marked run', () => {
  const c = ctx({});
  c.S.runs = [run({ ticket: 'HEL-9', status: 'done' })];
  c.S.compareSelection = ['HEL-9'];
  apply(c, { type: 'toggle-compare-select', ticket: 'HEL-9' });
  assert.deepEqual(c.S.compareSelection, []);
});

test('open-compare sets mode to compare and records the origin as fleet', () => {
  const c = ctx({});
  c.S.mode = 'fleet';
  c.S.compareSelection = ['HEL-1', 'HEL-2'];
  assert.equal(apply(c, { type: 'open-compare' }), true);
  assert.equal(c.S.mode, 'compare');
  assert.equal(c.S.compareReturnMode, 'fleet');
});

test('open-compare resets each column\'s scroll offset and focus on entry', () => {
  const c = ctx({});
  c.S.mode = 'fleet';
  c.S.compareSelection = ['HEL-1', 'HEL-2'];
  c.S.compareLeftScroll = 4;
  c.S.compareRightScroll = 4;
  c.S.compareFocus = 'right';
  apply(c, { type: 'open-compare' });
  assert.equal(c.S.compareLeftScroll, 0);
  assert.equal(c.S.compareRightScroll, 0);
  assert.equal(c.S.compareFocus, 'left');
});

test('open-compare with fewer than two marked is a no-op (defensive re-check)', () => {
  const c = ctx({});
  c.S.mode = 'fleet';
  c.S.compareSelection = ['HEL-1'];
  apply(c, { type: 'open-compare' });
  assert.equal(c.S.mode, 'fleet');
});
