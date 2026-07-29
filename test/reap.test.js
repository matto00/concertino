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
