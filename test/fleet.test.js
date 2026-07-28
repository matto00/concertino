'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderFleet, handleKey } = require('../lib/ui/screens/fleet');
const { reduce } = require('../lib/ui/reducer');

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
    const marked = out.split('\n').filter((l) => l.trimStart().startsWith('▸'));
    assert.equal(marked.length, 1, `selected:${n} produced ${marked.length} markers`);
    assert.ok(marked[0].includes(runs[n].ticket),
      `selected:${n} should mark ${runs[n].ticket}, marked line was: ${marked[0]}`);
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

test('the footer advertises n only in fleet mode', () => {
  const fleet = plain(renderFleet([run({})], OPTS));
  assert.match(fleet, /n new run/);
  assert.match(fleet, /↵ attach/);

  // While prompting, `n` types an "n" — advertising it as an action would be
  // advertising a key that is not bound, which this project treats as a defect.
  const prompting = plain(renderFleet([run({})], { ...OPTS, prompt: { value: '', error: null } }));
  assert.doesNotMatch(prompting, /n new run/);
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
