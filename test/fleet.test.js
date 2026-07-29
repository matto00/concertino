'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderFleet, handleKey, CONFIRM_RESTORED_QUEUE_KEY } = require('../lib/ui/screens/fleet');
const { reduce } = require('../lib/ui/reducer');
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

test('an uninstrumented run reports no telemetry and its idle time', () => {
  const out = renderFleet([run({ telemetry: 'none', phase: null, window: { alive: true, idleMs: 11 * 60000 } })], OPTS);
  assert.match(out, /no telemetry/);
  assert.match(out, /idle 11m/);
});

test('a stale escalation on a dead run is labelled stale', () => {
  const out = renderFleet([run({
    status: 'failed', escalationStale: true,
    escalation: { question: 'q', options: [], raisedAt: 1 },
  })], OPTS);
  assert.match(out, /stale/);
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

test('an inFlight-only restored queue (pending already fully drained) still shows the resume affordance', () => {
  const queueState = { pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1, confirmed: false };
  const out = plain(renderFleet([run({ ticket: 'CON-1', status: 'running' })], { ...OPTS, queueState }));
  assert.match(out, /resumed from a previous session/);
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
  const runs = [
    run({ ticket: 'HEL-1', status: 'running' }),
    run({ ticket: 'HEL-2', status: 'failed', endStatus: 'escalated', endedAt: 100 }),
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

  const out = renderFleet(runs, { cols: 78, rows: 12, selected: 0 });
  const lines = out.split('\n');
  assert.ok(lines.length <= 12, `output is ${lines.length} lines, terminal is 12`);
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
  const out = renderFleet(runs, { cols: 78, rows: 14, selected: 0 });
  assert.match(out, /HEL-1/);
  assert.match(out, /HEL-2/);
  assert.ok(out.split('\n').length <= 14);
});

// Two populated sections were never enough to catch this: a section trimmed to
// zero used to still cost a title, a "… and N more" line and a trailing blank,
// so every section had a floor of 3 rows the trim loop could not get below.
// With all four sections populated that floor exceeded a short terminal and the
// cap silently stopped capping — at rows:14 the screen rendered 16 lines and
// scrolled the header and NEEDS YOU off the TOP.
test('the total-height cap holds with all four sections populated', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-401', status: 'running' }),
    run({ ticket: 'HEL-402', status: 'running' }),
    run({ ticket: 'HEL-403', status: 'running' }),
  ].concat(manyFinished(8, 'failed'))
   .concat(manyFinished(8, 'done'));

  for (const rows of [10, 12, 14, 16, 20, 24]) {
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
test('the total-height cap holds with all five sections (including a populated QUEUED) populated', () => {
  const runs = [
    run({ ticket: 'HEL-338', status: 'needs-you',
          escalation: { question: 'add zod@3?', options: ['approve', 'deny'], raisedAt: 1 } }),
    run({ ticket: 'HEL-401', status: 'running' }),
    run({ ticket: 'HEL-402', status: 'running' }),
    run({ ticket: 'HEL-403', status: 'running' }),
  ].concat(manyFinished(8, 'failed'))
   .concat(manyFinished(8, 'done'));
  const queueState = { pending: manyQueued(20), inFlight: new Set(), maxConcurrent: 1 };

  for (const rows of [12, 14, 16, 20, 24, 28]) {
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
// RUNNING and FAILED — the exact scenario tasks.md 4.5 calls the ticket's
// primary constraint. QUEUED rows have no run object at all, so if the shared
// index counter advanced for them (even by accident), every FAILED/DONE
// selection below QUEUED would resolve to the wrong run.
test('the selection marker still points at the correct run when a non-empty QUEUED section renders between RUNNING and FAILED', () => {
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
