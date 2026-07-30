'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  canonicalHarness, resolveModelsForPlan,
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

// --- CON-26: trim phantom trailing blank row ------------------------------------
// draw() appends a trailing '\n' to its content before calling buildFrame().
// String.split('\n') on a trailing-newline-terminated string produces an extra
// empty trailing element. This test verifies that buildFrame strips that phantom
// row and does not count or write it.

test('buildFrame does not write a phantom trailing blank row for a trailing-newline-terminated input', () => {
  // A router.render()-shaped input: "line1\nline2\n" (like draw() always builds)
  const trailingNewlineInput = 'content line 1\ncontent line 2\n';
  const frame = buildFrame(trailingNewlineInput, 20, 0);

  // The lineCount should be 2 (the actual content lines), not 3 (which would
  // include the phantom empty line from the trailing '\n').
  assert.equal(frame.lineCount, 2,
    'lineCount must reflect only the actual rendered content, excluding the phantom row');

  // The written bytes should contain exactly the content lines, no extra blank row.
  // We can verify this by checking that there is no third line in the output.
  const lines = frame.bytes.slice(CURSOR_HOME.length).split('\n');
  // lines[0] and lines[1] are the real content (each padded), and there should
  // be no lines[2] (which would be the phantom blank row).
  assert.equal(lines.length, 2,
    'written output should have exactly 2 lines, not 3 with a phantom blank row');
});

test('buildFrame strips exactly one trailing newline, preserving genuine blank content lines', () => {
  // Content with a real blank line at the end, plus draw()'s synthetic trailing '\n'.
  // This represents: "content\n" (real line) + "" (real blank line) + "\n" (synthetic from draw())
  // After stripping exactly one '\n', should yield 2 lines: "content" + one blank line.
  const contentWithBlankLineAndSyntheticNewline = 'content\n\n';
  const frame = buildFrame(contentWithBlankLineAndSyntheticNewline, 10, 0);

  // The lineCount should be 2: one real content line + one real blank line.
  // Only the synthetic trailing '\n' is stripped; the genuine blank line remains.
  assert.equal(frame.lineCount, 2,
    'a genuine trailing blank content line must be preserved; only the synthetic trailing newline is stripped');

  // Verify both lines are written and padded (even the blank one).
  const lines = frame.bytes.slice(CURSOR_HOME.length).split('\n');
  assert.equal(lines.length, 2, 'output should have 2 lines: content + blank');
  assert.equal(lines[0], 'content   ', 'first line should be padded content');
  assert.equal(lines[1], '          ', 'second line should be a blank line, padded to column width');
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

// ===========================================================================
// CON-22 — canonicalHarness() + resolveModelsForPlan(), the two pure/thin
// helpers `open-launchplan`/`cycle-harness`/`cycle-speed` build on. The
// applyAction switch itself is a private closure inside watch() (no seam to
// unit-test it directly without a real tmux session — covered end to end by
// test/scripts/watch-smoke.test.sh instead), but these two are exactly the
// design's own "one small helper" / "one child-process call" — testable in
// isolation, and that IS the design-gate-required assertion: cycling to (or
// opening on) harness 'claude' must invoke resolve-speed.sh with
// 'claude-code', never 'claude', as $2.
// ===========================================================================

test('canonicalHarness maps the CLI-binary label to the canonical harness id', () => {
  assert.equal(canonicalHarness('claude'), 'claude-code');
});

test('canonicalHarness passes codex and claude-code through unchanged', () => {
  assert.equal(canonicalHarness('codex'), 'codex');
  assert.equal(canonicalHarness('claude-code'), 'claude-code');
});

// A throwaway project root with a fake resolve-speed.sh that just echoes its
// own argv back as JSON — enough to prove exactly what resolveModelsForPlan
// invoked it with, without depending on the real script's own resolution
// logic (already covered by test/scripts/resolve-speed.test.sh).
function fakeProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-test-'));
  const scriptsDir = path.join(root, 'scripts', 'concertino');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, 'resolve-speed.sh');
  fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf \'{"speed":"%s","harness":"%s"}\' "$1" "$2"\n');
  fs.chmodSync(scriptPath, 0o755);
  return root;
}

test('resolveModelsForPlan invokes resolve-speed.sh with the given speed/harness and parses its stdout', () => {
  const root = fakeProjectRoot();
  try {
    const result = resolveModelsForPlan(root, 'fast', 'claude-code');
    assert.deepEqual(result, { speed: 'fast', harness: 'claude-code' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveModelsForPlan is called with the CANONICAL harness id, never the CLI-binary label, when fed through canonicalHarness first', () => {
  const root = fakeProjectRoot();
  try {
    const result = resolveModelsForPlan(root, 'slow', canonicalHarness('claude'));
    assert.equal(result.harness, 'claude-code');
    assert.notEqual(result.harness, 'claude');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveModelsForPlan returns null (never throws) when the script is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-test-'));
  try {
    assert.doesNotThrow(() => resolveModelsForPlan(root, 'fast', 'claude-code'));
    assert.equal(resolveModelsForPlan(root, 'fast', 'claude-code'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveModelsForPlan returns null (never throws) when the script exits non-zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-test-'));
  const scriptsDir = path.join(root, 'scripts', 'concertino');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, 'resolve-speed.sh');
  fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "FAIL unknown speed" >&2\nexit 1\n');
  fs.chmodSync(scriptPath, 0o755);
  try {
    assert.doesNotThrow(() => resolveModelsForPlan(root, 'turbo', 'claude-code'));
    assert.equal(resolveModelsForPlan(root, 'turbo', 'claude-code'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveModelsForPlan returns null (never throws) on malformed JSON output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-test-'));
  const scriptsDir = path.join(root, 'scripts', 'concertino');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, 'resolve-speed.sh');
  fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf \'not json\'\n');
  fs.chmodSync(scriptPath, 0o755);
  try {
    assert.doesNotThrow(() => resolveModelsForPlan(root, 'fast', 'claude-code'));
    assert.equal(resolveModelsForPlan(root, 'fast', 'claude-code'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-18: ticket-text.resolve is wired into draw(), gated on mode -------
// Same technique as the reap test above (fake session/ticket-text modules via
// require.cache, a fake EventEmitter stdin, no real tmux). Verifies the exact
// seam design.md Decision 2 describes: resolve() is called once per draw()
// while mode === 'drilldown', and not at all in any other mode — mirroring
// how queuedTitles is only ever read while there is something queued.

test('ticket-text.resolve runs once per draw() while mode is drilldown, and not otherwise', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-tickettext-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-99');
  fs.mkdirSync(runDir, { recursive: true });
  // A live (not finished) run: only run.start, no run.end — so reap.js's
  // real reapFinished (unfaked here) never touches it.
  fs.writeFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ t: 1, kind: 'run.start', harness: 'claude', model: 'opus-5' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const ticketTextPath = require.resolve('../lib/ui/ticket-text');

  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-99', alive: true, activity: null }]; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const resolveCalls = [];

  delete require.cache[watchPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };
  require.cache[ticketTextPath] = {
    id: ticketTextPath, filename: ticketTextPath, loaded: true,
    exports: {
      resolve(resolveRoot, ticket, cache) {
        resolveCalls.push({ root: resolveRoot, ticket, cache });
        return { title: 'fake title', description: 'fake description' };
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

    // The very first draw() (synchronous, before `await new Promise(...)`)
    // ran with mode === 'fleet' — resolve() must not have been called at all.
    assert.equal(resolveCalls.length, 0, 'ticket-text.resolve must not run while mode is fleet');

    // 'l' on the (only, selected) fleet row opens the drill-down for HEL-99
    // (fleet.js's own handleKey) — this redraws once via applyAction's own
    // `runs = draw()` call.
    fakeStdin.emit('data', 'l');
    assert.equal(resolveCalls.length, 1, 'resolve() should run exactly once for the draw() that opened the drill-down');
    assert.equal(resolveCalls[0].root, root);
    assert.equal(resolveCalls[0].ticket, 'HEL-99');
    assert.ok(resolveCalls[0].cache && Array.isArray(resolveCalls[0].cache.tickets),
      'resolve() should be called with cache.read(root)\'s own shape');

    // A SIGWINCH-triggered redraw (process.stdout's own 'resize' listener,
    // watch.js's own real seam) is another poll while STILL in drilldown —
    // resolve() must run again, once.
    process.stdout.emit('resize');
    assert.equal(resolveCalls.length, 2, 'resolve() should run again on the next poll while still in drilldown');

    // esc backs out to the fleet (drilldown.js's own handleKey) — the very
    // next poll must NOT call resolve() at all.
    fakeStdin.emit('data', '\x1b');
    assert.equal(resolveCalls.length, 2, 'back-to-fleet\'s own redraw must not call resolve()');

    process.stdout.emit('resize');
    assert.equal(resolveCalls.length, 2, 'resolve() must stay uncalled on subsequent polls once back in fleet mode');

    fakeStdin.emit('end');
    await donePromise;
  } finally {
    process.stdout.write = realWrite;
    process.stdout.removeAllListeners('resize');
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[sessionPath];
    delete require.cache[ticketTextPath];
  }
});

// ===========================================================================
// CON-6 (tasks.md 3.6): repeated 'j' past the visible window must actually
// move watch.js's own scrollOffset and keep the marker aligned — exercised
// against a real keypress sequence and a real event log (not a direct call
// into fleet.js, which every other test in this suite already covers), the
// same "fake session/stdin, real store/reduce" technique as the reap and
// ticket-text tests above.
// ===========================================================================

test('repeated j past the visible window scrolls the fleet view and keeps the marker on the right run', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-scroll-'));
  // 8 delivered runs — more than one page of DONE (MAX_FINISHED = 5).
  // `t` decreases as `i` increases, so lastActivity (reducer.js) sorts them
  // HEL-200..HEL-207 in that exact order — index k in the rendered fleet is
  // ticket HEL-(200+k), with no need to separately reduce()/re-derive the
  // order this test asserts against.
  for (let i = 0; i < 8; i++) {
    const ticket = 'HEL-' + (200 + i);
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    const startT = 1000 - i * 10;
    const endT = 1005 - i * 10;
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: startT, kind: 'run.start' }) + '\n' +
      JSON.stringify({ t: endT, kind: 'run.end', status: 'delivered' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  // No live windows at all: every run is already finished, so reap.js's
  // real (unfaked) selectReapable never touches any of them (it requires
  // `run.window` to be present AND dead — see reap.js's own header comment
  // — and `run.window` is null here since none of these tickets appear in
  // listWindows()).
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  // eslint-disable-next-line no-control-regex
  const plainFrame = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  try {
    const watchModule = require('../lib/ui/watch');
    const donePromise = watchModule.watch({ root, config: {} });

    // The first draw() (synchronous, before `await new Promise(...)`) has
    // already rendered index 0 (HEL-200) selected, unscrolled — sanity-check
    // it before moving at all.
    const firstFrame = plainFrame(written[written.length - 1]);
    const firstMarked = firstFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(firstMarked.length, 1);
    assert.ok(firstMarked[0].includes('HEL-200'));

    // Six 'j' presses: index 0 -> 6. MAX_FINISHED = 5 means index 4 is the
    // last row visible before any scrolling — the 5th and 6th presses (onto
    // indices 5 and 6) are the ones that must scroll the view, not just move
    // an now-invisible marker.
    for (let i = 0; i < 6; i++) fakeStdin.emit('data', 'j');

    const lastFrame = plainFrame(written[written.length - 1]);
    const lastMarked = lastFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(lastMarked.length, 1,
      `expected exactly one marker after scrolling, got ${lastMarked.length}`);
    assert.ok(lastMarked[0].includes('HEL-206'),
      `the marker should be on HEL-206 (index 6) after 6 downward moves; marked line was: ${lastMarked[0] || '(none)'}`);

    // The rows scrolled past (index 0/1 — HEL-200/HEL-201) must no longer be
    // rendered at all, not just unmarked — this is the scrolling itself, not
    // merely "the marker followed the selection".
    assert.doesNotMatch(lastFrame, /HEL-200\b/, 'HEL-200 should have scrolled out of view');
    assert.doesNotMatch(lastFrame, /HEL-201\b/, 'HEL-201 should have scrolled out of view');

    fakeStdin.emit('end');
    await donePromise;
  } finally {
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Regression (found during task 4.2's manual `concertino watch` exercise,
// against a real tmux session — see fleet.test.js's own regression test for
// the root-cause comment): scrolling deep into DONE and then scrolling back
// UP with real 'k' presses must bring a short RUNNING section back into
// view exactly when the selection reaches its own row, not leave it
// unmarked because NEEDS YOU's always-visible index made the gap look
// "in range".
test('scrolling back up with k brings a short RUNNING section back into view when the selection reaches it', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-scroll-up-'));

  // One NEEDS YOU run (index 0), one RUNNING run (index 1, no run.end — a
  // live window, per the fake session below), and 10 DONE runs (indices
  // 2..11) — more than one page (MAX_FINISHED = 5), so scrolling down far
  // enough scrolls RUNNING's own single row entirely out of view.
  const needsYouDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(needsYouDir, { recursive: true });
  fs.writeFileSync(path.join(needsYouDir, 'events.jsonl'),
    JSON.stringify({ t: 500, kind: 'run.start' }) + '\n' +
    JSON.stringify({ t: 600, kind: 'escalation.raised', question: 'q', options: '' }) + '\n');

  const runningDir = path.join(root, '.concertino', 'runs', 'HEL-2');
  fs.mkdirSync(runningDir, { recursive: true });
  fs.writeFileSync(path.join(runningDir, 'events.jsonl'),
    JSON.stringify({ t: 700, kind: 'run.start' }) + '\n');

  for (let i = 0; i < 10; i++) {
    const ticket = 'HEL-' + (300 + i);
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    const startT = 1000 - i * 10;
    const endT = 1005 - i * 10;
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: startT, kind: 'run.start' }) + '\n' +
      JSON.stringify({ t: endT, kind: 'run.end', status: 'delivered' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  // HEL-2's window is alive (it is the only live one) — reap.js's real
  // selectReapable never touches it (no run.end) or any of the DONE runs
  // (window null, since they are not in this list at all).
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-2', alive: true, activity: null }]; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  // eslint-disable-next-line no-control-regex
  const plainFrame = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  // Declared outside the try so `finally` can always tear the poll loop's
  // real setInterval down, even if an assertion below throws — otherwise a
  // failing assertion here would leak a live timer that keeps firing (and
  // keeps writing to whatever `process.stdout.write` is hijacked to next)
  // forever, hanging the whole suite instead of just failing this one test.
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // 8 'j' presses: index 0 (NEEDS YOU) -> 8 (deep into DONE), scrolling
    // RUNNING's own row (index 1) entirely out of view along the way.
    for (let i = 0; i < 8; i++) fakeStdin.emit('data', 'j');

    const scrolledFrame = plainFrame(written[written.length - 1]);
    // RUNNING has scrolled entirely past — its own collapse line names it
    // (lowercase, matching the existing "… and N more <title>" wording),
    // not the bordered section title.
    assert.match(scrolledFrame, /and \d+ more running/, 'RUNNING should have collapsed to its own overflow line');
    assert.doesNotMatch(scrolledFrame, /HEL-2\b/, 'HEL-2 should have scrolled out of view by this point');

    // 7 'k' presses back: index 8 -> 1, landing exactly on HEL-2 (RUNNING).
    for (let i = 0; i < 7; i++) fakeStdin.emit('data', 'k');

    const backAtRunning = plainFrame(written[written.length - 1]);
    const marked = backAtRunning.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1,
      `expected exactly one marker once back at RUNNING, got ${marked.length}`);
    assert.ok(marked[0].includes('HEL-2'),
      `the marker should be on HEL-2 (RUNNING) once the selection reaches it again; marked line was: ${marked[0] || '(none)'}`);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
