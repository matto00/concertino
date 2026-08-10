'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderFleet, renderFleetRowMap, handleKey, CONFIRM_RESTORED_QUEUE_KEY, visibleWindow, computeWindow,
  sectionJumpTargets, buildSections, QUICK_START_COUNT,
  metricsFor, metricsColumnLines, searchKey,
} = require('../lib/ui/screens/fleet');
const { renderStackedSection } = require('../lib/ui/screens/fleet');
const { reduce, PHASE_ORDER } = require('../lib/ui/reducer');
const f = require('../lib/ui/format');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({
    ticket: 'HEL-1', project: 'helio', changeName: 'a-change', branch: null,
    worktree: null, devPort: null, backendPort: null, harness: null, model: null,
    phase: null, cycle: null, gates: [], lastVerdict: null, escalation: null,
    escalationStale: false, events: [], startedAt: null, endedAt: null,
    endStatus: null, elapsedMs: 60000, window: { alive: true, idleMs: 0 },
    status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

const OPTS = { cols: 78, selected: 0 };

test('renders a header with the project and counts', () => {
  const out = renderFleet([run({})], OPTS);
  assert.match(out, /helio/);
  assert.match(out, /1 run/);
});

test('groups escalated runs under NEEDS YOU', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331', status: 'running' }),
  ], OPTS);
  assert.match(out, /NEEDS YOU/);
  assert.ok(out.indexOf('HEL-338') < out.indexOf('HEL-331'), 'escalation must come first');
  assert.match(out, /add zod@3\?/);
});

test('shows phase and cycle for fully instrumented runs', () => {
  const out = renderFleet([run({ phase: 'Evaluation', cycle: 2, gates: [
    { name: 'test', status: 'pass' }, { name: 'lint', status: 'pass' },
    { name: 'build', status: 'fail' },
  ] })], OPTS);
  assert.match(out, /Evaluation/);
  assert.match(out, /cycle 2/);
  assert.match(out, /2\/3/);
});

test('a partially instrumented run says so instead of inventing a phase', () => {
  const out = renderFleet([run({ telemetry: 'partial', phase: null })], OPTS);
  assert.match(out, /phase unknown/);
  assert.doesNotMatch(out, /Evaluation/);
});

// --- CON-77: spawn visibility -----------------------------------------------

test('a live, spawned-but-not-started run reads "starting" with elapsed time, not "no telemetry"', () => {
  const out = renderFleet([run({
    telemetry: 'none', phase: null, status: 'running',
    spawnedAt: 12000, startingMs: 12000,
    window: { alive: true, idleMs: 0 },
  })], OPTS);
  assert.match(out, /starting/);
  assert.doesNotMatch(out, /no telemetry/);
});

test('an uninstrumented run reports no telemetry and its idle time', () => {
  const out = renderFleet([run({ telemetry: 'none', phase: null, window: { alive: true, idleMs: 11 * 60000 } })], OPTS);
  assert.match(out, /no telemetry/);
  assert.match(out, /idle 11m/);
});

test('a dead, spawn-only run reads "failed to start", not "window exited"', () => {
  const out = renderFleet([run({
    telemetry: 'none', phase: null, status: 'failed',
    spawnedAt: 1, startingMs: null,
    endedAt: null, endStatus: null,
    window: { alive: false, idleMs: null },
  })], OPTS);
  assert.match(out, /failed to start/);
  assert.doesNotMatch(out, /window exited/);
});

test('a stale escalation on a dead run renders safely — its question no longer surfaces on the dense FAILED row', () => {
  // FAILED's own row is now single-line (lazygit-layout density pass) and no
  // longer shows a live/stale escalation's question text at all — that
  // level of detail belongs to drill-down now, not the summary row. With no
  // endStatus/endedAt (this fixture never sets either), the row falls back
  // to the same "window exited" the dead-window case already reads.
  const out = renderFleet([run({
    status: 'failed', escalationStale: true,
    escalation: { question: 'q', options: [], raisedAt: 1 },
  })], OPTS);
  assert.match(out, /window exited/);
  assert.doesNotMatch(out, /\bq\b.*stale|stale.*\bq\b/);
});

test('malformed events are surfaced in the footer', () => {
  const out = renderFleet([run({ malformed: 2 })], OPTS);
  assert.match(out, /2 malformed events/);
});

test('a queued-launch failure is surfaced in the footer — otherwise invisible, since nothing else watches the launch-pad queue', () => {
  const out = renderFleet([run({})], { ...OPTS, queueNotice: 'could not start CON-9: tmux exited 1' });
  assert.match(out, /could not start CON-9/);
});

// --- an active queue is persistently visible, not just its failures --------
// Before this fix, only queueNotice (a FAILURE string) ever reached the
// footer — launching a five-ticket sequential batch and returning to the
// fleet view showed one RUNNING row and nothing indicating four more were
// queued.

test('an active queue is shown persistently in the footer, not only on a failure', () => {
  const queueState = { pending: ['CON-2', 'CON-3', 'CON-4'], inFlight: new Set(['CON-1']) };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.match(out, /1 running/);
  assert.match(out, /3 queued/);
});

test('an idle/empty queue (nothing pending, nothing in flight) shows no queue line', () => {
  const queueState = { pending: [], inFlight: new Set() };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.doesNotMatch(out, /queued/);
});

test('no queueState at all renders exactly as before', () => {
  const out = renderFleet([run({})], OPTS);
  assert.doesNotMatch(out, /queued/);
});

// --- QUEUED section (CON-28) ------------------------------------------------
// A ticket sitting in queueState.pending has no run object behind it — no run
// directory, no window, no event log — so the reducer never sees it and, before
// this section existed, it rendered as nothing at all: a queued batch of five
// looked identical to having mis-selected and queued only one.

function manyQueued(n, prefix) {
  return Array.from({ length: n }, (_, i) => (prefix || 'CON-') + (300 + i));
}

test('a non-empty queue renders a QUEUED section, titled with the pending count and maxConcurrent', () => {
  const queueState = { pending: ['CON-2', 'CON-3', 'CON-4'], inFlight: new Set(['CON-1']), maxConcurrent: 1 };
  const out = renderFleet([run({ ticket: 'CON-1', status: 'running' })], { ...OPTS, queueState });
  assert.match(out, /QUEUED \(3, running 1 at a time\)/);
  // statusKey: 'queued' wires the title through f.STATUS_COLOUR — without it
  // the title would silently render uncoloured (STATUS_COLOUR[key] || no-op).
  const escapedTitle = f.STATUS_COLOUR.queued('QUEUED (3, running 1 at a time)').replace(/[[\]()]/g, '\\$&');
  assert.match(out, new RegExp(escapedTitle));
});

test('QUEUED never renders when queueState is absent or pending is empty', () => {
  const noQueue = renderFleet([run({})], OPTS);
  assert.doesNotMatch(noQueue, /QUEUED/);

  const emptyQueue = renderFleet([run({})],
    { ...OPTS, queueState: { pending: [], inFlight: new Set(), maxConcurrent: 1 } });
  assert.doesNotMatch(emptyQueue, /QUEUED/);
});

test('a queued row shows position, ticket id, and the cached title when present in queuedTitles', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(), maxConcurrent: 1 };
  const queuedTitles = new Map([['CON-2', 'Add zod validation']]);
  const out = renderFleet([run({})], { ...OPTS, queueState, queuedTitles });
  assert.match(out, /1\. CON-2 {2}Add zod validation/);
  // CON-3 has no cache entry: id only, no fabricated title.
  const con3Line = out.split('\n').find((l) => l.includes('CON-3'));
  assert.ok(con3Line, 'CON-3 should still render');
  assert.match(con3Line, /2\. CON-3\s/);
  assert.doesNotMatch(con3Line, /Add zod validation/);
});

test('a queued row with no cached title falls back to id-only — no fabricated status, phase, elapsed, or bar', () => {
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 2 };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  const line = out.split('\n').find((l) => l.includes('CON-9'));
  assert.ok(line);
  assert.match(line, /1\. CON-9\s/);
  assert.doesNotMatch(line, /running|failed|done|phase|elapsed|▪|░|\d+[sm]\b/);
});

test('QUEUED trims under a height budget identically to FAILED/DONE, and is never treated as pinned', () => {
  const queueState = { pending: manyQueued(20), inFlight: new Set(), maxConcurrent: 1 };
  const out = renderFleet([run({ ticket: 'HEL-1', status: 'running' })],
    { cols: 78, rows: 13, selected: 0, queueState });
  const shownQueued = out.split('\n').filter((l) => /CON-3\d\d/.test(l)).length;
  assert.ok(shownQueued <= 5, `expected at most 5 (MAX_FINISHED) queued rows shown, got ${shownQueued}`);
  assert.match(out, /… and \d+ more/, 'a trimmed QUEUED section must still show an overflow line');
});

test('a queued row is never rendered with the ▸ selection marker, for any valid selected value', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
  ];
  const queueState = { pending: ['CON-90', 'CON-91'], inFlight: new Set(), maxConcurrent: 1 };
  for (let selected = 0; selected < runs.length; selected++) {
    const out = plain(renderFleet(runs, { cols: 100, selected, queueState }));
    const queuedLines = out.split('\n').filter((l) => /CON-9[01]/.test(l));
    assert.ok(queuedLines.length > 0, 'expected the queued rows to render');
    for (const line of queuedLines) {
      assert.ok(!line.includes('▸'), `a queued row must never carry the selection marker: ${line}`);
    }
  }
});

// --- CON-29: a queue restored from a previous session shows a distinct,
// unmissable "resumed — press <key> to continue" affordance, since it is
// NOT ticking and nothing in it will launch until the operator confirms.

test('a restored, unconfirmed queue renders the resume affordance naming the confirm key', () => {
  const queueState = {
    pending: ['CON-2', 'CON-3'], inFlight: new Set(['CON-1']), maxConcurrent: 1, confirmed: false,
    restoredFrom: { sessionId: 's', writtenAt: 1 },
  };
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })], { ...OPTS, queueState }));
  assert.match(out, /resumed from a previous session/);
  assert.match(out, new RegExp('press ' + CONFIRM_RESTORED_QUEUE_KEY + ' to continue'));
  // The pending ticket ids are still listed exactly as a normal QUEUED
  // section would list them (same rows, same lookup) — the affordance is
  // additive, not a replacement rendering.
  assert.match(out, /QUEUED/);
  assert.match(out, /CON-2/);
  assert.match(out, /CON-3/);
});

test('a normal, same-session (confirmed) queue never shows the resume affordance', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1, confirmed: true };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.doesNotMatch(out, /resumed from a previous session/);
});

test('a queueState with no `confirmed` field at all (pre-CON-29 shape) never shows the resume affordance', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.doesNotMatch(out, /resumed from a previous session/);
});

// --- launch plan's "start now: no" toggle: a held (not restored) queue -----

test('a deliberately held queue (confirmed: false, no restoredFrom) says "held", not "resumed from a previous session"', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1, confirmed: false };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.doesNotMatch(out, /resumed from a previous session/);
  assert.match(out, new RegExp('held — press ' + CONFIRM_RESTORED_QUEUE_KEY + ' to start'));
});

test('the confirm key starts a held (not restored) queue exactly like a restored one', () => {
  const s = state({ queueState: { pending: ['CON-2'], inFlight: new Set(), confirmed: false } });
  assert.deepEqual(handleKey(CONFIRM_RESTORED_QUEUE_KEY, s), { type: 'confirm-restored-queue' });
});

test('an inFlight-only restored queue (pending already fully drained) still shows the resume affordance', () => {
  const queueState = {
    pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1, confirmed: false,
    restoredFrom: { sessionId: 's', writtenAt: 1 },
  };
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })], { ...OPTS, queueState }));
  assert.match(out, /resumed from a previous session/);
});

// --- CON-37: completed-during-downtime notice — independent of queueState --

test('a restoreNotice renders even when queueState is null — nothing left to restore, but something finished during the downtime', () => {
  const out = renderFleet([run({})], {
    ...OPTS,
    cols: 100, // wide enough that the truncated line still contains both ids
    queueState: null,
    restoreNotice: '2 ticket(s) completed while you were away and were not restored: CON-12, CON-14',
  });
  assert.match(out, /completed while you were away/);
  assert.match(out, /CON-12/);
  assert.match(out, /CON-14/);
  assert.doesNotMatch(out, /resumed from a previous session/);
});

test('a restoreNotice too long for the available width is truncated, same as queueNotice already is', () => {
  const longIds = Array.from({ length: 20 }, (_, i) => 'CON-' + (300 + i)).join(', ');
  const out = renderFleet([run({})], {
    ...OPTS,
    queueState: null,
    restoreNotice: `20 ticket(s) completed while you were away and were not restored: ${longIds}`,
  });
  const line = out.split('\n').find((l) => l.includes('completed while you were away'));
  assert.ok(line, 'expected a truncated restoreNotice line to still render');
  assert.doesNotMatch(line, /CON-319/, 'the tail of the id list should be truncated away at this width');
});

test('a normal restored queue with no restoreNotice shows the resume affordance but no completed-during-downtime line', () => {
  const queueState = {
    pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1, confirmed: false,
    restoredFrom: { sessionId: 's', writtenAt: 1 },
  };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  assert.match(out, /resumed from a previous session/);
  assert.doesNotMatch(out, /completed while you were away/);
});

test('a restoreNotice and the resume affordance both render together when a queue partially restores', () => {
  const queueState = {
    pending: ['CON-3'], inFlight: new Set(), maxConcurrent: 1, confirmed: false,
    restoredFrom: { sessionId: 's', writtenAt: 1 },
  };
  const out = renderFleet([run({})], {
    ...OPTS,
    queueState,
    restoreNotice: '1 ticket(s) completed while you were away and were not restored: CON-12',
  });
  assert.match(out, /resumed from a previous session/);
  assert.match(out, /completed while you were away/);
  assert.match(out, /CON-12/);
});

test('no restoreNotice at all renders exactly as before — no completed-during-downtime line', () => {
  const out = renderFleet([run({})], OPTS);
  assert.doesNotMatch(out, /completed while you were away/);
});

test('pressing the confirm key with a restored unconfirmed queue on screen emits confirm-restored-queue', () => {
  const s = state({ queueState: { pending: ['CON-2'], inFlight: new Set(), confirmed: false } });
  assert.deepEqual(handleKey(CONFIRM_RESTORED_QUEUE_KEY, s), { type: 'confirm-restored-queue' });
});

test('the confirm key does nothing when there is no restored-unconfirmed queue on screen', () => {
  assert.equal(handleKey(CONFIRM_RESTORED_QUEUE_KEY, state({})), null);
  const confirmedQueue = state({ queueState: { pending: ['CON-2'], inFlight: new Set(), confirmed: true } });
  assert.equal(handleKey(CONFIRM_RESTORED_QUEUE_KEY, confirmedQueue), null);
});

// --- row-index safety: QUEUED must never shift what runs[selected] resolves to
// This is the ticket's primary hazard: queued rows have no run object, so
// inserting them naively would silently shift the index of every row below
// them — selecting a FAILED/DONE row would then attach to, kill, or restart
// the WRONG ticket. QUEUED is `unselectable`, so the shared index counter must
// skip it entirely (design.md Decision 1).

test('inserting a non-empty QUEUED section never perturbs which run a FAILED/DONE row below it resolves to', () => {
  // Array order mirrors the canonical section order (FAILED, RUNNING, DONE —
  // NEEDS YOU is empty here) so `runs[selected]` lines up with the flat walk
  // position `selected` renders at.
  const runs = [
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100 }),
  ];
  const queueState = { pending: ['CON-9', 'CON-10'], inFlight: new Set(), maxConcurrent: 1 };

  for (let selected = 0; selected < runs.length; selected++) {
    const withoutQueue = plain(renderFleet(runs, { cols: 100, selected }));
    const withQueue = plain(renderFleet(runs, { cols: 100, selected, queueState }));

    const markedWithout = withoutQueue.split('\n').filter((l) => l.includes('▸'));
    const markedWith = withQueue.split('\n').filter((l) => l.includes('▸'));

    assert.equal(markedWithout.length, 1, `selected:${selected} (no queue) produced ${markedWithout.length} markers`);
    assert.equal(markedWith.length, 1, `selected:${selected} (with queue) produced ${markedWith.length} markers`);
    assert.ok(markedWithout[0].includes(runs[selected].ticket));
    assert.ok(markedWith[0].includes(runs[selected].ticket),
      `selected:${selected} with QUEUED present should still mark ${runs[selected].ticket}, ` +
      `got: ${markedWith[0]}`);
  }
});

// --- quitting with a queue still active warns instead of discarding it -----

test('q with tickets still queued asks for confirmation via handleKey, not an immediate quit', () => {
  const s = state({ queueState: { pending: ['CON-2'], inFlight: new Set(['CON-1']) } });
  assert.deepEqual(handleKey('q', s), { type: 'request-quit' });
});

test('q with an empty/idle queue still quits immediately — nothing would be lost', () => {
  const s = state({ queueState: { pending: [], inFlight: new Set() } });
  assert.deepEqual(handleKey('q', s), { type: 'quit' });
});

test('q with no queue at all quits immediately, unchanged from before this fix', () => {
  assert.deepEqual(handleKey('q', state({})), { type: 'quit' });
});

test('the quit-confirmation warning renders the remaining count and the two ways out', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(['CON-1']) };
  const out = plain(renderFleet([run({})], { ...OPTS, queueState, quitConfirm: true }));
  assert.match(out, /quit with 3 ticket/);
  assert.match(out, /q confirm quit/);
  assert.match(out, /any other key.*cancel/);
});

test('while the quit-confirmation is up, a repeated q actually quits', () => {
  const s = state({ quitConfirm: true, queueState: { pending: [], inFlight: new Set() } });
  assert.deepEqual(handleKey('q', s), { type: 'quit' });
  assert.deepEqual(handleKey('\u0003', s), { type: 'quit' });
});

test('while the quit-confirmation is up, any other key cancels rather than acting normally', () => {
  const s = state({ quitConfirm: true, queueState: { pending: ['CON-2'], inFlight: new Set() } });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-quit' });
  assert.deepEqual(handleKey('\r', s), { type: 'cancel-quit' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-quit' });
});

test('an empty fleet renders a hint rather than a blank screen', () => {
  const out = renderFleet([], OPTS);
  assert.match(out, /no active runs/i);
});

// --- a crashed run must not read like a shipped one ------------------------

test('a delivered run and a failed run render under different headings', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done',   endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  assert.match(out, /FAILED/);
  assert.match(out, /DONE/);
  // FAILED sorts above DONE, and each ticket sits under its own heading.
  assert.ok(out.indexOf('FAILED') < out.indexOf('HEL-2'), 'HEL-2 under FAILED');
  assert.ok(out.indexOf('HEL-2') < out.indexOf('DONE'), 'FAILED section comes first');
  assert.ok(out.indexOf('DONE') < out.indexOf('HEL-1'), 'HEL-1 under DONE');
});

test('buildSections lists FAILED right after NEEDS YOU, ahead of RUNNING — the canonical order every grid-mode task depends on', () => {
  const sections = buildSections(
    { needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [run({ ticket: 'HEL-2', status: 'failed' })], done: [] },
    null,
    {},
  );
  const kinds = sections.map((s) => s.kind);
  // 'quickstart' is now unconditionally present (CON-56: no longer gated
  // behind a visibility flag) between 'running' and 'done'.
  assert.deepEqual(kinds, ['needs-you', 'failed', 'running', 'quickstart', 'done']);
});

// --- DONE rows compare delivery time against this repo's own average -------

test('a delivered run slower than the repo average gets a red up arrow', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 120000 }),
    run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  // Average of 120000 and 60000 is 90000: HEL-1 (120000, "2m") is above it —
  // slower than average is bad news, so red. DONE rows are a single line
  // (lazygit-layout density pass), so the arrow sits on the same line as
  // the ticket id, not a second status line below it.
  const lines = out.split('\n');
  const hel1Line = lines.find((l) => l.includes('HEL-1'));
  assert.match(hel1Line, /2m/);
  assert.ok(plain(hel1Line).includes('▲'), 'HEL-1 (2m, above the 90000ms average) should show ▲');
});

test('a delivered run faster than the repo average gets a green down arrow', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 120000 }),
    run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  // HEL-2 (60000) is below the 90000ms average — faster than average is
  // good news, so green.
  const lines = out.split('\n');
  const hel2Line = lines.find((l) => l.includes('HEL-2'));
  assert.ok(plain(hel2Line).includes('▼'), 'HEL-2 (1m, below the average) should show ▼');
});

test('a single delivered run has no average to compare against, so no arrow renders', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  assert.doesNotMatch(plain(out), /[▲▼]/);
});

test('a failed run never shows a delivery-time arrow, even alongside delivered history', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 120000 }),
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  const lines = out.split('\n');
  const hel2Line = lines.find((l) => l.includes('HEL-2'));
  assert.doesNotMatch(plain(hel2Line), /[▲▼]/);
});

// --- lazygit-layout pass: DONE/FAILED rows collapse to one line ------------

test('a DONE row renders as exactly one line', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  const lines = out.split('\n').filter((l) => /HEL-1/.test(l));
  assert.equal(lines.length, 1);
});

test('a FAILED row renders as exactly one line', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  const lines = out.split('\n').filter((l) => /HEL-2/.test(l));
  assert.equal(lines.length, 1);
});

test('a DONE row names the ticket, branch, end status and elapsed time on its single line', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', changeName: 'add-retry', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS));
  assert.match(out, /HEL-1/);
  assert.match(out, /add-retry/);
  assert.match(out, /delivered/);
  assert.match(out, /1m/);
});

test('NEEDS YOU and RUNNING rows are unaffected — still two lines', () => {
  const out = renderFleet([run({ ticket: 'HEL-3', status: 'running' })], OPTS);
  const lines = out.split('\n');
  const ticketLine = lines.find((l) => l.includes('HEL-3'));
  const idx = lines.indexOf(ticketLine);
  const nextLine = lines[idx + 1];
  assert.notEqual(nextLine.trim(), '');
});

// --- lazygit-layout pass: the last section grows to fill available height --

test('with vertical space to spare, the last section grows to push the footer to the last row', () => {
  const out = renderFleet([run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })],
    { cols: 78, selected: 0, rows: 30 });
  const lines = out.split('\n');
  // rows: 30 reserves the trailing-newline row (fleet.js's existing `rows -
  // 1` convention), so the footer must END on the LAST line this frame
  // emits. The footer wraps across rows at 78 cols (f.hintLines), so the
  // last line carries the hint list's TAIL (q quit) and the first hint
  // (attach) sits on one of the wrapped footer rows above it.
  assert.match(lines[lines.length - 1], /q quit/);
  assert.match(out, /↵ attach/);
  assert.ok(lines.length <= 30, `expected at most 30 lines, got ${lines.length}`);
  assert.ok(lines.length >= 25, `expected the frame to grow toward the 30-row budget, got only ${lines.length} lines`);
});

test('with no rows budget given (0/absent), rendering is unbounded exactly as before this change', () => {
  const out = renderFleet([run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })],
    { cols: 78, selected: 0 });
  const lines = out.split('\n');
  assert.ok(lines.length < 20, 'unbounded render must stay tight to content, not pad out to some default height');
});

// --- lazygit-layout pass: fleet METRICS panel -------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

test('metricsFor computes the average delivery time across done runs with elapsedMs', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', elapsedMs: 60000 }),
    run({ ticket: 'HEL-2', status: 'done', elapsedMs: 120000 }),
  ], 1000000);
  assert.equal(m.avgMs, 90000);
});

test('metricsFor.avgMs is null with no done runs at all', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.equal(m.avgMs, null);
});

test('metricsFor counts deliveries within today\'s UTC calendar day', () => {
  const now = 10 * DAY_MS + 3600000; // 1h into day 10
  const todayStart = 10 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart + 1000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 1000, elapsedMs: 1000 }), // yesterday
  ], now);
  assert.equal(m.deliveredToday, 1);
});

test('metricsFor counts deliveries within the rolling 7-day window for "this week"', () => {
  const now = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: now - 3 * DAY_MS, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: now - 8 * DAY_MS, elapsedMs: 1000 }), // outside window
  ], now);
  assert.equal(m.deliveredWeek, 1);
});

test('metricsFor counts escalation.raised events across every run\'s own event log, today only', () => {
  const now = 5 * DAY_MS + 1000;
  const todayStart = 5 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'needs-you', events: [
      { kind: 'escalation.raised', t: todayStart + 10 },
      { kind: 'escalation.raised', t: todayStart - 10 }, // yesterday
    ] }),
  ], now);
  assert.equal(m.escalationsToday, 1);
});

test('metricsFor.successRate.today is the done/(done+failed) ratio for terminal runs ending today', () => {
  const now = 10 * DAY_MS + 3600000; // 1h into day 10
  const todayStart = 10 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart + 1000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart + 2000, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'failed', endedAt: todayStart + 3000 }),
    run({ ticket: 'HEL-4', status: 'done', endedAt: todayStart - 1000, elapsedMs: 1000 }), // yesterday, excluded
    run({ ticket: 'HEL-5', status: 'running' }), // in flight, excluded (no endedAt)
  ], now);
  assert.deepEqual(m.successRate.today, { rate: 2 / 3, done: 2, total: 3 });
});

test('metricsFor.successRate.today.rate is null with no terminal runs today', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.equal(m.successRate.today.rate, null);
  assert.equal(m.successRate.today.total, 0);
  assert.equal(m.successRate.today.done, 0);
});

test('metricsFor.successRate.week uses the same rolling 7-day window as deliveredWeek', () => {
  const now = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: now - 3 * DAY_MS, elapsedMs: 1000 }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: now - 8 * DAY_MS }), // outside window
  ], now);
  assert.deepEqual(m.successRate.week, { rate: 1, done: 1, total: 1 });
});

test('metricsFor.throughput buckets done runs into the last 7 UTC days, oldest first', () => {
  const now = 20 * DAY_MS;
  const todayStart = 20 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart, elapsedMs: 1000 }), // today
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 3 * DAY_MS, elapsedMs: 1000 }), // 3 days ago
    run({ ticket: 'HEL-3', status: 'done', endedAt: todayStart - 8 * DAY_MS, elapsedMs: 1000 }), // outside the 7-day window
  ], now);
  assert.equal(m.throughput.length, 7);
  assert.equal(m.throughput[6], 1, 'index 6 is today');
  assert.equal(m.throughput[3], 1, 'index 3 is 3 days ago');
  assert.equal(m.throughput.reduce((a, b) => a + b, 0), 2, 'the 8-day-old delivery must not be counted');
});

test('metricsFor.throughput is seven zeroes with no delivery history', () => {
  const m = metricsFor([], 1000000);
  assert.deepEqual(m.throughput, [0, 0, 0, 0, 0, 0, 0]);
});

test('metricsFor.throughput30d buckets done runs into the last 30 UTC days, oldest first', () => {
  const now = 40 * DAY_MS;
  const todayStart = 40 * DAY_MS;
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endedAt: todayStart, elapsedMs: 1000 }), // today
    run({ ticket: 'HEL-2', status: 'done', endedAt: todayStart - 20 * DAY_MS, elapsedMs: 1000 }), // 20 days ago
    run({ ticket: 'HEL-3', status: 'done', endedAt: todayStart - 31 * DAY_MS, elapsedMs: 1000 }), // outside the 30-day window
  ], now);
  assert.equal(m.throughput30d.length, 30);
  assert.equal(m.throughput30d[29], 1, 'index 29 is today');
  assert.equal(m.throughput30d[9], 1, 'index 9 is 20 days ago');
  assert.equal(m.throughput30d.reduce((a, b) => a + b, 0), 2, 'the 31-day-old delivery must not be counted');
});

test('metricsFor.throughput30d is thirty zeroes with no delivery history', () => {
  const m = metricsFor([], 1000000);
  assert.deepEqual(m.throughput30d, new Array(30).fill(0));
});

test('metricsFor.durationBuckets counts done runs with a known elapsedMs into three ranges', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', elapsedMs: 5 * 60000 }),      // under10
    run({ ticket: 'HEL-2', status: 'done', elapsedMs: 9 * 60000 + 59000 }), // under10 (just below 10m)
    run({ ticket: 'HEL-3', status: 'done', elapsedMs: 10 * 60000 }),     // from10to30 (exactly 10m)
    run({ ticket: 'HEL-4', status: 'done', elapsedMs: 25 * 60000 }),     // from10to30
    run({ ticket: 'HEL-5', status: 'done', elapsedMs: 30 * 60000 }),     // over30 (exactly 30m)
    run({ ticket: 'HEL-6', status: 'done', elapsedMs: 45 * 60000 }),     // over30
    run({ ticket: 'HEL-7', status: 'running' }),                        // no elapsedMs to count — excluded
  ], 1000000);
  assert.deepEqual(m.durationBuckets, { under10: 2, from10to30: 2, over30: 2 });
});

test('metricsFor.durationBuckets is all zero with no done-run history', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'running' })], 1000000);
  assert.deepEqual(m.durationBuckets, { under10: 0, from10to30: 0, over30: 0 });
});

test('metricsFor.recentEscalations collects every escalation.raised event across all runs, newest first', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', events: [
      { kind: 'escalation.raised', t: 100, ticket: 'HEL-1', role: 'orchestrator', question: 'add zod?' },
    ] }),
    run({ ticket: 'HEL-2', events: [
      { kind: 'escalation.raised', t: 300, ticket: 'HEL-2', role: 'evaluator', question: 'drop the column?' },
      { kind: 'escalation.raised', t: 200, ticket: 'HEL-2', role: null, question: 'retry?' },
    ] }),
  ], 1000000);
  assert.equal(m.recentEscalations.length, 3);
  assert.deepEqual(m.recentEscalations.map((e) => e.raisedAt), [300, 200, 100], 'newest first');
  assert.deepEqual(m.recentEscalations[0], { ticket: 'HEL-2', role: 'evaluator', question: 'drop the column?', raisedAt: 300 });
  assert.equal(m.recentEscalations[1].role, null, 'a missing role stays null, not a made-up default');
});

test('metricsFor.recentEscalations is empty with no escalation history', () => {
  const m = metricsFor([run({ ticket: 'HEL-1', status: 'done' })], 1000000);
  assert.deepEqual(m.recentEscalations, []);
});

test('metricsFor.verdictRates computes each role\'s pass-rate from verdict events across all runs', () => {
  const m = metricsFor([
    run({ ticket: 'HEL-1', events: [
      { kind: 'verdict', role: 'evaluator', verdict: 'PASS' },
      { kind: 'verdict', role: 'evaluator', verdict: 'FAIL' },
      { kind: 'verdict', role: 'skeptic', verdict: 'CONFIRM' },
    ] }),
    run({ ticket: 'HEL-2', events: [
      { kind: 'verdict', role: 'evaluator', verdict: 'PASS' },
    ] }),
  ], 1000000);
  assert.equal(m.verdictRates.evaluator, 2 / 3);
  assert.equal(m.verdictRates.skeptic, 1);
  assert.equal(m.verdictRates.auditor, null, 'a role with zero verdict events must be null, not 0');
});

test('metricsFor.gateRates computes each gate\'s pass-rate from the latest per-run result, omitting gates no run has ever reported', () => {
  // Real gate-name vocabulary only: `phase:setup`/`phase:servers`/etc, the
  // lowercase names assert-phase.sh's own PHASE argument actually emits —
  // NOT PHASE_ORDER's 'Setup'/'Planning'/... phase.enter-event vocabulary,
  // a completely different thing (see GATE_NAME_ORDER's header comment in
  // fleet.js). A test built on the wrong vocabulary would pass even if
  // gateRates could never match a single real gate.result event.
  const m = metricsFor([
    run({ ticket: 'HEL-1', gates: [
      { name: 'phase:setup', status: 'pass' },
      { name: 'server:backend', status: 'fail' },
    ] }),
    run({ ticket: 'HEL-2', gates: [
      { name: 'phase:setup', status: 'pass' },
    ] }),
  ], 1000000);
  assert.equal(m.gateRates['phase:setup'], 1);
  assert.equal(m.gateRates['server:backend'], 0);
  assert.ok(!('phase:servers' in m.gateRates), 'a gate no run ever reported must be omitted, not 0%');
});

test('metricsColumnLines returns the same 5 compact lines buildSections used to build inline', () => {
  const { metricsColumnLines } = require('../lib/ui/screens/fleet');
  const m = metricsFor([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000,
      events: [{ kind: 'verdict', role: 'evaluator', verdict: 'PASS' }],
      gates: [{ name: 'phase:setup', status: 'pass' }] }),
  ], 100000);
  const lines = metricsColumnLines(m, { cols: 76 });
  assert.equal(lines.length, 5);
  assert.match(lines[0], /avg delivery/);
  assert.match(lines[1], /success\s+today/);
  assert.match(lines[2], /throughput \(7d\)/);
  assert.match(lines[3], /verdicts\s+evaluator/);
  assert.match(lines[4], /gates\s+setup/);
});

function metricsFixtureExpanded() {
  return {
    avgMs: 90000, deliveredToday: 2, deliveredWeek: 5, escalationsToday: 1,
    successRate: { today: { rate: 1, done: 2, total: 2 }, week: { rate: 0.8, done: 4, total: 5 } },
    throughput: [0, 0, 0, 0, 0, 1, 1],
    throughput30d: new Array(30).fill(0).map((_, i) => (i >= 28 ? 1 : 0)),
    verdictRates: { evaluator: 0.9, skeptic: null, auditor: null },
    gateRates: { 'phase:setup': 1 },
    durationBuckets: { under10: 3, from10to30: 1, over30: 0 },
    recentEscalations: [
      { ticket: 'CON-9', role: 'orchestrator', question: 'retry?', raisedAt: 5000 },
      { ticket: 'CON-8', role: 'evaluator', question: 'looks risky, proceed?', raisedAt: 4000 },
    ],
  };
}

test('metricsColumnLines stays compact when the column is narrower than 80 cols, even with plenty of rows', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 60, contentRows: 40 });
  assert.equal(lines.length, 5);
});

test('metricsColumnLines stays compact when contentRows is too small, even with a wide column', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 100, contentRows: 5 });
  assert.equal(lines.length, 5);
});

test('metricsColumnLines expands when both cols>=80 and contentRows>=11: 30-day throughput, duration line, escalations', () => {
  const lines = metricsColumnLines(metricsFixtureExpanded(), { cols: 90, contentRows: 20 });
  assert.match(lines[2], /throughput \(30d\)/);
  const durationLine = lines.find((l) => l.startsWith('duration'));
  assert.ok(durationLine, 'a duration line must render');
  assert.match(durationLine, /<10m 75%/);
  assert.match(durationLine, /10-30m 25%/);
  assert.match(durationLine, /30m\+ 0%/);
  assert.ok(lines.includes('recent escalations'), 'a recent-escalations header must render');
  const escLine = lines.find((l) => l.includes('CON-9'));
  assert.ok(escLine, 'the newest escalation must render');
  assert.match(escLine, /retry\?/);
});

test('metricsColumnLines\' expanded tier shows only as many escalation rows as contentRows allows', () => {
  const m = metricsFixtureExpanded();
  m.recentEscalations = Array.from({ length: 20 }, (_, i) => ({
    ticket: `CON-${i}`, role: 'orchestrator', question: 'q', raisedAt: 20 - i,
  }));
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 13 }); // 8 fixed + header + 1 room for 3 more? see below
  // fixedLines = [line1,line2,line3,line4,line5,'',durationLine,''] = 8 lines.
  // remaining = contentRows - 8. header consumes 1, the rest go to escalation rows.
  const remaining = 13 - 8;
  const escalationRowCount = lines.length - 8 - 1; // minus the 8 fixed lines and the header
  assert.equal(escalationRowCount, remaining - 1);
});

test('metricsColumnLines\' expanded tier says "no escalations yet" when the list is empty but there is room', () => {
  const m = metricsFixtureExpanded();
  m.recentEscalations = [];
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 20 });
  assert.ok(lines.some((l) => l.includes('no escalations yet')));
});

test('metricsColumnLines\' expanded-tier duration line says "no data yet" with no duration history', () => {
  const m = metricsFixtureExpanded();
  m.durationBuckets = { under10: 0, from10to30: 0, over30: 0 };
  const lines = metricsColumnLines(m, { cols: 90, contentRows: 20 });
  const durationLine = lines.find((l) => l.startsWith('duration'));
  assert.match(durationLine, /no data yet/);
});

test('the fleet view shows a METRICS section after DONE with real numbers', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], { ...OPTS, now: 100000 }));
  assert.match(out, /METRICS/);
  assert.match(out, /avg delivery/);
  assert.match(out, /delivered today/);
});

test('escalations today renders on line 1 (with avg delivery/delivered today/this week), always visible at a default 80-column terminal width — not packed into line 2\'s fitSegments, where it would be the first thing dropped', () => {
  const now = 5 * DAY_MS + 1000;
  const todayStart = 5 * DAY_MS;
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'needs-you', events: [
      { kind: 'escalation.raised', t: todayStart + 10 },
    ] }),
  ], { ...OPTS, cols: 80, now }));
  const line1 = out.split('\n').find((l) => l.includes('avg delivery'));
  assert.ok(line1, 'line 1 must render');
  assert.match(line1, /escalations today 1/);
  const successLine = out.split('\n').find((l) => l.includes('success'));
  assert.ok(successLine, 'the success-rate line must render');
  assert.doesNotMatch(successLine, /escalations/, 'escalations must not be packed into the success-rate line');
});

test('the METRICS box renders five content lines with real numbers', () => {
  const now = 100000;
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000,
      events: [{ kind: 'verdict', role: 'evaluator', verdict: 'PASS' }],
      gates: [{ name: 'phase:setup', status: 'pass' }] }),
  ], { ...OPTS, now }));
  assert.match(out, /METRICS/);
  assert.match(out, /avg delivery/);
  assert.match(out, /success\s+today/);
  assert.match(out, /throughput \(7d\)/);
  assert.match(out, /verdicts\s+evaluator/);
  assert.match(out, /gates\s+setup/);
});

test('the METRICS verdicts and gates lines say "no data yet" with no verdict/gate history', () => {
  const now = 100000;
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], { ...OPTS, now }));
  assert.match(out, /verdicts\s+no data yet/);
  assert.match(out, /gates\s+no data yet/);
});

test('the METRICS gates line drops trailing segments (with an ellipsis) instead of corrupting the box at a narrow width', () => {
  const now = 100000;
  // The real 6-name gate vocabulary (assert-phase.sh's phase:setup/servers/
  // delivery/cleanup plus start-servers.sh's server:backend/frontend) — NOT
  // PHASE_ORDER's phase.enter-event vocabulary, a different thing entirely.
  const manyGates = ['phase:setup', 'phase:servers', 'phase:delivery', 'phase:cleanup', 'server:backend', 'server:frontend']
    .map((name) => ({ name, status: 'pass' }));
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000, gates: manyGates }),
  ], { ...OPTS, cols: 40, now }));
  const gatesLine = out.split('\n').find((l) => l.includes('gates'));
  assert.ok(gatesLine, 'a gates line must render');
  assert.match(gatesLine, /…/);
  const labels = ['setup', 'servers', 'delivery', 'cleanup', 'backend', 'frontend'];
  const presentCount = labels.filter((l) => gatesLine.includes(l)).length;
  assert.ok(presentCount < labels.length, 'not every gate label should fit at 40 cols');
  assert.ok(f.visibleLength(gatesLine) <= 40, 'the rendered line must not exceed the box width');
});

test('the METRICS gates line uses the real gate-name vocabulary (phase:setup/servers/delivery/cleanup, server:backend/frontend) — not PHASE_ORDER\'s phase.enter vocabulary', () => {
  const now = 100000;
  const gates = [
    { name: 'phase:setup', status: 'pass' },
    { name: 'phase:servers', status: 'pass' },
    { name: 'phase:delivery', status: 'fail' },
    { name: 'phase:cleanup', status: 'pass' },
    { name: 'server:backend', status: 'pass' },
    { name: 'server:frontend', status: 'pass' },
  ];
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000, gates }),
  ], { ...OPTS, cols: 100, now }));
  const gatesLine = out.split('\n').find((l) => l.includes('gates'));
  assert.ok(gatesLine, 'a gates line must render');
  assert.match(gatesLine, /setup 100%/);
  assert.match(gatesLine, /servers 100%/);
  assert.match(gatesLine, /delivery 0%/);
  assert.match(gatesLine, /cleanup 100%/);
  assert.match(gatesLine, /backend 100%/);
  assert.match(gatesLine, /frontend 100%/);
});

test('pressing the METRICS section\'s own digit is a no-op, not a broken jump', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  // CON-56: QUICK START is[1] (always renders), DONE is [2], METRICS is [3]
  // (all three always render — QUICK START/METRICS are forceRender: true,
  // DONE has one entry).
  assert.equal(handleKey('3', state({ runs })), null);
});

test('an escalated run says so — the circuit breaker giving up is not a crash', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS);
  assert.match(out, /escalated/);
});

test('a dead window does not render a growing elapsed time as its signal', () => {
  // The harness crashed at 2am: no run.end, so endedAt is null and elapsed has
  // been counting against `now` ever since. `8h32m` reads as progress.
  const out = renderFleet([
    run({ ticket: 'HEL-3', status: 'failed', endStatus: null, endedAt: null,
          elapsedMs: 8 * 3600000 + 32 * 60000, window: { alive: false, idleMs: null } }),
  ], OPTS);
  assert.match(out, /window exited/);
  assert.doesNotMatch(out, /8h32m/);
});

// --- unbounded history must not push NEEDS YOU off the top -----------------

function manyFinished(n, status) {
  return Array.from({ length: n }, (_, i) =>
    run({ ticket: 'HEL-' + (100 + i), status, endStatus: status === 'done' ? 'delivered' : 'failed',
          endedAt: 100, elapsedMs: 60000, window: null }));
}

test('a long history renders a bounded number of rows plus a "more" line', () => {
  const out = renderFleet(manyFinished(50, 'done'), { cols: 78, selected: 0 });
  const shown = out.split('\n').filter((l) => /HEL-1\d\d/.test(l)).length;
  assert.ok(shown <= 5, `expected at most 5 finished rows, got ${shown}`);
  assert.match(out, /… and 45 more/);
});

test('NEEDS YOU survives when finished runs would otherwise fill the screen', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
  ].concat(manyFinished(50, 'done'));

  // rows:15 was this fixture's floor before QUICK START became unconditional
  // (CON-56) — it is now ALSO an always-on, untrimmable 3-row floor (1
  // emptyHint line + 2-row border), same as METRICS. The footer-wrap pass
  // (f.hintLines: hints wrap at cols instead of being clamp-truncated, and
  // t/s are now advertised) costs one more untrimmable row at 78 cols —
  // verified empirically (rows:18 still renders 19 lines).
  const out = renderFleet(runs, { cols: 78, rows: 19, selected: 0 });
  const lines = out.split('\n');
  assert.ok(lines.length <= 19, `output is ${lines.length} lines, terminal is 19`);
  assert.match(out, /NEEDS YOU/);
  assert.match(out, /HEL-338/);
  assert.match(out, /add zod@3\?/);
  assert.match(out, /more/, 'the hidden history is still accounted for');
  // The header must survive too — it is above NEEDS YOU and scrolls off first.
  assert.match(out, /concertino/);
});

test('a tiny terminal still keeps every NEEDS YOU run', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q1', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'needs-you', escalation: { question: 'q2', options: [], raisedAt: 1 } }),
  ].concat(manyFinished(20, 'failed'));
  // rows:17 was this fixture's floor before QUICK START became unconditional
  // (CON-56) — it is now ALSO an always-on, untrimmable 3-row floor, shifting
  // this fixture's own floor up by 3. The footer-wrap pass (f.hintLines)
  // adds one more untrimmable row at 78 cols — verified empirically that
  // rows:21 is the new floor (rows:20 still renders 21 lines).
  const out = renderFleet(runs, { cols: 78, rows: 21, selected: 0 });
  assert.match(out, /HEL-1/);
  assert.match(out, /HEL-2/);
  assert.ok(out.split('\n').length <= 21);
});

// Two populated sections were never enough to catch this: a section trimmed to
// zero used to still cost a title, a "… and N more" line and a trailing blank,
// so every section had a floor of 3 rows the trim loop could not get below.
// With all four sections populated that floor exceeded a short terminal and the
// cap silently stopped capping — at rows:14 the screen rendered 16 lines and
// scrolled the header and NEEDS YOU off the TOP.
//
// The lazygit-layout pass's METRICS panel is unconditional (forceRender,
// exactly like QUICK START's own untrimmable floor) — this fixture is now
// really FIVE sections (NEEDS YOU/RUNNING/FAILED/DONE/METRICS), which shifts
// the smallest terminal height it can hold everything in up accordingly.
// The METRICS charts pass (2026-08-01) grew METRICS' own untrimmable floor
// from 3 rows (1 emptyHint line + 2-row border) to 7 rows (5 emptyLines +
// 2-row border) — even with RUNNING/FAILED/DONE each collapsed to their own
// 1-row floor, the combined untrimmable minimum was head+tail(3) +
// NEEDS YOU(4) + RUNNING(1) + FAILED(1) + DONE(1) + METRICS(7) = 17 rows,
// so the smallest `rows` that could hold it was 18 (rows - 1 == 17), not 14.
// CON-56: QUICK START is now unconditional too (forceRender, empty here — no
// quickStartTickets opt is passed), adding its own untrimmable 3-row floor
// (1 emptyHint line + 2-row border). The footer-wrap pass (f.hintLines)
// adds one more tail row at 78 cols — the combined minimum is now 21 rows,
// verified empirically (rows:21 renders exactly 21 lines, the smallest
// `rows` that still satisfies output <= rows).
test('the total-height cap holds with all four sections populated (plus the always-on METRICS and QUICK START panels)', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-401', status: 'running' }),
    run({ ticket: 'HEL-402', status: 'running' }),
    run({ ticket: 'HEL-403', status: 'running' }),
  ].concat(manyFinished(8, 'failed'))
   .concat(manyFinished(8, 'done'));

  for (const rows of [21, 22, 24, 28]) {
    const out = renderFleet(runs, { cols: 78, rows, selected: 0 });
    const lines = out.split('\n');
    assert.ok(lines.length <= rows,
      `rows:${rows} rendered ${lines.length} lines`);
    assert.match(out, /NEEDS YOU/,
      `rows:${rows} lost the NEEDS YOU heading`);
    assert.match(out, /HEL-338/,
      `rows:${rows} lost the escalation itself`);
  }
});

// CON-28's own version of the incident above: a populated QUEUED section adds
// a fifth section AND a 1-line-per-row shape sectionHeight() must reason about
// via `linesPerRow`, not the old hardcoded 2-per-row constant. If that constant
// stayed hardcoded, the height budget would systematically UNDERcount QUEUED's
// true cost (2 lines charged for what only ever renders 1), silently letting
// more rows through than the terminal can hold — the exact "stale height
// computation" failure mode the comment above describes, just reachable a
// different way. Five real sections' floor is one line taller than four's, so
// the smallest terminal height this fixture can hold everything in also shifts
// up accordingly (rows:12, not rows:10 — see the four-section test above).
//
// With the lazygit-layout pass's always-on METRICS panel this fixture is
// really SIX sections (+ METRICS), shifting the floor up once more
// (rows:16, not rows:12).
//
// The METRICS charts pass (2026-08-01) grew METRICS' own untrimmable floor
// from 3 rows to 7 rows (see the four-section test above for the exact
// breakdown), pushing this fixture's own floor up again — rows:19 was the
// smallest terminal that still fit (rows:18 rendered 19 lines, over budget).
//
// CON-56: QUICK START is now unconditional too, adding its own untrimmable
// 3-row floor on top of that — verified empirically, the new floor is
// rows:22 (rows:22 renders exactly 22 lines; rows:21 renders 22, over
// budget), so the smallest scheduled value in the list below that clears it
// is 22, not 20.
test('the total-height cap holds with all five sections (including a populated QUEUED) populated, plus METRICS and QUICK START', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-401', status: 'running' }),
    run({ ticket: 'HEL-402', status: 'running' }),
    run({ ticket: 'HEL-403', status: 'running' }),
  ].concat(manyFinished(8, 'failed'))
   .concat(manyFinished(8, 'done'));
  const queueState = { pending: manyQueued(20), inFlight: new Set(), maxConcurrent: 1 };

  // Floor moved 22 -> 23 with the footer-wrap pass (f.hintLines: the queue-
  // populated hint list wraps to a second row at 78 cols), then 23 -> 26
  // with CON-98's `a address`/`d done` FAILED-section hint (this fixture
  // includes 8 FAILED runs, so the hint is present and wraps the footer
  // further) — verified empirically (rows:25 still renders 24 lines,
  // rows:26 is where the budget genuinely starts to bind).
  for (const rows of [26, 28, 32]) {
    const out = renderFleet(runs, { cols: 78, rows, selected: 0, queueState });
    const lines = out.split('\n');
    assert.ok(lines.length <= rows,
      `rows:${rows} rendered ${lines.length} lines`);
    assert.match(out, /NEEDS YOU/,
      `rows:${rows} lost the NEEDS YOU heading`);
    assert.match(out, /HEL-338/,
      `rows:${rows} lost the escalation itself`);
    assert.match(out, /concertino/,
      `rows:${rows} lost the header`);
  }
});

// The one deliberate exception, kept explicit so nobody "fixes" it: NEEDS YOU
// is pinned and never trimmed, so a fleet whose escalations alone overflow the
// terminal overflows. Losing the header is the right thing to lose; silently
// hiding a question somebody is blocked on is not.
test('NEEDS YOU is never trimmed even when it alone overflows', () => {
  const runs = Array.from({ length: 6 }, (_, i) =>
    run({ ticket: 'HEL-' + (200 + i), status: 'needs-you',
          escalation: { question: 'q' + i, options: [], raisedAt: 1 } }))
    .concat(manyFinished(8, 'done'));

  const out = renderFleet(runs, { cols: 78, rows: 10, selected: 0 });
  for (let i = 0; i < 6; i++) assert.match(out, new RegExp('HEL-' + (200 + i)));
});

// --- reducer -> fleet, end to end -------------------------------------------
// Every other test in this file hand-builds Run objects, so a field rename in
// reducer.js would leave the whole suite green while the real screen rendered
// blanks. These two drive the actual reducer output into the actual screen.

function ev(t, kind, ticket, over) {
  return Object.assign({ t, kind, ticket, project: 'helio', role: 'orchestrator' }, over);
}

// A fleet spanning every status the reducer can derive.
function realisticLog() {
  return new Map([
    ['HEL-500', { malformed: 0, events: [
      ev(1000, 'run.start', 'HEL-500', { branch: 'matt/add-zod' }),
      ev(1100, 'phase.enter', 'HEL-500', { phase: 'Planning' }),
      ev(1200, 'escalation.raised', 'HEL-500', { question: 'add zod@3?', options: 'approve,deny' }),
    ] }],
    ['HEL-505', { malformed: 2, events: [
      ev(1050, 'run.start', 'HEL-505', { branch: 'matt/second-question' }),
      ev(1150, 'escalation.raised', 'HEL-505', { question: 'drop the legacy column?', options: '' }),
    ] }],
    ['HEL-501', { malformed: 0, events: [
      ev(900, 'run.start', 'HEL-501', { branch: 'matt/live-one' }),
      ev(950, 'phase.enter', 'HEL-501', { phase: 'Execution', cycle: 1 }),
      ev(960, 'gate.result', 'HEL-501', { gate: 'lint', status: 'pass' }),
      ev(970, 'gate.result', 'HEL-501', { gate: 'test', status: 'fail' }),
    ] }],
    ['HEL-506', { malformed: 0, events: [
      ev(880, 'run.start', 'HEL-506', { branch: 'matt/live-two' }),
      ev(890, 'phase.enter', 'HEL-506', { phase: 'Evaluation', cycle: 2 }),
    ] }],
    // No window and no run.end: the reducer cannot tell what this is doing.
    ['HEL-507', { malformed: 0, events: [
      ev(870, 'run.start', 'HEL-507', { branch: 'matt/no-window' }),
    ] }],
    ['HEL-502', { malformed: 0, events: [
      ev(800, 'run.start', 'HEL-502', { branch: 'matt/broke' }),
      ev(850, 'run.end', 'HEL-502', { status: 'failed' }),
    ] }],
    ['HEL-503', { malformed: 0, events: [
      ev(700, 'run.start', 'HEL-503', { branch: 'matt/shipped' }),
      ev(750, 'run.end', 'HEL-503', { status: 'delivered' }),
    ] }],
    ['HEL-508', { malformed: 0, events: [
      ev(600, 'run.start', 'HEL-508', { branch: 'matt/shipped-earlier' }),
      ev(650, 'run.end', 'HEL-508', { status: 'delivered' }),
    ] }],
  ]);
}

const REAL_WINDOWS = [
  { ticket: 'HEL-500', alive: true, idleMs: 0 },
  { ticket: 'HEL-505', alive: true, idleMs: 0 },
  { ticket: 'HEL-501', alive: true, idleMs: 0 },
  { ticket: 'HEL-506', alive: true, idleMs: 120000 },
];

// CON-3: an unrecognised phase.enter value must never reach the screen as a
// phantom phase label with an empty bar — reduce() rejects it before fleet.js
// ever sees run.phase, so this proves the reducer's validation, not just the
// screen's existing null-phase fallback (already covered at line 49-53 above).
test('an unrecognised phase.enter value renders as phase unknown with zero progress, not a phantom label', () => {
  const events = new Map([
    ['HEL-9', { malformed: 0, events: [
      ev(1000, 'run.start', 'HEL-9', { branch: 'matt/bad-phase' }),
      ev(1100, 'phase.enter', 'HEL-9', { phase: 'Phase 2' }),
    ] }],
  ]);
  const windows = [{ ticket: 'HEL-9', alive: true, idleMs: 0 }];
  const runs = reduce(events, windows, 2000);
  const out = plain(renderFleet(runs, { cols: 100, selected: 0 }));

  assert.match(out, /phase unknown/);
  assert.doesNotMatch(out, /Phase 2/);
  assert.match(out, /1 malformed events/);
  // The progress bar renders zero fill — the same all-dim bar rendered for a
  // run with no phase at all, never a partially-filled one for the rejected
  // value.
  assert.equal(runs[0].phase, null);
});

test('a real event log reduces and renders end to end', () => {
  const runs = reduce(realisticLog(), REAL_WINDOWS, 2000);
  const out = plain(renderFleet(runs, { cols: 100, selected: 0 }));

  // The project comes off the events, not off a hand-built object.
  assert.match(out, /helio/);

  // changeName is derived in the reducer by splitting the branch — the single
  // most likely thing to silently break, and invisible to hand-built fixtures.
  assert.match(out, /add-zod/, 'branch-derived change name is missing');
  assert.match(out, /live-one/);
  assert.match(out, /shipped/);

  // Every section actually appeared.
  assert.match(out, /NEEDS YOU/);
  assert.match(out, /RUNNING/);
  assert.match(out, /FAILED/);
  assert.match(out, /DONE/);

  // Escalation text survives the trip from the log to the screen.
  assert.match(out, /add zod@3\?/);
  assert.match(out, /approve \/ deny/);

  // Phase, cycle and gate tallies come from the fold, not from a fixture.
  assert.match(out, /Execution/);
  assert.match(out, /cycle 1/);
  assert.match(out, /gates 1\/2/, 'gate pass/total tally is wrong');

  // A run nobody can see into must not read as healthy.
  assert.match(out, /phase unknown|no telemetry/);

  // Malformed lines are surfaced, not swallowed.
  assert.match(out, /2 malformed events/);
});

// watch.js attaches to runs[selected], where `selected` indexes fleet.js's flat
// walk over its sections. Those two orderings agree only because the reducer's
// sort happens to match the section composition — nothing enforces it, so
// reordering sections would silently attach you to the wrong agent. This pins
// the correspondence for every index, not just the first.
test('the selection marker points at reduce()\'s run for every index', () => {
  const runs = reduce(realisticLog(), REAL_WINDOWS, 2000);
  assert.ok(runs.length >= 8, `expected the full fleet, got ${runs.length}`);

  for (let n = 0; n < runs.length; n++) {
    const out = plain(renderFleet(runs, { cols: 100, selected: n }));
    // Each section is now its own bordered box (`│ … │`), so the marker no
    // longer sits at column 0 of its line — it can appear anywhere after the
    // left border and padding. '▸' is unique to this selection marker, so
    // matching its presence anywhere on the line still pins one-marker-per-
    // render without depending on the border's own column offset.
    const marked = out.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `selected:${n} produced ${marked.length} markers`);
    assert.ok(marked[0].includes(runs[n].ticket),
      `selected:${n} should mark ${runs[n].ticket}, marked line was: ${marked[0]}`);
  }
});

// CON-28: the same pin, but with a non-empty QUEUED section rendered between
// RUNNING and DONE — the exact scenario tasks.md 4.5 calls the ticket's
// primary constraint. (Section order, post CON-40/fleet-metrics-grid's FAILED
// reorder: NEEDS YOU, FAILED, RUNNING, QUEUED, DONE — QUEUED no longer sits
// next to FAILED.) QUEUED rows have no run object at all, so if the shared
// index counter advanced for them (even by accident), every DONE selection
// below QUEUED would resolve to the wrong run.
test('the selection marker still points at the correct run when a non-empty QUEUED section renders between RUNNING and DONE', () => {
  const runs = reduce(realisticLog(), REAL_WINDOWS, 2000);
  assert.ok(runs.length >= 8, `expected the full fleet, got ${runs.length}`);
  const queueState = { pending: ['CON-90', 'CON-91', 'CON-92'], inFlight: new Set(), maxConcurrent: 2 };

  for (let n = 0; n < runs.length; n++) {
    const out = plain(renderFleet(runs, { cols: 100, selected: n, queueState }));
    assert.match(out, /QUEUED \(3, running 2 at a time\)/, `selected:${n} should still render QUEUED`);
    const marked = out.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `selected:${n} produced ${marked.length} markers`);
    assert.ok(marked[0].includes(runs[n].ticket),
      `selected:${n} should mark ${runs[n].ticket} even with QUEUED rendered above, marked line was: ${marked[0]}`);
    // The marker must never land on a queued row either — those tickets
    // (CON-90/91/92) never appear in `runs`, so they should never be marked.
    assert.ok(!marked[0].includes('CON-9'), `selected:${n} marked a QUEUED row instead of a run: ${marked[0]}`);
  }
});

// --- CON-6: scroll offset — the selection marker must stay aligned at every
// scroll position, not just scrollOffset: 0, and NEEDS YOU must never move --

// NEEDS YOU (1) + FAILED (12, windowed at MAX_FINISHED=5 — design.md
// Decision 1) + RUNNING (2) + DONE (3): more than one page of FAILED alone,
// so scrolling through it is unavoidable, and RUNNING/DONE give the walk in
// design.md Decision 2 more than one section to cross. Array order mirrors
// the canonical section order (NEEDS YOU, FAILED, RUNNING, DONE) so
// `runs[n]` lines up with the flat walk position `selected: n` renders at
// (see the reducer.js STATUS_ORDER comment for why this correspondence
// matters).
function scrollFixture() {
  return [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
  ].concat(manyFinished(12, 'failed'), [
    run({ ticket: 'HEL-2', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'running' }),
  ]).concat(manyFinished(3, 'done'));
}

// 3.1: extends "the selection marker points at reduce()'s run for every
// index" (above) to scrolled offsets — not just scrollOffset: 0.
test('the selection marker points at the correct run for every reachable scroll offset', () => {
  const runs = scrollFixture();
  const maxScrollOffset = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: 0 }).maxScrollOffset;
  assert.ok(maxScrollOffset > 0, 'fixture must actually be scrollable for this test to mean anything');

  for (let scrollOffset = 0; scrollOffset <= maxScrollOffset; scrollOffset++) {
    const win = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset });
    // Exercise the two ends of whatever is actually visible at this offset —
    // this is the acceptance criterion's "at every scroll offset", not a
    // sample of a couple of arbitrary ones.
    for (const n of new Set([win.firstVisibleIndex, win.lastVisibleIndex])) {
      if (n < 0 || n >= runs.length) continue;
      const out = plain(renderFleet(runs, { cols: 100, selected: n, scrollOffset }));
      const marked = out.split('\n').filter((l) => l.includes('▸'));
      assert.equal(marked.length, 1,
        `scrollOffset:${scrollOffset} selected:${n} produced ${marked.length} markers`);
      assert.ok(marked[0].includes(runs[n].ticket),
        `scrollOffset:${scrollOffset} selected:${n} should mark ${runs[n].ticket}, marked line was: ${marked[0]}`);
    }
  }
});

// 3.1 (scrolling back to zero, byte-for-byte): the migration plan's own
// guarantee — scrollOffset: 0 must render identically to scrollOffset
// absent entirely.
test('scrolling back to a zero offset renders byte-for-byte identically to no scroll offset at all', () => {
  const runs = scrollFixture();
  const withoutOffset = renderFleet(runs, { cols: 100, selected: 2 });
  const withZeroOffset = renderFleet(runs, { cols: 100, selected: 2, scrollOffset: 0 });
  assert.equal(withZeroOffset, withoutOffset);
});

// Regression (found during task 4.2's manual `concertino watch` exercise,
// against a real tmux session): NEEDS YOU sits before the scrollable region
// and is always fully visible, so a naive "first section with shown>0 ..
// last section with shown>0" range wrongly treated the GAP between NEEDS
// YOU and a scrolled-past RUNNING section as "visible" too. Concretely: a
// 1-row RUNNING section scrolled entirely out of view by a deep scrollOffset
// into DONE was reported as being inside [firstVisibleIndex,
// lastVisibleIndex] purely because NEEDS YOU's own always-visible index (0)
// sat below it and DONE's window sat above it — so watch.js's move handler
// never scrolled back up when the selection reached RUNNING's own row, and
// it rendered with no marker anywhere on screen. Root cause: NEEDS YOU (a
// pinned section) must never contribute to firstVisibleIndex/
// lastVisibleIndex — see visibleWindow's own comment on this exact point.
test('a short RUNNING section scrolled entirely past NEEDS YOU is correctly reported as NOT visible, not folded into NEEDS YOU\'s always-visible range', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ].concat(manyFinished(12, 'done'));

  // scrollOffset:3 = RUNNING's own single row, plus 2 rows into DONE —
  // exactly the scrolled state the manual repro reached.
  const win = visibleWindow(runs, { rows: 0, selected: 1, scrollOffset: 3 });
  assert.ok(win.firstVisibleIndex > 1,
    `RUNNING (index 1) is scrolled entirely past — firstVisibleIndex must be greater than it, got ${win.firstVisibleIndex}`);

  // renderFleet itself never reads firstVisibleIndex/lastVisibleIndex (only
  // watch.js's move handler does) — this just confirms the window helper's
  // report matches what the renderer actually does: selecting the scrolled-
  // past RUNNING row renders no marker anywhere.
  const out = plain(renderFleet(runs, { cols: 100, selected: 1, scrollOffset: 3 }));
  assert.doesNotMatch(out, /▸/,
    'RUNNING is genuinely not rendered at this scroll offset — no marker should appear anywhere');
});

// 3.2
test('NEEDS YOU renders in full at every scroll offset, even scrolled deep into FAILED/DONE', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q1', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'needs-you', escalation: { question: 'q2', options: [], raisedAt: 1 } }),
  ].concat(manyFinished(15, 'failed')).concat(manyFinished(15, 'done'));

  const maxScrollOffset = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: 0 }).maxScrollOffset;
  assert.ok(maxScrollOffset > 0, 'fixture must actually be scrollable for this test to mean anything');

  for (const scrollOffset of [0, 1, Math.floor(maxScrollOffset / 2), maxScrollOffset]) {
    const out = plain(renderFleet(runs, { cols: 100, selected: 0, scrollOffset }));
    assert.match(out, /HEL-1\b/, `scrollOffset:${scrollOffset} lost HEL-1 from NEEDS YOU`);
    assert.match(out, /HEL-2\b/, `scrollOffset:${scrollOffset} lost HEL-2 from NEEDS YOU`);
    assert.match(out, /q1/, `scrollOffset:${scrollOffset} lost HEL-1's escalation text`);
    assert.match(out, /q2/, `scrollOffset:${scrollOffset} lost HEL-2's escalation text`);
    // RUNNING is empty in this fixture, so NEEDS YOU sits directly above
    // whichever of FAILED/DONE the scroll landed in — it must still be
    // FIRST, never pushed down or off the top.
    assert.ok(out.indexOf('HEL-1') < out.indexOf('HEL-2'));
  }
});

// 3.3: the exported window helper's own return shape, at the boundaries.
test('visibleWindow reports firstVisibleIndex/lastVisibleIndex/maxScrollOffset correctly at the boundaries', () => {
  // A single scrollable section (FAILED, 12 rows, capped/windowed at 5) —
  // deliberately no NEEDS YOU/RUNNING/DONE, so the arithmetic is easy to
  // hand-verify against MAX_FINISHED directly.
  const runs = manyFinished(12, 'failed');

  const atZero = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: 0 });
  assert.equal(atZero.firstVisibleIndex, 0);
  assert.equal(atZero.lastVisibleIndex, 4);   // MAX_FINISHED=5 window: rows 0..4
  assert.equal(atZero.maxScrollOffset, 7);    // 12 total - 5 shown at the end = 7

  const atMax = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: atZero.maxScrollOffset });
  assert.equal(atMax.firstVisibleIndex, 7);
  assert.equal(atMax.lastVisibleIndex, 11);   // the very last row

  // One past the structural maximum must not go OUT of bounds — nothing
  // after the final row exists to reveal. (Clamping scrollOffset itself to
  // maxScrollOffset is watch.js's job, on every draw(); visibleWindow just
  // must never misbehave if asked for more anyway.)
  const onePast = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: atZero.maxScrollOffset + 1 });
  assert.equal(onePast.lastVisibleIndex, 11);
  assert.ok(onePast.firstVisibleIndex >= 0 && onePast.firstVisibleIndex <= 11);
});

// 3.5: the combined scroll-plus-small-terminal case the design skeptic's
// round-1 report called for (design.md Decision 3's selected-row protection
// rule) — a non-zero scrollOffset windows FAILED to a mid-group slice with
// `selected` sitting at the window's own tail, and then a `rows` budget
// tight enough to force the whole-frame trim to shrink that very section
// further. Without the protection rule, today's tail-first trim would evict
// exactly the row scrolling just revealed.
test('a scroll offset that lands mid-group survives a whole-frame height-budget trim without evicting the selected row', () => {
  const runs = manyFinished(20, 'failed');
  const scrollOffset = 10;
  const selected = 14; // the lastVisibleIndex of the pre-trim [10, 15) window

  const unbudgeted = visibleWindow(runs, { rows: 0, selected, scrollOffset });
  assert.equal(unbudgeted.firstVisibleIndex, 10, 'sanity: the scroll really does land mid-group');
  assert.equal(unbudgeted.lastVisibleIndex, 14, 'sanity: selected sits exactly at the window tail');

  // rows: 19 forces the budget trim to shrink FAILED further (5 shown rows
  // down to 4) — the exact scenario the protection rule exists for. (Was
  // rows: 14 before METRICS grew from a 3-row to a 7-row untrimmable panel,
  // 2026-08-01, then 18; the footer-wrap pass adds one more tail row at
  // 100 cols — the hint list is 104 visible cols — so the same trim
  // outcome now needs one more.)
  const out = plain(renderFleet(runs, { cols: 100, rows: 19, selected, scrollOffset }));
  const marked = out.split('\n').filter((l) => l.includes('▸'));
  assert.equal(marked.length, 1,
    `expected exactly one marker after the height-budget trim, got ${marked.length}`);
  assert.ok(marked[0].includes(runs[selected].ticket),
    `the height-budget trim evicted the selected row instead of protecting it; marked line was: ${marked[0] || '(none)'}`);
});

// 3.4: small-terminal-height regression — rows smaller than the combined
// height of all non-empty sections, at a non-zero scroll offset, still
// renders the header + NEEDS YOU in full and collapses everything else it
// cannot fit to a "… and N more" line rather than a partial/corrupted box.
test('a small terminal at a non-zero scroll offset still renders the header + NEEDS YOU in full, collapsing what does not fit', () => {
  // NEEDS YOU + FAILED + DONE only (no RUNNING) — selected stays on NEEDS
  // YOU throughout, which is the row this test cares about protecting;
  // design.md Decision 3's own selected-row protection for a *scrolled*
  // section is covered separately, above.
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q1', options: [], raisedAt: 1 } }),
  ].concat(manyFinished(10, 'failed')).concat(manyFinished(10, 'done'));

  const maxScrollOffset = visibleWindow(runs, { rows: 0, selected: 0, scrollOffset: 0 }).maxScrollOffset;
  const scrollOffset = Math.min(3, maxScrollOffset);
  assert.ok(scrollOffset > 0, 'fixture must actually be scrollable for this test to mean anything');

  // Three non-empty sections (NEEDS YOU + FAILED + DONE) each cost at least
  // one line even fully collapsed, on top of the header/footer, PLUS the
  // lazygit-layout pass's always-on METRICS panel — rows:12 was this
  // fixture's own structural floor (mirrors the existing "total-height cap"
  // tests' own per-fixture floor, elsewhere in this file).
  //
  // The METRICS charts pass (2026-08-01) grew METRICS' own untrimmable floor
  // from 3 rows to 7 rows (see the four-section "total-height cap" test
  // above for the exact breakdown), shifting this fixture's floor up by the
  // same +4 (to rows:16). CON-56: QUICK START is now unconditional too,
  // adding its own untrimmable 3-row floor on top of that. The footer-wrap
  // pass (f.hintLines) adds one more tail row at 78 cols — verified
  // empirically (rows:20 is the new floor).
  for (const rows of [20, 21, 22]) {
    const out = renderFleet(runs, { cols: 78, rows, selected: 0, scrollOffset });
    const lines = out.split('\n');
    assert.ok(lines.length <= rows, `rows:${rows} rendered ${lines.length} lines`);
    assert.match(out, /NEEDS YOU/, `rows:${rows} lost the NEEDS YOU heading`);
    assert.match(out, /HEL-1\b/, `rows:${rows} lost the escalation itself`);
    assert.match(out, /concertino/, `rows:${rows} lost the header`);
    // Every section that cannot fit collapses to its "… and N more" line —
    // no partially rendered box.
    assert.match(out, /more/, `rows:${rows} lost the overflow accounting`);
  }
});

// --- computeWindow extraction (Task 5) --------------------------------------

test('computeWindow produces the identical result visibleWindow already returns, given the same buildSections output', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done' })];
  const sections = buildSections(
    { needsYou: [], active: [runs[0]], failed: [], done: [runs[1]] },
    null, {},
  );
  const direct = computeWindow(runs, sections, { rows: 30, selected: 0, scrollOffset: 0 });
  const viaWrapper = visibleWindow(runs, { rows: 30, selected: 0, scrollOffset: 0 });
  assert.deepEqual(direct, viaWrapper);
});

test('computeWindow with includeHeadTail:false does not subtract the page header/footer row count from the budget', () => {
  const runs = manyFinished(20, 'done');
  const sections = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {});
  const withHeadTail = computeWindow(runs, sections, { rows: 10, selected: 0, scrollOffset: 0, includeHeadTail: true });
  const withoutHeadTail = computeWindow(runs, sections, { rows: 10, selected: 0, scrollOffset: 0, includeHeadTail: false });
  // Excluding head/tail leaves more of the same 10-row budget for content, so
  // more DONE rows survive the trim. Targeted by `kind` rather than a
  // hardcoded index (section order can shift, as it already did once in
  // Task 2) — and NOT sections[0], which is NEEDS YOU and empty in this
  // fixture (shown: 0 on both sides regardless of includeHeadTail, which
  // would make the assertion vacuous).
  const done = sections.findIndex((s) => s.kind === 'done');
  assert.ok(
    withoutHeadTail.sections[done].shown > withHeadTail.sections[done].shown,
    `expected more DONE rows without head/tail: ${withoutHeadTail.sections[done].shown} vs ${withHeadTail.sections[done].shown}`,
  );
});

// --- only bound keys are advertised ----------------------------------------

test('the empty state does not advertise an unbound key', () => {
  const out = renderFleet([], OPTS);
  assert.doesNotMatch(out, /press n/);
});

test('escalation options avoid the keybinding idiom until something binds them', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
  ], OPTS);
  assert.match(out, /approve \/ deny/);
  assert.doesNotMatch(out, /\[a\]pprove/);
  assert.doesNotMatch(out, /\[d\]eny/);
});

test('no rendered line exceeds the terminal width', () => {
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', changeName: 'an-extremely-long-change-name-that-will-not-fit-anywhere',
          escalation: { question: 'a very long escalation question that should be truncated to fit the terminal', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331' }),
  ], { cols: 60, selected: 0 });
  // eslint-disable-next-line no-control-regex
  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of out.split('\n')) {
    assert.ok(visible(line).length <= 60, `line too long (${visible(line).length}): ${line}`);
  }
});

// --- CON-53: the escalation question wraps instead of being hard-truncated -

test('a long escalation question wraps onto additional lines instead of being clipped with an ellipsis', () => {
  const longQuestion = 'word '.repeat(40).trim(); // well over cols - 8 at 80 columns
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: longQuestion, options: ['approve', 'deny'], raisedAt: 1 } }),
  ], { cols: 80, selected: 0 });
  const plainOut = plain(out);
  const questionLines = plainOut.split('\n').filter((l) => l.includes('word'));
  assert.ok(questionLines.length > 1, 'a 40-word question at 80 columns must wrap onto more than one row');
  for (const line of questionLines) assert.doesNotMatch(line, /…/);
  const wordCount = questionLines.join(' ').split(/\s+/).filter((w) => w === 'word').length;
  assert.equal(wordCount, 40, 'every word must survive the wrap, none dropped or cut off');
});

test('a wrapped escalation question keeps the stale marker/options on its last line, and box borders stay intact', () => {
  const longQuestion = 'word '.repeat(40).trim();
  const out = renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: longQuestion, options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-331', status: 'running' }),
  ], { cols: 80, selected: 0 });
  const plainOut = plain(out);
  assert.match(plainOut, /approve \/ deny/, 'the options hint must still render, appended to the wrapped block\'s last line');
  // No rendered line — border or content — may exceed the terminal's column
  // budget, and every top/bottom border line (all `─`/corner characters) must
  // be the same width as every other one: a wrapped multi-line row that threw
  // off the box's own border bookkeeping would either overflow a line or
  // produce a mismatched border width.
  const lines = plainOut.split('\n');
  const borderWidths = new Set();
  for (const line of lines) {
    assert.ok(line.length <= 80, `line exceeds terminal width (${line.length}): ${line}`);
    if (/^[┌┐└┘─]+$/.test(line)) borderWidths.add(line.length);
  }
  assert.equal(borderWidths.size, 1, `expected every border line to share one width, got: ${[...borderWidths]}`);
  assert.match(plainOut, /RUNNING/, 'the RUNNING section below NEEDS YOU must still render, not be corrupted/overwritten');
  assert.match(plainOut, /HEL-331/, 'the RUNNING run below the wrapped question must still render');
});

test('a short escalation question (fits on one line) renders identically to before this change', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
  ], { cols: 80, selected: 0 }));
  const questionLines = out.split('\n').filter((l) => l.includes('add zod@3?'));
  assert.equal(questionLines.length, 1, 'a short question must render on exactly one line, unchanged');
  assert.match(questionLines[0], /approve \/ deny/);
});

// --- snapshot widths, wide characters, borders + colour together (task 6.2) -
// isTTY forced (format-colour.test.js's pattern) so both the section boxes'
// border colour AND STATUS_COLOUR are actually exercised, not just their
// plain-text fallback — every width below must still hold the visible-
// column budget with a bordered, coloured, wide-character render.

test('at 60/80/100/120 cols, a bordered, coloured, wide-character (CJK) fleet render stays in budget', () => {
  process.stdout.isTTY = true;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet']) {
    delete require.cache[require.resolve(m)];
  }
  const f = require('../lib/ui/format');
  const { renderFleet: renderColoured } = require('../lib/ui/screens/fleet');

  const wideRuns = [
    run({
      ticket: 'HEL-9001', status: 'needs-you',
      changeName: '日本語のとても長いブランチ名前のテストです',
      escalation: { question: 'これは非常に長いエスカレーションの質問文です。承認しますか？', options: ['approve', 'deny'], raisedAt: 1 },
    }),
    run({ ticket: 'HEL-9002', status: 'running', phase: 'Execution', cycle: 3 }),
    run({ ticket: 'HEL-9003', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
    run({ ticket: 'HEL-9004', status: 'done', endStatus: 'delivered', endedAt: 100 }),
  ];

  for (const cols of [60, 80, 100, 120]) {
    const out = renderColoured(wideRuns, { cols, selected: 0 });
    assert.match(out, /\x1b\[/, `cols:${cols} should still be emitting colour under isTTY`);
    for (const line of out.split('\n')) {
      assert.ok(f.visibleLength(line) <= cols,
        `cols:${cols} line is ${f.visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }

  process.stdout.isTTY = false;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet']) {
    delete require.cache[require.resolve(m)];
  }
});

// --- borderless fallback path, exercised end to end ------------------------
// layout.degrade()'s own threshold is unreachable through this screen's real
// render() at any width/height this codebase actually wires up (`cols` is
// floored at 40, `MIN_BOX_WIDTH` is 8 — see design.md Decision 3's own
// discussion of why that is fine). That leaves the fallback branch inside
// renderFleet covered only by layout.test.js's unit-level test of
// layout.degrade() itself, not by anything that runs fleet.js's OWN "skip
// the frame" code. Stubbing layout.degrade() to force `true` and re-requiring
// fleet.js against that stub exercises the real conditional inside
// renderFleet, not a copy of it — this is the cheapest way to pin that wiring
// without lowering any screen's width floor just to make a threshold
// reachable, which would be a regression in its own right.
test('when layout.degrade() reports true, fleet sections render without any frame at all', () => {
  const layoutPath = require.resolve('../lib/ui/layout');
  const fleetPath = require.resolve('../lib/ui/screens/fleet');
  const realLayout = require('../lib/ui/layout');

  delete require.cache[fleetPath];
  require.cache[layoutPath] = {
    id: layoutPath, filename: layoutPath, loaded: true,
    exports: Object.assign({}, realLayout, { degrade: () => true }),
  };
  const { renderFleet: renderDegraded } = require('../lib/ui/screens/fleet');

  const out = renderDegraded([
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-501', status: 'running' }),
  ], { cols: 78, selected: 0 });

  // No box-drawing character anywhere — neither border set was drawn.
  assert.doesNotMatch(out, /[┌┐└┘│┏┓┗┛┃]/,
    'layout.degrade() reporting true should suppress every box-drawing character');
  // The content this run's fallback path (title line + rows) is responsible
  // for is still there — degrading drops the frame, never the information.
  assert.match(out, /NEEDS YOU/);
  assert.match(out, /HEL-338/);
  assert.match(out, /add zod@3\?/);
  assert.match(out, /RUNNING/);
  assert.match(out, /HEL-501/);

  delete require.cache[fleetPath];
  delete require.cache[layoutPath];
});

// --- the new-run prompt ----------------------------------------------------
// The screen holds no prompt state of its own: watch.js passes it through
// opts, so these are still pure (runs, opts) -> string assertions.

test('the prompt line renders what has been typed so far', () => {
  const out = plain(renderFleet([run({})], { ...OPTS, prompt: { value: 'CON-1', error: null } }));
  assert.match(out, /new run/);
  assert.match(out, /CON-1/);
});

test('an empty prompt still renders, so `n` visibly did something', () => {
  const out = plain(renderFleet([run({})], { ...OPTS, prompt: { value: '', error: null } }));
  assert.match(out, /new run/);
});

test('a failed launch is shown on the prompt, not swallowed', () => {
  const out = plain(renderFleet([run({})], {
    ...OPTS, prompt: { value: 'CON-9', error: 'could not start CON-9: tmux exited 1' },
  }));
  assert.match(out, /could not start CON-9/);
  assert.match(out, /tmux exited 1/);
});

// A ticket that fails shape validation (see lib/ui/ticket.js) is reported
// through the same error path as a failed launch — no separate mechanism —
// and the typed value stays on the line so the user can fix it in place.
test('a value that does not look like a ticket id is shown on the prompt as a validation error', () => {
  const out = plain(renderFleet([run({})], {
    ...OPTS, prompt: { value: '$(touch /tmp/x)', error: 'not a ticket id' },
  }));
  assert.match(out, /not a ticket id/);
  assert.match(out, /\$\(touch \/tmp\/x\)/);
});

test('the footer advertises n and N only in fleet mode', () => {
  const fleet = plain(renderFleet([run({})], OPTS));
  assert.match(fleet, /n new run/);
  assert.match(fleet, /N launch pad/);
  assert.match(fleet, /↵ attach/);

  // While prompting, `n` types an "n" — advertising it as an action would be
  // advertising a key that is not bound, which this project treats as a defect.
  const prompting = plain(renderFleet([run({})], { ...OPTS, prompt: { value: '', error: null } }));
  assert.doesNotMatch(prompting, /n new run/);
  assert.doesNotMatch(prompting, /N launch pad/);
  assert.doesNotMatch(prompting, /↵ attach/);
  assert.match(prompting, /esc cancel/);
});

test('a long typed value and a long error stay inside the terminal width', () => {
  const out = renderFleet([run({})], {
    cols: 50, selected: 0,
    prompt: { value: 'CON-' + '9'.repeat(80), error: 'could not start it: ' + 'x'.repeat(120) },
  });
  for (const line of out.split('\n')) {
    assert.ok(plain(line).length <= 50, `line too long (${plain(line).length}): ${line}`);
  }
});

// --- handleKey: pure (key, state) -> action, the router seam ---------------
// watch.js owns selected/prompt/mode; this function only describes what a
// keypress means, so it can be tested without a tty or a mock session.

function state(over) {
  return Object.assign({ runs: [run({})], selected: 0, prompt: null }, over);
}

test('j/k move the selection without touching state directly', () => {
  assert.deepEqual(handleKey('j', state({})), { type: 'move', delta: 1 });
  assert.deepEqual(handleKey('k', state({})), { type: 'move', delta: -1 });
  assert.deepEqual(handleKey('\x1b[B', state({})), { type: 'move', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', state({})), { type: 'move', delta: -1 });
});

test('q and Ctrl-C quit', () => {
  assert.deepEqual(handleKey('q', state({})), { type: 'quit' });
  assert.deepEqual(handleKey('\u0003', state({})), { type: 'quit' });
});

test('n opens the prompt', () => {
  assert.deepEqual(handleKey('n', state({})), { type: 'open-prompt' });
});

// Capital N — the launch pad's sole entry point (see the comment on this
// binding in fleet.js). Always bound, even when the launch pad's own feature
// gate is off, so watch.js can route to a screen that explains why rather
// than the key doing nothing at all.
test('N opens the launch pad', () => {
  assert.deepEqual(handleKey('N', state({})), { type: 'open-launchpad' });
});

test('while prompting, N types an "N" rather than opening the launch pad', () => {
  assert.deepEqual(handleKey('N', promptState({ value: '', error: null })), { type: 'prompt-type', char: 'N' });
});

test('enter on a plain run attaches', () => {
  assert.deepEqual(handleKey('\r', state({})), { type: 'attach', ticket: 'HEL-1' });
});

test('enter on a run with a live escalation opens the escalation screen instead of attaching', () => {
  const escalated = run({
    ticket: 'HEL-338', status: 'needs-you', escalationStale: false,
    escalation: { question: 'q', options: ['approve', 'deny'], raisedAt: 1 },
  });
  assert.deepEqual(
    handleKey('\r', state({ runs: [escalated] })),
    { type: 'open-escalation', ticket: 'HEL-338' },
  );
});

test('enter on a run with a STALE escalation attaches, not opens the screen — nobody is waiting on it', () => {
  const stale = run({
    ticket: 'HEL-338', status: 'failed', escalationStale: true,
    escalation: { question: 'q', options: ['approve', 'deny'], raisedAt: 1 },
  });
  assert.deepEqual(
    handleKey('\r', state({ runs: [stale] })),
    { type: 'attach', ticket: 'HEL-338' },
  );
});

test('enter with no runs is a no-op', () => {
  assert.equal(handleKey('\r', state({ runs: [] })), null);
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', state({})), null);
});

test('l opens the drill-down on the selected run', () => {
  assert.deepEqual(handleKey('l', state({})), { type: 'open-drilldown', ticket: 'HEL-1' });
  assert.deepEqual(handleKey('\x1b[C', state({})), { type: 'open-drilldown', ticket: 'HEL-1' });
});

test('l with no runs is a no-op', () => {
  assert.equal(handleKey('l', state({ runs: [] })), null);
});

// CON-54: additive to the `l` binding above — a distinct action
// (view-ticket, not open-drilldown) for the same selected run.
test('t opens the ticket detail view for the selected run (RUNNING)', () => {
  assert.deepEqual(handleKey('t', state({})), { type: 'view-ticket', ticket: 'HEL-1' });
});

test('t opens the ticket detail view for the selected run (DONE)', () => {
  const done = run({ ticket: 'HEL-2', status: 'done', endStatus: 'merged' });
  assert.deepEqual(handleKey('t', state({ runs: [done] })),
    { type: 'view-ticket', ticket: 'HEL-2' });
});

test('t with no runs is a no-op', () => {
  assert.equal(handleKey('t', state({ runs: [] })), null);
});

test("l on RUNNING/DONE is unaffected by t's addition", () => {
  assert.deepEqual(handleKey('l', state({})), { type: 'open-drilldown', ticket: 'HEL-1' });
  const done = run({ ticket: 'HEL-2', status: 'done', endStatus: 'merged' });
  assert.deepEqual(handleKey('l', state({ runs: [done] })),
    { type: 'open-drilldown', ticket: 'HEL-2' });
});

// --- CON-98: `a`/`d` on a FAILED selected row (design.md Decision 1) -------
// specs/fleet-failed-remediation/spec.md's "a"/"d" bind at the fleet
// screen's top level" requirement, all four scenarios.

test('a on a FAILED selected row (focus: runs) resolves to address-failure', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  assert.deepEqual(handleKey('a', state({ runs: [failed], focus: 'runs' })),
    { type: 'address-failure', ticket: 'HEL-9' });
});

test('d on a FAILED selected row (focus: runs) opens the mark-done confirm', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  assert.deepEqual(handleKey('d', state({ runs: [failed], focus: 'runs' })),
    { type: 'open-mark-done-confirm', ticket: 'HEL-9' });
});

test('a/d are no-ops on a non-FAILED selected row', () => {
  const running = run({ ticket: 'HEL-9', status: 'running' });
  assert.equal(handleKey('a', state({ runs: [running], focus: 'runs' })), null);
  assert.equal(handleKey('d', state({ runs: [running], focus: 'runs' })), null);
});

test('a/d are no-ops while QUEUED is locally focused, even if the (off-screen) selected row is FAILED', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = state({ runs: [failed], focus: 'queue', queueState: { pending: ['HEL-1'], maxConcurrent: 1 } });
  assert.equal(handleKey('a', s), null);
  assert.equal(handleKey('d', s), null);
});

test('a/d never resolve to address-failure/open-mark-done-confirm while QUICK START is locally focused, even if the (off-screen) selected row is FAILED', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = state({ runs: [failed], focus: 'quickstart' });
  // `a` under quickstart focus is already, separately, claimed by CON-40's
  // own binding (quickstart-add) — that pre-existing claim is exactly WHY
  // this off-screen FAILED row can never leak through for `a` specifically;
  // the load-bearing assertion is that it is NOT address-failure.
  const aResult = handleKey('a', s);
  assert.notEqual(aResult && aResult.type, 'address-failure');
  assert.deepEqual(aResult, { type: 'quickstart-add', index: s.quickStartFocus });
  // `d` has no such pre-existing claim inside the quickstart block, so this
  // one genuinely falls through to a bare null — the `focus === 'runs'`
  // guard is the only thing stopping it.
  assert.equal(handleKey('d', s), null);
});

test('a/d default to focus: runs when `focus` is entirely absent from state (matches existing default)', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = { runs: [failed], selected: 0 }; // no `focus` key at all
  assert.deepEqual(handleKey('a', s), { type: 'address-failure', ticket: 'HEL-9' });
  assert.deepEqual(handleKey('d', s), { type: 'open-mark-done-confirm', ticket: 'HEL-9' });
});

test('a/d with no runs selected is a no-op', () => {
  assert.equal(handleKey('a', state({ runs: [], focus: 'runs' })), null);
  assert.equal(handleKey('d', state({ runs: [], focus: 'runs' })), null);
});

// --- CON-109, fleet-bulk-select spec: `space` toggles a FAILED row into the
// multi-select set (mirroring a/d's own binding site/guard) -----------------

test('space on a FAILED selected row toggles it into the FAILED multi-select set', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  assert.deepEqual(handleKey(' ', state({ runs: [failed], focus: 'runs' })),
    { type: 'toggle-multi-select', section: 'failed', ticket: 'HEL-9' });
});

test('space is a no-op on a non-FAILED selected row', () => {
  const running = run({ ticket: 'HEL-9', status: 'running' });
  assert.equal(handleKey(' ', state({ runs: [running], focus: 'runs' })), null);
});

test('space is a no-op while QUICK START is locally focused, even if the (off-screen) selected row is FAILED', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = state({ runs: [failed], focus: 'quickstart' });
  assert.equal(handleKey(' ', s), null);
});

// --- CON-109, fleet-failed-remediation spec: a non-empty FAILED
// multi-select set makes a/d bulk regardless of the cursor's own row -------

test('a with a non-empty FAILED multi-select set opens the bulk address confirm, not single-row address-failure', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = state({
    runs: [failed], focus: 'runs',
    multiSelect: { failed: new Set(['HEL-1', 'HEL-2', 'HEL-3']), queued: new Set() },
  });
  assert.deepEqual(handleKey('a', s),
    { type: 'open-bulk-address-confirm', tickets: ['HEL-1', 'HEL-2', 'HEL-3'] });
});

test('d with a non-empty FAILED multi-select set opens the bulk mark-done confirm', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const s = state({
    runs: [failed], focus: 'runs',
    multiSelect: { failed: new Set(['HEL-1', 'HEL-2']), queued: new Set() },
  });
  assert.deepEqual(handleKey('d', s),
    { type: 'open-bulk-mark-done-confirm', tickets: ['HEL-1', 'HEL-2'] });
});

test('a/d bulk dispatch fires even while the cursor sits on a non-FAILED row, as long as the FAILED multi-select set is non-empty', () => {
  const running = run({ ticket: 'HEL-9', status: 'running' });
  const s = state({
    runs: [running], focus: 'runs',
    multiSelect: { failed: new Set(['HEL-1']), queued: new Set() },
  });
  assert.deepEqual(handleKey('a', s), { type: 'open-bulk-address-confirm', tickets: ['HEL-1'] });
  assert.deepEqual(handleKey('d', s), { type: 'open-bulk-mark-done-confirm', tickets: ['HEL-1'] });
});

test('a/d with an EMPTY FAILED multi-select set behave byte-for-byte exactly as before this change (tasks.md 3.3)', () => {
  const failed = run({ ticket: 'HEL-9', status: 'failed' });
  const withEmptySet = state({
    runs: [failed], focus: 'runs',
    multiSelect: { failed: new Set(), queued: new Set() },
  });
  const withNoField = state({ runs: [failed], focus: 'runs' }); // multiSelect absent entirely
  assert.deepEqual(handleKey('a', withEmptySet), { type: 'address-failure', ticket: 'HEL-9' });
  assert.deepEqual(handleKey('d', withEmptySet), { type: 'open-mark-done-confirm', ticket: 'HEL-9' });
  assert.deepEqual(handleKey('a', withNoField), { type: 'address-failure', ticket: 'HEL-9' });
  assert.deepEqual(handleKey('d', withNoField), { type: 'open-mark-done-confirm', ticket: 'HEL-9' });
});

// --- CON-109: the bulk action's own y/anything-else confirmation gate ------

test('bulkConfirm: y resolves to the confirm action matching bulkConfirm.kind', () => {
  assert.deepEqual(handleKey('y', state({ bulkConfirm: { section: 'failed', kind: 'address', tickets: ['HEL-1'] } })),
    { type: 'confirm-bulk-address' });
  assert.deepEqual(handleKey('y', state({ bulkConfirm: { section: 'failed', kind: 'mark-done', tickets: ['HEL-1'] } })),
    { type: 'confirm-bulk-mark-done' });
  assert.deepEqual(handleKey('y', state({ bulkConfirm: { section: 'queued', kind: 'force-start', tickets: ['HEL-1'] } })),
    { type: 'confirm-bulk-force-start' });
});

test('bulkConfirm: any other key cancels via the one shared cancel-bulk-confirm type', () => {
  const s = state({ bulkConfirm: { section: 'failed', kind: 'mark-done', tickets: ['HEL-1'] } });
  assert.deepEqual(handleKey('n', s), { type: 'cancel-bulk-confirm' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-bulk-confirm' });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-bulk-confirm' });
});

// --- CON-98: markDoneConfirm's own y/anything-else gate, mirroring
// forceStartConfirm/clearQueueConfirm's precedence discipline exactly -------

test('markDoneConfirm: y confirms', () => {
  const s = state({ markDoneConfirm: { ticket: 'HEL-9' } });
  assert.deepEqual(handleKey('y', s), { type: 'confirm-mark-done', ticket: 'HEL-9' });
});

test('markDoneConfirm: any other key cancels', () => {
  const s = state({ markDoneConfirm: { ticket: 'HEL-9' } });
  assert.deepEqual(handleKey('n', s), { type: 'cancel-mark-done' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-mark-done' });
});

test('markDoneConfirm intercepts every key, even ones ordinarily bound elsewhere (j/k/l)', () => {
  const s = state({ markDoneConfirm: { ticket: 'HEL-9' } });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-mark-done' });
  assert.deepEqual(handleKey('l', s), { type: 'cancel-mark-done' });
});

test('k still means move-up, not kill — the fleet footer must never claim otherwise', () => {
  assert.deepEqual(handleKey('k', state({})), { type: 'move', delta: -1 });
  const out = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(out, /k kill/);
});

// --- handleKey while the `n` prompt is open ---------------------------------

function promptState(prompt) {
  return state({ prompt });
}

test('typing appends to the prompt value', () => {
  assert.deepEqual(handleKey('C', promptState({ value: 'CON', error: 'stale error' })),
    { type: 'prompt-type', char: 'C' });
});

test('backspace removes a character', () => {
  assert.deepEqual(handleKey('\x7f', promptState({ value: 'CON-1', error: null })),
    { type: 'prompt-backspace' });
});

test('escape cancels the prompt', () => {
  assert.deepEqual(handleKey('\x1b', promptState({ value: 'CON-1', error: null })),
    { type: 'cancel-prompt' });
});

test('enter on a non-empty value submits it, trimmed', () => {
  assert.deepEqual(handleKey('\r', promptState({ value: '  CON-1  ', error: null })),
    { type: 'submit-prompt', value: 'CON-1' });
});

// --- CON-21: `n` branches on parseTicketInput, not raw looksLikeTicket -----
// design.md Decision 4: parseTicketInput tolerates the trailing speed/
// agent-merge token forms that a bare looksLikeTicket(value) call (whole-
// string match, no whitespace) would misroute into the draft flow.

test('enter on "CON-21 fast" still submits — parseTicketInput accepts the trailing speed token', () => {
  assert.deepEqual(handleKey('\r', promptState({ value: 'CON-21 fast', error: null })),
    { type: 'submit-prompt', value: 'CON-21 fast' });
});

test('enter on "CON-21 --agent-merge" still submits — parseTicketInput accepts the trailing flag', () => {
  assert.deepEqual(handleKey('\r', promptState({ value: 'CON-21 --agent-merge', error: null })),
    { type: 'submit-prompt', value: 'CON-21 --agent-merge' });
});

test('enter on free text opens the ticket-draft flow with the raw text as the seed', () => {
  assert.deepEqual(
    handleKey('\r', promptState({ value: 'add a share button to dashboards', error: null })),
    { type: 'open-ticket-draft', seed: 'add a share button to dashboards' },
  );
});

test('enter on a ticket-adjacent-but-invalid value falls through to open-ticket-draft like any other rejected input', () => {
  assert.deepEqual(
    handleKey('\r', promptState({ value: 'CON-21 nonsense', error: null })),
    { type: 'open-ticket-draft', seed: 'CON-21 nonsense' },
  );
});

test('while drafting, every key except escape is a no-op', () => {
  const drafting = promptState({ value: 'add a share button', error: null, drafting: true });
  assert.equal(handleKey('C', drafting), null);
  assert.equal(handleKey('\x7f', drafting), null);
  assert.equal(handleKey('\r', drafting), null);
  assert.deepEqual(handleKey('\x1b', drafting), { type: 'cancel-prompt' });
});

test('enter on an empty (or whitespace-only) value cancels rather than submits blank', () => {
  assert.deepEqual(handleKey('\r', promptState({ value: '', error: null })), { type: 'cancel-prompt' });
  assert.deepEqual(handleKey('\r', promptState({ value: '   ', error: null })), { type: 'cancel-prompt' });
});

test('while prompting, n types an "n" rather than being treated as the open-prompt key', () => {
  assert.deepEqual(handleKey('n', promptState({ value: '', error: null })), { type: 'prompt-type', char: 'n' });
});

test('while prompting, q types a "q" rather than quitting', () => {
  assert.deepEqual(handleKey('q', promptState({ value: '', error: null })), { type: 'prompt-type', char: 'q' });
});

test('an arrow key while prompting is ignored, not typed literally', () => {
  assert.equal(handleKey('\x1b[A', promptState({ value: 'x', error: null })), null);
});

// --- Progress bar colour reflects the run's status (Task 7.10) ---

test('the fleet screen renders status-coloured progress bars for RUNNING, and a status-coloured end label for DONE', () => {
  process.stdout.isTTY = true;
  delete process.env.TERM;
  delete process.env.COLORTERM;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet']) {
    delete require.cache[require.resolve(m)];
  }
  const f = require('../lib/ui/format');
  const { renderFleet: renderColoured } = require('../lib/ui/screens/fleet');

  const runningRun = run({ ticket: 'HEL-1', status: 'running', phase: 'Execution' });
  const doneRun = run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100 });

  const out = renderColoured([runningRun, doneRun], { cols: 80, selected: 0 });
  const plainOut = plain(out);

  // Both runs should render
  assert.match(plainOut, /HEL-1/);
  assert.match(plainOut, /Execution/);
  assert.match(plainOut, /HEL-2/);
  assert.match(plainOut, /RUNNING/);
  assert.match(plainOut, /DONE/);

  // RUNNING still shows a live, cyan progress bar (STATUS_COLOUR.running) —
  // unaffected by the lazygit-layout density pass, which only collapsed
  // FAILED/DONE (no longer live) down to a single line with no bar at all.
  assert.match(out, /\x1b\[36m[▪░]/, 'running bar should be cyan (STATUS_COLOUR.running)');
  // DONE's own end-status word ("delivered") still carries STATUS_COLOUR.done
  // (dim) on its now-single line, even without a bar.
  assert.match(out, /\x1b\[2mdelivered/, 'DONE\'s end status should be dim (STATUS_COLOUR.done)');

  process.stdout.isTTY = false;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet']) {
    delete require.cache[require.resolve(m)];
  }
});

// --- CON-39: digit-key section jump -----------------------------------------
// design.md Decision 1: numbering is positional over sections actually
// rendered THIS frame, in on-screen order — never a fixed NEEDS YOU=1/
// RUNNING=2/... scheme.

test('digit jump lands on the first row of the target section when NEEDS YOU/RUNNING/FAILED are all present', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'running' }),
    run({ ticket: 'HEL-4', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
  ];
  // Sections on screen (canonical order): NEEDS YOU (1 row, index 0), FAILED
  // (1 row, index 1), RUNNING (2 rows, indices 2-3), then QUICK START
  // (digit 4, unselectable, always on screen since CON-56 — doesn't affect
  // FAILED's own digit, since it renders after RUNNING). Digit 2 -> FAILED's
  // first row, index 1.
  assert.deepEqual(handleKey('2', state({ runs })), { type: 'jump', index: 1 });
});

test('numbering skips empty sections — digit 3 reaches DONE when NEEDS YOU/FAILED are empty', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100 }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100 }),
  ];
  // CON-56: RUNNING(1)=index0, QUICK START(2, unselectable, always on
  // screen), DONE(3)=indices1-2 — DONE is the THIRD section on screen, not
  // the fifth in a fixed scheme (and no longer the second, now that QUICK
  // START always claims a digit between them).
  assert.deepEqual(handleKey('3', state({ runs })), { type: 'jump', index: 1 });
});

test('an out-of-range digit is a no-op, leaving selection/focus unchanged', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  // On-screen targets: RUNNING(1), QUICK START(2, always on screen —
  // CON-56), METRICS(3, always on screen but never focusable — its own
  // 'metrics' case in handleKey returns null regardless). Digit 4 is
  // genuinely out of range (only 3 targets exist).
  assert.equal(handleKey('4', state({ runs })), null);
  // Also true of the empty fleet — QUICK START and METRICS are still the
  // only two (both forceRender) targets, so digit 3 is out of range.
  assert.equal(handleKey('3', state({ runs: [] })), null);
});

test('QUEUED participates in the digit numbering but jumps via focus-queue, never perturbing selected', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } })];
  const queueState = { pending: ['CON-9', 'CON-10'], inFlight: new Set(), maxConcurrent: 1 };
  // CON-56: NEEDS YOU(1), QUICK START(2, always on screen), QUEUED(3).
  assert.deepEqual(handleKey('3', state({ runs, queueState })), { type: 'focus-queue', index: 0 });
});

test('a digit that resolves to a runs-backed section while already focused on QUEUED exits queue-focus and jumps normally', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ];
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  // Sections: NEEDS YOU(1)=index0, RUNNING(2)=index1, QUEUED(3). Currently
  // focused on QUEUED (per the ticket's own "different section's digit
  // exits queue focus and jumps as normal" requirement) — pressing 2 (RUNNING)
  // must still emit an ordinary jump, not a queue-focus action.
  const s = state({ runs, queueState, focus: 'queue', queueFocus: 0 });
  assert.deepEqual(handleKey('2', s), { type: 'jump', index: 1 });
});

test('pressing QUEUED\'s own digit again while already focused on it re-emits focus-queue at index 0 (a no-op-equivalent)', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const queueState = { pending: ['CON-9', 'CON-10'], inFlight: new Set(), maxConcurrent: 1 };
  const s = state({ runs, queueState, focus: 'queue', queueFocus: 1 });
  // CON-56: RUNNING(1), QUICK START(2, always on screen), QUEUED(3).
  assert.deepEqual(handleKey('3', s), { type: 'focus-queue', index: 0 });
});

// --- CON-39: the QUEUED-local focus cursor ----------------------------------

function queueFocusState(over) {
  return state(Object.assign({
    focus: 'queue',
    queueFocus: 0,
    queueState: { pending: ['CON-1', 'CON-2', 'CON-3'], inFlight: new Set(), maxConcurrent: 1 },
  }, over));
}

test('j/k (and arrow aliases) move the QUEUED-local cursor while focus is queue, never the ordinary move action', () => {
  assert.deepEqual(handleKey('j', queueFocusState({})), { type: 'move-queue-focus', delta: 1 });
  assert.deepEqual(handleKey('k', queueFocusState({})), { type: 'move-queue-focus', delta: -1 });
  assert.deepEqual(handleKey('\x1b[B', queueFocusState({})), { type: 'move-queue-focus', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', queueFocusState({})), { type: 'move-queue-focus', delta: -1 });
});

test('bare Escape exits queue focus', () => {
  assert.deepEqual(handleKey('\x1b', queueFocusState({})), { type: 'exit-queue-focus' });
});

test('Enter/l/n/N are suppressed (no-ops) while focus is queue', () => {
  assert.equal(handleKey('\r', queueFocusState({})), null);
  assert.equal(handleKey('l', queueFocusState({})), null);
  assert.equal(handleKey('\x1b[C', queueFocusState({})), null); // l's arrow alias
  assert.equal(handleKey('n', queueFocusState({})), null);
  assert.equal(handleKey('N', queueFocusState({})), null);
});

test('q/Ctrl-C keep behaving exactly as today, independent of queue focus', () => {
  assert.deepEqual(handleKey('q', queueFocusState({})), { type: 'request-quit' }); // queueState has pending
  assert.deepEqual(handleKey('\u0003', queueFocusState({})), { type: 'request-quit' });
  const emptyQueue = queueFocusState({ queueState: { pending: [], inFlight: new Set(), maxConcurrent: 1 } });
  assert.deepEqual(handleKey('q', emptyQueue), { type: 'quit' });
});

test('f on a focused pending ticket opens the force-start confirmation, naming that exact ticket', () => {
  assert.deepEqual(handleKey('f', queueFocusState({ queueFocus: 1 })),
    { type: 'open-force-start-confirm', ticket: 'CON-2' });
});

test('f is a no-op when nothing is validly focused (queueFocus null or out of range)', () => {
  assert.equal(handleKey('f', queueFocusState({ queueFocus: null })), null);
  assert.equal(handleKey('f', queueFocusState({ queueFocus: 99 })), null);
});

test('f outside queue focus is unbound, same as any other unclaimed key', () => {
  assert.equal(handleKey('f', state({})), null);
});

// --- CON-109, fleet-bulk-select spec: `space` toggles the QUEUED-local
// cursor's ticket into the QUEUED multi-select set --------------------------

test('space on a focused QUEUED row toggles it into the QUEUED multi-select set', () => {
  assert.deepEqual(handleKey(' ', queueFocusState({ queueFocus: 1 })),
    { type: 'toggle-multi-select', section: 'queued', ticket: 'CON-2' });
});

test('space is a no-op in QUEUED focus when nothing is validly focused (queueFocus null or out of range)', () => {
  assert.equal(handleKey(' ', queueFocusState({ queueFocus: null })), null);
  assert.equal(handleKey(' ', queueFocusState({ queueFocus: 99 })), null);
});

// --- CON-109, fleet-queue-force-start spec: a non-empty QUEUED
// multi-select set makes `f` bulk instead of single-row ---------------------

test('f with a non-empty QUEUED multi-select set opens the bulk force-start confirm, not the single-ticket one', () => {
  const s = queueFocusState({
    queueFocus: 1,
    multiSelect: { failed: new Set(), queued: new Set(['CON-1', 'CON-3']) },
  });
  assert.deepEqual(handleKey('f', s),
    { type: 'open-bulk-force-start-confirm', tickets: ['CON-1', 'CON-3'] });
});

test('f with an EMPTY QUEUED multi-select set behaves byte-for-byte exactly as before this change (tasks.md 3.3)', () => {
  const withEmptySet = queueFocusState({
    queueFocus: 1, multiSelect: { failed: new Set(), queued: new Set() },
  });
  const withNoField = queueFocusState({ queueFocus: 1 }); // multiSelect absent entirely
  assert.deepEqual(handleKey('f', withEmptySet), { type: 'open-force-start-confirm', ticket: 'CON-2' });
  assert.deepEqual(handleKey('f', withNoField), { type: 'open-force-start-confirm', ticket: 'CON-2' });
});

// CON-54: t on a focused QUEUED row opens the ticket detail view — resolved
// the same way f's own open-force-start-confirm resolves its ticket, above.
test('t on a focused pending ticket opens the ticket detail view, naming that exact ticket', () => {
  assert.deepEqual(handleKey('t', queueFocusState({ queueFocus: 1 })),
    { type: 'view-ticket', ticket: 'CON-2' });
});

test('t is a no-op when nothing is validly focused in QUEUED (queueFocus null or out of range)', () => {
  assert.equal(handleKey('t', queueFocusState({ queueFocus: null })), null);
  assert.equal(handleKey('t', queueFocusState({ queueFocus: 99 })), null);
});

// --- CON-39: force-start's own y/anything-else confirmation gate -----------

test('y confirms force-start, naming the ticket the confirmation was opened for', () => {
  const s = state({ forceStartConfirm: { ticket: 'CON-2' } });
  assert.deepEqual(handleKey('y', s), { type: 'confirm-force-start', ticket: 'CON-2' });
});

test('any other key cancels force-start without starting anything', () => {
  const s = state({ forceStartConfirm: { ticket: 'CON-2' } });
  assert.deepEqual(handleKey('q', s), { type: 'cancel-force-start' });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-force-start' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-force-start' });
});

test('forceStartConfirm is checked before quitConfirm — the two gates never both claim a keypress', () => {
  const s = state({ forceStartConfirm: { ticket: 'CON-2' }, quitConfirm: true });
  // A bare 'q' would ordinarily confirm quitConfirm — forceStartConfirm's
  // own gate must win instead, cancelling itself rather than falling
  // through to quitConfirm's quit-key handling.
  assert.deepEqual(handleKey('q', s), { type: 'cancel-force-start' });
});

// --- CON-39: force-start confirmation warning text --------------------------

test('the force-start confirmation names the resulting concurrent count against maxConcurrent', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(['CON-1']), maxConcurrent: 1 };
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })],
    { ...OPTS, queueState, forceStartConfirm: { ticket: 'CON-2' } }));
  assert.match(out, /this will run 2 concurrently, exceeding your maxConcurrent:1 setting/);
  assert.match(out, /y confirm force-start/);
});

// --- Clear Queue: drops queueState.pending, never inFlight ------------------

test('C opens the clear-queue confirmation when the QUEUED section has pending tickets', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(), maxConcurrent: 1 };
  assert.deepEqual(handleKey('C', state({ queueState })), { type: 'open-clear-queue-confirm' });
});

test('C is a no-op with no queue, or a queue with nothing pending', () => {
  assert.equal(handleKey('C', state({})), null);
  assert.equal(handleKey('C', state({ queueState: { pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1 } })), null);
});

test('y confirms clear-queue', () => {
  const s = state({ clearQueueConfirm: true });
  assert.deepEqual(handleKey('y', s), { type: 'confirm-clear-queue' });
});

test('any other key cancels clear-queue without dropping anything', () => {
  const s = state({ clearQueueConfirm: true });
  assert.deepEqual(handleKey('q', s), { type: 'cancel-clear-queue' });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-clear-queue' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-clear-queue' });
});

test('clearQueueConfirm is checked before forceStartConfirm and quitConfirm — the newest gate wins', () => {
  const s = state({ clearQueueConfirm: true, forceStartConfirm: { ticket: 'CON-2' }, quitConfirm: true });
  assert.deepEqual(handleKey('q', s), { type: 'cancel-clear-queue' });
});

test('the clear-queue confirmation names the exact pending count, and leaves inFlight unmentioned as at risk', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(['CON-1']), maxConcurrent: 1 };
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })],
    { ...OPTS, queueState, clearQueueConfirm: true }));
  assert.match(out, /this will drop 2 queued tickets — they will never start\. proceed\?/);
  assert.match(out, /y confirm clear/);
});

// --- CON-98: `d`'s own y/anything-else confirmation gate + on-screen banner
// (design.md Decision 2 / skeptic gate round 1, finding 3) -----------------

test('y confirms mark-done, naming the ticket the confirmation was opened for', () => {
  const s = state({ markDoneConfirm: { ticket: 'CON-9' } });
  assert.deepEqual(handleKey('y', s), { type: 'confirm-mark-done', ticket: 'CON-9' });
});

test('any other key cancels mark-done without writing anything', () => {
  const s = state({ markDoneConfirm: { ticket: 'CON-9' } });
  assert.deepEqual(handleKey('q', s), { type: 'cancel-mark-done' });
  assert.deepEqual(handleKey('j', s), { type: 'cancel-mark-done' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'cancel-mark-done' });
});

test('markDoneConfirm is checked before quitConfirm — the two gates never both claim a keypress', () => {
  const s = state({ markDoneConfirm: { ticket: 'CON-9' }, quitConfirm: true });
  assert.deepEqual(handleKey('q', s), { type: 'cancel-mark-done' });
});

// The load-bearing render-level check (skeptic gate round 1, finding 3): the
// banner must actually appear on screen, not just intercept keypresses —
// mirrors forceStartConfirm's own render test just above.
test('the mark-done confirmation banner is visible on screen while markDoneConfirm is set, naming the ticket', () => {
  const out = plain(renderFleet([run({})], { ...OPTS, markDoneConfirm: { ticket: 'CON-9' } }));
  assert.match(out, /mark CON-9 as done/);
  assert.match(out, /y confirm mark done/);
});

test('no mark-done banner when markDoneConfirm is unset', () => {
  const out = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(out, /mark .* as done/);
});

test('the footer advertises C clear queue only when a QUEUED section is actually present this frame', () => {
  const withoutQueue = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(withoutQueue, /C clear queue/);

  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const withQueue = plain(renderFleet([run({})], { ...OPTS, queueState }));
  assert.match(withQueue, /C clear queue/);

  const emptyQueue = plain(renderFleet([run({})],
    { ...OPTS, queueState: { pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1 } }));
  assert.doesNotMatch(emptyQueue, /C clear queue/);
});

// --- CON-98: the FAILED section's own footer hint (design.md's "only
// advertise a key that currently does something" discipline) --------------

test('the footer advertises a address / d done only when a FAILED section is actually rendered this frame', () => {
  const withoutFailed = plain(renderFleet([run({ status: 'running' })], OPTS));
  assert.doesNotMatch(withoutFailed, /a address/);
  assert.doesNotMatch(withoutFailed, /d done/);

  const withFailed = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })], OPTS));
  assert.match(withFailed, /a address/);
  assert.match(withFailed, /d done/);
});

// --- CON-98: `a`'s inline notice (non-claude-code harness) -----------------

test('addressFailureNotice renders inline on the fleet screen, following queueNotice\'s own precedent', () => {
  const out = plain(renderFleet([run({})],
    { ...OPTS, addressFailureNotice: "/concertino-address-failure isn't available for codex yet" }));
  assert.match(out, /isn't available for codex yet/);
});

test('no addressFailureNotice line when unset', () => {
  const out = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(out, /concertino-address-failure/);
});

// --- CON-109, fleet-bulk-select spec: the dedicated multi-select marker ---

test('a multi-selected FAILED row shows the dedicated ✓ marker, whether or not it is the cursor row', () => {
  const multiSelect = { failed: new Set(['HEL-9']), queued: new Set() };
  const out = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })],
    { ...OPTS, selected: 0, multiSelect }));
  const line = out.split('\n').find((l) => l.includes('HEL-9'));
  assert.match(line, /✓/);
});

test('a non-multi-selected FAILED row shows no ✓ marker', () => {
  const out = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })],
    { ...OPTS, multiSelect: { failed: new Set(), queued: new Set() } }));
  const line = out.split('\n').find((l) => l.includes('HEL-9'));
  assert.doesNotMatch(line, /✓/);
});

test('a FAILED row can show both the multi-select ✓ marker AND the ordinary ▸ cursor marker at once', () => {
  const multiSelect = { failed: new Set(['HEL-9']), queued: new Set() };
  const out = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })],
    { ...OPTS, selected: 0, multiSelect }));
  const line = out.split('\n').find((l) => l.includes('HEL-9'));
  assert.match(line, /✓/);
  assert.match(line, /▸/);
});

test('a multi-selected QUEUED row shows the dedicated ✓ marker, independent of the » focus marker', () => {
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  const multiSelect = { failed: new Set(), queued: new Set(['CON-9']) };
  const out = plain(renderFleet([run({})], { ...OPTS, queueState, multiSelect }));
  const line = out.split('\n').find((l) => l.includes('CON-9'));
  assert.match(line, /✓/);
  assert.doesNotMatch(line, /»/, 'no QUEUED focus in this fixture — only the multi-select marker should show');
});

test('no multi-select marker on any row when multiSelect is entirely absent from opts', () => {
  const out = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })], OPTS));
  const line = out.split('\n').find((l) => l.includes('HEL-9'));
  assert.doesNotMatch(line, /✓/);
});

// --- CON-109, design.md Decision 4: the bulk confirmation banner ----------

test('the bulk address confirmation banner names the row count', () => {
  const out = plain(renderFleet([run({ ticket: 'HEL-9', status: 'failed' })],
    { ...OPTS, bulkConfirm: { section: 'failed', kind: 'address', tickets: ['HEL-1', 'HEL-2', 'HEL-3'] } }));
  assert.match(out, /address 3 FAILED runs\?/);
  assert.match(out, /y confirm/);
});

test('the bulk mark-done confirmation banner names the row count, not any single ticket', () => {
  const out = plain(renderFleet([run({ ticket: 'HEL-9', status: 'failed' })],
    { ...OPTS, bulkConfirm: { section: 'failed', kind: 'mark-done', tickets: ['HEL-1', 'HEL-2', 'HEL-3', 'HEL-4'] } }));
  assert.match(out, /mark 4 runs as done\?/);
  assert.doesNotMatch(out, /HEL-1|HEL-2|HEL-3|HEL-4/, 'no single ticket id should be named in a bulk banner');
});

test('the bulk force-start confirmation banner names both the count and the resulting concurrency overage', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(['CON-1']), maxConcurrent: 2 };
  // Wider than OPTS' default 78 cols — the full warning line is long enough
  // to truncate (with a trailing "…") at a narrower width, which would hide
  // the very "maxConcurrent:2" suffix this assertion checks for. `rows` is
  // deliberately left unset (as OPTS itself leaves it) so grid mode's own
  // height gate (columnAreaHeight >= 7) never engages even though cols alone
  // clears GRID_MIN_COLS — this stays on the ordinary single-column path.
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })], {
    ...OPTS, cols: 130, queueState,
    bulkConfirm: { section: 'queued', kind: 'force-start', tickets: ['CON-2', 'CON-3'] },
  }));
  assert.match(out, /force-start 2 queued tickets/);
  assert.match(out, /run 3 concurrently, exceeding your maxConcurrent:2 setting/);
});

test('bulkConfirm is checked in the same gate-precedence chain as markDoneConfirm — never rendered alongside quitConfirm\'s own banner', () => {
  const out = plain(renderFleet([run({})],
    { ...OPTS, bulkConfirm: { section: 'failed', kind: 'mark-done', tickets: ['HEL-1'] }, quitConfirm: true }));
  assert.match(out, /mark 1 run as done\?/);
  assert.doesNotMatch(out, /quit with/);
});

test('no bulk confirmation banner when bulkConfirm is unset', () => {
  const out = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(out, /address \d+ FAILED runs\?|mark \d+ runs? as done\?|force-start \d+ queued tickets/);
});

// --- CON-109, design.md Decision 4: the post-confirm per-row result list ---

test('bulkResult renders one line per ticket with a ✓/✗ marker, error text on failure', () => {
  // Distinct ticket ids from fleet.test.js's own run() default ('HEL-1') —
  // otherwise `.find(l => l.includes('HEL-1'))` below would match the
  // ordinary run row itself, not the bulkResult tail line.
  const bulkResult = {
    kind: 'mark-done',
    results: [
      { ticket: 'ZZZ-1', ok: true, error: null },
      { ticket: 'ZZZ-2', ok: false, error: 'stale — run no longer present' },
    ],
  };
  const out = plain(renderFleet([run({})], { ...OPTS, bulkResult }));
  const lines = out.split('\n');
  const okLine = lines.find((l) => l.includes('ZZZ-1'));
  const failLine = lines.find((l) => l.includes('ZZZ-2'));
  assert.match(okLine, /✓/);
  assert.doesNotMatch(okLine, /✗/);
  assert.match(failLine, /✗/);
  assert.match(failLine, /stale — run no longer present/);
});

test('a fully-successful bulkResult still renders — every row explicitly ✓, not silently hidden', () => {
  const bulkResult = { kind: 'mark-done', results: [{ ticket: 'HEL-1', ok: true, error: null }, { ticket: 'HEL-2', ok: true, error: null }] };
  const out = plain(renderFleet([run({})], { ...OPTS, bulkResult }));
  assert.match(out, /✓ HEL-1/);
  assert.match(out, /✓ HEL-2/);
});

test('no bulkResult lines when bulkResult is unset', () => {
  const out = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(out, /✓ HEL|✗ HEL/);
});

// --- CON-109, fleet-bulk-select spec: the `space select` footer hint -------

test('the footer advertises space select when a FAILED or QUEUED section is on screen, never when neither is', () => {
  const neither = plain(renderFleet([run({ status: 'running' })], OPTS));
  assert.doesNotMatch(neither, /space select/);

  const withFailed = plain(renderFleet(
    [run({ ticket: 'HEL-9', status: 'failed', endStatus: 'escalated' })], OPTS));
  assert.match(withFailed, /space select/);

  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const withQueued = plain(renderFleet([run({ status: 'running' })], { ...OPTS, queueState }));
  assert.match(withQueued, /space select/);
});

// --- CON-109, design.md Decision 4 (skeptic gate round 1, finding 2):
// bulkConfirm/bulkResult must be accounted for wherever the render-opts
// "every tail-lengthening field" list is duplicated (tasks.md 9.4) ---------

test('mergeRenderOpts threads bulkConfirm/bulkResult through to renderFleet — the banner/result list actually reach the screen', () => {
  const { render } = require('../lib/ui/screens/fleet/render');
  const bulkConfirmState = { runs: [run({})], bulkConfirm: { section: 'failed', kind: 'mark-done', tickets: ['HEL-1'] } };
  const outConfirm = plain(render(bulkConfirmState, { cols: 78 }));
  assert.match(outConfirm, /mark 1 run as done\?/);

  const bulkResultState = { runs: [run({})], bulkResult: { kind: 'mark-done', results: [{ ticket: 'HEL-1', ok: true, error: null }] } };
  const outResult = plain(render(bulkResultState, { cols: 78 }));
  assert.match(outResult, /✓ HEL-1/);
});

// --- CON-39: QUEUED-local cursor's own marker, distinct from ▸ -------------

test('the focused queued row renders a marker distinct from the ordinary ▸ run-selection marker', () => {
  const queueState = { pending: ['CON-9', 'CON-10'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderFleet([run({})], { ...OPTS, queueState, focus: 'queue', queueFocus: 1 }));
  const lines = out.split('\n');
  const con9Line = lines.find((l) => l.includes('CON-9') && !l.includes('CON-10'));
  const con10Line = lines.find((l) => l.includes('CON-10'));
  assert.ok(con9Line && con10Line);
  assert.doesNotMatch(con9Line, /»/, 'the unfocused queued row must not carry the focus marker');
  assert.match(con10Line, /»/, 'the focused queued row must carry the focus marker');
  assert.doesNotMatch(con10Line, /▸/, 'the focus marker must never be the ordinary run-selection ▸');
});

test('no queued row carries the focus marker when focus is not on queue', () => {
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderFleet([run({})], { ...OPTS, queueState }));
  assert.doesNotMatch(out, /»/);
});

// --- CON-39: QUEUED rows show the batch's speed and agent-merge setting ----

test('a queued row shows speed and agent-merge when both are present in launchCommand', () => {
  const queueState = {
    pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1,
    launchCommand: 'claude "/concertino-deliver {{TICKET}} --agent-merge fast"',
  };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  const line = out.split('\n').find((l) => l.includes('CON-2'));
  assert.match(line, /fast/);
  assert.match(line, /agent-merge on/);
});

test('a queued row omits the agent-merge field when launchCommand carries no flag token', () => {
  const queueState = {
    pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1,
    launchCommand: 'echo "custom launcher with no {{TICKET}} placeholder"',
  };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  const line = out.split('\n').find((l) => l.includes('CON-2'));
  assert.doesNotMatch(line, /agent-merge/);
});

test('every row in a QUEUED section shows the same batch-level speed/agent-merge, not re-derived per ticket', () => {
  const queueState = {
    pending: ['CON-2', 'CON-3', 'CON-4'], inFlight: new Set(), maxConcurrent: 1,
    launchCommand: 'codex "/concertino-deliver {{TICKET}} --no-agent-merge slow"',
  };
  const out = renderFleet([run({})], { ...OPTS, queueState });
  for (const ticket of ['CON-2', 'CON-3', 'CON-4']) {
    const line = out.split('\n').find((l) => l.includes(ticket));
    assert.match(line, /slow/, `${ticket}'s row should show the batch speed`);
    assert.match(line, /agent-merge off/, `${ticket}'s row should show the batch agent-merge setting`);
  }
});

// Existing "queued row with/without cached title" behavior (fixture near the
// top of this file) must still hold in shape — title still renders, now
// alongside the new speed/agent-merge fields.

test('a queued row with a cached title still shows position/ticket/title, now alongside speed/agent-merge', () => {
  const queueState = {
    pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1,
    launchCommand: 'claude "/concertino-deliver {{TICKET}} fast"',
  };
  const queuedTitles = new Map([['CON-2', 'Add zod validation']]);
  const out = renderFleet([run({})], { ...OPTS, queueState, queuedTitles });
  assert.match(out, /1\. CON-2 {2}Add zod validation/);
  assert.match(out, /fast/);
});

// --- CON-39: footer discoverability -----------------------------------------

test('the footer always advertises the digit-jump hint', () => {
  const out = plain(renderFleet([run({})], OPTS));
  assert.match(out, /1-9 jump/);
});

test('the footer advertises f force-start only when a QUEUED section is actually present this frame', () => {
  const withoutQueue = plain(renderFleet([run({})], OPTS));
  assert.doesNotMatch(withoutQueue, /f force-start/);

  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const withQueue = plain(renderFleet([run({})], { ...OPTS, queueState }));
  assert.match(withQueue, /f force-start/);

  const emptyQueue = plain(renderFleet([run({})],
    { ...OPTS, queueState: { pending: [], inFlight: new Set(), maxConcurrent: 1 } }));
  assert.doesNotMatch(emptyQueue, /f force-start/);
});

// --- lazygit-layout pass: [N] panel-number labels ---------------------------

test('a rendered section title is prefixed with its digit-jump number', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
  ], OPTS));
  assert.match(out, /\[1\] NEEDS YOU/);
  assert.match(out, /\[2\] RUNNING/);
});

test('section numbering skips sections that are not on screen this frame, matching sectionJumpTargets', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], OPTS));
  // NEEDS YOU and RUNNING are both empty (never rendered) — QUICK START
  // (CON-56: always on screen, forceRender when empty) is [1], so DONE is
  // the SECOND section on screen, not the first (and not whatever position
  // it holds in buildSections' own full list).
  assert.match(out, /\[2\] DONE/);
});

test('the [N] shown in a title always equals the digit that actually jumps to it', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'failed', endStatus: 'escalated', endedAt: 100, elapsedMs: 60000 }),
    run({ ticket: 'HEL-4', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  // CON-56: QUICK START is unconditional now, so it's implicitly among these
  // targets too (no flag to pass) — metricsVisible: true here matches
  // renderFleet's own always-on METRICS section (metricsFor always returns a
  // truthy object), so `targets` and the actual render agree on every digit.
  const targets = sectionJumpTargets(runs, null, true);
  const out = plain(renderFleet(runs, OPTS));
  targets.forEach((t, i) => {
    const n = i + 1;
    assert.match(out, new RegExp(`\\[${n}\\] ${t.section.title.replace(/[[\]()]/g, '\\$&')}`));
  });
});

// ============================================================================
// CON-40: QUICK START widget — build/render/height budget, focus, key handling
// ============================================================================

function qsTicket(over) {
  return Object.assign({ identifier: 'CON-1', title: 'Some ticket', priority: 2 }, over);
}

// --- section presence/position ----------------------------------------------

test('the QUICK START section always appears — CON-56, no toggle/opt required', () => {
  const noOptsAtAll = plain(renderFleet([run({})], OPTS));
  assert.match(noOptsAtAll, /QUICK START/);

  const withTickets = plain(renderFleet([run({})],
    { ...OPTS, quickStartTickets: [qsTicket({})] }));
  assert.match(withTickets, /QUICK START/);
});

test('QUICK START renders between RUNNING and QUEUED', () => {
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderFleet([run({ status: 'running' })], {
    ...OPTS, queueState, quickStartTickets: [qsTicket({ identifier: 'CON-5' })],
  }));
  const runningIdx = out.indexOf('RUNNING');
  const quickStartIdx = out.indexOf('QUICK START');
  const queuedIdx = out.indexOf('QUEUED');
  assert.ok(runningIdx >= 0 && quickStartIdx > runningIdx && queuedIdx > quickStartIdx,
    `expected RUNNING < QUICK START < QUEUED, got indices ${runningIdx}, ${quickStartIdx}, ${queuedIdx}`);
});

// --- empty/cold hint ---------------------------------------------------------

test('a cold cache shows the fetch hint, distinct from the fully-filtered hint', () => {
  const cold = plain(renderFleet([run({})],
    { ...OPTS, quickStartTickets: [], quickStartCold: true }));
  assert.match(cold, /no tickets cached yet — press N to fetch/);

  const filtered = plain(renderFleet([run({})],
    { ...OPTS, quickStartTickets: [], quickStartCold: false }));
  assert.match(filtered, /nothing left to quick-start/);
  assert.doesNotMatch(filtered, /no tickets cached yet/);
});

test('a populated QUICK START list never shows either empty hint', () => {
  const out = plain(renderFleet([run({})],
    { ...OPTS, quickStartTickets: [qsTicket({})] }));
  assert.doesNotMatch(out, /no tickets cached yet/);
  assert.doesNotMatch(out, /nothing left to quick-start/);
});

// --- sectionHeight / cap ------------------------------------------------------

test('buildSections always includes a QUICK START entry, even with no opts at all', () => {
  const sections = buildSections({ needsYou: [], active: [run({})], failed: [], done: [] }, null, {});
  assert.ok(sections.some((s) => s.kind === 'quickstart'));
});

test('a forceRender-empty QUICK START section is flagged correctly by buildSections', () => {
  const emptySections = buildSections(
    { needsYou: [], active: [run({})], failed: [], done: [] }, null,
    { quickStartTickets: [] });
  const qs = emptySections.find((s) => s.kind === 'quickstart');
  assert.equal(qs.forceRender, true);
  assert.equal(qs.group.length, 0);
});

test('sectionHeight costs a forceRender-empty QUICK START exactly 3 rows', () => {
  // CON-56: QUICK START is always on screen now, so its box cost is measured
  // directly off a single render (no on/off comparison to diff against) —
  // the span from its own numbered title line up to (not including) the
  // next section's (METRICS, which always immediately follows it here: no
  // QUEUED, and FAILED/DONE are both empty and unforced, so they render
  // nothing) title line.
  const out = plain(renderFleet([run({})], OPTS));
  const lines = out.split('\n');
  const qsIdx = lines.findIndex((l) => l.includes('QUICK START'));
  const metricsIdx = lines.findIndex((l) => l.includes('METRICS'));
  assert.ok(qsIdx >= 0 && metricsIdx > qsIdx);
  assert.equal(metricsIdx - qsIdx, 3, 'a forceRender-empty QUICK START box (1 hint line + 2-row border) must cost exactly 3 lines');
});

test('a populated QUICK START section carries cap: QUICK_START_COUNT, not undefined/NaN', () => {
  const sections = buildSections({ needsYou: [], active: [], failed: [], done: [] }, null,
    { quickStartTickets: [qsTicket({})] });
  const qs = sections.find((s) => s.kind === 'quickstart');
  assert.equal(qs.cap, QUICK_START_COUNT);
  assert.equal(Number.isNaN(qs.cap), false);
});

// --- sectionJumpTargets -------------------------------------------------------

test('sectionJumpTargets always includes a forceRender-empty QUICK START', () => {
  const targets = sectionJumpTargets([run({ status: 'running' })], null, true);
  const kinds = targets.map((t) => t.section.kind);
  assert.ok(kinds.includes('quickstart'), `expected 'quickstart' among ${kinds.join(',')}`);
});

test('sectionJumpTargets never throws when metricsVisible passes the bare {} stand-in buildSections only checks for truthiness', () => {
  // CON-56: sectionJumpTargets dropped its middle `quickStartVisible`
  // parameter — signature is now (runs, queueState, metricsVisible).
  const targets = sectionJumpTargets([run({ status: 'running' })], null, true);
  const kinds = targets.map((t) => t.section.kind);
  assert.ok(kinds.includes('metrics'), `expected 'metrics' among ${kinds.join(',')}`);
});

// --- row rendering -------------------------------------------------------------

test('a populated QUICK START row renders via the ticket-object row renderer, with the correct row focused', () => {
  const out = plain(renderFleet([run({})], {
    ...OPTS, focus: 'quickstart', quickStartFocus: 1,
    quickStartTickets: [
      qsTicket({ identifier: 'CON-10', title: 'First ticket', priority: 1 }),
      qsTicket({ identifier: 'CON-11', title: 'Second ticket', priority: 2 }),
    ],
  }));
  const lines = out.split('\n');
  const firstLine = lines.find((l) => l.includes('CON-10'));
  const secondLine = lines.find((l) => l.includes('CON-11'));
  assert.ok(firstLine && secondLine);
  assert.match(firstLine, /Urg/, 'priority label should render (reusing launchpad.js priorityLabel)');
  assert.doesNotMatch(firstLine, /»/, 'the unfocused row must not carry the focus marker');
  assert.match(secondLine, /»/, 'the focused row (quickStartFocus: 1) must carry the focus marker');
  assert.doesNotMatch(secondLine, /▸/, 'the focus marker must never be the ordinary run-selection ▸');
});

test('a QUEUED row in the same frame still renders via the unchanged renderQueuedRow path', () => {
  const queueState = { pending: ['CON-20'], inFlight: new Set(), maxConcurrent: 1 };
  const queuedTitles = new Map([['CON-20', 'A queued ticket']]);
  const out = plain(renderFleet([run({})], {
    ...OPTS, queueState, queuedTitles,
    quickStartTickets: [qsTicket({ identifier: 'CON-30', title: 'A quick-start ticket' })],
  }));
  assert.match(out, /1\. CON-20 {2}A queued ticket/);
  assert.match(out, /CON-30/);
  assert.match(out, /A quick-start ticket/);
});

// --- renderFleet actually draws the section (pins 2.10/2.11) -----------------

test('renderFleet\'s own returned string actually contains a rendered QUICK START box/hint', () => {
  const withTickets = renderFleet([run({})], {
    ...OPTS, quickStartTickets: [qsTicket({ identifier: 'CON-40' })],
  });
  assert.match(plain(withTickets), /QUICK START/);
  assert.match(plain(withTickets), /CON-40/);

  const emptyForced = renderFleet([run({})], {
    ...OPTS, quickStartTickets: [], quickStartCold: true,
  });
  assert.match(plain(emptyForced), /QUICK START/);
  assert.match(plain(emptyForced), /no tickets cached yet/);
});

// --- row-index space is unaffected --------------------------------------------

test('a visible QUICK START section never perturbs the run row-index space', () => {
  // Array order mirrors the canonical section order (FAILED, RUNNING, then
  // DONE) so `selected: n` lines up with the flat walk position `n` renders
  // at. DONE matters here specifically: QUICK START renders AFTER RUNNING
  // and BEFORE DONE in the canonical order (NEEDS YOU, FAILED, RUNNING,
  // QUICK START, QUEUED, DONE), so a DONE row is the only runs-backed row in
  // this fixture that actually sits BELOW QUICK START on screen. Without it,
  // this test could pass even if QUICK START's rows wrongly consumed a slot
  // in the selectable-index space, because both FAILED and RUNNING render
  // above QUICK START regardless.
  const runs = [
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100 }),
  ];
  const opts = {
    ...OPTS,
    quickStartTickets: [qsTicket({}), qsTicket({ identifier: 'CON-2' })],
  };

  const outSecond = plain(renderFleet(runs, { ...opts, selected: 1 }));
  const markedSecond = outSecond.split('\n').filter((l) => l.includes('▸'));
  assert.equal(markedSecond.length, 1);
  assert.match(markedSecond[0], /HEL-1/, 'selected=1 must still resolve to the second RUN, unaffected by QUICK START rows above it');

  // The real regression case: DONE renders below QUICK START, so this only
  // stays correct if QUICK START's (unselectable) rows never consumed a
  // slot in the shared index space.
  const outThird = plain(renderFleet(runs, { ...opts, selected: 2 }));
  const markedThird = outThird.split('\n').filter((l) => l.includes('▸'));
  assert.equal(markedThird.length, 1);
  assert.match(markedThird[0], /HEL-3/, 'selected=2 must resolve to the DONE run, which renders below QUICK START — this is what would break if QUICK START rows perturbed the index space');
});

test('no QUICK START row is ever marked with the ordinary run-row ▸ selection marker', () => {
  const out = plain(renderFleet([run({})], {
    ...OPTS, selected: 0, quickStartTickets: [qsTicket({})],
  }));
  const quickStartLine = out.split('\n').find((l) => l.includes(qsTicket({}).identifier));
  assert.ok(quickStartLine);
  assert.doesNotMatch(quickStartLine, /▸/);
});

// --- height-budget trimming ----------------------------------------------------

test('height-budget trimming accounts for QUICK START like any other non-pinned section', () => {
  const manyRuns = [];
  for (let i = 0; i < 10; i++) manyRuns.push(run({ ticket: 'HEL-' + i, status: 'done', endStatus: 'delivered', endedAt: 100 }));
  const emptyQuickStart = visibleWindow(manyRuns, { rows: 12, selected: 0 });
  const populatedQuickStart = visibleWindow(manyRuns, {
    rows: 12, selected: 0, quickStartTickets: [qsTicket({})],
  });
  // CON-56: QUICK START is always one of the built sections (index 3:
  // NEEDS YOU, FAILED, RUNNING, QUICK START, ... — fleet-metrics-grid moved
  // FAILED to index 1) regardless of how many tickets it holds — the
  // section count itself never changes; populating it changes what it
  // SHOWS (and so how much height-budget accounting sees it consume), which
  // is what this test actually checks.
  assert.equal(emptyQuickStart.sections.length, populatedQuickStart.sections.length);
  assert.equal(emptyQuickStart.sections[3].shown, 0);
  assert.equal(populatedQuickStart.sections[3].shown, 1);
});

// --- CON-40/CON-56: digit-jump discriminates quickstart vs queued vs ordinary -

test('digit-jump resolves to focus-quickstart when the target section is QUICK START', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  // Sections: RUNNING (1), QUICK START (2) — always on screen (CON-56).
  assert.deepEqual(
    handleKey('2', state({ runs })),
    { type: 'focus-quickstart', index: 0 },
  );
});

test('digit-jump resolves to focus-queue (not focus-quickstart) when both QUICK START and QUEUED are on screen', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  // Sections: RUNNING(1), QUICK START(2), QUEUED(3).
  assert.deepEqual(
    handleKey('3', state({ runs, queueState })),
    { type: 'focus-queue', index: 0 },
  );
  assert.deepEqual(
    handleKey('2', state({ runs, queueState })),
    { type: 'focus-quickstart', index: 0 },
  );
});

// --- CON-40: the QUICK START-local focus cursor -------------------------------

function quickStartFocusState(over) {
  return state(Object.assign({ focus: 'quickstart', quickStartFocus: 0 }, over));
}

test('j/k (and arrow aliases) move the QUICK START-local cursor while focused, never the ordinary move action', () => {
  assert.deepEqual(handleKey('j', quickStartFocusState({})), { type: 'move-quickstart-focus', delta: 1 });
  assert.deepEqual(handleKey('k', quickStartFocusState({})), { type: 'move-quickstart-focus', delta: -1 });
  assert.deepEqual(handleKey('\x1b[B', quickStartFocusState({})), { type: 'move-quickstart-focus', delta: 1 });
  assert.deepEqual(handleKey('\x1b[A', quickStartFocusState({})), { type: 'move-quickstart-focus', delta: -1 });
});

test('a emits quickstart-add unconditionally while focused, even with no ticket data in state', () => {
  assert.deepEqual(handleKey('a', quickStartFocusState({ quickStartFocus: 3 })),
    { type: 'quickstart-add', index: 3 });
  // Still emitted even for an index that could not possibly resolve — handleKey
  // has no ticket list to check against (design.md Decision 3).
  assert.deepEqual(handleKey('a', quickStartFocusState({ quickStartFocus: 99 })),
    { type: 'quickstart-add', index: 99 });
});

// CON-54: t emits view-ticket-quickstart unconditionally while focused, same
// as a's own quickstart-add just above — handleKey has no ticket list to
// resolve `index` against; watch.js does that (design.md Decision 1/3).
test('t emits view-ticket-quickstart unconditionally while focused, even with no ticket data in state', () => {
  assert.deepEqual(handleKey('t', quickStartFocusState({ quickStartFocus: 3 })),
    { type: 'view-ticket-quickstart', index: 3 });
  assert.deepEqual(handleKey('t', quickStartFocusState({ quickStartFocus: 99 })),
    { type: 'view-ticket-quickstart', index: 99 });
});

test('bare Escape exits QUICK START focus', () => {
  assert.deepEqual(handleKey('\x1b', quickStartFocusState({})), { type: 'exit-quickstart-focus' });
});

test('Enter/l/n/N are suppressed (no-ops) while focus is quickstart', () => {
  assert.equal(handleKey('\r', quickStartFocusState({})), null);
  assert.equal(handleKey('l', quickStartFocusState({})), null);
  assert.equal(handleKey('\x1b[C', quickStartFocusState({})), null);
  assert.equal(handleKey('n', quickStartFocusState({})), null);
  assert.equal(handleKey('N', quickStartFocusState({})), null);
});

test('forceStartConfirm/quitConfirm still short-circuit before quickstart-focus handling', () => {
  const withForceStart = state({ forceStartConfirm: { ticket: 'CON-1' }, focus: 'quickstart' });
  assert.deepEqual(handleKey('a', withForceStart), { type: 'cancel-force-start' });

  const withQuitConfirm = state({ quitConfirm: true, focus: 'quickstart' });
  assert.deepEqual(handleKey('a', withQuitConfirm), { type: 'cancel-quit' });
});

test('the footer no longer advertises a Q quick start hint — CON-56 removes the toggle', () => {
  // A wider terminal than OPTS' 78 cols, matching the width the old test used
  // to check the hint's presence — now checking its absence, over the same
  // full footer line (↵ attach / l details / j/k move / 1-9 jump / n new run
  // / N launch pad / q quit).
  const out = plain(renderFleet([run({})], { cols: 140, selected: 0 }));
  assert.doesNotMatch(out, /Q quick start/);
  assert.match(out, /q quit/);
});

// --- CON-48: a live post-run.end escalation buckets under NEEDS YOU --------
// Drives the actual reducer output (not a hand-built Run) through the real
// fleet screen, so a regression in either reducer.js's precedence or fleet's
// own bucketing would fail here even if each were unit-tested in isolation.

test('a run.end-then-live-escalation run lands in NEEDS YOU, not DONE', () => {
  const events = new Map([
    ['HEL-16', { malformed: 0, events: [
      ev(100, 'run.start', 'HEL-16', { branch: 'task/sync-drift-cleanup/HEL-16' }),
      ev(200, 'run.end', 'HEL-16', { status: 'delivered' }),
      ev(210, 'escalation.raised', 'HEL-16', {
        question: 'Want me to open a follow-up ticket for the sync drift, or leave it for now?',
        options: 'open-ticket,leave-it',
      }),
    ] }],
  ]);
  const windows = [{ ticket: 'HEL-16', alive: true, idleMs: 0 }];
  const runs = reduce(events, windows, 2000);

  assert.equal(runs[0].status, 'needs-you');
  assert.equal(runs[0].escalationStale, false);

  const out = plain(renderFleet(runs, { cols: 100, selected: 0 }));
  assert.match(out, /NEEDS YOU/);
  const needsYouIdx = out.indexOf('NEEDS YOU');
  const doneIdx = out.indexOf('DONE');
  const ticketIdx = out.indexOf('HEL-16');
  assert.ok(ticketIdx > needsYouIdx, 'HEL-16 should render under the NEEDS YOU section');
  assert.ok(doneIdx === -1 || ticketIdx < doneIdx, 'HEL-16 must not fall under DONE');
});

// --- CON-42: icon vocabulary -------------------------------------------------

test('QUICK START, QUEUED, and METRICS section titles are each prefixed with their own icon', () => {
  const icons = require('../lib/ui/icons');
  const queueState = { pending: ['CON-9'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderFleet([
    run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ], {
    ...OPTS, now: 100000, queueState, quickStartTickets: [qsTicket({ identifier: 'CON-5' })],
  }));
  assert.match(out, new RegExp(icons.quickStart + ' QUICK START'));
  assert.match(out, new RegExp(icons.queue + ' QUEUED'));
  assert.match(out, new RegExp(icons.metrics + ' METRICS'));
});

test('NEEDS YOU, RUNNING, FAILED, and DONE section headings carry no new icon — STATUS_COLOUR already governs them', () => {
  const out = plain(renderFleet([
    run({ ticket: 'HEL-338', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-2', status: 'failed' }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered' }),
  ], OPTS));
  // Exact, unprefixed section headings — no glyph inserted before them.
  // Canonical order: NEEDS YOU, FAILED, RUNNING, QUICK START (always on
  // screen now, CON-56 — untested here but still claims [4]), DONE.
  assert.match(out, /\[1\] NEEDS YOU/);
  assert.match(out, /\[2\] FAILED/);
  assert.match(out, /\[3\] RUNNING/);
  assert.match(out, /\[5\] DONE/);
});

// --- fleet-metrics-grid: renderStackedSection --------------------------

test('renderStackedSection renders a non-empty section as a bordered box at its natural height, with the given jump number', () => {
  const sections = buildSections({ needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [], done: [] }, null, {});
  const running = sections.find((s) => s.kind === 'running');
  const w = { shown: 1, startOffset: 0, hidden: 0 };
  const lines = renderStackedSection(running, 3, w, { cols: 70, avgDoneMs: null, selected: 0, sectionStartIndex: 0 });
  assert.match(lines[0], /\[3\] RUNNING/);
  assert.match(plain(lines.join('\n')), /HEL-1/);
  assert.equal(lines[lines.length - 1][0], '└', 'a natural-height box always closes with its own bottom border');
});

test('renderStackedSection renders a forceRender-empty section (e.g. METRICS-shaped) from its emptyLines', () => {
  const s = { title: 'X', group: [], statusKey: 'x', kind: 'x', unselectable: true, forceRender: true, emptyLines: ['one', 'two'] };
  const lines = renderStackedSection(s, 1, { shown: 0, startOffset: 0, hidden: 0 }, { cols: 40 });
  assert.match(plain(lines.join('\n')), /one/);
  assert.match(plain(lines.join('\n')), /two/);
});

test('renderStackedSection renders nothing for an ordinary empty, non-forceRender section', () => {
  const s = { title: 'X', group: [], statusKey: 'x', kind: 'x', forceRender: false };
  const lines = renderStackedSection(s, 1, { shown: 0, startOffset: 0, hidden: 0 }, { cols: 40 });
  assert.deepEqual(lines, []);
});

test('renderStackedSection never grows past its natural height, even when told about a larger box budget elsewhere on the page', () => {
  const sections = buildSections({ needsYou: [], active: [run({ ticket: 'HEL-1', status: 'running' })], failed: [], done: [] }, null, {});
  const running = sections.find((s) => s.kind === 'running');
  const w = { shown: 1, startOffset: 0, hidden: 0 };
  const lines = renderStackedSection(running, 1, w, { cols: 70, avgDoneMs: null, selected: 0, sectionStartIndex: 0 });
  // 1 run row (2 lines per row) + 2 border lines = 4, regardless of how
  // much vertical space the page has elsewhere (unlike renderFleet's
  // single-column loop, this function has no budget/grow-to-fill concept
  // at all).
  assert.equal(lines.length, 4);
});

// --- fleet-metrics-grid: visibleWindowGrid ------------------------------

const { visibleWindowGrid } = require('../lib/ui/screens/fleet');

test('visibleWindowGrid shows NEEDS YOU in full, exactly like visibleWindow\'s pinned treatment', () => {
  const runs = Array.from({ length: 5 }, (_, i) => run({ ticket: `HEL-${i}`, status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }));
  const win = visibleWindowGrid(runs, { rows: 15, selected: 0, cols: 150 });
  const idx = buildSections({ needsYou: runs, active: [], failed: [], done: [] }, null, {}).findIndex((s) => s.kind === 'needs-you');
  assert.equal(win.sections[idx].shown, 5);
});

test('visibleWindowGrid caps FAILED at MAX_FINISHED and never scroll-adjusts it', () => {
  const runs = manyFinished(12, 'failed');
  const win1 = visibleWindowGrid(runs, { rows: 30, selected: 0, scrollOffset: 0, cols: 150 });
  const win2 = visibleWindowGrid(runs, { rows: 30, selected: 0, scrollOffset: 10, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: runs, done: [] }, null, {}).findIndex((s) => s.kind === 'failed');
  assert.equal(win1.sections[idx].shown, 5);
  assert.equal(win1.sections[idx].startOffset, 0);
  assert.deepEqual(win1.sections[idx], win2.sections[idx], 'scrollOffset must not change FAILED\'s window in grid mode');
});

test('visibleWindowGrid windows DONE against the column area\'s own height, not the full terminal', () => {
  const runs = manyFinished(20, 'done');
  const winShort = visibleWindowGrid(runs, { rows: 12, selected: 0, scrollOffset: 0, cols: 150 });
  const winTall = visibleWindowGrid(runs, { rows: 40, selected: 0, scrollOffset: 0, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {}).findIndex((s) => s.kind === 'done');
  assert.ok(winTall.sections[idx].shown >= winShort.sections[idx].shown);
});

test('visibleWindowGrid\'s maxScrollOffset reflects only RUNNING/QUICK START/QUEUED/DONE, not FAILED', () => {
  // DONE has 12 items capped at MAX_FINISHED=5, so up to 7 can be scrolled
  // through; FAILED must not add to this even though it also has surplus.
  const done = manyFinished(12, 'done');
  const failed = manyFinished(12, 'failed');
  const runs = failed.concat(done);
  const win = visibleWindowGrid(runs, { rows: 0, selected: 0, scrollOffset: 0, cols: 150 });
  assert.equal(win.maxScrollOffset, 7);
});

test('visibleWindowGrid with rows:0 returns an unbounded (untrimmed) window, matching visibleWindow\'s own structural-query contract', () => {
  const runs = manyFinished(20, 'done');
  const win = visibleWindowGrid(runs, { rows: 0, selected: 0, scrollOffset: 0, cols: 150 });
  const idx = buildSections({ needsYou: [], active: [], failed: [], done: runs }, null, {}).findIndex((s) => s.kind === 'done');
  assert.equal(win.sections[idx].shown, 5, 'DONE still caps at MAX_FINISHED even untrimmed — cap and height-budget trim are different things');
});

// Regression: computeWindow re-bases its internal globalIndex at 0 over
// whatever section list it's handed, but `selected` is always a GLOBAL
// flat-row index (the one renderFleet/watch.js/Task 8's sectionStartIndices
// walk all use) that already counts NEEDS YOU's and FAILED's rows ahead of
// RUNNING. Passing selected straight through to computeWindow's restricted
// columnSections call — without translating it into that list's own
// re-based index space, and translating the returned indices back out —
// silently shifts firstVisibleIndex/lastVisibleIndex and the selected-row
// trim protection by needsYou.length + failed.length.
test('visibleWindowGrid translates the global `selected` into column 1\'s re-based index space and back out again', () => {
  const needsYou = Array.from({ length: 2 }, (_, i) => run({ ticket: `NY-${i}`, status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }));
  const failed = manyFinished(3, 'failed');
  const running = Array.from({ length: 4 }, (_, i) => run({ ticket: `RUN-${i}`, status: 'running' }));
  const runs = needsYou.concat(failed, running);
  // RUNNING's true global start index is needsYou.length + failed.length = 5.
  const win = visibleWindowGrid(runs, { rows: 30, selected: 5, scrollOffset: 0, cols: 150 });
  assert.equal(win.firstVisibleIndex, 5, 'RUNNING\'s global start index is 5 (2 needs-you + 3 failed ahead of it), not 0');
});

test('visibleWindowGrid\'s selected-row trim protection keeps the actually-selected RUNNING row visible, even though its global index is offset by NEEDS YOU/FAILED', () => {
  const needsYou = Array.from({ length: 2 }, (_, i) => run({ ticket: `NY-${i}`, status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }));
  const failed = manyFinished(3, 'failed');
  const running = Array.from({ length: 10 }, (_, i) => run({ ticket: `RUN-${i}`, status: 'running' }));
  const runs = needsYou.concat(failed, running);
  const idx = buildSections({ needsYou, active: running, failed, done: [] }, null, {}).findIndex((s) => s.kind === 'running');
  // selected = 5 is RUNNING's first row (global index needsYou.length + failed.length = 5).
  // rows: 26 and 30 are small enough that column 1 must trim RUNNING's 10
  // rows down, which is exactly when the mistranslated `selected` used to
  // evict the actually-selected row instead of protecting it.
  for (const rows of [26, 30]) {
    const win = visibleWindowGrid(runs, { rows, selected: 5, scrollOffset: 0, cols: 150 });
    const w = win.sections[idx];
    assert.ok(w.startOffset <= 0 && 0 < w.startOffset + w.shown,
      `rows:${rows} — RUNNING row 0 (the selected row) must stay within [startOffset, startOffset+shown), got ${JSON.stringify(w)}`);
  }
});

// --- Task 8: renderFleet's grid-mode branch ----------------------------

test('renderFleet stays single-column below GRID_MIN_COLS, byte-identical to before this task', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 109, rows: 30, selected: 0, now: 100000 }));
  assert.doesNotMatch(out, /METRICS.*RUNNING/s, 'single-column mode never places a later section\'s text before an earlier one on the same line');
  const lines = out.split('\n');
  assert.ok(lines.some((l) => l.trim().startsWith('┌') && l.includes('RUNNING')));
});

test('renderFleet: cols one below GRID_MIN_COLS stays single-column, cols at GRID_MIN_COLS switches to grid', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const { GRID_MIN_COLS } = require('../lib/ui/screens/fleet');
  const belowLines = plain(renderFleet(runs, { cols: GRID_MIN_COLS - 1, rows: 30, selected: 0, now: 100000 })).split('\n');
  const atLines = plain(renderFleet(runs, { cols: GRID_MIN_COLS, rows: 30, selected: 0, now: 100000 })).split('\n');
  assert.notEqual(
    belowLines.findIndex((l) => l.includes('RUNNING')),
    belowLines.findIndex((l) => l.includes('METRICS')),
    'below GRID_MIN_COLS, RUNNING and METRICS must be on DIFFERENT lines (single-column stack)',
  );
  assert.equal(
    atLines.findIndex((l) => l.includes('RUNNING')),
    atLines.findIndex((l) => l.includes('METRICS')),
    'at GRID_MIN_COLS, RUNNING and METRICS must be on the SAME line (side by side)',
  );
});

test('renderFleet switches to the two-column grid at GRID_MIN_COLS', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const runningLine = lines.find((l) => l.includes('RUNNING'));
  const metricsLine = lines.find((l) => l.includes('METRICS'));
  assert.ok(runningLine, 'RUNNING must render');
  assert.ok(metricsLine, 'METRICS must render');
  assert.equal(lines.indexOf(runningLine), lines.indexOf(metricsLine), 'RUNNING and METRICS render on the SAME line — side by side, not stacked');
});

test('grid mode: METRICS column fills the full column-area height regardless of column 1\'s actual content height', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })]; // column 1 has almost nothing to show
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const metricsBorderLines = lines.filter((l) => l.includes('│') || l.includes('┃'));
  // METRICS' own box border should extend well past where column 1's tiny
  // RUNNING box ends — i.e. there exist rows where the METRICS-side border
  // character is present but column 1's content area is just blank padding.
  assert.ok(metricsBorderLines.length > 6, 'METRICS should render a tall box, not a short one, on a 30-row terminal with almost no column-1 content');
});

test('grid mode: NEEDS YOU and FAILED render as full-width banners above the two columns', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
  ];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  const needsYouIdx = lines.findIndex((l) => l.includes('NEEDS YOU'));
  const failedIdx = lines.findIndex((l) => l.includes('FAILED'));
  const runningIdx = lines.findIndex((l) => l.includes('RUNNING'));
  assert.ok(needsYouIdx >= 0 && failedIdx >= 0 && runningIdx >= 0);
  assert.ok(needsYouIdx < failedIdx, 'NEEDS YOU banner comes first');
  assert.ok(failedIdx < runningIdx, 'FAILED banner comes before the two-column area starts');
});

test('grid mode: digit-jump numbers still match sectionJumpTargets\' numbering (no drift introduced by grid rendering)', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
    run({ ticket: 'HEL-4', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  const out = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  const targets = sectionJumpTargets(runs, null, false, true);
  targets.forEach((t, i) => {
    const num = i + 1;
    assert.match(out, new RegExp(`\\[${num}\\] ${t.section.title.replace(/[[\]()]/g, '\\$&')}`));
  });
});

test('grid mode: selecting a run inside DONE (rendered in column 1) still highlights the correct row', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const outSelected1 = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 1, now: 100000 }));
  const outSelected0 = plain(renderFleet(runs, { cols: 150, rows: 30, selected: 0, now: 100000 }));
  assert.notEqual(outSelected1, outSelected0, 'selecting a different row must change the render');
  // The ordinary run-selection marker is '▸' (see e.g. the QUICK START/
  // QUEUED-focus tests elsewhere in this file, which explicitly distinguish
  // their own '»' focus marker FROM '▸') — DONE is rendered via
  // renderFinishedRow, which uses '▸' like every other run row, not '»'
  // (QUEUED/QUICK START's unselectable-row focus marker; not applicable
  // here, there is no QUEUED/QUICK START section in this fixture).
  // Tightened past task-8-report's original "some marker exists somewhere"
  // check (flagged by review as weaker than the test name claims): assert
  // the marker sits on the SPECIFIC selected row, on both renders, not
  // merely that a '▸' appears somewhere in the whole frame.
  const hel1Selected1 = outSelected1.split('\n').find((l) => l.includes('HEL-1'));
  const hel2Selected1 = outSelected1.split('\n').find((l) => l.includes('HEL-2'));
  assert.ok(hel2Selected1 && hel2Selected1.includes('▸'), 'HEL-2 (selected: 1, the DONE row) must carry the ▸ marker');
  assert.ok(hel1Selected1 && !hel1Selected1.includes('▸'), 'HEL-1 must not carry the marker while HEL-2 is selected');

  const hel1Selected0 = outSelected0.split('\n').find((l) => l.includes('HEL-1'));
  const hel2Selected0 = outSelected0.split('\n').find((l) => l.includes('HEL-2'));
  assert.ok(hel1Selected0 && hel1Selected0.includes('▸'), 'HEL-1 (selected: 0, the RUNNING row) must carry the ▸ marker');
  assert.ok(hel2Selected0 && !hel2Selected0.includes('▸'), 'HEL-2 must not carry the marker while HEL-1 is selected');
});

// Final whole-branch review, Finding 4: this title used to read "the total
// rendered frame never exceeds the requested row budget", worded as a
// general system property. It isn't one — banners (NEEDS YOU/FAILED) are
// never trimmed by design, and METRICS' forceRender floor is untrimmable in
// single-column mode too (see the "METRICS charts pass... own untrimmable
// floor" comments elsewhere in this file), so a banner/METRICS-heavy
// fixture at a small enough `rows` can legitimately render MORE lines than
// the budget without that being a "cap" failure in the sense this title
// implied. Narrowed to scope the claim to what THIS fixture actually
// demonstrates: grid mode's own columnAreaHeight accounting (the thing the
// parenthetical was already about) stays scroll-by-one-safe across the
// `rows` values where grid mode actually engages.
//
// `rows` starts at 18, not 15: at cols:150 this exact fixture's
// columnAreaHeight only reaches 7 (METRICS' compact-tier floor — 5 content
// lines + 2-row border) at rows:18; below that, Finding 1's fix falls back
// to the single-column path, where METRICS' own untrimmable floor can
// legitimately exceed the budget (the same pre-existing, accepted behavior
// this file already documents for single-column mode) — a different,
// out-of-scope property from the one this test targets.
test('grid mode: columnAreaHeight accounting stays scroll-by-one-safe across rows where grid mode engages (this fixture never exceeds the row budget)', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
  ];
  for (const rows of [18, 20, 25, 30, 40]) {
    const out = renderFleet(runs, { cols: 150, rows, selected: 0, now: 100000 });
    const lineCount = out.split('\n').length;
    assert.ok(lineCount <= rows - 1, `at rows:${rows}, rendered ${lineCount} lines — must leave the one row reserved for the trailing newline`);
  }
});

test('grid mode: METRICS renders its expanded tier when the terminal is wide enough (>= COLUMN_ONE_WIDTH + 1 + 80)', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 160, rows: 30, selected: 0, now: 100000 }));
  assert.match(out, /throughput \(30d\)/);
});

// Final whole-branch review, Finding 1: metricsColumnLines' compact tier
// always returns exactly 5 lines with no shorter fallback, but
// renderFleetGrid used to size METRICS' box to exactly columnAreaHeight
// regardless of whether that height could actually fit all 5 — and
// layout.box silently drops content past `height - 2` with NO ellipsis and
// no other signal. A wide-but-short terminal (a horizontally-split tmux
// pane, a half-height terminal window) lands exactly in that gap: wide
// enough to qualify for grid mode (`cols >= GRID_MIN_COLS`) but short
// enough that columnAreaHeight computes into the 3-6 range — so METRICS
// rendered only 1-4 of its 5 compact lines, with the reader given no
// indication anything was cut. The design doc's old "can't happen in
// two-column mode by construction" edge-case claim was wrong: a terminal
// can be wide AND short at once, and the width-only `cols >= GRID_MIN_COLS`
// gate does not account for that.
test('grid mode: METRICS never silently drops compact-tier lines on a wide-but-short terminal', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
  ];
  // Pinned: for this exact fixture at cols:150, columnAreaHeight computes to
  // 4 at rows:15 — squarely in the 3-6 "not enough room for the compact
  // tier's 5 lines + 2-row border (7), but still nonzero" danger zone.
  const win = visibleWindowGrid(runs, { rows: 15, selected: 0, scrollOffset: 0, cols: 150 });
  assert.equal(win.columnAreaHeight, 4, 'fixture must actually reach columnAreaHeight: 4 at rows:15, cols:150');

  for (const rows of [14, 15, 16, 17]) {
    const out = plain(renderFleet(runs, { cols: 150, rows, selected: 0, now: 100000 }));
    const anyMetricsLine = /avg delivery|success\s+today|throughput \(|verdicts\s|gates\s/.test(out);
    // Either METRICS doesn't render at all this frame (e.g. a single-column
    // fallback, or a fully collapsed box) — acceptable — or, if it renders
    // ANY of its 5 compact-tier lines, it must render ALL FIVE. A partial
    // set (some lines silently dropped, others present) is exactly the bug.
    if (!anyMetricsLine) continue;
    assert.match(out, /avg delivery/, `rows:${rows}: METRICS line 1 (avg delivery) missing while another line rendered`);
    assert.match(out, /success\s+today/, `rows:${rows}: METRICS line 2 (success) missing while another line rendered`);
    assert.match(out, /throughput \(/, `rows:${rows}: METRICS line 3 (throughput) missing while another line rendered`);
    assert.match(out, /verdicts\s/, `rows:${rows}: METRICS line 4 (verdicts) missing while another line rendered`);
    assert.match(out, /gates\s/, `rows:${rows}: METRICS line 5 (gates) missing while another line rendered`);
  }

  // The chosen fix (fall back to the single-column path whenever the grid's
  // column area can't fit METRICS' compact tier) also needs pinning
  // directly: at rows:15/cols:150, RUNNING and METRICS must render
  // stacked (single-column), not side by side, even though cols alone
  // would otherwise qualify for grid mode.
  const fallbackOut = plain(renderFleet(runs, { cols: 150, rows: 15, selected: 0, now: 100000 }));
  const lines = fallbackOut.split('\n');
  const runningLine = lines.findIndex((l) => l.includes('RUNNING'));
  const metricsLine = lines.findIndex((l) => l.includes('METRICS'));
  assert.notEqual(runningLine, metricsLine,
    'at columnAreaHeight:4, grid mode must fall back to single-column — RUNNING and METRICS must be on DIFFERENT lines');
});

// Consequence of Finding 1's fix: renderFleet's grid-mode decision is no
// longer just `cols >= GRID_MIN_COLS` — it also requires the column area to
// fit METRICS' compact-tier floor. watch.js's own scroll-accounting call
// sites (the scrollOffset re-clamp and scrollToShow) must pick the exact
// SAME windowing function (visibleWindowGrid vs visibleWindow) the renderer
// will use this frame, or `maxScrollOffset`/`firstVisibleIndex` computed
// against grid mode's own accounting (which excludes FAILED entirely — it
// renders as a banner, never part of column 1's scrollable list) could be
// applied to a frame that actually rendered single-column (where FAILED IS
// part of the ordinary scrollable flat list). `gridModeEligible` is the
// shared helper both `renderFleet` and watch.js now use to avoid exactly
// that drift — this pins its own contract directly.
test('gridModeEligible matches renderFleet\'s own grid-mode decision, including the Finding 1 height gate', () => {
  const { gridModeEligible, GRID_MIN_COLS, GRID_MIN_COLUMN_AREA_HEIGHT } = require('../lib/ui/screens/fleet');
  assert.equal(GRID_MIN_COLUMN_AREA_HEIGHT, 7, 'this test is pinned to the documented threshold value');

  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
    run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
    run({ ticket: 'HEL-3', status: 'running' }),
  ];

  // Below GRID_MIN_COLS: never eligible, regardless of height.
  assert.equal(gridModeEligible(runs, { cols: GRID_MIN_COLS - 1, rows: 100, selected: 0, scrollOffset: 0 }), false);

  // At/above GRID_MIN_COLS but too short for METRICS' compact-tier floor
  // (columnAreaHeight: 6 at rows:17, for this exact fixture — see the
  // sibling "never silently drops" test above for the same fixture at
  // rows:15/columnAreaHeight:4): not eligible.
  assert.equal(gridModeEligible(runs, { cols: 150, rows: 17, selected: 0, scrollOffset: 0 }), false);

  // Just tall enough (columnAreaHeight: 7 at rows:18): eligible, and must
  // agree with what renderFleet itself actually renders this frame.
  assert.equal(gridModeEligible(runs, { cols: 150, rows: 18, selected: 0, scrollOffset: 0 }), true);
  const out = plain(renderFleet(runs, { cols: 150, rows: 18, selected: 0, now: 100000 }));
  const lines = out.split('\n');
  assert.equal(
    lines.findIndex((l) => l.includes('RUNNING')),
    lines.findIndex((l) => l.includes('METRICS')),
    'gridModeEligible said true at rows:18 — renderFleet must actually render RUNNING and METRICS side by side');

  // rows: 0 is a documented rows-independent structural query for OTHER
  // callers (visibleWindow/visibleWindowGrid's own `maxScrollOffset`
  // contract) — gridModeEligible must not be fooled into reporting `true`
  // for it; a caller needing both must check eligibility against the real
  // row count separately, per this function's own header comment.
  assert.equal(gridModeEligible(runs, { cols: 150, rows: 0, selected: 0, scrollOffset: 0 }), false);
});

test('grid mode: METRICS stays compact when the terminal is grid-eligible but METRICS\' own column is still narrow', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 })];
  const out = plain(renderFleet(runs, { cols: 115, rows: 30, selected: 0, now: 100000 }));
  assert.match(out, /throughput \(7d\)/);
  assert.doesNotMatch(out, /throughput \(30d\)/);
});

// --- Task 8 fix-loop regressions (task review findings) ------------------

// Critical finding: renderFleetGrid's old `metricsWidth = Math.max(40, cols
// - COLUMN_ONE_WIDTH - 1)` floor forced metricsWidth to 40 at cols === 110
// (GRID_MIN_COLS itself, cols - 70 - 1 = 39 pre-floor) — the hsplit row then
// composed to 70 + 1 + 40 = 111 columns against a 110-column budget, so the
// function's own trailing `f.truncate(l, cols)` stripped METRICS' right
// border and stamped a stray ellipsis on every line. No existing test used
// exactly cols: 110 (GRID_MIN_COLS), so this went undetected. Asserts every
// rendered line stays within budget at exactly that width, across several
// fixture shapes (with/without banners, with QUICK START/QUEUED) so the
// regression is pinned regardless of which sections are on screen.
test('grid mode: every rendered line fits within cols at exactly cols === GRID_MIN_COLS (110) — metricsWidth must never overflow the composed row', () => {
  const { GRID_MIN_COLS } = require('../lib/ui/screens/fleet');
  assert.equal(GRID_MIN_COLS, 110, 'this test is pinned to the documented threshold value');
  const fixtures = [
    [run({ ticket: 'HEL-1', status: 'running' })],
    [
      run({ ticket: 'HEL-1', status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }),
      run({ ticket: 'HEL-2', status: 'failed', endedAt: 100, elapsedMs: 1000 }),
      run({ ticket: 'HEL-3', status: 'done', endStatus: 'delivered', endedAt: 100, elapsedMs: 60000 }),
    ],
  ];
  for (const runs of fixtures) {
    const out = renderFleet(runs, { cols: GRID_MIN_COLS, rows: 30, selected: 0, now: 100000 });
    for (const line of out.split('\n')) {
      assert.ok(f.visibleLength(line) <= GRID_MIN_COLS,
        `line exceeds cols:${GRID_MIN_COLS} (visibleLength ${f.visibleLength(line)}): ${JSON.stringify(line)}`);
    }
    // The METRICS box's own right border must still be present, not
    // truncated away — the concrete symptom the reviewer observed.
    assert.doesNotMatch(plain(out), /…\s*$/m, 'no line should end in a stray truncation ellipsis at cols:110');
  }
});

// Important finding: visibleWindowGrid passed `rows: 0` straight into
// computeWindow whenever columnAreaHeight computed to exactly 0 (banners
// consuming the whole page) — but computeWindow's OWN `rows: 0` contract
// means "unbounded, don't trim" (a deliberate, documented behaviour other
// callers rely on for a structural maxScrollOffset query), not "collapse to
// nothing". So column 1 rendered at full natural height instead of
// collapsing, and a terminal one row SHORTER (columnAreaHeight going from 1
// to 0) could render a much LONGER frame than a taller one — non-monotonic,
// the opposite of what a height budget exists to guarantee. Fixed in
// visibleWindowGrid by forcing every column-1 section to shown:0 directly
// when columnAreaHeight === 0, bypassing computeWindow for that case.
test('grid mode: shrinking the terminal into columnAreaHeight === 0 must never grow the rendered frame past columnAreaHeight === 1\'s size', () => {
  const needsYou = Array.from({ length: 2 }, (_, i) =>
    run({ ticket: `NY-${i}`, status: 'needs-you', escalation: { question: 'q', options: [], raisedAt: 1 } }));
  const failed = manyFinished(4, 'failed');
  const running = Array.from({ length: 6 }, (_, i) => run({ ticket: `RUN-${i}`, status: 'running' }));
  const done = manyFinished(8, 'done');
  const runs = needsYou.concat(failed, running, done);

  // rows:16 -> columnAreaHeight computes to 0; rows:17 -> columnAreaHeight
  // computes to 1, for this exact fixture (head.length + tail.length +
  // needsYouHeight(6) + failedHeight(6) = 15, pageBudget = rows - 1).
  const winAt16 = visibleWindowGrid(runs, { rows: 16, selected: 0, scrollOffset: 0, cols: 150 });
  const winAt17 = visibleWindowGrid(runs, { rows: 17, selected: 0, scrollOffset: 0, cols: 150 });
  assert.equal(winAt16.columnAreaHeight, 0, 'fixture must actually reach columnAreaHeight: 0 at rows:16');
  assert.equal(winAt17.columnAreaHeight, 1, 'fixture must actually reach columnAreaHeight: 1 at rows:17');

  const outAt16 = renderFleet(runs, { cols: 150, rows: 16, selected: 0, now: 100000 });
  const outAt17 = renderFleet(runs, { cols: 150, rows: 17, selected: 0, now: 100000 });
  const lineCountAt16 = outAt16.split('\n').length;
  const lineCountAt17 = outAt17.split('\n').length;
  assert.ok(lineCountAt16 <= lineCountAt17,
    `shrinking rows 17->16 (columnAreaHeight 1->0) must not grow the frame: got ${lineCountAt17} -> ${lineCountAt16} lines`);

  // Column 1 must actually have collapsed at columnAreaHeight: 0 — every
  // RUNNING/QUICK START/QUEUED/DONE section shows nothing (a "… and N
  // more" line at most), not its full natural-height content.
  const allSections = buildSections({ needsYou, active: running, failed, done }, null, {});
  allSections.forEach((s, i) => {
    if (s.kind === 'running' || s.kind === 'queued' || s.kind === 'done') {
      assert.equal(winAt16.sections[i].shown, 0, `${s.kind} must be fully collapsed when columnAreaHeight is 0`);
    }
  });

  // Regression coverage for Task 7's parked issue #1 (sentinel shift): with
  // nothing visible in column 1, firstVisibleIndex/lastVisibleIndex must
  // report the same "nothing to scroll toward" sentinel computeWindow
  // itself falls back to (0 / runs.length - 1) — UNTRANSLATED by
  // columnIndexBase — not a bogus mid-list index that corresponds to
  // nothing actually on screen.
  assert.equal(winAt16.firstVisibleIndex, 0);
  assert.equal(winAt16.lastVisibleIndex, runs.length - 1);
});

// --- footer-wrap pass: every bound key is advertised, none lost to width ----

test('the fleet footer advertises s settings and t ticket (bound in handleKey, previously unadvertised)', () => {
  const out = plain(renderFleet([run({ ticket: 'HEL-1', status: 'running' })], { cols: 120, selected: 0 }));
  assert.match(out, /s settings/);
  assert.match(out, /t ticket/);
});

test('at 80 cols the footer wraps instead of truncating — q quit and s settings survive', () => {
  const out = plain(renderFleet([run({ ticket: 'HEL-1', status: 'running' })], { cols: 80, selected: 0 }));
  assert.match(out, /q quit/);
  assert.match(out, /s settings/);
  assert.match(out, /N launch pad/);
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 80, `line exceeds 80 cols: "${line}"`);
  }
});

test('with a populated queue the full hint set (f force-start, x clear queue) still survives 80 cols', () => {
  const queueState = { pending: ['HEL-9'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderFleet([run({ ticket: 'HEL-1', status: 'running' })],
    { cols: 80, selected: 0, queueState, queuedTitles: new Map() }));
  for (const h of ['↵ attach', 'l details', 't ticket', 'f force-start', 'n new run', 'N launch pad', 's settings', 'q quit']) {
    assert.ok(out.includes(h), `lost hint at 80 cols: ${h}`);
  }
});

// --- CON-112: the fleet row-index map (mouse click hit-testing) ------------
// `renderFleetRowMap(runs, opts)` shares its layout computation with
// `renderFleet` itself (design.md Decision 3) — these tests assert the
// resulting `{ [terminalRow]: runsIndex }` map against the SAME rendered
// text `renderFleet` produces for the identical `runs`/`opts`, so a drift
// between the two would show up here as a map entry pointing at a terminal
// row that does not actually say what the assertion expects.

test('CON-112: the row-index map points a run\'s own rendered rows (both lines of its 2-line block) at its runs[] index', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' }), run({ ticket: 'HEL-2', status: 'done' })];
  const opts = { cols: 78, selected: 0 };
  const text = renderFleet(runs, opts);
  const lines = text.split('\n');
  const map = renderFleetRowMap(runs, opts);

  const mappedRows = Object.keys(map).map(Number);
  assert.ok(mappedRows.length >= 3, `expected at least 3 mapped rows (2 for HEL-1, 1 for HEL-2), got ${mappedRows.length}`);

  for (const row of mappedRows) {
    const runIndex = map[row];
    const ticket = runs[runIndex].ticket;
    // Every mapped row either names its own run's ticket directly (the
    // first line of a 2-line RUNNING row, or a 1-line DONE row) or is the
    // second, ticket-less status/bar line of a RUNNING row immediately
    // following a line that does — either way it must land somewhere
    // inside that run's own rendered block, never someone else's.
    const line = lines[row];
    const ownLine = line.includes(ticket);
    const isRunningStatusLine = !ownLine && lines[row - 1] && lines[row - 1].includes(ticket);
    assert.ok(ownLine || isRunningStatusLine,
      `row ${row} (mapped to runs[${runIndex}] = ${ticket}) does not belong to that run's own block: "${line}"`);
  }
});

test('CON-112: the row-index map only covers rendered content rows, never a section\'s title/border/blank lines', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const opts = { cols: 78, selected: 0 };
  const text = renderFleet(runs, opts);
  const lines = text.split('\n');
  const map = renderFleetRowMap(runs, opts);

  for (const row of Object.keys(map).map(Number)) {
    assert.ok(lines[row].includes('│'), `mapped row ${row} is not a boxed content row: "${lines[row]}"`);
  }
  // The RUNNING box's own top border, title, and bottom border must never
  // appear as map keys.
  const borderRows = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.startsWith('┌') || l.startsWith('└')).map(({ i }) => i);
  for (const row of borderRows) assert.ok(!(row in map), `border row ${row} must not be a click target`);
});

test('CON-112: a scrolled window maps terminal rows to the correct (scrolled-into-view) runs[] indices', () => {
  // 12 running rows at a small row budget forces a scroll — selecting the
  // 9th (index 8) run pushes the window down, exactly the scenario
  // design.md's implementation note calls out ("not just raw
  // visibleWindow/scrollOffset math").
  const runs = Array.from({ length: 12 }, (_, i) => run({ ticket: 'HEL-' + i, status: 'running' }));
  const opts = { cols: 100, rows: 20, selected: 8, scrollOffset: 0 };
  const text = renderFleet(runs, opts);
  const lines = text.split('\n');
  const map = renderFleetRowMap(runs, opts);

  const mappedRows = Object.keys(map).map(Number);
  assert.ok(mappedRows.length > 0, 'a scrolled frame must still map at least one visible row');
  for (const row of mappedRows) {
    const runIndex = map[row];
    const ticket = runs[runIndex].ticket;
    const ownLine = lines[row].includes(ticket);
    const isStatusLine = !ownLine && lines[row - 1] && lines[row - 1].includes(ticket);
    assert.ok(ownLine || isStatusLine,
      `scrolled row ${row} maps to runs[${runIndex}] (${ticket}) but that ticket is not on that line: "${lines[row]}"`);
  }
  // HEL-8 (the selected/scrolled-to run) must actually be on screen and
  // mapped — otherwise this test is not exercising the scrolled case at all.
  assert.ok(text.includes('HEL-8'), 'fixture sanity: the selected run must have scrolled into view');
  assert.ok(Object.values(map).includes(8), 'HEL-8 (runs[8]) must be a mapped row once scrolled into view');
});

test('CON-112: QUEUED/QUICK START rows and a collapsed "…and N more" summary line contribute no map entries', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const queueState = { pending: ['HEL-9', 'HEL-10'], inFlight: new Set(), maxConcurrent: 1 };
  const opts = { cols: 100, selected: 0, queueState, queuedTitles: new Map() };
  const text = renderFleet(runs, opts);
  const lines = text.split('\n');
  const map = renderFleetRowMap(runs, opts);

  for (const row of Object.keys(map).map(Number)) {
    assert.doesNotMatch(lines[row], /HEL-9|HEL-10/,
      `a QUEUED row must never be a mapped click target: "${lines[row]}"`);
  }
});

test('CON-112: grid mode (renderFleetGrid) contributes an empty row map — clicking there is a no-op this pass', () => {
  const runs = Array.from({ length: 3 }, (_, i) => run({ ticket: 'HEL-' + i, status: 'running' }));
  const opts = { cols: 130, rows: 30, selected: 0 };
  // Fixture sanity: this really is the grid-mode path (design.md's explicit
  // scope decision — grid mode is out of scope for click support this pass).
  assert.match(renderFleet(runs, opts), /METRICS/);
  assert.deepEqual(renderFleetRowMap(runs, opts), {});
});

// --- CON-110: `/` fleet-wide search --------------------------------------
// specs/fleet-search/spec.md's four requirements.

test("'/' opens the search prompt, unconditionally, regardless of focus", () => {
  assert.deepEqual(handleKey('/', state({})), { type: 'open-search' });
  assert.deepEqual(handleKey('/', state({ focus: 'queue', queueState: { pending: ['HEL-1'], maxConcurrent: 1 } })),
    { type: 'open-search' });
  assert.deepEqual(handleKey('/', state({ focus: 'quickstart' })), { type: 'open-search' });
});

test("'/' does nothing while the n prompt is open — it types the character '/' into the prompt instead", () => {
  assert.deepEqual(handleKey('/', promptState({ value: '', error: null })), { type: 'prompt-type', char: '/' });
});

test("'/' does not open search while a confirmation gate is already open — the gate's own key handling claims it first", () => {
  assert.deepEqual(handleKey('/', state({ quitConfirm: true })), { type: 'cancel-quit' });
  assert.deepEqual(handleKey('/', state({ markDoneConfirm: { ticket: 'HEL-9' } })), { type: 'cancel-mark-done' });
});

function searchState(search) {
  return state({ search });
}

test('while search is open, an open search box intercepts every other key — a digit types, not section-jumps', () => {
  assert.deepEqual(handleKey('4', searchState({ value: '' })), { type: 'search-type', char: '4' });
  assert.deepEqual(handleKey('j', searchState({ value: '' })), { type: 'search-type', char: 'j' });
  assert.deepEqual(handleKey('n', searchState({ value: '' })), { type: 'search-type', char: 'n' });
  assert.deepEqual(handleKey('q', searchState({ value: '' })), { type: 'search-type', char: 'q' });
});

// --- searchKey: pure (key, search) -> action, mirroring promptKey's own
// tests just above -----------------------------------------------------

test('searchKey: typing appends via search-type', () => {
  assert.deepEqual(searchKey('x', { value: 'foo' }), { type: 'search-type', char: 'x' });
});

test('searchKey: backspace trims via search-backspace', () => {
  assert.deepEqual(searchKey('\x7f', { value: 'foo' }), { type: 'search-backspace' });
});

test('searchKey: bare escape / Ctrl-C cancels', () => {
  assert.deepEqual(searchKey('\x1b', { value: 'foo' }), { type: 'cancel-search' });
  assert.deepEqual(searchKey('', { value: 'foo' }), { type: 'cancel-search' });
});

test('searchKey: enter submits, even on an empty value (resolution happens in the controller)', () => {
  assert.deepEqual(searchKey('\r', { value: '' }), { type: 'submit-search' });
  assert.deepEqual(searchKey('\n', { value: 'CON-1' }), { type: 'submit-search' });
});

test('searchKey: a multi-byte escape sequence (arrow key) is ignored, not typed literally', () => {
  assert.equal(searchKey('\x1b[A', { value: 'x' }), null);
});

// --- Rendering: the search input line and live match highlighting --------

test('an open search prompt renders the input line and its own footer hint', () => {
  const out = plain(renderFleet([run({})], { ...OPTS, search: { value: 'CON' } }));
  assert.match(out, /search.*CON/);
  assert.match(out, /↵ jump/);
  assert.match(out, /esc cancel/);
});

test('while search is open, n/N/↵ attach are not advertised — same discipline as the n prompt', () => {
  const out = plain(renderFleet([run({})], { ...OPTS, search: { value: '' } }));
  assert.doesNotMatch(out, /n new run/);
  assert.doesNotMatch(out, /N launch pad/);
  assert.doesNotMatch(out, /↵ attach/);
});

// The ACTUAL colour a match produces (does row X really carry an f.yellow
// escape, and does a non-matching row carry none?) can only be observed with
// isTTY forced on — see format-colour.test.js's own header comment ("the
// ONLY test in this repo that sees an escape sequence"). The highlighting
// coverage itself lives there; these plain-text tests only pin the content
// (which row/token the query resolves against), not the colour.
test('typing against a matching RUNNING row leaves every row\'s plain text (colour stripped) unaffected', () => {
  const runs = [run({ ticket: 'CON-42', status: 'running' }), run({ ticket: 'CON-99', status: 'running' })];
  const withQuery = renderFleet(runs, { ...OPTS, search: { value: '42' } });
  const withoutQuery = renderFleet(runs, OPTS);
  // Plain text (colour stripped) of each RUN ROW is identical either way — a
  // highlight adds colour only, never changes the text itself (design.md
  // Decision 2). The search box's own tail lines are new (search is open in
  // one and not the other), so this compares only the two run rows, not the
  // whole frame.
  const row42With = plain(withQuery.split('\n').find((l) => l.includes('CON-42')));
  const row42Without = plain(withoutQuery.split('\n').find((l) => l.includes('CON-42')));
  const row99With = plain(withQuery.split('\n').find((l) => l.includes('CON-99')));
  const row99Without = plain(withoutQuery.split('\n').find((l) => l.includes('CON-99')));
  assert.equal(row42With, row42Without);
  assert.equal(row99With, row99Without);
});
