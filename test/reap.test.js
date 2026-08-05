'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reap = require('../lib/ui/reap');
const store = require('../lib/ui/store');
const { reduce } = require('../lib/ui/reducer');
const { hasTmux, createSession } = require('../lib/ui/session');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-reap-'));
}

function run(over) {
  return Object.assign({ ticket: 'HEL-1', endStatus: null, window: null }, over);
}

// --- selectReapable (pure) ---------------------------------------------------

test('selectReapable: terminal + dead window is selected', () => {
  const runs = [run({ ticket: 'HEL-1', endStatus: 'delivered', window: { alive: false, idleMs: null } })];
  assert.deepEqual(reap.selectReapable(runs), ['HEL-1']);
});

test('selectReapable: terminal + alive window is NOT selected', () => {
  const runs = [run({ ticket: 'HEL-2', endStatus: 'delivered', window: { alive: true, idleMs: 0 } })];
  assert.deepEqual(reap.selectReapable(runs), []);
});

test('selectReapable: dead window with no run.end is NEVER selected — the ticket\'s required guarantee', () => {
  const runs = [run({ ticket: 'HEL-3', endStatus: null, window: { alive: false, idleMs: null } })];
  assert.deepEqual(reap.selectReapable(runs), []);
});

test('selectReapable: no window at all is not selected, even for a terminal run', () => {
  const runs = [run({ ticket: 'HEL-4', endStatus: 'failed', window: null })];
  assert.deepEqual(reap.selectReapable(runs), []);
});

// --- the ticket's mandatory guarantee, through a real reducer.reduce() call -
// A crash/OOM/kill -9/harness-exit-before-Phase-4 run never emits run.end.
// Its dead window is reducer.js's tier-1 telemetry line (deriveStatus) — the
// only remaining evidence the run existed and failed — so reap.js must never
// select it, however many polls it sits there dead.

test('a dead window with no run.end is never reaped, and still resolves to status failed', () => {
  const eventsByTicket = new Map([
    ['HEL-5', { events: [{ t: 1, kind: 'run.start' }], malformed: 0 }],
  ]);
  const windows = [{ ticket: 'HEL-5', alive: false, idleMs: null }];
  const runs = reduce(eventsByTicket, windows, 1000);

  const run5 = runs.find((r) => r.ticket === 'HEL-5');
  assert.ok(run5, 'run should be present');
  assert.equal(run5.endStatus, null, 'no run.end was ever parsed');
  assert.equal(run5.status, 'failed', 'the dead window alone must still resolve to failed');

  assert.deepEqual(reap.selectReapable(runs), [],
    'a run with no run.end must never be selected for reaping, no matter how long its window has been dead');
});

// --- CON-77: a run.spawn-only run (no run.start, no run.end) ---------------
// A window the dashboard just spawned — before the agent has reached
// run.start, let alone run.end — must never be reaped as though terminal,
// whether that window is still alive (still booting) or has already died
// (failed to start).

test('a run.spawn-only run is never reaped, alive window', () => {
  const eventsByTicket = new Map([
    ['HEL-30', { events: [{ t: 1, kind: 'run.spawn' }], malformed: 0 }],
  ]);
  const windows = [{ ticket: 'HEL-30', alive: true, idleMs: 0 }];
  const runs = reduce(eventsByTicket, windows, 1000);

  const run30 = runs.find((r) => r.ticket === 'HEL-30');
  assert.ok(run30, 'run should be present');
  assert.equal(run30.endStatus, null, 'no run.end was ever parsed');
  assert.deepEqual(reap.selectReapable(runs), [],
    'a run.spawn-only run must never be selected for reaping while its window is alive');
});

test('a run.spawn-only run is never reaped, dead window', () => {
  const eventsByTicket = new Map([
    ['HEL-31', { events: [{ t: 1, kind: 'run.spawn' }], malformed: 0 }],
  ]);
  const windows = [{ ticket: 'HEL-31', alive: false, idleMs: null }];
  const runs = reduce(eventsByTicket, windows, 1000);

  const run31 = runs.find((r) => r.ticket === 'HEL-31');
  assert.ok(run31, 'run should be present');
  assert.equal(run31.endStatus, null, 'no run.end was ever parsed');
  assert.equal(run31.status, 'failed', 'a dead window that never started must still resolve to failed');
  assert.deepEqual(reap.selectReapable(runs), [],
    'a run.spawn-only run must never be selected for reaping, however long its dead window sits there');
});

// --- reapFinished against a fake session ------------------------------------

test('reapFinished writes the scrollback file to disk before session.kill is called', () => {
  const root = tmpRoot();
  let scrollbackExistedAtKillTime = null;
  const session = {
    captureFull(ticket) { return 'hello-' + ticket; },
    kill(ticket) {
      scrollbackExistedAtKillTime = fs.existsSync(store.scrollbackPath(root, ticket));
    },
  };
  const runs = [run({ ticket: 'HEL-10', endStatus: 'delivered', window: { alive: false, idleMs: null } })];

  const reaped = reap.reapFinished(root, session, runs);

  assert.deepEqual(reaped, ['HEL-10']);
  assert.equal(scrollbackExistedAtKillTime, true, 'scrollback must be on disk before kill runs');
  assert.equal(fs.readFileSync(store.scrollbackPath(root, 'HEL-10'), 'utf8'), 'hello-HEL-10');
});

test('a captureFull that throws does not prevent kill from being called', () => {
  const root = tmpRoot();
  let killed = null;
  const session = {
    captureFull() { throw new Error('tmux transiently unavailable'); },
    kill(ticket) { killed = ticket; },
  };
  const runs = [run({ ticket: 'HEL-11', endStatus: 'failed', window: { alive: false, idleMs: null } })];

  const reaped = reap.reapFinished(root, session, runs);

  assert.equal(killed, 'HEL-11', 'kill must still run when captureFull throws');
  assert.deepEqual(reaped, ['HEL-11']);
});

test('a scrollback write failure does not prevent kill from being called', () => {
  const root = tmpRoot();
  // Make the runs directory itself an ordinary file, so
  // mkdirSync(runDir(root, ticket), { recursive: true }) throws (ENOTDIR).
  fs.mkdirSync(path.join(root, '.concertino'), { recursive: true });
  fs.writeFileSync(path.join(root, '.concertino', 'runs'), 'not a directory');

  let killed = null;
  const session = { captureFull() { return 'x'; }, kill(ticket) { killed = ticket; } };
  const runs = [run({ ticket: 'HEL-12', endStatus: 'failed', window: { alive: false, idleMs: null } })];

  const reaped = reap.reapFinished(root, session, runs);

  assert.equal(killed, 'HEL-12', 'kill must still run when the scrollback write fails');
  assert.deepEqual(reaped, ['HEL-12']);
});

test('reapFinished only acts on reapable tickets, and returns [] when nothing is reapable', () => {
  const root = tmpRoot();
  const calls = [];
  const session = {
    captureFull(ticket) { calls.push(ticket); return ''; },
    kill(ticket) { calls.push('kill:' + ticket); },
  };
  const runs = [
    run({ ticket: 'HEL-13', endStatus: 'delivered', window: { alive: true, idleMs: 0 } }), // alive, skip
    run({ ticket: 'HEL-14', endStatus: null, window: { alive: false, idleMs: null } }),    // no run.end, skip
  ];

  const reaped = reap.reapFinished(root, session, runs);

  assert.deepEqual(reaped, []);
  assert.deepEqual(calls, []);
});

// --- reapFinished against a real tmux session --------------------------------

const SESSION = 'concertino-reap-test-' + process.pid;
const tmuxSkip = !hasTmux() ? { skip: 'tmux not installed' } : {};

test('reapFinished closes a dead, terminal run\'s real tmux window and writes its scrollback to disk', tmuxSkip, () => {
  const s = createSession(SESSION);
  s.ensure();
  try {
    const root = tmpRoot();
    s.spawn('HEL-20', 'echo reap-marker; true');
    require('child_process').execFileSync('sleep', ['1']);

    const before = s.listWindows().find((x) => x.ticket === 'HEL-20');
    assert.ok(before, 'window should exist before reaping');
    assert.equal(before.alive, false, 'the short-lived command should already be dead');

    const runs = [run({ ticket: 'HEL-20', endStatus: 'delivered', window: { alive: false, idleMs: null } })];
    const reaped = reap.reapFinished(root, s, runs);

    assert.deepEqual(reaped, ['HEL-20']);
    assert.equal(s.listWindows().find((x) => x.ticket === 'HEL-20'), undefined,
      'the window must be gone from listWindows() after reaping');
    assert.match(fs.readFileSync(store.scrollbackPath(root, 'HEL-20'), 'utf8'), /reap-marker/);
  } finally {
    try { require('child_process').execFileSync('tmux', ['kill-session', '-t', SESSION]); } catch (e) {}
  }
});

// --- reaping a DELIVERED run whose harness never exited ---------------------
// A harness returns to its prompt when the workflow finishes rather than
// exiting, so condition 1 (window already dead) never fires for a clean
// delivery. Observed live: CON-71 delivered and merged its PR, then held an
// idle session — and a Remote Control registration — indefinitely.

const MIN = 60 * 1000;
const delivered = (over) => Object.assign({
  ticket: 'CON-71', endStatus: 'delivered', endedAt: 1000,
  window: { alive: true },
}, over);

test('selectReapable: a delivered run whose window is still alive IS reaped once the grace has passed', () => {
  const runs = [delivered({})];
  assert.deepEqual(reap.selectReapable(runs, 1000 + 10 * MIN, 10 * MIN), ['CON-71']);
});

test('selectReapable: it is left alone until the grace has passed', () => {
  const runs = [delivered({})];
  assert.deepEqual(reap.selectReapable(runs, 1000 + 9 * MIN, 10 * MIN), []);
});

// CON-48: cleanup.sh emits run.end mid-Phase-4 and the orchestrator can ask
// a question afterwards — reducer.js's status() gives that escalation
// precedence over endStatus for exactly this reason. Killing it would
// destroy a session waiting on a human.
test('selectReapable: a delivered run with a LIVE escalation is never idle-reaped', () => {
  const runs = [delivered({ escalation: { question: 'merge?', raisedAt: 1 } })];
  assert.deepEqual(reap.selectReapable(runs, 1000 + 60 * MIN, 10 * MIN), []);
});

test('selectReapable: a STALE escalation does not protect it — nobody is waiting', () => {
  const runs = [delivered({ escalation: { question: 'merge?', raisedAt: 1 }, escalationStale: true })];
  assert.deepEqual(reap.selectReapable(runs, 1000 + 60 * MIN, 10 * MIN), ['CON-71']);
});

// The invariant the original predicate exists to protect, re-asserted for
// the new path: a crashed run's window is its only surviving evidence.
test('selectReapable: an ALIVE window whose run never emitted run.end is never idle-reaped', () => {
  const runs = [{ ticket: 'CON-9', endStatus: null, endedAt: null, window: { alive: true } }];
  assert.deepEqual(reap.selectReapable(runs, 1000 + 60 * MIN, 10 * MIN), []);
});

test('selectReapable: without a clock, only already-dead windows are reaped (unchanged legacy behaviour)', () => {
  const runs = [delivered({}), { ticket: 'CON-8', endStatus: 'failed', endedAt: 5, window: { alive: false } }];
  assert.deepEqual(reap.selectReapable(runs), ['CON-8']);
});

test('selectReapable: a zero grace disables the idle path rather than reaping instantly', () => {
  // 0 is the documented "disable" value; a delivered-and-alive run must
  // survive it, while a dead window is still reaped.
  const runs = [delivered({})];
  assert.deepEqual(reap.selectReapable(runs, 1000, 0), ['CON-71']);
});

test('reapFinished captures scrollback before killing an idle delivered window', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-reap-idle-'));
  const order = [];
  const session = {
    captureFull(t) { order.push('capture:' + t); return 'the tail'; },
    kill(t) { order.push('kill:' + t); },
  };
  const reaped = reap.reapFinished(root, session, [delivered({})], 1000 + 10 * MIN, 10 * MIN);
  assert.deepEqual(reaped, ['CON-71']);
  assert.deepEqual(order, ['capture:CON-71', 'kill:CON-71']);
  assert.equal(fs.readFileSync(path.join(root, '.concertino', 'runs', 'CON-71', 'session-scrollback.txt'), 'utf8'), 'the tail');
  fs.rmSync(root, { recursive: true, force: true });
});
