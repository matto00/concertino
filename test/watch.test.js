'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT,
} = require('../lib/ui/watch');
const { padTo, visibleLength } = require('../lib/ui/format');

// CON-17: the flicker was a blank frame between an \x1b[2J full clear and the
// repaint. buildFrame() is the steady-state redraw path's entire escape-
// sequence-producing logic, extracted pure (no process.stdout access) so
// this is testable without a real TTY — see watch.js's own header comment
// on buildFrame.

test('buildFrame never emits a full-screen clear (\\x1b[2J)', () => {
  const frame = buildFrame('line one\nline two', 20, 0);
  assert.doesNotMatch(frame.bytes, /\x1b\[2J/);
});

test('buildFrame homes the cursor instead of clearing', () => {
  const frame = buildFrame('hello', 10, 0);
  assert.ok(frame.bytes.startsWith(CURSOR_HOME));
});

test('buildFrame pads every line to the requested column width', () => {
  const frame = buildFrame('ab\ncd', 5, 0);
  const [l1, l2] = frame.bytes.slice(CURSOR_HOME.length).split('\n');
  assert.equal(l1, 'ab   ');
  assert.equal(l2, 'cd   ');
});

test('buildFrame reports the line count it padded from', () => {
  const frame = buildFrame('a\nb\nc', 5, 0);
  assert.equal(frame.lineCount, 3);
});

// --- 5.1a: visible-width-aware padding, not raw .length ---------------------

test('a coloured (ANSI-wrapped) line is padded by VISIBLE width, not raw length', () => {
  const coloured = '\x1b[33mhi\x1b[0m'; // raw .length is 13; visible width is 2
  const frame = buildFrame(coloured, 20, 0);
  const line = frame.bytes.slice(CURSOR_HOME.length);
  assert.equal(visibleLength(line), 20,
    'a raw-.length regression would under-pad this line by the escape byte count');
  // Cross-check directly against format.js's own padTo, since design.md
  // Decision 1 requires buildFrame to REUSE padTo, not reimplement it.
  assert.equal(line, padTo(coloured, 20));
});

test('an uncoloured line reaching the exact column width needs no padding', () => {
  const frame = buildFrame('x'.repeat(10), 10, 0);
  const line = frame.bytes.slice(CURSOR_HOME.length);
  assert.equal(visibleLength(line), 10);
});

// --- 5.3: a shrinking frame leaves no stale trailing rows -------------------

test('a shrinking frame blanks every leftover row from the taller previous frame', () => {
  const tall = buildFrame('a\nb\nc\nd', 5, 0); // 4 lines, no previous frame yet
  assert.equal(tall.lineCount, 4);

  const short = buildFrame('x\ny', 5, tall.lineCount); // shrinks to 2 lines
  assert.equal(short.lineCount, 2);

  // Rows 3 and 4 (the leftover rows from the taller frame) must be blanked,
  // each preceded by an explicit cursor position rather than relying on
  // line-feed sequencing (design.md Decision 2).
  assert.match(short.bytes, /\x1b\[3;1H {5}/);
  assert.match(short.bytes, /\x1b\[4;1H {5}/);
  // No extra blanking beyond exactly the leftover rows.
  assert.doesNotMatch(short.bytes, /\x1b\[5;1H/);
});

test('a frame that grows (or stays the same height) blanks nothing', () => {
  const first = buildFrame('a\nb', 5, 0);
  const grown = buildFrame('a\nb\nc', 5, first.lineCount);
  assert.doesNotMatch(grown.bytes, /\x1b\[\d+;1H/);
});

// --- alternate screen buffer constants --------------------------------------
// The exact byte sequences watch.js writes at startup (once), from quit()
// (once, on every exit path), and around attach (suspend/restore) — see
// watch.js's own header comment on why these are named constants: it makes
// "exactly one enter, exactly one exit per path" a textually verifiable
// property, and test/scripts/watch-smoke.test.sh asserts the real, running
// dashboard actually writes them exactly this many times across every real
// exit path (q, echo+trailing-newline, immediate EOF, and around a real
// attach attempt).

test('the alternate-screen constants are the standard enter/exit pair', () => {
  assert.equal(ALT_SCREEN_ENTER, '\x1b[?1049h');
  assert.equal(ALT_SCREEN_EXIT, '\x1b[?1049l');
});

// --- 3.2 / design.md Decision 4: attach must restore even if it throws -----

test('attachAndRestore runs restore() on a normal return, and returns fn()\'s value', () => {
  let restored = false;
  const result = attachAndRestore(() => 'attach-result', () => { restored = true; });
  assert.equal(result, 'attach-result');
  assert.equal(restored, true);
});

test('attachAndRestore runs restore() even when fn() throws, and rethrows', () => {
  let restored = false;
  assert.throws(
    () => attachAndRestore(() => { throw new Error('tmux exited abnormally'); }, () => { restored = true; }),
    /tmux exited abnormally/,
  );
  assert.equal(restored, true,
    'the terminal hand-back (alternate-buffer restore, raw mode) must still run after a throwing attach');
});

// --- CON-5: idle time is a stateless function of tmux window_activity ------
// (replaces the old idle-Map + pane-content-hash tracking; see design.md).

test('idleMsFromActivity reflects a later activity timestamp immediately, not only on the first call', () => {
  const t0 = 1000; // epoch seconds
  const now = t0 * 1000 + 5000; // 5s after t0, in ms

  const stale = idleMsFromActivity(t0, now);
  assert.equal(stale, 5000);

  // A later poll observes activity has advanced closer to `now` — the
  // result must shrink accordingly on THIS call, not wait for a subsequent
  // one to notice.
  const advanced = t0 + 4; // 4s later, still in epoch seconds
  const fresh = idleMsFromActivity(advanced, now);
  assert.equal(fresh, 1000);
  assert.ok(fresh < stale, 'idleMs must decrease as soon as activity advances, on the very next call');
});

test('idleMsFromActivity tracks activity, never pane content, since content is not and cannot be an input', () => {
  // The acceptance criterion is "a window that redraws identical content
  // must not read as idle". idleMsFromActivity takes no content argument at
  // all, so this is demonstrated structurally: an advancing `activity`
  // (the only signal tmux gives us, whether or not the redrawn frame is
  // byte-identical to the last one) always yields a correspondingly low
  // idleMs, regardless of what — if anything — was on screen.
  const now = 100000;
  const justWritten = idleMsFromActivity(100, now); // activity in epoch seconds
  const longAgo = idleMsFromActivity(1, now);
  assert.equal(justWritten, now - 100 * 1000);
  assert.equal(longAgo, now - 1 * 1000);
  assert.ok(justWritten < longAgo,
    'result tracks activity alone — there is no content parameter that could override it either way');
});

test('idleMsFromActivity survives a restart: a fresh process\'s very first call returns the full elapsed time, not zero', () => {
  // Stateless — there is no "first sight" seed to fall back to, and none is
  // needed: a "restart" is just calling this function again with a fresh
  // `now` and the same tmux-owned activity timestamp.
  const oldActivity = 1000; // epoch seconds, from well before this process started
  const now = oldActivity * 1000 + 3600000; // an hour later
  assert.equal(idleMsFromActivity(oldActivity, now), 3600000);
});

test('idleMsFromActivity falls back to 0 when activity is null (no tmux timestamp yet)', () => {
  assert.equal(idleMsFromActivity(null, Date.now()), 0);
  assert.equal(idleMsFromActivity(undefined, Date.now()), 0);
});

// --- computeLiveEscalations: what the cross-screen banner (CON-25) targets --
// Deliberately narrower than, and not the same filter as, fleet.js's
// `needsYou` (status === 'needs-you' also matches a BLOCKER-verdict run with
// no live run.escalation at all — nothing answer.json could resolve).

function run(over) {
  return Object.assign({ ticket: 'HEL-1', escalation: null, escalationStale: false }, over);
}

test('a run with no escalation at all is excluded', () => {
  assert.deepEqual(computeLiveEscalations([run({})]), []);
});

test('a run with a stale escalation is excluded', () => {
  const r = run({ escalation: { question: 'q', raisedAt: 1 }, escalationStale: true });
  assert.deepEqual(computeLiveEscalations([r]), []);
});

test('a run with a live escalation is included', () => {
  const r = run({ escalation: { question: 'q', raisedAt: 1 }, escalationStale: false });
  assert.deepEqual(computeLiveEscalations([r]), [r]);
});

test('several live escalations sort oldest-raisedAt-first', () => {
  const newest = run({ ticket: 'HEL-3', escalation: { question: 'q3', raisedAt: 900 } });
  const oldest = run({ ticket: 'HEL-1', escalation: { question: 'q1', raisedAt: 100 } });
  const middle = run({ ticket: 'HEL-2', escalation: { question: 'q2', raisedAt: 500 } });
  const sorted = computeLiveEscalations([newest, oldest, middle]);
  assert.deepEqual(sorted.map((r) => r.ticket), ['HEL-1', 'HEL-2', 'HEL-3']);
});

test('an empty or missing runs list is handled safely', () => {
  assert.deepEqual(computeLiveEscalations([]), []);
  assert.deepEqual(computeLiveEscalations(undefined), []);
});

// --- CON-34: reap.reapFinished is wired into draw(), right after reduce() --
// watch() itself owns the interval loop and real stdin/stdout, so this
// exercises the real call site inside watch()'s draw() against FAKE
// session/reap modules — substituted via require.cache, the same technique
// test/fleet.test.js already uses for layout.degrade() — and a fake stdin.
// No real tmux session is ever touched (session.js is fully replaced).

test('reap.reapFinished runs once per draw(), against the runs snapshot reduce() just produced', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-reap-'));
  // A real, on-disk terminal run — reduce() reads this file for real; only
  // tmux itself (session.listWindows()) is faked.
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-99');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ t: 1, kind: 'run.start' }) + '\n' +
    JSON.stringify({ t: 2, kind: 'run.end', status: 'delivered' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const reapPath = require.resolve('../lib/ui/reap');

  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-99', alive: false, activity: null }]; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const reapCalls = [];

  delete require.cache[watchPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };
  require.cache[reapPath] = {
    id: reapPath, filename: reapPath, loaded: true,
    exports: {
      selectReapable: () => [],
      reapFinished(reapRoot, session, runs) {
        reapCalls.push({ root: reapRoot, session, runs });
        return [];
      },
    },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  process.stdout.write = () => true;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  try {
    const watchModule = require('../lib/ui/watch');
    const donePromise = watchModule.watch({ root, config: {} });

    // Everything up to `await new Promise(...)` inside watch() — including
    // the first draw() — runs synchronously (nothing before it is async),
    // so by the time watch() has returned its promise, draw() has already
    // run exactly once.
    assert.equal(reapCalls.length, 1, 'reapFinished should run exactly once for the first draw()');
    assert.equal(reapCalls[0].root, root);
    assert.equal(reapCalls[0].session, fakeSessionObj);
    const passedRun = reapCalls[0].runs.find((r) => r.ticket === 'HEL-99');
    assert.ok(passedRun, 'reapFinished must be called with reduce()\'s own output');
    // Proves this ran AFTER reduce(), not before: endStatus/window are only
    // populated once reduce() has folded the log + tmux snapshot together.
    assert.equal(passedRun.endStatus, 'delivered');
    assert.equal(passedRun.window.alive, false);

    fakeStdin.emit('end'); // let watch() quit and clean up its interval timer
    await donePromise;
  } finally {
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[sessionPath];
    delete require.cache[reapPath];
  }
});
