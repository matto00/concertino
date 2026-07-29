'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildFrame, attachAndRestore, CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT,
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
