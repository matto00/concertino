'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  canonicalHarness, resolveModelsForPlan, openInBrowser, sessionsAutoRefreshDue,
  parseMouseClick,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, CURSOR_SHOW,
  MOUSE_REPORT_ENTER, MOUSE_REPORT_EXIT,
} = require('../lib/ui/watch');
const { splitKeys } = require('../lib/ui/frame');
const { padTo, visibleLength } = require('../lib/ui/format');

// CON-17: the flicker was a blank frame between an \x1b[2J full clear and the
// repaint. buildFrame() is the steady-state redraw path's entire escape-
// sequence-producing logic, extracted pure (no process.stdout access) so
// this is testable without a real TTY — see watch.js's own header comment
// on buildFrame.
//
// CON-27 turned that always-full-rewrite into a per-row diff:
// `buildFrame(text, cols, rows, prevLines) -> { bytes, lines }`. Two things
// changed for these tests specifically. First, a full-rewrite frame no longer
// starts with the bare CURSOR_HOME (`\x1b[H`, 3 bytes) unless it took the
// over-tall fallback — on the ordinary diff path row 1 is prefixed with its
// own placement, `\x1b[1;1H` (7 bytes). Second, `rows` is passed as 0 in
// every test that is not specifically exercising the fallback, so those tests
// stay on the diff path (a falsy `rows` means "height unknown", under which
// the fallback never triggers — exactly how the smoke gate's redirected
// stdout runs).

// The per-row placement prefix for row N on the diff path.
const at = (row) => '\x1b[' + row + ';1H';

// Replays everything the dashboard wrote to stdout into a virtual screen and
// returns it as plain text, one row per line.
//
// CON-27: any test that drives the real watch() loop and then asks "what is on
// screen?" MUST go through this rather than reading the last chunk that
// process.stdout.write received. Under the old full-rewrite writer those were
// the same thing — every redraw wrote the entire frame in one call, so the
// last chunk WAS the frame. The differential writer only writes the rows that
// changed since the previous tick, so the last chunk is a partial frame, and
// asserting on it silently changes the question from "is this on screen?" to
// "did this change on the most recent tick?" — which makes a `doesNotMatch`
// assertion pass for the wrong reason (the row is still displayed; it just
// wasn't rewritten). Replaying keeps these tests asking the original question
// under either writer mode.
//
// Handles both modes: `\x1b[<n>;1H` addresses row n directly; `\x1b[H` homes
// and subsequent newlines advance a row (the over-tall fallback's flow).
// Colour escapes are stripped from row content only, after placement parsing.
function screenOf(chunks) {
  const all = chunks.join('');
  const rows = [];
  let cur = 0;
  let i = 0;
  while (i < all.length) {
    const place = /^\x1b\[(?:(\d+);1H|H)/.exec(all.slice(i));
    if (place) {
      cur = place[1] ? parseInt(place[1], 10) - 1 : 0;
      i += place[0].length;
      continue;
    }
    let j = i;
    let text = '';
    while (j < all.length) {
      if (/^\x1b\[(?:\d+;1H|H)/.test(all.slice(j))) break;
      if (all[j] === '\n') break;
      text += all[j];
      j++;
    }
    // eslint-disable-next-line no-control-regex
    if (text) rows[cur] = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    if (all[j] === '\n') { cur++; j++; }
    i = j;
  }
  return rows.join('\n');
}

// Every `\x1b[<row>;1H<content>` write, in order, as { row, text } — the raw
// material for asserting WHICH rows a redraw touched (as opposed to
// screenOf's "what does the finished screen look like").
//
// Deliberately not built on screenOf: these tests need to distinguish "the
// row was rewritten with identical content" from "the row was left alone",
// which a replayed screen cannot show — that distinction is the entire
// subject of the two cache-invalidation regressions below. Non-placement
// escapes (colour, and the `\x1b[?1049h/l` alternate-buffer pair an attach
// writes) are stripped from the content rather than mistaken for text.
function writesByRow(chunks) {
  const out = [];
  const re = /\x1b\[(\d+);1H((?:(?!\x1b\[(?:\d+;1H|H))[\s\S])*)/g;
  let m;
  while ((m = re.exec(chunks.join('')))) {
    // eslint-disable-next-line no-control-regex
    out.push({ row: parseInt(m[1], 10), text: m[2].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') });
  }
  return out;
}

test('buildFrame never emits a full-screen clear (\\x1b[2J)', () => {
  const frame = buildFrame('line one\nline two', 20, 0, []);
  assert.doesNotMatch(frame.bytes, /\x1b\[2J/);
});

test('buildFrame positions the cursor instead of clearing', () => {
  const frame = buildFrame('hello', 10, 0, []);
  assert.ok(frame.bytes.startsWith(at(1)));
});

test('buildFrame treats an omitted prevLines as an empty previous frame', () => {
  // The `prevLines || []` guard: makes the argument genuinely optional rather
  // than defensive-only, so a caller that has no previous frame at all reads
  // the same as one passing [] — every row counts as changed.
  const omitted = buildFrame('a\nb', 5, 0);
  const explicit = buildFrame('a\nb', 5, 0, []);
  assert.equal(omitted.bytes, explicit.bytes);
  assert.deepEqual(omitted.lines, explicit.lines);
});

test('buildFrame pads every line to the requested column width', () => {
  const frame = buildFrame('ab\ncd', 5, 0, []);
  // First frame: both rows are "changed", so each gets its own placement.
  assert.equal(frame.lines[0], 'ab   ');
  assert.equal(frame.lines[1], 'cd   ');
  assert.ok(frame.bytes.startsWith(at(1) + 'ab   ' + at(2) + 'cd   '));
});

test('buildFrame reports the lines it padded from', () => {
  const frame = buildFrame('a\nb\nc', 5, 0, []);
  assert.deepEqual(frame.lines, ['a    ', 'b    ', 'c    ']);
});

// --- 5.1a: visible-width-aware padding, not raw .length ---------------------

test('a coloured (ANSI-wrapped) line is padded by VISIBLE width, not raw length', () => {
  const coloured = '\x1b[33mhi\x1b[0m'; // raw .length is 13; visible width is 2
  const frame = buildFrame(coloured, 20, 0, []);
  const line = frame.lines[0];
  assert.equal(visibleLength(line), 20,
    'a raw-.length regression would under-pad this line by the escape byte count');
  // Cross-check directly against format.js's own padTo, since design.md
  // Decision 1 requires buildFrame to REUSE padTo, not reimplement it.
  assert.equal(line, padTo(coloured, 20));
  // The padded line is what actually reaches the terminal, behind its own
  // row-1 placement (and again via the cursor-park write, since it is also
  // the last row).
  assert.equal(frame.bytes, at(1) + line + at(1) + line);
});

test('an uncoloured line reaching the exact column width needs no padding', () => {
  const frame = buildFrame('x'.repeat(10), 10, 0, []);
  assert.equal(visibleLength(frame.lines[0]), 10);
});

// --- 5.3: a shrinking frame leaves no stale trailing rows -------------------

test('a shrinking frame blanks every leftover row from the taller previous frame', () => {
  const tall = buildFrame('a\nb\nc\nd', 5, 0, []); // 4 lines, no previous frame yet
  assert.equal(tall.lines.length, 4);

  const short = buildFrame('x\ny', 5, 0, tall.lines); // shrinks to 2 lines
  assert.equal(short.lines.length, 2);

  // Rows 3 and 4 (the leftover rows from the taller frame) must be blanked,
  // each preceded by an explicit cursor position rather than relying on
  // line-feed sequencing (design.md Decision 2).
  assert.match(short.bytes, /\x1b\[3;1H {5}/);
  assert.match(short.bytes, /\x1b\[4;1H {5}/);
  // No extra blanking beyond exactly the leftover rows.
  assert.doesNotMatch(short.bytes, /\x1b\[5;1H/);
});

test('a frame that grows writes each new row via its own cursor placement', () => {
  // CON-27 inverts CON-17's assertion here: under the always-full-rewrite
  // writer a growing frame emitted no `\x1b[<row>;1H` at all (it blanked
  // nothing and flowed by newlines); under the diff path every written row —
  // including the new ones — carries its own placement.
  const first = buildFrame('a\nb', 5, 0, []);
  const grown = buildFrame('a\nb\nc\nd', 5, 0, first.lines);
  assert.match(grown.bytes, /\x1b\[\d+;1H/);
  // Rows 1 and 2 are unchanged; EVERY new row (3 and 4) is written via its
  // own placement, not a single cursor-home + join (plus the cursor-park
  // write, which targets the last row, 4).
  assert.equal(grown.bytes, at(3) + 'c    ' + at(4) + 'd    ' + at(4) + 'd    ');
  assert.doesNotMatch(grown.bytes, /\x1b\[H/);
  // Nothing is blanked when a frame grows.
  assert.doesNotMatch(grown.bytes, /\x1b\[\d+;1H {5}/);
});

// --- CON-27: the diff itself ------------------------------------------------

test('an entirely unchanged frame writes no bytes at all', () => {
  // Decision 5: the tick this whole ticket exists to make free. Note this is
  // also the assertion behind "the cursor is not moved on an unchanged tick"
  // (Decision 8 / the spec's own cursor-rest scenario) — the cursor-park
  // write is appended only when something else was already written, so an
  // empty `bytes` here proves the cursor stays exactly where the last
  // writing tick left it, rather than being re-parked every second.
  const first = buildFrame('a\nb\nc', 5, 0, []);
  const second = buildFrame('a\nb\nc', 5, 0, first.lines);
  assert.equal(second.bytes, '');
  assert.doesNotMatch(second.bytes, /\x1b\[\d+;1H/);
  // The cache still round-trips, so a third identical tick is free too.
  assert.deepEqual(second.lines, first.lines);
});

test('a single changed row writes only that row, plus the cursor-park write', () => {
  const first = buildFrame('aaa\nbbb\nccc\nddd', 5, 0, []);
  const second = buildFrame('aaa\nXXX\nccc\nddd', 5, 0, first.lines);
  // The changed row (row 2) is written...
  assert.ok(second.bytes.includes(at(2) + 'XXX  '));
  // ...and the frame's last row is re-written to park the cursor (Decision
  // 8), since the changed row is not itself the last row.
  assert.ok(second.bytes.endsWith(at(4) + 'ddd  '));
  // No OTHER row's placement appears — exactly two placements in total.
  assert.equal(second.bytes, at(2) + 'XXX  ' + at(4) + 'ddd  ');
  assert.doesNotMatch(second.bytes, /\x1b\[1;1H/);
  assert.doesNotMatch(second.bytes, /\x1b\[3;1H/);
});

// --- CON-27: the over-tall fallback ----------------------------------------

test('a frame taller than the terminal falls back to the full newline-flow rewrite', () => {
  const text = Array.from({ length: 10 }, (_, i) => 'r' + i).join('\n');
  const frame = buildFrame(text, 5, 5, []); // 10 lines into a 5-row terminal
  const padded = text.split('\n').map((l) => padTo(l, 5));
  assert.equal(frame.bytes, CURSOR_HOME + padded.join('\n'));
  // No absolute row addressing at all on this path — a `\x1b[<row>;1H` past
  // the terminal's height clamps onto the last row instead of scrolling.
  assert.doesNotMatch(frame.bytes, /\x1b\[\d+;1H/);
  // Only the tail the terminal's scroll actually leaves visible is cached
  // (Decision 6), so absolute row i means prevLines[i] again next tick.
  assert.deepEqual(frame.lines, padded.slice(5));
  assert.equal(frame.lines.length, 5);
});

test('a back-within-bounds frame resumes per-row diffing against the truncated tail', () => {
  const tallText = Array.from({ length: 10 }, (_, i) => 'r' + i).join('\n');
  const tall = buildFrame(tallText, 5, 5, []);
  assert.deepEqual(tall.lines, ['r5   ', 'r6   ', 'r7   ', 'r8   ', 'r9   ']);

  // The next frame fits in 5 rows, and its content happens to equal the
  // visible tail the scroll left behind — so nothing should be written, and
  // the fallback must NOT re-trigger merely because an overflow just
  // happened (`prevLines.length <= rows` is what restores the invariant).
  const fits = buildFrame('r5\nr6\nr7\nr8\nr9', 5, 5, tall.lines);
  assert.equal(fits.bytes, '');
  assert.deepEqual(fits.lines, tall.lines);

  // And a genuine one-row change against that tail diffs normally.
  const changed = buildFrame('r5\nr6\nZZ\nr8\nr9', 5, 5, tall.lines);
  assert.equal(changed.bytes, at(3) + 'ZZ   ' + at(5) + 'r9   ');
  assert.doesNotMatch(changed.bytes, /\x1b\[H/);
});

// --- CON-27: the resize sentinel -------------------------------------------

test('a sentinel-invalidated cache repaints every row AND still blanks the shrunk tail', () => {
  // This is the mechanism the resize listener uses (design.md Decision 3):
  // `prevFrameLines.map(() => null)` invalidates CONTENT while preserving
  // LENGTH. Resetting to `[]` instead would force the repaint but silently
  // drop the length the shrink loop is driven by, leaving the pre-resize
  // frame's trailing rows on screen — the exact regression Decision 3
  // documents, which must not recur.
  const before = buildFrame('a\nb\nc\nd\ne', 5, 0, []);
  assert.equal(before.lines.length, 5);
  const invalidated = before.lines.map(() => null);

  // The post-resize frame is shorter (3 lines) and its content is byte-
  // identical to the pre-resize frame's first three rows.
  const after = buildFrame('a\nb\nc', 5, 0, invalidated);

  // Every row repaints despite identical content — that is the sentinel
  // doing its job for a rows-only resize.
  assert.ok(after.bytes.includes(at(1) + 'a    '));
  assert.ok(after.bytes.includes(at(2) + 'b    '));
  assert.ok(after.bytes.includes(at(3) + 'c    '));
  // ...and rows 4-5 from the taller pre-resize frame are still blanked,
  // which is only possible because the sentinel preserved `.length`.
  assert.match(after.bytes, /\x1b\[4;1H {5}/);
  assert.match(after.bytes, /\x1b\[5;1H {5}/);
  assert.doesNotMatch(after.bytes, /\x1b\[6;1H/);
  // The cursor-park write runs last, after the blanking (Decision 8).
  assert.ok(after.bytes.endsWith(at(3) + 'c    '));
});

// --- CON-26: trim phantom trailing blank row ------------------------------------
// draw() appends a trailing '\n' to its content before calling buildFrame().
// String.split('\n') on a trailing-newline-terminated string produces an extra
// empty trailing element. These tests verify that buildFrame strips that phantom
// row and does not count or write it.
//
// CON-27 ported both to the 4-arg / { bytes, lines } contract — deliberately
// PORTED, not replaced: they are the only guard on the strip, and the diff
// writer makes the bug they cover strictly worse rather than moot. Under the
// old full-rewrite writer a phantom row was one extra blank line at the
// bottom; under the diff path it would ALSO be the row the cursor-park write
// (Decision 8) leaves the cursor resting on, so the visible cursor would sit
// one row below the footer forever. Each test therefore now also asserts
// where the park write points.

test('buildFrame does not write a phantom trailing blank row for a trailing-newline-terminated input', () => {
  // A router.render()-shaped input: "line1\nline2\n" (like draw() always builds)
  const trailingNewlineInput = 'content line 1\ncontent line 2\n';
  const frame = buildFrame(trailingNewlineInput, 20, 0, []);

  // Two rows (the actual content lines), not three — a third would be the
  // phantom empty line the trailing '\n' produces when split.
  assert.equal(frame.lines.length, 2,
    'the returned lines must reflect only the actual rendered content, excluding the phantom row');

  // No row 3 is ever positioned or written...
  assert.doesNotMatch(frame.bytes, /\x1b\[3;1H/,
    'a phantom third row must never be positioned, let alone written');
  // ...and the cursor-park write targets row 2, the last REAL row, so the
  // cursor comes to rest on the footer rather than a blank row below it.
  assert.ok(frame.bytes.endsWith(at(2) + padTo('content line 2', 20)));
  assert.equal(frame.bytes,
    at(1) + padTo('content line 1', 20) + at(2) + padTo('content line 2', 20)
      + at(2) + padTo('content line 2', 20));
});

test('buildFrame strips exactly one trailing newline, preserving genuine blank content lines', () => {
  // Content with a real blank line at the end, plus draw()'s synthetic trailing '\n'.
  // This represents: "content\n" (real line) + "" (real blank line) + "\n" (synthetic from draw())
  // After stripping exactly one '\n', should yield 2 lines: "content" + one blank line.
  const contentWithBlankLineAndSyntheticNewline = 'content\n\n';
  const frame = buildFrame(contentWithBlankLineAndSyntheticNewline, 10, 0, []);

  // Two rows: one real content line + one real blank line. Only the synthetic
  // trailing '\n' is stripped; the genuine blank line remains.
  assert.equal(frame.lines.length, 2,
    'a genuine trailing blank content line must be preserved; only the synthetic trailing newline is stripped');
  assert.equal(frame.lines[0], 'content   ', 'first line should be padded content');
  assert.equal(frame.lines[1], '          ', 'second line should be a blank line, padded to column width');

  // Both rows are written, each behind its own placement, and no third row
  // exists. The blank row here is GENUINE content, so it is correctly also
  // where the park write points — unlike the phantom row in the test above.
  assert.equal(frame.bytes,
    at(1) + 'content   ' + at(2) + '          ' + at(2) + '          ');
  assert.doesNotMatch(frame.bytes, /\x1b\[3;1H/);
});

test('the lines cached for the next tick carry no phantom trailing row', () => {
  // The strip has to hold in the value buildFrame RETURNS, not just in the
  // bytes it writes: `lines` becomes the next tick's `prevLines`, so a
  // phantom row that leaked into it would be compared against, and blanked
  // by the shrink loop, on every subsequent frame.
  //
  // The length assertion is the load-bearing one. An earlier version of this
  // test asserted only `second.bytes === ''` and was vacuous: a leaked
  // phantom row lands in BOTH `lines` and `prevLines`, compares equal to
  // itself, and yields `bytes === ''` either way — so it passed with the
  // strip removed. (Caught at the final gate; the two tests above are the
  // ones that actually kill that mutation.)
  const first = buildFrame('alpha\nbravo\n', 10, 0, []);
  assert.equal(first.lines.length, 2,
    'the cached lines must hold only real content rows, not the empty string a trailing newline splits into');
  assert.deepEqual(first.lines, ['alpha     ', 'bravo     ']);

  const second = buildFrame('alpha\nbravo\n', 10, 0, first.lines);
  assert.equal(second.bytes, '',
    'a trailing-newline-terminated frame must still diff as unchanged tick over tick');
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

// --- CON-112: SGR mouse-reporting constants and click parsing --------------

test('the mouse-reporting constants are the standard SGR enable/disable pair', () => {
  assert.equal(MOUSE_REPORT_ENTER, '\x1b[?1000h\x1b[?1006h');
  assert.equal(MOUSE_REPORT_EXIT, '\x1b[?1000l\x1b[?1006l');
});

test('CON-112 task 2.2: splitKeys already yields a full SGR mouse sequence as a single token', () => {
  // A left-click at column 12, row 5 — the exact shape a real terminal with
  // SGR mouse mode enabled sends on stdin. `splitKeys` already special-cases
  // any CSI run ending in a byte in the `@`-`~` range as one token (the same
  // path arrow keys already take) — `<`, digits, and `;` are all below `@`
  // (0x40), so the scan does not stop early, and the sequence's own final
  // byte (`M`) is what ends it.
  assert.deepEqual(splitKeys('\x1b[<0;12;5M'), ['\x1b[<0;12;5M']);
  // A paste/piped chunk carrying a click immediately followed by an ordinary
  // key must still split into exactly two tokens, not run the click's scan
  // into the following key.
  assert.deepEqual(splitKeys('\x1b[<0;12;5Mj'), ['\x1b[<0;12;5M', 'j']);
});

test('CON-112 task 2.3: parseMouseClick recognizes a left-button press and returns its 1-based {row, col}', () => {
  assert.deepEqual(parseMouseClick('\x1b[<0;12;5M'), { col: 12, row: 5 });
});

test('CON-112 task 2.3: parseMouseClick returns null for a release event (only press is handled this pass)', () => {
  assert.equal(parseMouseClick('\x1b[<0;12;5m'), null);
});

test('CON-112 task 2.3: parseMouseClick returns null for a non-mouse CSI sequence (falls through to keypress handling)', () => {
  assert.equal(parseMouseClick('\x1b[A'), null); // up arrow
  assert.equal(parseMouseClick('j'), null); // an ordinary key
  // A right-button or motion event — this pass only recognizes button code
  // 0 (left, press).
  assert.equal(parseMouseClick('\x1b[<2;12;5M'), null);
  assert.equal(parseMouseClick('\x1b[<32;12;5M'), null);
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
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
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
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

// ===========================================================================
// CON-78 — sessionsAutoRefreshDue(), the pure gating check the poll timer's
// own setInterval callback uses to decide whether THIS tick re-runs sessions
// discovery (design.md Decision 1). Tested directly, as a pure function,
// rather than by actually waiting on the real POLL_MS timer — see this
// file's own flushRefresh() comment (further down) on why a real wall-clock
// wait around this file's stdout-capturing harness is deliberately avoided
// (it corrupts node:test's own pass/fail accounting for an adjacent test).
// ===========================================================================

test('sessionsAutoRefreshDue is false on every tick while mode is fleet', () => {
  for (let tick = 1; tick <= 12; tick++) {
    assert.equal(sessionsAutoRefreshDue('fleet', tick), false, `tick ${tick}`);
  }
});

test('sessionsAutoRefreshDue is true only on every 3rd tick while mode is sessions', () => {
  const due = [];
  for (let tick = 1; tick <= 9; tick++) {
    if (sessionsAutoRefreshDue('sessions', tick)) due.push(tick);
  }
  assert.deepEqual(due, [3, 6, 9]);
});

test('sessionsAutoRefreshDue is false for any other mode, even on a multiple-of-3 tick', () => {
  assert.equal(sessionsAutoRefreshDue('drilldown', 3), false);
  assert.equal(sessionsAutoRefreshDue('settings', 6), false);
  assert.equal(sessionsAutoRefreshDue(undefined, 3), false);
});

// --- CON-78: the sessions screen wired end to end (open/close, no real
// POLL_MS wait needed — a keypress-driven redraw is enough to prove the
// mode transition and the fresh discovery pass on open) --------------------

test('v opens the sessions screen from the fleet, populated with a fresh discovery pass; Escape returns to the fleet', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-sessions-'));

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const discoveryPath = require.resolve('../lib/ui/discovery');

  const fakeSessionObj = {
    name: 'concertino',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const discoverCalls = [];

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: {
      hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__',
      attachTarget: () => ({ status: 0 }), killTarget: () => {},
    },
  };
  require.cache[discoveryPath] = {
    id: discoveryPath, filename: discoveryPath, loaded: true,
    exports: {
      discover(opts) { discoverCalls.push(opts); return [{ pid: 1, harness: 'claude', managed: false, tmux: null, cwd: '/a', ageMs: 1000, version: null, nearTicket: null }]; },
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
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  try {
    const watchModule = require('../lib/ui/watch');
    const donePromise = watchModule.watch({ root, config: {} });

    assert.equal(discoverCalls.length, 0, 'discovery must not run before the sessions screen is ever opened');

    written.length = 0;
    fakeStdin.emit('data', 'v');
    assert.equal(discoverCalls.length, 1, 'opening the sessions screen runs discovery exactly once, synchronously');

    const screenAfterOpen = written.join('');
    assert.match(screenAfterOpen, /claude/, 'the freshly discovered session is on screen immediately');

    fakeStdin.emit('data', '\x1b');
    written.length = 0;
    fakeStdin.emit('data', 'j'); // a harmless no-op keypress that still redraws via move (fleet mode)
    const screenAfterBack = written.join('');
    assert.doesNotMatch(screenAfterBack, /SESSIONS/, 'Escape must have returned to the fleet screen');

    fakeStdin.emit('end');
    await donePromise;
  } finally {
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    delete require.cache[discoveryPath];
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
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
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  try {
    const watchModule = require('../lib/ui/watch');
    const donePromise = watchModule.watch({ root, config: {} });

    // The first draw() (synchronous, before `await new Promise(...)`) has
    // already rendered index 0 (HEL-200) selected, unscrolled — sanity-check
    // it before moving at all.
    const firstFrame = screenOf(written);
    const firstMarked = firstFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(firstMarked.length, 1);
    assert.ok(firstMarked[0].includes('HEL-200'));

    // Six 'j' presses: index 0 -> 6. MAX_FINISHED = 5 means index 4 is the
    // last row visible before any scrolling — the 5th and 6th presses (onto
    // indices 5 and 6) are the ones that must scroll the view, not just move
    // an now-invisible marker.
    for (let i = 0; i < 6; i++) fakeStdin.emit('data', 'j');

    const lastFrame = screenOf(written);
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
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

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

    const scrolledFrame = screenOf(written);
    // RUNNING has scrolled entirely past — its own collapse line names it
    // (lowercase, matching the existing "… and N more <title>" wording),
    // not the bordered section title.
    assert.match(scrolledFrame, /and \d+ more running/, 'RUNNING should have collapsed to its own overflow line');
    assert.doesNotMatch(scrolledFrame, /HEL-2\b/, 'HEL-2 should have scrolled out of view by this point');

    // 7 'k' presses back: index 8 -> 1, landing exactly on HEL-2 (RUNNING).
    for (let i = 0; i < 7; i++) fakeStdin.emit('data', 'k');

    const backAtRunning = screenOf(written);
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
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-39: digit-key section jump, wired end to end through watch.js -----
// A single digit press must reach the same scroll-into-view row a run of
// repeated k presses would (see the two tests above): jumping directly to a
// section currently scrolled entirely out of view must scroll it back into
// the rendered window, with the marker on it.

test('a digit press jumps directly to a scrolled-past section and scrolls it back into view', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-jump-'));

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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // Scroll deep into DONE first, exactly as the sibling test above does —
    // RUNNING's own row (HEL-2, index 1) scrolls entirely out of view.
    for (let i = 0; i < 8; i++) fakeStdin.emit('data', 'j');
    const scrolledFrame = screenOf(written);
    assert.doesNotMatch(scrolledFrame, /HEL-2\b/, 'HEL-2 should have scrolled out of view by this point');

    // Sections on screen: NEEDS YOU (1), RUNNING (2), DONE (3). Digit 2
    // jumps straight to RUNNING's first (only) row — one keypress, not
    // seven k's.
    fakeStdin.emit('data', '2');

    const jumpedFrame = screenOf(written);
    const marked = jumpedFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `expected exactly one marker after the jump, got ${marked.length}`);
    assert.ok(marked[0].includes('HEL-2'),
      `the marker should be on HEL-2 (RUNNING) after jumping to section 2; marked line was: ${marked[0] || '(none)'}`);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-110: `/` fleet-wide search, wired end to end -----------------------
// Mirrors the digit-jump test just above: the same "scroll deep into DONE,
// then jump straight back" scenario, but via `/` + typed text + `↵` instead
// of a single digit — proving the search-driven jump reaches into a
// section's full bucket (not just what is painted on screen at the moment
// of the keypress) exactly like digit-jump already does.

test("'/' + typing + enter jumps directly to a scrolled-past section's matching row, like a digit press does", async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-search-jump-'));

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
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (the
  // Enter keypress that submits the search query) — see withWatchHarness's
  // own identical comment.
  fakeStdin.isTTY = true;
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // Scroll deep into DONE first — HEL-2 (RUNNING) scrolls entirely out of
    // view, exactly as the sibling digit-jump test does.
    for (let i = 0; i < 8; i++) fakeStdin.emit('data', 'j');
    const scrolledFrame = screenOf(written);
    assert.doesNotMatch(scrolledFrame, /HEL-2\b/, 'HEL-2 should have scrolled out of view by this point');

    // '/' opens the search box.
    fakeStdin.emit('data', '/');
    assert.match(screenOf(written), /search/);

    // Type "HEL-2" — a query that matches only HEL-2's own ticket id (not
    // HEL-300..HEL-309, DONE's own delivered tickets).
    for (const ch of 'HEL-2') fakeStdin.emit('data', ch);

    // ↵ jumps to the first (only) match, scrolling it back into view.
    fakeStdin.emit('data', '\r');

    const jumpedFrame = screenOf(written);
    assert.doesNotMatch(jumpedFrame, /search ›/, 'the search prompt must have closed on a successful jump');
    const marked = jumpedFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `expected exactly one marker after the search-jump, got ${marked.length}`);
    assert.ok(marked[0].includes('HEL-2'),
      `the marker should be on HEL-2 (RUNNING) after the search-jump; marked line was: ${marked[0] || '(none)'}`);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('esc cancels the search prompt with no state change — selected/scrollOffset/focus are exactly as before `/` was pressed', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-search-cancel-'));
  for (const ticket of ['HEL-1', 'HEL-2', 'HEL-3']) {
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return []; }, capture() { return ''; },
    captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
  };
  const fakeStdin = new EventEmitter();
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (the
  // Enter keypress that submits/cancels the search query) — see
  // withWatchHarness's own identical comment.
  fakeStdin.isTTY = true;
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    fakeStdin.emit('data', 'j'); // move selection to index 1 first
    const beforeFrame = screenOf(written);
    const beforeMarked = beforeFrame.split('\n').filter((l) => l.includes('▸'));

    fakeStdin.emit('data', '/');
    for (const ch of 'zzz-no-match') fakeStdin.emit('data', ch);
    fakeStdin.emit('data', '\x1b'); // esc cancels

    const afterFrame = screenOf(written);
    assert.doesNotMatch(afterFrame, /search ›/, 'the search prompt must have closed');
    const afterMarked = afterFrame.split('\n').filter((l) => l.includes('▸'));
    assert.deepEqual(afterMarked, beforeMarked, 'selection must be exactly as it was before `/` was pressed');
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('enter with no match leaves the search prompt open, value unchanged — a no-op, not a cancel', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-search-nomatch-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return []; }, capture() { return ''; },
    captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
  };
  const fakeStdin = new EventEmitter();
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (the
  // Enter keypress that submits/cancels the search query) — see
  // withWatchHarness's own identical comment.
  fakeStdin.isTTY = true;
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    fakeStdin.emit('data', '/');
    for (const ch of 'zzz') fakeStdin.emit('data', ch);
    fakeStdin.emit('data', '\r'); // no match — a no-op

    const frame = screenOf(written);
    assert.match(frame, /search.*zzz/, 'the prompt must stay open, value unchanged');
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-39: QUEUED-local focus round trip, wired end to end ---------------

test('jumping into QUEUED focus, moving the cursor, and exiting leaves the run selection completely unchanged', async () => {
  const { EventEmitter } = require('node:events');
  const queueCache = require('../lib/ui/queue-cache');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-queuefocus-'));

  for (const ticket of ['HEL-1', 'HEL-2']) {
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: ticket === 'HEL-1' ? 1000 : 900, kind: 'run.start' }) + '\n');
  }

  // Seed a restored (unconfirmed) queue tail — QUEUED renders purely off
  // pending.length, regardless of confirmed (design.md Decision 4's own
  // point), so this is sufficient to put a QUEUED section on screen.
  queueCache.write(root, {
    pending: ['CON-50', 'CON-51'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-1', Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-1', alive: true, activity: null }, { ticket: 'HEL-2', alive: true, activity: null }]; },
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  const markedTicket = (frame) => {
    const line = frame.split('\n').find((l) => l.includes('▸'));
    return line ? (line.match(/HEL-\d+/) || [null])[0] : null;
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // Move selection onto the SECOND running run first, so a stray reset to
    // index 0 would be caught.
    fakeStdin.emit('data', 'j');
    const beforeFrame = screenOf(written);
    assert.equal(markedTicket(beforeFrame), 'HEL-2', 'sanity: selection is on HEL-2 before entering queue focus');

    // Sections on screen: RUNNING (1), QUICK START (2, always on screen —
    // CON-56), QUEUED (3). Digit 3 jumps INTO QUEUED focus without touching
    // the run selection at all.
    fakeStdin.emit('data', '3');
    const inQueueFrame = screenOf(written);
    assert.match(inQueueFrame, /»/, 'the QUEUED-local cursor marker should now be on screen');
    assert.equal(markedTicket(inQueueFrame), 'HEL-2', 'the run selection marker must be unaffected by entering queue focus');

    // Move the QUEUED-local cursor — must still never touch the run selection.
    fakeStdin.emit('data', 'j');
    const movedFrame = screenOf(written);
    assert.equal(markedTicket(movedFrame), 'HEL-2');

    // Escape back out — the run selection must resolve to the exact same run.
    fakeStdin.emit('data', '\x1b');
    const afterFrame = screenOf(written);
    assert.doesNotMatch(afterFrame, /»/, 'the QUEUED-local cursor marker should be gone after exiting queue focus');
    assert.equal(markedTicket(afterFrame), 'HEL-2', 'the run selection must resolve to the same run after the round trip');
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-109, evaluator cycle-1 change request 1: a mouse click on a run row
// while QUEUED focus is active reaches the same under-guarded 'jump' case
// the keyboard digit-jump path does — must clear S.multiSelect.queued too,
// not just S.focus. ---------------------------------------------------------

test('a mouse click on a run row while QUEUED-focused clears S.multiSelect.queued, not just S.focus', async () => {
  const { EventEmitter } = require('node:events');
  const queueCache = require('../lib/ui/queue-cache');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-queueclick-'));

  for (const ticket of ['HEL-1', 'HEL-2']) {
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: ticket === 'HEL-1' ? 1000 : 900, kind: 'run.start' }) + '\n');
  }

  // Same seeded-queue technique as the QUEUED-focus round-trip test above —
  // sufficient to put a QUEUED section on screen with two pending tickets.
  queueCache.write(root, {
    pending: ['CON-50', 'CON-51'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-1', Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-1', alive: true, activity: null }, { ticket: 'HEL-2', alive: true, activity: null }]; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true; // mouse sequences need the same isTTY treatment CON-112's own click tests use
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // Sections on screen: RUNNING (1), QUICK START (2, always on screen —
    // CON-56), QUEUED (3) — same numbering the round-trip test above relies
    // on. Digit 3 jumps INTO QUEUED focus.
    fakeStdin.emit('data', '3');
    // space toggles the QUEUED-local cursor's ticket (CON-50, queueFocus 0)
    // into S.multiSelect.queued.
    fakeStdin.emit('data', ' ');
    const selectedFrame = screenOf(written);
    assert.match(selectedFrame, /✓/, 'sanity: the multi-select marker is on screen after space');

    // Locate HEL-2's rendered row and click it — deliberately the run row
    // NOT already selected (jumping into QUEUED focus never moves `selected`
    // off its pre-existing HEL-1/index-0 position), so the click actually
    // changes what's on screen (the ▸ marker moves from HEL-1 to HEL-2) and
    // the differential writer (CON-27) emits a real diff to replay — clicking
    // an ALREADY-selected row would be a false-negative-prone no-diff case
    // for this specific assertion. Dispatches the same { type: 'jump', ... }
    // action a digit-jump to a different section would, via watch.js's own
    // SGR mouse-click intercept in onKey (independent of fleet/keys.js's
    // handleKey entirely).
    const lines = selectedFrame.split('\n');
    const targetLine = lines.findIndex((l) => l.includes('HEL-2'));
    assert.ok(targetLine >= 0, 'fixture sanity: HEL-2 must be on screen');
    const terminalRow = targetLine + 1;

    fakeStdin.emit('data', '\x1b[<0;5;' + terminalRow + 'M');

    // screenOf replays the FULL accumulated write history, never just the
    // latest diff chunk (this file's own header comment on screenOf, and
    // CON-27's differential-writer precedent) — required here since this
    // click's own diff may not touch every row screenOf needs to reconstruct
    // the true current screen.
    const afterClickFrame = screenOf(written);
    assert.doesNotMatch(afterClickFrame, /»/, 'the click must have exited QUEUED focus (mirrors CON-112\'s own jump-action behavior)');
    const marked = afterClickFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1);
    assert.ok(marked[0].includes('HEL-2'), 'the click must have selected HEL-2, via the ordinary jump action');

    // The regression itself: re-enter QUEUED focus and press f. If
    // S.multiSelect.queued had survived the click (the bug this test
    // guards), this would silently resolve to a BULK force-start confirm
    // (naming a count) instead of the single-ticket one (naming CON-50, the
    // ticket still under queueFocus 0 — nothing was force-started here).
    fakeStdin.emit('data', '3'); // back into QUEUED focus
    fakeStdin.emit('data', 'f');
    const confirmFrame = screenOf(written);
    assert.match(confirmFrame, /y confirm force-start/, 'sanity: a force-start confirmation opened');
    assert.doesNotMatch(confirmFrame, /force-start \d+ queued tickets/,
      'S.multiSelect.queued must have been cleared by the earlier click — f must resolve to the single-row ' +
      'confirm (naming one ticket), never the bulk one (naming a count), or the click-path clearing fix has regressed');
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CON-39: force-start confirm/cancel/confirm cycle, wired end to end ----

test('force-start: f opens a confirmation, any key cancels, y actually starts the ticket and persists the queue', async () => {
  const { EventEmitter } = require('node:events');
  const queueCache = require('../lib/ui/queue-cache');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-forcestart-'));

  queueCache.write(root, {
    pending: ['CON-90'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-1', Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const spawnCalls = [];
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn(ticket, cmd) { spawnCalls.push({ ticket, cmd }); },
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // No runs at all — QUICK START (always on screen — CON-56) is digit 1,
    // QUEUED is digit 2, jumping straight into queue focus on CON-90 (the
    // sole pending ticket).
    fakeStdin.emit('data', '2');
    const focusedFrame = screenOf(written);
    assert.match(focusedFrame, /»/);

    // f opens the confirmation — nothing has started yet.
    fakeStdin.emit('data', 'f');
    const confirmFrame = screenOf(written);
    assert.match(confirmFrame, /this will run 1 concurrently, exceeding your maxConcurrent:1 setting/);
    assert.equal(spawnCalls.length, 0, 'nothing should be spawned until y is pressed');

    // Any other key cancels — no spawn, queue unchanged on disk.
    fakeStdin.emit('data', 'x');
    const cancelledFrame = screenOf(written);
    assert.doesNotMatch(cancelledFrame, /this will run 1 concurrently/);
    assert.equal(spawnCalls.length, 0);
    const afterCancelRecord = queueCache.read(root);
    assert.deepEqual(afterCancelRecord.pending, ['CON-90'], 'cancelling must never mutate the persisted queue');

    // f again, then y — this time it actually starts.
    fakeStdin.emit('data', 'f');
    fakeStdin.emit('data', 'y');
    const startedFrame = screenOf(written);

    assert.equal(spawnCalls.length, 1, 'exactly one spawn — the confirmed force-start');
    assert.equal(spawnCalls[0].ticket, 'CON-90');

    const afterStartRecord = queueCache.read(root);
    assert.deepEqual(afterStartRecord.pending, [], 'CON-90 must have left pending');
    assert.deepEqual(afterStartRecord.inFlight, ['CON-90'], 'CON-90 must persist as an ordinary in-flight entry');

    // QUEUED is gone from the frame now that pending is empty.
    assert.doesNotMatch(startedFrame, /QUEUED/);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Clear Queue: C opens a confirmation, any key cancels, y drops pending and persists (or removes) the queue', async () => {
  const { EventEmitter } = require('node:events');
  const queueCache = require('../lib/ui/queue-cache');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-clearqueue-'));

  queueCache.write(root, {
    pending: ['CON-90', 'CON-91'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-1', Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const spawnCalls = [];
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn(ticket, cmd) { spawnCalls.push({ ticket, cmd }); },
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    const initialFrame = screenOf(written);
    assert.match(initialFrame, /QUEUED \(2/);

    // C opens the confirmation — nothing dropped yet.
    fakeStdin.emit('data', 'C');
    const confirmFrame = screenOf(written);
    assert.match(confirmFrame, /this will drop 2 queued tickets — they will never start\. proceed\?/);

    // Any other key cancels — the persisted queue is untouched.
    fakeStdin.emit('data', 'x');
    const cancelledFrame = screenOf(written);
    assert.doesNotMatch(cancelledFrame, /this will drop 2 queued tickets/);
    const afterCancelRecord = queueCache.read(root);
    assert.deepEqual(afterCancelRecord.pending, ['CON-90', 'CON-91'],
      'cancelling must never mutate the persisted queue');

    // C again, then y — this time it actually clears.
    fakeStdin.emit('data', 'C');
    fakeStdin.emit('data', 'y');
    const clearedFrame = screenOf(written);

    assert.equal(spawnCalls.length, 0, 'Clear Queue must never spawn anything');
    assert.doesNotMatch(clearedFrame, /QUEUED/);

    // Nothing pending and nothing in flight — the queue is idle, so the
    // cache file itself is removed (queueCache.clear), not just emptied,
    // mirroring what a normal tick()-driven drain to empty already does.
    assert.equal(queueCache.read(root), null);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every frame begins with the persistent top bar naming the project and current screen', async () => {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-topbar-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ kind: 'run.start', t: 1, project: 'helio', branch: 'feature/x/HEL-1' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return []; }, capture() { return ''; },
    captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });
    const frame = screenOf(written);
    const firstLine = frame.split('\n')[0];
    assert.match(firstLine, /helio/);
    assert.match(firstLine, /FLEET/);
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// CON-27 (skeptic-final-1b.md change requests 1 and 2): the two cache-
// invalidation WIRING lines.
//
// buildFrame's own internals are well covered by the pure tests at the top of
// this file, but the two lines that decide WHEN its previous-frame cache is
// invalidated are not reachable from them — and a mutation run proved all
// three plausible regressions (resize invalidation weakened to `[]`, resize
// invalidation deleted, attach reset deleted) passed the entire `npm test`
// gate with exit 0, while each is catastrophic in a real terminal: an
// interleaved double-render with two selection markers for the resize cases,
// a permanently BLANK dashboard for the attach case.
//
// Both requirements are MODIFIED by this change's spec delta and each has a
// dedicated scenario there ("A rows-only resize still triggers a full
// rewrite, not a partial diff" and "The first redraw after returning from
// attach rewrites every row"); these are those scenarios' regression tests.
//
// Both drive the real watch() loop, the same fake-session/fake-stdin
// technique the CON-6 scroll tests above use, because the seam under test is
// watch()'s own wiring — asserting on buildFrame directly would re-test the
// thing that already works and miss the thing that does not.
// ===========================================================================

// Shared harness: the fleet's RUNNING section is the one that actually grows
// and shrinks with the terminal's row budget (DONE is capped at MAX_FINISHED,
// so a DONE-only fixture renders the same height at every size and could not
// exercise the shrink path at all — measured before writing this).
function withWatchHarness({ tickets, rows, cols, attach }, body) {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-cache-'));
  for (let i = 0; i < tickets; i++) {
    const runDir = path.join(root, '.concertino', 'runs', 'HEL-' + (200 + i));
    fs.mkdirSync(runDir, { recursive: true });
    // run.start with no run.end, and listed as a live window below, so every
    // one of these lands in RUNNING.
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: 1000 - i * 10, kind: 'run.start' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() {
      return Array.from({ length: tickets },
        (_, i) => ({ ticket: 'HEL-' + (200 + i), alive: true, activity: null }));
    },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach: attach || (() => ({ status: 0 })),
  };

  const fakeStdin = new EventEmitter();
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (the
  // attach key) as it does for piped stdin — see watch.js's own comment there.
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const realColsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const realWrite = process.stdout.write;
  // watch() registers its 'resize' listener on the real process.stdout and
  // never removes it — and quit() does not clear its `running` flag — so a
  // previously-finished watch() from an earlier test in this file would ALSO
  // redraw (into this test's `written`) when we emit 'resize'. Park them for
  // the duration and put them back afterwards, so the only listener that
  // fires is the one under test.
  const parkedResizeListeners = process.stdout.listeners('resize').slice();
  process.stdout.removeAllListeners('resize');

  const written = [];
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  const setRows = (n) => Object.defineProperty(process.stdout, 'rows', { value: n, configurable: true });
  setRows(rows);
  Object.defineProperty(process.stdout, 'columns', { value: cols, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  const cleanup = async () => {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    if (realRowsDescriptor) Object.defineProperty(process.stdout, 'rows', realRowsDescriptor);
    else delete process.stdout.rows;
    if (realColsDescriptor) Object.defineProperty(process.stdout, 'columns', realColsDescriptor);
    else delete process.stdout.columns;
    process.stdout.removeAllListeners('resize');
    for (const l of parkedResizeListeners) process.stdout.on('resize', l);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  };

  const watchModule = require('../lib/ui/watch');
  donePromise = watchModule.watch({ root, config: {} });
  return body({ written, fakeStdin, setRows }).finally(cleanup);
}

test('a rows-only resize repaints every row AND blanks the taller pre-resize frame\'s trailing rows', async () => {
  // 12 live runs at 30 rows renders a 29-row frame; at 20 rows the fleet's
  // visible window shrinks it to 18. Same column count throughout — that is
  // the whole point: `padTo` pads to exactly `cols`, so a rows-only resize
  // leaves unchanged content byte-identical and the diff would skip it
  // without the listener's explicit invalidation (design.md Decision 3).
  await withWatchHarness({ tickets: 12, rows: 30, cols: 100 }, async ({ written, setRows }) => {
    const before = writesByRow(written);
    assert.ok(before.length > 0, 'the startup frame should have been drawn');
    const preHeight = Math.max(...before.map((w) => w.row));
    assert.ok(preHeight > 20,
      `fixture sanity: the pre-resize frame must be taller than the post-resize terminal, got ${preHeight}`);

    written.length = 0;
    setRows(20);
    process.stdout.emit('resize');

    const after = writesByRow(written);
    assert.ok(after.length > 0, 'the resize must trigger a redraw');
    // Still the diff path, not the over-tall fallback — otherwise this test
    // would be asserting about a code path it does not mean to cover.
    assert.doesNotMatch(written.join(''), /\x1b\[H/,
      'a frame that fits its terminal must not take the full-rewrite fallback');

    const touched = new Set(after.map((w) => w.row));
    // The frame's last row is the footer, which is never blank — so the
    // largest row carrying non-blank content is the new frame's height.
    const newHeight = Math.max(...after.filter((w) => w.text.trim() !== '').map((w) => w.row));
    assert.ok(newHeight < preHeight,
      `fixture sanity: the frame must actually shrink (pre=${preHeight}, post=${newHeight})`);

    // (a) EVERY row from 1 to the taller pre-resize frame's height is
    //     touched, with no gaps: rows 1..newHeight rewritten by the diff
    //     (this is what fails if the invalidation is removed entirely — the
    //     unchanged rows would be skipped, leaving holes), and rows
    //     newHeight+1..preHeight blanked by the shrink loop (this is what
    //     fails if the invalidation is weakened to `prevFrameLines = []`,
    //     which discards the length that loop is driven by).
    for (let row = 1; row <= preHeight; row++) {
      assert.ok(touched.has(row),
        `row ${row} was not written by the resize redraw (frame 1..${newHeight}, stale tail ${newHeight + 1}..${preHeight})`);
    }

    // (b) The stale tail is blanked specifically — not merely "touched".
    for (const w of after.filter((x) => x.row > newHeight)) {
      assert.equal(w.text.trim(), '',
        `row ${w.row} is past the new frame's last row and must be blanked, got ${JSON.stringify(w.text)}`);
    }

    // (c) Nothing beyond the pre-resize frame is touched — the shrink loop
    //     must stop at the previous frame's own length.
    assert.equal(Math.max(...after.map((w) => w.row)), preHeight,
      'the redraw must not write past the pre-resize frame\'s last row');
  });
});

test('the first redraw after returning from attach repaints every row', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    const before = writesByRow(written);
    const height = Math.max(...before.map((w) => w.row));
    assert.ok(height > 1, 'the startup frame should have been drawn');

    written.length = 0;
    // '\r' on the selected run with no live escalation routes to
    // doAttach() (fleet.js's handleKey), which exits the alternate buffer,
    // calls the faked session.attach(), and re-enters it. applyAction then
    // returns true, so watch()'s key handler redraws synchronously — that
    // redraw is the one under test.
    fakeStdin.emit('data', '\r');

    const all = written.join('');
    assert.ok(all.includes(ALT_SCREEN_EXIT) && all.includes(ALT_SCREEN_ENTER),
      'sanity: the attach round-trip should have suspended and restored the alternate buffer');

    // Re-entering the alternate buffer CLEARS it, so nothing the pre-attach
    // cache describes is on screen any more. Every row must be repainted.
    // Without the reset the frame is byte-identical to the pre-attach one,
    // every row diffs as "unchanged", buildFrame returns bytes === '' — and
    // the dashboard stays blank forever.
    const after = writesByRow(written);
    assert.ok(after.length > 0,
      'the post-attach redraw wrote nothing at all — the dashboard would be left blank');
    const touched = new Set(after.map((w) => w.row));
    for (let row = 1; row <= height; row++) {
      assert.ok(touched.has(row), `row ${row} was not repainted after the attach round-trip`);
    }
  });
});

test('CON-112: mouse reporting is entered once at startup and exited once at quit', async () => {
  await withWatchHarness({ tickets: 1, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    const all = written.join('');
    assert.equal(all.split(MOUSE_REPORT_ENTER).length - 1, 1,
      'MOUSE_REPORT_ENTER must be written exactly once at startup');
    assert.doesNotMatch(all, /\x1b\[\?1000l/, 'mouse reporting must not already be disabled before quit');

    written.length = 0;
    fakeStdin.emit('data', 'q');
    const afterQuit = written.join('');
    assert.equal(afterQuit.split(MOUSE_REPORT_EXIT).length - 1, 1,
      'MOUSE_REPORT_EXIT must be written exactly once on quit');
    assert.ok(afterQuit.includes(CURSOR_SHOW), 'the cursor must be shown again on quit');
  });
});

test('CON-112: mouse reporting is suspended before an attach and restored after, paired with the alt-screen', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    written.length = 0;
    fakeStdin.emit('data', '\r');
    const all = written.join('');
    assert.equal(all.split(MOUSE_REPORT_EXIT).length - 1, 1,
      'mouse reporting must be disabled exactly once before handing the terminal to tmux');
    assert.equal(all.split(MOUSE_REPORT_ENTER).length - 1, 1,
      'mouse reporting must be re-enabled exactly once after regaining control');
    // Ordering: exit must precede the alt-screen exit's own restore re-entry
    // — i.e. exit comes before enter in the byte stream, mirroring the
    // alt-screen pair's own suspend-then-restore order.
    assert.ok(all.indexOf(MOUSE_REPORT_EXIT) < all.indexOf(MOUSE_REPORT_ENTER),
      'mouse reporting must be disabled before it is re-enabled');
  });
});

test('CON-112: mouse reporting is restored even when the attach itself THROWS', async () => {
  const boom = () => { throw new Error('tmux exploded'); };
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100, attach: boom }, async ({ written, fakeStdin }) => {
    written.length = 0;
    assert.throws(() => fakeStdin.emit('data', '\r'), /tmux exploded/);
    const all = written.join('');
    assert.ok(all.includes(MOUSE_REPORT_EXIT), 'mouse reporting must still be disabled before the throwing attach');
    assert.ok(all.includes(MOUSE_REPORT_ENTER),
      'the restore callback must still re-enable mouse reporting even when attach() throws (frame.attachAndRestore\'s try/finally)');
  });
});

// --- CON-112: click-to-select on the fleet run-row list ---------------------

test('CON-112: a left-click on a rendered run row selects that run, via the same jump action digit-jump uses', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    // withWatchHarness names its fixture runs HEL-200.. (200 + i) — target
    // the second one (HEL-201), exactly the way the digit-jump test above
    // locates its own target row. screenOf replays the differential writes
    // into a plain per-row screen so this does not depend on which rows the
    // diff writer happened to touch on the startup frame.
    const frame = screenOf(written);
    const lines = frame.split('\n');
    const targetLine = lines.findIndex((l) => l.includes('HEL-201'));
    assert.ok(targetLine >= 0, 'fixture sanity: HEL-201 must be on the startup frame');
    const terminalRow = targetLine + 1; // screenOf is 0-based; terminal rows are 1-based

    written.length = 0;
    fakeStdin.emit('data', '\x1b[<0;5;' + terminalRow + 'M');

    const after = screenOf(written.length ? written : [frame]);
    const marked = after.split('\n').filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `expected exactly one marker after the click, got ${marked.length}`);
    assert.ok(marked[0].includes('HEL-201'),
      `the marker should be on HEL-201 after clicking its row; marked line was: ${marked[0] || '(none)'}`);
  });
});

test('CON-112: a click outside any rendered run row is a no-op — selection and rendering are unchanged', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    const before = screenOf(written);
    const beforeMarked = before.split('\n').filter((l) => l.includes('▸'));

    written.length = 0;
    // Row 1 is the top bar — never part of the fleet row-index map.
    fakeStdin.emit('data', '\x1b[<0;5;1M');

    assert.equal(written.length, 0,
      'a click outside any rendered row must dispatch no action at all — draw() must not even be called');
    const after = screenOf(written.length ? written : [before]);
    const afterMarked = after.split('\n').filter((l) => l.includes('▸'));
    assert.deepEqual(afterMarked, beforeMarked, 'selection must be unchanged by a click outside the row list');
  });
});

test('CON-112: an unrecognized mouse sequence (a release event) falls through as a harmless no-op keypress', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    const before = screenOf(written);
    const beforeMarked = before.split('\n').filter((l) => l.includes('▸'));

    written.length = 0;
    // A release event (final byte 'm') — parseMouseClick returns null for
    // this, so it falls through to router.handleKey, which has no binding
    // for this raw byte sequence and returns null (no-op), exactly like the
    // spec's own "unrecognized mouse sequence" scenario.
    fakeStdin.emit('data', '\x1b[<0;5;3m');

    assert.equal(written.length, 0, 'an unrecognized sequence must not trigger any redraw');
    const after = screenOf(written.length ? written : [before]);
    assert.deepEqual(after.split('\n').filter((l) => l.includes('▸')), beforeMarked);
  });
});

test('CON-112: a click is a no-op outside fleet mode (S.fleetRowMap is null)', async () => {
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100 }, async ({ written, fakeStdin }) => {
    // Open the drill-down (Enter with no live escalation attaches, not
    // drills — use 'l' instead, fleet.js's own "view details" binding).
    fakeStdin.emit('data', 'l');
    assert.match(screenOf(written), /DRILL-DOWN|GATES|EVIDENCE/i, 'fixture sanity: drill-down must be open');

    written.length = 0;
    fakeStdin.emit('data', '\x1b[<0;5;3M');
    assert.equal(written.length, 0, 'a click while any non-fleet screen is on top must be a silent no-op');
  });
});

// --- CON-112, design.md Decision 5: the new top-level uncaughtException
// handler --------------------------------------------------------------

test('CON-112 task 1.7: quit() removes the uncaughtException handler — no leaked listener across watch() calls', async () => {
  const baseline = process.listenerCount('uncaughtException');
  await withWatchHarness({ tickets: 1, rows: 30, cols: 100 }, async ({ fakeStdin }) => {
    assert.equal(process.listenerCount('uncaughtException'), baseline + 1,
      'watch() must register exactly one new uncaughtException listener');
    fakeStdin.emit('data', 'q');
    assert.equal(process.listenerCount('uncaughtException'), baseline,
      'quit() must remove the listener it registered, restoring the pre-watch() count — this is what keeps ' +
      'test/watch.test.js\'s own ~62 sequential watch() calls from accumulating stale handlers');
  });
});

test('CON-112 task 1.5/1.7: an uncaught exception restores the FULL terminal state (raw mode, alt-screen, ' +
  'mouse mode, cursor) exactly once, surfaces the error, and exits — a second exception cannot double-write', async () => {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-crash-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return [{ ticket: 'HEL-1', alive: true, activity: null }]; },
    capture() { return ''; }, captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const realError = console.error;
  const realExit = process.exit;
  const written = [];
  let errOut = '';
  let exitCode = null;

  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  console.error = (s) => { errOut += String(s) + '\n'; };
  // process.exit() never returns in production — a bare stub that just
  // records the call and returns would let this test's OWN code after the
  // call keep running, unlike reality (and unlike what the handler itself
  // assumes: nothing follows its own process.exit() call). A sentinel throw
  // reproduces "never returns" without actually killing the test process.
  class ExitSentinel extends Error {}
  process.exit = (code) => { exitCode = code; throw new ExitSentinel(); };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  try {
    // The baseline BEFORE watch() registers its own listener — node:test
    // itself keeps a global 'uncaughtException' listener of its own (to
    // catch genuine test-breaking errors), so this must never be assumed to
    // be 0. Calling the CAPTURED handler function directly below (rather
    // than `process.emit('uncaughtException', ...)`, which would also
    // invoke node:test's own listener and misreport this deliberate,
    // handled simulation as a real test failure) is what keeps this test
    // isolated to exactly the one handler watch() itself installed.
    const baseline = process.listenerCount('uncaughtException');

    const watchModule = require('../lib/ui/watch');
    // Deliberately not awaited: the crash path never resolves watch()'s own
    // promise (matching production, where process.exit() really does
    // terminate the process before anything else runs — including the
    // resolve() only a graceful quit() reaches). Nothing here ever settles
    // this promise, but nothing awaits it either, so it is simply dropped.
    watchModule.watch({ root, config: {} }).catch(() => {});

    assert.equal(process.listenerCount('uncaughtException'), baseline + 1,
      'watch() must register exactly one new uncaughtException handler');
    const handler = process.listeners('uncaughtException').slice(-1)[0];

    written.length = 0;
    assert.throws(() => handler(new Error('CON-112 test boom')), ExitSentinel);

    assert.equal(exitCode, 1, 'the process must exit non-zero after a crash');
    assert.match(errOut, /CON-112 test boom/, 'the underlying error must be surfaced, not silently swallowed');

    const restored = written.join('');
    assert.equal(restored.split(ALT_SCREEN_EXIT).length - 1, 1, 'the alt-screen exit must be written exactly once');
    assert.equal(restored.split(MOUSE_REPORT_EXIT).length - 1, 1, 'mouse reporting must be disabled exactly once');
    assert.ok(restored.includes(CURSOR_SHOW), 'the cursor must be shown again');

    // The handler removes itself before calling process.exit() (see its own
    // comment) — the listener count must be back to baseline, and a second,
    // racing exception (the same `quitting` re-entrancy guard `quit()`
    // shares) must not double-write the restore sequence.
    assert.equal(process.listenerCount('uncaughtException'), baseline,
      'the handler must have removed itself before calling process.exit()');
    written.length = 0;
    handler(new Error('second, must be a no-op'));
    assert.equal(written.length, 0, 'a second uncaughtException must not double-write the restore sequence');
  } finally {
    process.stdout.write = realWrite;
    console.error = realError;
    process.exit = realExit;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the first redraw after an attach that THREW also repaints every row', async () => {
  const boom = () => { throw new Error('tmux exploded'); };
  await withWatchHarness({ tickets: 4, rows: 30, cols: 100, attach: boom }, async ({ written, fakeStdin }) => {
    const before = writesByRow(written);
    const height = Math.max(...before.map((w) => w.row));

    written.length = 0;
    // attachAndRestore is a try/finally, so the restore callback (and its
    // cache reset) runs on this path too — but the exception unwinds past
    // watch.js's `if (applyAction(action)) runs = draw();`, so unlike the
    // normal path there is NO synchronous redraw. watch.js has no try/catch
    // around onKey, so the throw surfaces here.
    assert.throws(() => fakeStdin.emit('data', '\r'), /tmux exploded/);
    const duringAttach = written.join('');
    assert.ok(duringAttach.includes(ALT_SCREEN_ENTER),
      'the restore callback must re-enter the alternate buffer even when attach throws');

    written.length = 0;
    // The next redraw is therefore whatever comes first. Rather than waiting
    // a full POLL_MS for the poll timer, nudge one deterministically with a
    // 'k' at the top of the list: applyAction clamps the selection to 0 (no
    // change), so the frame is byte-identical to the pre-attach one and the
    // ONLY reason any bytes get written is the cache reset in the restore
    // callback. That is exactly the property under test.
    fakeStdin.emit('data', 'k');

    const after = writesByRow(written);
    assert.ok(after.length > 0,
      'the first redraw after a THROWING attach wrote nothing — the dashboard would be left blank');
    const touched = new Set(after.map((w) => w.row));
    for (let row = 1; row <= height; row++) {
      assert.ok(touched.has(row),
        `row ${row} was not repainted after the throwing attach round-trip`);
    }
  });
});

// --- CON-40: QUICK START widget, wired end to end ---------------------------
// Mirrors the QUEUED-focus and force-start harnesses above: a real watch()
// against a FAKE session/stdin, no real tmux. `setupQuickStartHarness()`
// factors out the shared boilerplate (fake session/stdin/stdout, cache
// seeding) since every test below needs it identically — the individual
// tests differ only in what they seed and assert.
//
// CON-27 (see `screenOf`'s own header comment, above): the differential
// writer only writes the ROWS that changed since the previous poll, so
// asserting against the last raw `written` chunk directly would silently
// start asking "did this row change on the most recent tick?" instead of
// "what does the screen show right now?" — these tests use `screenOf`,
// exactly like the resize/attach regression tests above, to replay every
// accumulated write into the current full-screen text.
function setupQuickStartHarness(tickets, over) {
  const { EventEmitter } = require('node:events');
  const cacheModule = require('../lib/ui/cache');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-quickstart-'));
  cacheModule.write(root, { tickets, epics: [] }, Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const spawnCalls = [];
  const fakeSessionObj = Object.assign({
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn(ticket, cmd) { spawnCalls.push({ ticket, cmd }); },
    kill() {},
    attach() { return { status: 0 }; },
  }, over);

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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  return {
    root, spawnCalls, fakeStdin, written,
    // The current full screen, replayed from every write so far (CON-27's
    // `screenOf`, defined at the top of this file) — never the raw last
    // chunk, which under the differential writer may hold only a handful of
    // changed rows.
    screen: () => screenOf(written),
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('quickstart-add with no active queue creates a single-ticket maxConcurrent:1 queue using the default launch command', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupQuickStartHarness([
    { identifier: 'CON-100', title: 'Urgent ticket', priority: 1 },
    { identifier: 'CON-101', title: 'Less urgent ticket', priority: 3 },
  ]);

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: QUICK START is always shown (no toggle) — digit-jump into it
    // instead (it's the only forceRender-eligible section on screen here, so
    // it's digit 1). The top of the priority-sorted list (CON-100, Urgent)
    // is quickStartFocus 0.
    h.fakeStdin.emit('data', '1');
    const focusedFrame = h.screen();
    assert.match(focusedFrame, /QUICK START/);
    assert.match(focusedFrame, /CON-100/);

    h.fakeStdin.emit('data', 'a');

    assert.equal(h.spawnCalls.length, 1, 'exactly one spawn — the quick-started ticket');
    assert.equal(h.spawnCalls[0].ticket, 'CON-100');
    assert.match(h.spawnCalls[0].cmd, /CON-100/);

    const record = queueCache.read(h.root);
    assert.deepEqual(record.pending, [], 'CON-100 must already have left pending (admitted this same poll)');
    assert.deepEqual(record.inFlight, ['CON-100']);
    assert.equal(record.maxConcurrent, 1);
  } finally {
    await h.teardown(donePromise);
  }
});

// A genuinely CONFIRMED, actively-ticking "already active queue" — unlike
// queueCache.write()'s own restore path (createRestoredQueue always sets
// confirmed: false, which shouldTick() then refuses to tick at all, so
// nothing would ever get persisted for this test to observe) — is only
// reachable through the widget's own first quickstart-add (createQueue()
// always sets confirmed: true). This test therefore presses `a` TWICE in a
// row at the same quickStartFocus index: the first press creates the queue
// (exercising the createQueue branch, same as the "no active queue" test
// above); by the time the second press is handled, the first ticket has
// already left the eligible list (now inFlight), so quickStartFocus: 0
// resolves to a DIFFERENT ticket — exercising the enqueueOne append branch
// against a real, already-active, confirmed queue.
test('a second quickstart-add onto an already-active queue appends via enqueueOne, preserving that queue\'s own maxConcurrent/launchCommand — and never re-adds the same ticket', async () => {
  const h = setupQuickStartHarness([
    { identifier: 'CON-200', title: 'First ticket', priority: 1 },
    { identifier: 'CON-201', title: 'Second ticket', priority: 2 },
  ]);

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: digit-jump into QUICK START (always shown, no toggle) —
    // focuses it with quickStartFocus: 0 -> CON-200 (Urgent).
    h.fakeStdin.emit('data', '1');
    h.fakeStdin.emit('data', 'a'); // creates a fresh, confirmed, maxConcurrent:1 queue for CON-200

    assert.equal(h.spawnCalls.length, 1);
    assert.equal(h.spawnCalls[0].ticket, 'CON-200');

    // CON-200 is now inFlight — excluded from the eligible list — so
    // quickStartFocus: 0 (unchanged; 'a' never moves the cursor) now
    // resolves to CON-201 instead.
    h.fakeStdin.emit('data', 'a');

    assert.equal(h.spawnCalls.length, 2, 'a second, DIFFERENT ticket must have been launched — never CON-200 again');
    assert.equal(h.spawnCalls[1].ticket, 'CON-201');
    // Both launches share the identical command TEMPLATE (only the ticket id
    // substituted in) — proving the append preserved the original queue's
    // own launchCommand rather than resetting it.
    // The `-n "<id> <title>"` session name is a PER-TICKET decoration
    // applied at spawn (lib/ui/launcher.js), like the harness/provider
    // ones — the queue itself still stores one undecorated template, which
    // is what this assertion is actually guarding. Strip the name before
    // comparing, or two different tickets can never match by construction.
    const tmpl = (cmd, id) => cmd.replace(/ -n "[^"]*"/, '').split(id).join('{{TICKET}}');
    assert.equal(tmpl(h.spawnCalls[0].cmd, 'CON-200'), tmpl(h.spawnCalls[1].cmd, 'CON-201'));
    // maxConcurrent: 1 was preserved across the append — proven by CON-201
    // only launching on the SECOND poll (once CON-200's slot freed), not
    // alongside it in the same tick, which is what a reset to some larger
    // maxConcurrent would have allowed.
  } finally {
    await h.teardown(donePromise);
  }
});

test('an already-queued ticket never appears in the QUICK START list at all — the widget cannot even offer it for re-adding', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupQuickStartHarness([
    { identifier: 'CON-300', title: 'Already queued', priority: 1 },
    { identifier: 'CON-301', title: 'Still eligible', priority: 2 },
  ]);

  queueCache.write(h.root, {
    pending: ['CON-300'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-dup', Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: digit-jump into QUICK START (always shown, no toggle) — it is
    // still digit 1 here even with a restored QUEUED section also on
    // screen, since QUICK START renders before QUEUED (buildSections'
    // render order).
    h.fakeStdin.emit('data', '1');
    const frame = h.screen();

    // Isolate the QUICK START box's own content (between its own title line
    // and its own closing border) — the full screen's REMAINDER after
    // "QUICK START" also contains the QUEUED section (which legitimately
    // shows CON-300), so a plain substring/split check against the whole
    // tail would false-positive on that unrelated section.
    const lines = frame.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('QUICK START'));
    assert.ok(startIdx >= 0, 'QUICK START must be on screen');
    const endIdx = lines.findIndex((l, i) => i > startIdx && l.trimStart().startsWith('└'));
    const quickStartBox = lines.slice(startIdx, endIdx >= 0 ? endIdx + 1 : lines.length).join('\n');

    assert.doesNotMatch(quickStartBox, /CON-300/, 'an already-queued ticket must not appear in QUICK START at all');
    assert.match(quickStartBox, /CON-301/, 'the genuinely eligible ticket must still be offered');

    // Confirm the CONFIRM_RESTORED_QUEUE_KEY affordance is also on screen —
    // sanity check that this is genuinely the "queue already active" setup
    // this test claims, not an accidentally-empty queue.
    assert.match(frame, /resumed from a previous session/);

    h.fakeStdin.emit('data', 'a'); // adds CON-301 (the only offered ticket) — never CON-300

    // The IN-MEMORY append happened (enqueueOne does not gate on
    // `confirmed` — design.md Decision 5) — the very next render already
    // shows both tickets in QUEUED, even though...
    const afterAddFrame = h.screen();
    assert.match(afterAddFrame, /QUEUED \(2,/);
    assert.match(afterAddFrame, /CON-300/);
    assert.match(afterAddFrame, /CON-301/);

    // ...the on-disk record is UNAFFECTED by this poll — the pre-existing
    // restored queue never ticks (confirmed: false, per CON-29 —
    // shouldTick() refuses it), so nothing persists it yet; what matters
    // for THIS test is that CON-300 was never duplicated — trivially true
    // since it was never re-offered in the first place.
    const record = queueCache.read(h.root);
    assert.deepEqual(record.pending, ['CON-300']);
  } finally {
    await h.teardown(donePromise);
  }
});

test('an out-of-bounds quickstart-add index (empty eligible list) is a no-op that leaves queueState unchanged', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  // An empty cache — cold, nothing eligible at all.
  const h = setupQuickStartHarness([]);

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: digit-jump into QUICK START (always shown, no toggle).
    h.fakeStdin.emit('data', '1');
    const focusedFrame = h.screen();
    assert.match(focusedFrame, /no tickets cached yet/);

    h.fakeStdin.emit('data', 'a');

    assert.equal(h.spawnCalls.length, 0, 'nothing should ever be spawned from an empty eligible list');
    assert.equal(queueCache.read(h.root), null, 'no queue should have been created at all');
  } finally {
    await h.teardown(donePromise);
  }
});

// --- CON-54: t / view-ticket / view-ticket-quickstart / back-to-launchpad --
// routing ---------------------------------------------------------------
// `mode`, `launchPad` and `ticketviewReturnMode` are private closures inside
// watch(opts) — exactly like queueState/launchPad above, the only way to
// prove a real 't'/'esc' keypress reaches them end to end is against a real
// running dashboard (a fake session, not real tmux) and reading what actually
// lands on screen.

test('t on the QUICK START-focused ticket opens the ticket detail view (view-ticket-quickstart), populating the cache even though the launch pad was never opened', async () => {
  const h = setupQuickStartHarness([
    { identifier: 'CON-100', title: 'Urgent ticket', priority: 1, description: 'the full description body' },
    { identifier: 'CON-101', title: 'Less urgent ticket', priority: 3 },
  ]);

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: digit-jump into QUICK START (always on screen, digit 1 here —
    // no runs, no queue). quickStartFocus: 0 -> CON-100 (top priority).
    h.fakeStdin.emit('data', '1');
    h.fakeStdin.emit('data', 't');

    // CON-54, design.md Decision 4: ensureLaunchPad() must have populated
    // launchPad.cache even though 'N' (the launch pad's own entry point) was
    // never pressed this session — findTicket() has to have something to
    // search. A passing match on the ticket's own title (not just its
    // identifier) proves the FULL cached ticket object was found, not just an
    // id echoed back.
    const opened = h.screen();
    assert.match(opened, /CON-100/);
    assert.match(opened, /Urgent ticket/);
    assert.match(opened, /esc back/);
    assert.doesNotMatch(opened, /QUICK START/, 'the fleet view must no longer be on screen');

    // esc returns to the FLEET view (ticketviewReturnMode === 'fleet'), not
    // the launch pad — the launch pad was never even opened this session.
    h.fakeStdin.emit('data', '\x1b');
    const backOnFleet = h.screen();
    assert.match(backOnFleet, /QUICK START/);
    assert.doesNotMatch(backOnFleet, /esc back/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('t on a QUICK START focus whose eligible list shrank out from under it (focused index no longer resolves) is a no-op', async () => {
  const cacheModule = require('../lib/ui/cache');
  const h = setupQuickStartHarness([
    { identifier: 'CON-110', title: 'First ticket', priority: 1 },
    { identifier: 'CON-111', title: 'Second ticket', priority: 2 },
  ]);

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    h.fakeStdin.emit('data', '1'); // focus QUICK START, quickStartFocus: 0
    h.fakeStdin.emit('data', 'j'); // quickStartFocus: 1 -> CON-111 (draw()'s own reclamp confirms this is still valid — len is 2)

    // Rewrite the cache DIRECTLY (no keypress in between, so no draw() runs
    // and quickStartFocus is never reclamped) to shrink the eligible list to
    // a single entry — exactly the "list shrank between render and keypress"
    // race the spec's no-op requirement describes: index 1 no longer
    // resolves to anything by the time 't' is actually handled.
    cacheModule.write(h.root, { tickets: [{ identifier: 'CON-110', title: 'First ticket', priority: 1 }], epics: [] }, Date.now());

    h.fakeStdin.emit('data', 't');

    const frame = h.screen();
    assert.doesNotMatch(frame, /esc back/, 'no ticket detail view should have opened');
    assert.match(frame, /QUICK START/, 'the fleet view must still be on screen');
  } finally {
    await h.teardown(donePromise);
  }
});

test('t on a QUEUED-focused ticket opens the ticket detail view (view-ticket), and esc returns to the fleet view', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [{ identifier: 'CON-120', title: 'Pending queued ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' }, description: 'queued ticket body' }],
    [{ id: 'e1', name: 'Epic', openCount: 1 }],
  );
  // A restored, unconfirmed queue — untouched by tick() (shouldTick()
  // refuses it), so CON-120 stays stably `pending` for the whole test,
  // exactly like the sibling "already-`⏳ queued`" test above relies on.
  queueCache.write(h.root, {
    pending: ['CON-120'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-preexisting', Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    // No RUNNING/NEEDS YOU: QUICK START(1), QUEUED(2) — CON-120 is already
    // pending, so it is excluded from QUICK START's own eligible list and
    // only reachable via QUEUED.
    h.fakeStdin.emit('data', '2');
    const focused = h.screen();
    assert.match(focused, /QUEUED/);

    h.fakeStdin.emit('data', 't');

    const opened = h.screen();
    assert.match(opened, /CON-120/);
    assert.match(opened, /Pending queued ticket/);
    assert.match(opened, /esc back/);

    // Opened from the fleet view (via QUEUED, never the launch pad) — esc
    // must return to the fleet view, not the launch pad.
    h.fakeStdin.emit('data', '\x1b');
    const backOnFleet = h.screen();
    assert.match(backOnFleet, /QUEUED/);
    assert.doesNotMatch(backOnFleet, /esc back/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('the launch pad\'s own ↵ -> open-ticketview -> esc still returns to the launch pad, unaffected by the new fleet-originated entry points', async () => {
  const h = setupLaunchPadHarness(
    [{ identifier: 'CON-130', title: 'Launch pad ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' }, description: 'launch pad ticket body' }],
    [{ id: 'e1', name: 'Epic', openCount: 1 }],
  );

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');   // open the launch pad
    h.fakeStdin.emit('data', '\t');  // switch focus to the tickets pane
    h.fakeStdin.emit('data', '\r');  // open-ticketview on the highlighted ticket

    const opened = h.screen();
    assert.match(opened, /CON-130/);
    assert.match(opened, /Launch pad ticket/);
    assert.match(opened, /esc back/);

    h.fakeStdin.emit('data', '\x1b'); // esc — must return to the LAUNCH PAD, not the fleet
    const backOnLaunchPad = h.screen();
    // The launch pad's EPICS pane is its discriminator — the launch pad's
    // own footer now legitimately shows `esc back` too (the footer-wrap
    // pass; the old single hints line lost that hint to the 80-col clamp),
    // so absence of `esc back` no longer distinguishes it from ticketview.
    assert.match(backOnLaunchPad, /EPICS/);
    assert.match(backOnLaunchPad, /Launch pad ticket|CON-130/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('alternating entry points each return correctly — launch pad, then fleet, in the same session', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [{ identifier: 'CON-140', title: 'Both entry points ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' }, description: 'body' }],
    [{ id: 'e1', name: 'Epic', openCount: 1 }],
  );
  queueCache.write(h.root, {
    pending: ['CON-140'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-preexisting', Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    // First: open from the launch pad, esc back to the launch pad. EPICS
    // (not absence of `esc back`) is the launch-pad discriminator — its own
    // footer now shows `esc back` too, see the sibling test above.
    h.fakeStdin.emit('data', 'N');
    h.fakeStdin.emit('data', '\t');
    h.fakeStdin.emit('data', '\r');
    assert.match(h.screen(), /esc back/);
    assert.doesNotMatch(h.screen(), /EPICS/);
    h.fakeStdin.emit('data', '\x1b');
    assert.match(h.screen(), /EPICS/);

    // Leave the launch pad entirely, back to the fleet.
    h.fakeStdin.emit('data', '\x1b');
    const onFleet = h.screen();
    assert.match(onFleet, /QUEUED/, 'must be back on the fleet view');

    // Second: open via 't' from the fleet's QUEUED row, esc back to the
    // FLEET this time — not a stale launch-pad destination left over from
    // the first visit.
    h.fakeStdin.emit('data', '2'); // focus-queue
    h.fakeStdin.emit('data', 't');
    assert.match(h.screen(), /esc back/);
    h.fakeStdin.emit('data', '\x1b');
    const backOnFleet = h.screen();
    assert.match(backOnFleet, /QUEUED/);
    assert.doesNotMatch(backOnFleet, /esc back/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('the eligible list excludes a ticket that already has a live run, not just an already-queued one', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupQuickStartHarness([
    { identifier: 'HEL-1', title: 'Already running', priority: 1 },
    { identifier: 'CON-400', title: 'Genuinely eligible', priority: 2 },
  ], {
    listWindows() { return [{ ticket: 'HEL-1', alive: true, activity: null }]; },
  });

  const runDir = path.join(h.root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-56: digit-jump into QUICK START (always shown, no toggle) — HEL-1
    // has a live run here, so RUNNING is non-empty and renders first,
    // pushing QUICK START to digit 2 (unlike the other harness tests in this
    // file, which have no runs at all and so land QUICK START on digit 1).
    h.fakeStdin.emit('data', '2');
    const focusedFrame = h.screen();
    const quickStartPane = focusedFrame.split('QUICK START')[1] || '';
    assert.doesNotMatch(quickStartPane.split('\n').slice(0, 6).join('\n'), /HEL-1.*Already running/);
    assert.match(focusedFrame, /CON-400/);

    h.fakeStdin.emit('data', 'a'); // quickStartFocus: 0 -> the only genuinely eligible ticket

    assert.equal(h.spawnCalls.length, 1);
    assert.equal(h.spawnCalls[0].ticket, 'CON-400');
  } finally {
    await h.teardown(donePromise);
  }
});

test('t on a RUNNING row opens the ticket detail view (view-ticket), and esc returns to the fleet view', async () => {
  const h = setupQuickStartHarness([
    { identifier: 'CON-500', title: 'A currently running ticket', priority: 1, description: 'running ticket body' },
  ], {
    listWindows() { return [{ ticket: 'CON-500', alive: true, activity: null }]; },
  });

  const runDir = path.join(h.root, '.concertino', 'runs', 'CON-500');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-500 is already `▲ running`, so RUNNING (not QUICK START) is the
    // first section — `selected: 0` (the default) already lands on it, no
    // digit-jump needed.
    h.fakeStdin.emit('data', 't');

    const opened = h.screen();
    assert.match(opened, /CON-500/);
    assert.match(opened, /A currently running ticket/);
    assert.match(opened, /esc back/);

    h.fakeStdin.emit('data', '\x1b');
    const backOnFleet = h.screen();
    assert.match(backOnFleet, /RUNNING/);
    assert.doesNotMatch(backOnFleet, /esc back/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('t on a DONE row opens the ticket detail view (view-ticket), and esc returns to the fleet view', async () => {
  const h = setupQuickStartHarness([
    { identifier: 'CON-501', title: 'A finished ticket', priority: 1, description: 'done ticket body' },
  ]);

  const runDir = path.join(h.root, '.concertino', 'runs', 'CON-501');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n' +
    JSON.stringify({ t: 2000, kind: 'run.end', status: 'delivered' }) + '\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    // CON-501 has already ended (run.end, no live window) — it lands in
    // DONE, the only runs-backed section on screen, so `selected: 0` (the
    // default) already lands on it.
    h.fakeStdin.emit('data', 't');

    const opened = h.screen();
    assert.match(opened, /CON-501/);
    assert.match(opened, /A finished ticket/);
    assert.match(opened, /esc back/);

    h.fakeStdin.emit('data', '\x1b');
    const backOnFleet = h.screen();
    assert.match(backOnFleet, /DONE/);
    assert.doesNotMatch(backOnFleet, /esc back/);
  } finally {
    await h.teardown(donePromise);
  }
});

// --- CON-41: launch pad IN QUEUE status + 'q' add-to-queue action, wired
// end to end -----------------------------------------------------------------
// The launch pad screen itself (unlike CON-40's QUICK START widget on the
// fleet view) is gated behind `dashboard.launchPad.enabled` + a "linear"
// ticketProvider + LINEAR_API_KEY (linear.js's launchPadStatus) — this
// harness mirrors setupQuickStartHarness() above (same fake session/stdin,
// no real tmux) but also supplies that config and a dummy env key, restored
// in teardown() so it never leaks into a later test. `applyAction`/
// `openLaunchPad` are private closures inside watch(opts) (see watch.js's
// own header comment above module.exports), so — exactly like the P-key
// smoke-test regression's own comment explains — the only way to prove a
// real 'q' keypress reaches queueState is end to end, against a real running
// dashboard (a fake session, not real tmux).
function setupLaunchPadHarness(tickets, epics, over) {
  const { EventEmitter } = require('node:events');
  const cacheModule = require('../lib/ui/cache');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-launchpad-'));
  cacheModule.write(root, { tickets, epics }, Date.now());

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

  const spawnCalls = [];
  const fakeSessionObj = Object.assign({
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn(ticket, cmd) { spawnCalls.push({ ticket, cmd }); },
    kill() {},
    attach() { return { status: 0 }; },
  }, over);

  const fakeStdin = new EventEmitter();
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (the
  // launch plan's own confirm key, emitted standalone by several tests
  // below) as it does for piped stdin — see watch.js's own comment there,
  // and withWatchHarness's identical setting above for the same reason.
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  // The launch pad gate's third condition (linear.js's launchPadStatus) —
  // never a real key, and never left set after this harness tears down.
  const prevKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'dummy-not-a-real-key';

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  return {
    root, spawnCalls, fakeStdin, written,
    screen: () => screenOf(written),
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevKey;
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const LAUNCHPAD_CONFIG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'linear', idExample: 'CON-1' } };

// --- CON-44: ensureLaunchPad must never let an unresolvable
// ticketProvider.kind escape the stdin listener as an uncaught throw --------
// lib/cli/watch.js's cmdWatch now runs a successfully-parsed config through
// lib/config.js's withDefaults on its common path (CON-92), but falls back
// to the raw parsed object (or `{}`) when there's no config file, the JSON
// fails to parse, or withDefaults itself throws ("watch works without
// config" — cmdWatch's own comment) — so ticketProvider.kind reaching here
// can still be absent (no config file, or malformed JSON), typo'd, or
// "github" (which `concertino validate` reports OK, but MODULES in
// ticket-provider.js has no module for): withDefaults only resolves the one
// known-deprecated alias, it never validates `kind`. moduleFor()'s
// throw on an unresolvable kind is deliberate and correct (task-3's own
// design); what is NOT correct is letting it escape uncaught: onKey/
// applyAction have no try/catch of their own, so an uncaught throw here
// would skip quit()'s terminal restore (setRawMode(false), the alt-screen
// exit) entirely. ensureLaunchPad must catch it and degrade to the same
// gate-failure message screens/launchpad.js already renders for
// `enabled: false`.

test('opening the launch pad with no ticketProvider configured at all renders a gate message, not a crash', async () => {
  const h = setupLaunchPadHarness([], []);
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: {} });

    h.fakeStdin.emit('data', 'N'); // must not throw
    const frame = h.screen();
    assert.match(frame, /esc back/, 'the launch pad screen must still render its own gate message, not crash');
    assert.match(frame, /launch pad needs ticketProvider\.kind "linear" or "local" — none is set/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('a typo\'d ticketProvider.kind renders its own message instead of throwing', async () => {
  const h = setupLaunchPadHarness([], []);
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'lienar' } } });

    h.fakeStdin.emit('data', 'N');
    const frame = h.screen();
    assert.match(frame, /esc back/);
    assert.match(frame, /launch pad needs ticketProvider\.kind "linear" or "local" — not "lienar"/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('ticketProvider.kind "github" — accepted by concertino validate, but with no resolver module — renders a message instead of crashing the dashboard', async () => {
  const h = setupLaunchPadHarness([], []);
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'github' } } });

    h.fakeStdin.emit('data', 'N');
    const frame = h.screen();
    assert.match(frame, /esc back/);
    assert.match(frame, /launch pad needs ticketProvider\.kind "linear" or "local" — not "github"/);
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-95: the sibling guard, one line down from the three just above — a
// persisted `teamFound: false` cache row (a PRIOR process's confirmed
// team-not-found refresh, see the "stale team-not-found cache" tests further
// below) makes ensureLaunchPad also call `linear.teamNotFoundMessage(config,
// initialCache.teamKey)`, which itself calls through the same moduleFor() —
// so an unresolvable `ticketProvider.kind` throws there too, and must be
// caught exactly like the `launchPadStatus` throw just above is. Removing
// that second try/catch leaves the whole suite passing (nothing else seeds
// BOTH a `teamFound: false` cache row AND an unresolvable kind together) —
// this is the one test that would then fail, with an uncaught throw escaping
// the 'N' keypress instead of a rendered gate message.
test('a persisted team-not-found cache row together with an unresolvable ticketProvider.kind renders a gate message, not a crash', async () => {
  const h = setupLaunchPadHarness([], []);
  const cacheModule = require('../lib/ui/cache');
  cacheModule.write(h.root, { teamKey: 'ABC', tickets: [], epics: [], teamFound: false }, Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'github' } } });

    h.fakeStdin.emit('data', 'N'); // must not throw
    const frame = h.screen();
    assert.match(frame, /esc back/, 'the launch pad screen must still render its own gate message, not crash');
    assert.match(frame, /launch pad needs ticketProvider\.kind "linear" or "local" — not "github"/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('add-to-queue (q) with no active queue creates a single-ticket maxConcurrent:1 queue, keyed by the ticket\'s identifier string', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [{ identifier: 'CON-50', title: 'Solo ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } }],
    [{ id: 'e1', name: 'Epic', openCount: 1 }],
  );

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');   // open the launch pad
    h.fakeStdin.emit('data', '\t');  // switch focus to the tickets pane
    h.fakeStdin.emit('data', 'q');   // add the highlighted ticket to the queue

    // A queue with maxConcurrent:1 admits CON-50 on this same poll, and
    // submitTicket only ever spawns given a STRING it can validate
    // (prompt.js's parseTicketInput rejects anything that is not typeof
    // 'string' outright) — so a passing assertion here also proves the
    // ticket's identifier, not the ticket object, reached queue.createQueue.
    assert.equal(h.spawnCalls.length, 1, 'exactly one spawn — the queued ticket');
    assert.equal(h.spawnCalls[0].ticket, 'CON-50');
    assert.match(h.spawnCalls[0].cmd, /CON-50/);

    const record = queueCache.read(h.root);
    assert.deepEqual(record.pending, [], 'CON-50 must already have left pending (admitted this same poll)');
    assert.deepEqual(record.inFlight, ['CON-50']);
    assert.equal(record.maxConcurrent, 1);
  } finally {
    await h.teardown(donePromise);
  }
});

// Mirrors the sibling 'a second quickstart-add onto an already-active queue'
// test above exactly, including its own reasoning: this fake harness's
// session never reports a spawned ticket as a live tmux window, so
// queue.tick()'s own inFlight re-check (queue.js: a ticket only keeps its
// concurrency slot for as long as `runs` still shows it live) drops CON-60
// again the very next poll and frees the slot — CON-61 is admitted moments
// later, on a LATER poll, not instantly alongside CON-60. What this proves
// is not "CON-61 waits forever" but that the SECOND 'q' went through
// enqueueOne's append (preserving the original queue's maxConcurrent/
// launchCommand) rather than a second, competing createQueue() call.
test('a second add-to-queue (q) onto an already-active queue appends via enqueueOne, preserving that queue\'s own maxConcurrent/launchCommand — and never re-adds the same ticket', async () => {
  const h = setupLaunchPadHarness(
    [
      { identifier: 'CON-60', title: 'First ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
      { identifier: 'CON-61', title: 'Second ticket', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
    ],
    [{ id: 'e1', name: 'Epic', openCount: 2 }],
  );

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');   // open
    h.fakeStdin.emit('data', '\t');  // tickets pane; ticketIndex 0 -> CON-60
    h.fakeStdin.emit('data', 'q');   // creates a maxConcurrent:1 queue for CON-60, admitted immediately

    assert.equal(h.spawnCalls.length, 1);
    assert.equal(h.spawnCalls[0].ticket, 'CON-60');

    h.fakeStdin.emit('data', 'j');   // move down to CON-61
    h.fakeStdin.emit('data', 'q');   // active queue exists -> enqueueOne appends CON-61 (never a second createQueue)

    assert.equal(h.spawnCalls.length, 2, 'a second, DIFFERENT ticket must eventually have been launched — never CON-60 again');
    assert.equal(h.spawnCalls[1].ticket, 'CON-61');
    // Both launches share the identical command TEMPLATE (only the ticket id
    // substituted in) — proving the append preserved the original queue's
    // own launchCommand rather than resetting it.
    // See the quickstart-add sibling: the session name is per-ticket by
    // design; the queue's own launchCommand is what must be preserved.
    const tmpl2 = (cmd, id) => cmd.replace(/ -n "[^"]*"/, '').split(id).join('{{TICKET}}');
    assert.equal(tmpl2(h.spawnCalls[0].cmd, 'CON-60'), tmpl2(h.spawnCalls[1].cmd, 'CON-61'));
  } finally {
    await h.teardown(donePromise);
  }
});

test('add-to-queue (q) on an already-`▲ running` ticket is a no-op — the same refusal isSelectable already applies to selection', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [{ identifier: 'CON-70', title: 'Already running', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } }],
    [{ id: 'e1', name: 'Epic', openCount: 1 }],
    { listWindows() { return [{ ticket: 'CON-70', alive: true, activity: null }]; } },
  );

  const runDir = path.join(h.root, '.concertino', 'runs', 'CON-70');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');
    h.fakeStdin.emit('data', '\t');
    const frame = h.screen();
    assert.match(frame, /▲ running/, 'CON-70 must already show as running before q is even pressed');

    h.fakeStdin.emit('data', 'q');

    assert.equal(h.spawnCalls.length, 0, 'nothing new should ever be spawned — q must have been a no-op');
    assert.equal(queueCache.read(h.root), null, 'no queue should have been created at all');
  } finally {
    await h.teardown(donePromise);
  }
});

test('add-to-queue (q) on an already-`⏳ queued` ticket is a no-op — it is not appended a second time', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [
      { identifier: 'CON-80', title: 'Already queued', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
      { identifier: 'CON-81', title: 'Occupying the one slot', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
    ],
    [{ id: 'e1', name: 'Epic', openCount: 2 }],
  );

  // Seed an already-active, confirmed, maxConcurrent:1 queue with CON-81
  // inFlight (occupying the only slot) and CON-80 pending — exactly the
  // shape `q`'s own isSelectable refusal must recognise as "already queued".
  queueCache.write(h.root, {
    pending: ['CON-80'], inFlight: new Set(['CON-81']), maxConcurrent: 1, launchCommand: null,
  }, 'sess-preexisting', Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');
    h.fakeStdin.emit('data', '\t'); // ticketIndex 0 -> CON-80 (already pending)
    const frame = h.screen();
    assert.match(frame, /⏳ queued/, 'CON-80 must already show as queued before q is pressed');

    h.fakeStdin.emit('data', 'q'); // must be a no-op — CON-80 is not selectable

    const record = queueCache.read(h.root);
    assert.deepEqual(record.pending, ['CON-80'], 'CON-80 must not have been appended a second time');
  } finally {
    await h.teardown(donePromise);
  }
});

// `queueState` is a plain in-memory variable inside watch(opts)'s own
// closure — it is only ever mutated by applyAction (a keypress) or by
// queue.tick()'s own admission/drop bookkeeping, and is read back from disk
// only once, at process startup (see the `queueCache.read` call site in
// watch.js). Nothing re-reads it mid-session. That means the literal
// "becomes queued in the few seconds between L and Enter" race
// design.md Decision 4 describes cannot be reproduced against a single
// dashboard process purely by driving keys — while the launch plan screen
// is on top, `mode === 'launchplan'` routes every keypress to
// launchplan.js's own handleKey, not launchpad.js's 'q'/'toggle-select'.
// The reachable, equally load-bearing form of the same guarantee is
// queuing the ticket BEFORE 'L' is pressed: open-launchplan's own re-check
// (also threaded with `queueState` by this change) then excludes it from
// `plan.tickets` outright, so confirm-launch's OWN "third and final
// refusal" (same isSelectable(t, runs, queueState) expression, now also
// threaded) never even has a chance to re-admit it — proving end to end
// that no path through this flow can ever queue the same ticket twice,
// regardless of which of the two re-checks is the one that actually catches
// it for a given timing.
//
// The pre-existing (confirmed: false, never-ticks-until-explicitly-
// confirmed) RESTORED queue shape is used here — exactly the same pattern
// the "already-`⏳ queued`" no-op test above relies on — rather than a
// fresh, actively-ticking queue: this fake harness's session never reports
// a spawned ticket as a live tmux window, so an actively-ticking queue's
// own inFlight bookkeeping would silently forget an admitted ticket the
// very next poll (nothing marks it "still live"), making CON-90's queued
// status impossible to hold in place for the several keypresses this test
// needs. A restored-but-unconfirmed queue's pending list is untouched by
// tick() (shouldTick() refuses it) no matter how many polls elapse, so
// CON-90 stays genuinely, stably `⏳ queued` for the whole test.
test('a ticket that becomes queued (via q) before L is pressed is excluded from the launch plan, and confirming never duplicates it into a second queue entry', async () => {
  const queueCache = require('../lib/ui/queue-cache');
  const h = setupLaunchPadHarness(
    [
      { identifier: 'CON-90', title: 'Selected then queued via q', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
      { identifier: 'CON-91', title: 'Selected, never touched again', epicId: 'e1', state: { name: 'Todo', type: 'unstarted' } },
    ],
    [{ id: 'e1', name: 'Epic', openCount: 2 }],
  );

  // A restored, unconfirmed, maxConcurrent:1 queue already occupying its one
  // slot with an unrelated ticket — 'q' on CON-90 (below) can only APPEND to
  // its `pending`, never admit anything, since shouldTick() refuses to tick
  // an unconfirmed queue at all.
  queueCache.write(h.root, {
    pending: ['CON-89'], inFlight: new Set(), maxConcurrent: 1, launchCommand: null,
  }, 'sess-preexisting', Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');    // open
    h.fakeStdin.emit('data', '\t');   // tickets pane, ticketIndex 0 -> CON-90
    h.fakeStdin.emit('data', ' ');    // select CON-90 (checkbox)
    h.fakeStdin.emit('data', 'q');    // CON-90 (still highlighted) also queued via q -> enqueueOne appends to the restored queue's pending
    h.fakeStdin.emit('data', 'j');    // move to CON-91
    h.fakeStdin.emit('data', ' ');    // select CON-91 (checkbox) — CON-90's own checkbox is untouched, still checked

    assert.equal(h.spawnCalls.length, 0, 'the restored queue never ticks — q only appended CON-90, nothing was spawned');
    const midRecord = queueCache.read(h.root);
    assert.deepEqual(midRecord.pending, ['CON-89'], 'the in-memory append never persists on its own — no tick() call site ran to write it back to disk');

    h.fakeStdin.emit('data', 'L');    // open-launchplan re-check: CON-90 is now already-queued -> excluded
    const planFrame = h.screen();
    assert.match(planFrame, /LAUNCH PLAN/);
    assert.doesNotMatch(planFrame, /CON-90/, 'the already-queued CON-90 must never reach the launch plan\'s own ticket list');
    assert.match(planFrame, /CON-91/);

    h.fakeStdin.emit('data', '\r');   // confirm-launch's own re-check: nothing left to additionally exclude, only CON-91 queues

    // confirm-launch's own queue.createQueue() call is built only from
    // `startable` (plan.tickets filtered by isSelectable) — CON-90 was
    // already excluded from plan.tickets by open-launchplan above, so it
    // can never be spawned by confirm-launch, nor appear in the fresh
    // queue's own pending list.
    assert.equal(h.spawnCalls.length, 1, 'exactly one spawn — CON-91 only, from the freshly confirmed queue');
    assert.equal(h.spawnCalls[0].ticket, 'CON-91');
    const record = queueCache.read(h.root);
    assert.ok(!(record.pending || []).includes('CON-90'), 'CON-90 must never appear in the confirmed queue\'s pending list');
  } finally {
    await h.teardown(donePromise);
  }
});

// --- CON-44: a local project auto-refreshes the launch pad on open --------
// openLaunchPad's new branch (watch.js) fires refreshLaunchPad() itself, with
// no 'r' keypress, when the resolved provider is 'local' — a directory read
// costs nothing, unlike linear's network round trip, so there is nothing for
// the "press r to fetch" hint to protect against. Exercised end to end,
// against the REAL (unfaked) ticket-provider.js/tickets/local.js modules —
// unlike the linear-focused refresh tests below, no fetchTickets/resolveTeam
// fake is needed at all, since a local fetch never leaves the filesystem.
test('a local project opens the launch pad already refreshed, with no r keypress', async () => {
  const h = setupLaunchPadHarness([], []);
  const ticketsDir = path.join(h.root, 'tickets');
  fs.mkdirSync(ticketsDir, { recursive: true });
  fs.writeFileSync(path.join(ticketsDir, 'CON-1.md'), '---\ntitle: One\nstate: backlog\n---\n\nbody\n');

  const LOCAL_LAUNCHPAD_CONFIG = {
    dashboard: { launchPad: { enabled: true } },
    ticketProvider: { kind: 'local', teamKey: 'CON' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LOCAL_LAUNCHPAD_CONFIG });

    const cacheModule = require('../lib/ui/cache');
    // setupLaunchPadHarness seeds the on-disk cache directly (no fetch
    // involved) with zero tickets — so CON-1 actually showing up on disk
    // afterwards proves a real refresh ran, not just that the pre-seeded
    // cache was read back unchanged.
    assert.equal(cacheModule.read(h.root).tickets.length, 0);

    h.fakeStdin.emit('data', 'N'); // open the launch pad — no 'r' keypress follows
    await flushRefresh();

    const onDisk = cacheModule.read(h.root);
    assert.equal(typeof onDisk.fetchedAt, 'number', 'opening a local project\'s launch pad must refresh it on its own');
    assert.equal(onDisk.tickets.length, 1);
    assert.equal(onDisk.tickets[0].identifier, 'CON-1');
  } finally {
    await h.teardown(donePromise);
  }
});

// unreadable is per-file (tickets/local.js's readTickets: a malformed file is
// a skip, not a thrown error and not a silently-shrunk board) and, per
// watch.js's own comment at the surfacing site, deliberately in-memory only
// — it never reaches the on-disk cache, so the only way to observe it is the
// rendered screen. `\t` (an ordinary pane-focus toggle, otherwise inert here)
// is emitted after flushRefresh() purely to force the next redraw so the
// settled `lp.error` is actually on screen — no macrotask boundary or resize
// involved, unlike the corruption this file's own flushRefresh() comment
// documents for a real wall-clock/resize wait.
test('an unreadable local ticket file is surfaced in lp.error, not silently dropped from the board', async () => {
  const h = setupLaunchPadHarness([], []);
  const ticketsDir = path.join(h.root, 'tickets');
  fs.mkdirSync(ticketsDir, { recursive: true });
  fs.writeFileSync(path.join(ticketsDir, 'CON-1.md'), '---\ntitle: One\nstate: backlog\n---\n\nbody\n');
  // Malformed: an unrecognised state — tickets/local.js's parseTicket
  // returns null for it, so readTickets counts it as unreadable rather than
  // including it or throwing.
  fs.writeFileSync(path.join(ticketsDir, 'CON-2.md'), '---\ntitle: Bad\nstate: not-a-real-state\n---\n\nbody\n');

  const LOCAL_LAUNCHPAD_CONFIG = {
    dashboard: { launchPad: { enabled: true } },
    ticketProvider: { kind: 'local', teamKey: 'CON' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LOCAL_LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N'); // open — auto-refreshes for local
    await flushRefresh();
    h.fakeStdin.emit('data', '\t'); // force the redraw that shows the settled refresh's lp.error

    const frame = h.screen();
    assert.match(frame, /1 ticket file\(s\) unreadable — check frontmatter \(title, state, matching id\)/);

    const cacheModule = require('../lib/ui/cache');
    // The good ticket is still on the board — one bad file must not blank it.
    assert.deepEqual(cacheModule.read(h.root).tickets.map((t) => t.identifier), ['CON-1']);
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-44: the SMALLEST schema-valid local config — `kind` and nothing else.
// The schema requires only `kind`, and `teamKey` is functionally inert for
// local (local.fetchTickets scans tickets/ and only echoes the key back), but
// refreshLaunchPad used to demand one unconditionally — and because local
// auto-refreshes on open, that hard-failed with "refresh failed: no
// ticketProvider.teamKey configured" the instant the user pressed N. The key
// is now required only where it is load-bearing (ticket-provider.js's
// NEEDS_TEAM_KEY), and a null key has to DEGRADE, never render as "null".
test('a minimal local config — kind only, no teamKey — lists its tickets with no error', async () => {
  const h = setupLaunchPadHarness([], []);
  const ticketsDir = path.join(h.root, 'tickets');
  fs.mkdirSync(ticketsDir, { recursive: true });
  fs.writeFileSync(path.join(ticketsDir, 'CON-1.md'), '---\ntitle: One\nstate: backlog\n---\n\nbody\n');
  fs.writeFileSync(path.join(ticketsDir, 'CON-2.md'), '---\ntitle: Two\nstate: started\n---\n\nbody\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({
      root: h.root,
      config: { ticketProvider: { kind: 'local' }, dashboard: { launchPad: { enabled: true } } },
    });

    h.fakeStdin.emit('data', 'N');
    await flushRefresh();
    h.fakeStdin.emit('data', '\t'); // force the redraw that would show a settled lp.error

    const frame = h.screen();
    assert.doesNotMatch(frame, /refresh failed/, 'a teamKey-less local project must not hard-fail on open');
    assert.doesNotMatch(frame, /teamKey/);
    // A null teamKey must never reach the screen as the literal string.
    assert.doesNotMatch(frame, /null/);
    assert.match(frame, /2 open/, 'the header falls back to a plain count when there is no team key');
    assert.match(frame, /One/);

    const onDisk = require('../lib/ui/cache').read(h.root);
    assert.deepEqual(onDisk.tickets.map((t) => t.identifier), ['CON-1', 'CON-2']);
    assert.equal(onDisk.teamKey, null);
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-44: `concertino validate` tells a project still on `manual` that it
// "reads as local", and config-reference.md says the same. lib/config.js's
// withDefaults is the only normaliser, and — before CON-92 — lib/cli/watch.js's
// cmdWatch never called it: it JSON.parsed the file and handed the raw object
// to watch(). So the promise was true of the agent half and false of the
// dashboard: the gate refused, and no local launch pad appeared even with a
// populated tickets/. The alias resolves inside the resolver, which every
// consumer goes through regardless of how the config was loaded — this test
// exercises watch() directly with a raw, un-normalised config (what cmdWatch's
// own fallback path can still produce post-CON-92, and all it ever produced
// before), which remains a valid and necessary scenario either way.
test('a project still configured "manual" gets the local launch pad it was promised', async () => {
  const h = setupLaunchPadHarness([], []);
  const ticketsDir = path.join(h.root, 'tickets');
  fs.mkdirSync(ticketsDir, { recursive: true });
  fs.writeFileSync(path.join(ticketsDir, 'CON-9.md'), '---\ntitle: Legacy manual project\nstate: started\n---\n\nb\n');

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    // Raw, exactly as cmdWatch would hand it over — never through withDefaults.
    donePromise = watchModule.watch({
      root: h.root,
      config: { ticketProvider: { kind: 'manual' }, dashboard: { launchPad: { enabled: true } } },
    });

    h.fakeStdin.emit('data', 'N');
    await flushRefresh();
    h.fakeStdin.emit('data', '\t');

    const frame = h.screen();
    assert.doesNotMatch(frame, /launch pad needs ticketProvider\.kind/, 'the gate must not refuse the deprecated alias');
    assert.match(frame, /Legacy manual project/);
    // Auto-refresh-on-open is a local-provider behaviour, so it has to fire
    // for the alias too — nothing here ever pressed 'r'.
    assert.deepEqual(require('../lib/ui/cache').read(h.root).tickets.map((t) => t.identifier), ['CON-9']);
  } finally {
    await h.teardown(donePromise);
  }
});

// --- CON-20: launch pad refresh distinguishes an empty team from a
// not-found team key ---------------------------------------------------------
// `refreshLaunchPad` is a private closure inside watch(opts) (same
// constraint as the 'q' add-to-queue tests above), so the only way to prove
// the new resolveTeam() branching actually wires up is end to end. This
// harness mirrors setupLaunchPadHarness's fake session/stdin exactly, but
// additionally replaces lib/ui/linear's require.cache entry so fetchTickets
// and resolveTeam are test doubles instead of real network calls — the
// non-network functions (launchPadStatus, teamKeyFromConfig,
// stateTypesFromConfig) are the REAL implementation (spread from the actual
// module) so the gate and team-key resolution behave exactly as in
// production.
function setupLaunchPadRefreshHarness(linearOverrides) {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-launchpad-refresh-'));

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const linearPath = require.resolve('../lib/ui/linear');
  const realLinear = require('../lib/ui/linear');

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
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  const prevKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'dummy-not-a-real-key';

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };
  require.cache[linearPath] = {
    id: linearPath, filename: linearPath, loaded: true,
    exports: Object.assign({}, realLinear, linearOverrides),
  };

  return {
    root, fakeStdin, written,
    screen: () => screenOf(written),
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevKey;
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      delete require.cache[linearPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// refreshLaunchPad is fire-and-forget (its own comment: "the 1-second poll
// timer picks up the result on its own; nothing here needs to force an extra
// redraw") — nothing here awaits its promise chain directly, and this
// harness's fake fetchTickets/resolveTeam never touch the real network, so
// the whole chain settles on the microtask queue with no real I/O in it.
// Flushing microtasks is therefore enough to observe it — repeated so it
// doesn't matter how many `await`s are chained inside refreshLaunchPad.
//
// Deliberately NOT `setImmediate`/any macrotask boundary, and deliberately
// NOT a real wall-clock wait for watch.js's own POLL_MS timer: both were
// tried and BOTH corrupt node:test's own pass/fail accounting for an
// ADJACENT test in this file — reproduced in isolation down to a two-line
// repro (override process.stdout.write, cross a macrotask boundary, restore)
// — while process.stdout.write is the wrapper this file's own harnesses
// install to capture frames. A pure microtask flush (no macrotask boundary
// at all) does not exhibit this. Because of the same corruption risk, these
// tests deliberately do NOT try to force a fresh keypress-triggered redraw
// after settling either (that would need a macrotask boundary too, or
// `resize`, which was also confirmed to corrupt reporting even with a pure
// microtask wait around it) — they assert the settled OUTCOME through the
// on-disk cache and the fake fetchTickets/resolveTeam's own call-tracking
// arrays instead, which need no redraw at all. The actual rendered TEXT
// ("no open tickets in CON" / "no team with key ..." / the cold-cache gate
// bypass) is covered directly against renderLaunchPad/headerLine in
// launchpad.test.js, where no terminal-emulation timing is involved.
async function flushRefresh() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

const LAUNCHPAD_CONFIG_BAD_TEAM = {
  dashboard: { launchPad: { enabled: true } },
  ticketProvider: { kind: 'linear', teamKey: 'ABC', idExample: 'ABC-123' },
};

test('a real team with zero open tickets resolves the team and writes an empty-but-real cache, no error', async () => {
  const resolveTeamCalls = [];
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async (opts) => ({ teamKey: opts.teamKey, tickets: [], epics: [], pages: 1, truncated: false }),
    resolveTeam: async (transport, apiKey, teamKey) => { resolveTeamCalls.push(teamKey); return { found: true }; },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N'); // open the launch pad
    h.fakeStdin.emit('data', 'r'); // trigger refreshLaunchPad
    await flushRefresh();

    assert.deepEqual(resolveTeamCalls, ['CON'], 'resolveTeam is called with the same team key the fetch used');

    const cacheModule = require('../lib/ui/cache');
    const onDisk = cacheModule.read(h.root);
    assert.deepEqual(onDisk.tickets, [], 'a real, empty team still writes its zero-ticket result to the cache');
    assert.equal(onDisk.teamKey, 'CON');
    // CON-20 (skeptic-final-1.md): persisted, not just held in lp.error —
    // openLaunchPad rebuilds the initial error from exactly this field on a
    // fresh process, so it has to survive on disk, not just in memory.
    assert.strictEqual(onDisk.teamFound, true);
  } finally {
    await h.teardown(donePromise);
  }
});

test('a team key that matches no team resolves found:false and never writes a stray success', async () => {
  const resolveTeamCalls = [];
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async (opts) => ({ teamKey: opts.teamKey, tickets: [], epics: [], pages: 1, truncated: false }),
    resolveTeam: async (transport, apiKey, teamKey) => { resolveTeamCalls.push(teamKey); return { found: false }; },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG_BAD_TEAM });

    h.fakeStdin.emit('data', 'N');
    h.fakeStdin.emit('data', 'r');
    await flushRefresh();

    assert.deepEqual(resolveTeamCalls, ['ABC']);

    // refreshLaunchPad still writes the (empty) fetch result to the cache
    // regardless of whether the team resolved — `teamFound: false` is what
    // tells this case apart from a confirmed-empty team ON DISK (CON-20,
    // skeptic-final-1.md: this used to live only in the in-memory lp.error,
    // which did not survive a process restart — see the dedicated
    // "restart" test below for the end-to-end proof of THAT).
    const cacheModule = require('../lib/ui/cache');
    const onDisk = cacheModule.read(h.root);
    assert.deepEqual(onDisk.tickets, []);
    assert.strictEqual(onDisk.teamFound, false);
  } finally {
    await h.teardown(donePromise);
  }
});

test('a non-empty fetch never triggers a team-resolution lookup', async () => {
  const resolveTeamCalls = [];
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async (opts) => ({
      teamKey: opts.teamKey,
      tickets: [{ identifier: 'CON-1', title: 'Has tickets', epicId: null, state: { name: 'Todo', type: 'unstarted' } }],
      epics: [{ id: null, name: null, openCount: 1 }],
      pages: 1,
      truncated: false,
    }),
    resolveTeam: async (transport, apiKey, teamKey) => { resolveTeamCalls.push(teamKey); return { found: true }; },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');
    h.fakeStdin.emit('data', 'r');
    await flushRefresh();

    assert.deepEqual(resolveTeamCalls, [], 'a non-empty result already proves the team exists — no lookup needed');

    const cacheModule = require('../lib/ui/cache');
    const onDisk = cacheModule.read(h.root);
    assert.deepEqual(onDisk.tickets.map((t) => t.identifier), ['CON-1']);
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-20 (skeptic-final-1.md, Change Request 2): the exact restart scenario
// the skeptic's own repro exercised — a PRIOR process's team-not-found
// refresh persisted `teamFound: false` to disk; a fresh process (fresh `lp`,
// no refresh performed at all) must derive the same error from that
// persisted row, not from anything held in memory (there is none — this is
// a brand-new `launchPad` object). fetchTickets/resolveTeam both throw if
// called, to prove the error comes straight from the stale cache, exactly
// like the sibling "cold cache performs no ticket fetch" test just below
// proves the cold-cache path never touches the network.
test('a stale team-not-found cache renders the error on a fresh process, before any refresh', async () => {
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async () => { throw new Error('must not fetch — no refresh was requested'); },
    resolveTeam: async () => { throw new Error('must not resolve — no refresh was requested'); },
  });

  // A PRIOR process's team-not-found refresh, written directly — this test
  // never presses 'r' at all, so this is the only way the cache reaches
  // this state.
  const cacheModule = require('../lib/ui/cache');
  cacheModule.write(h.root, { teamKey: 'ABC', tickets: [], epics: [], teamFound: false }, Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG_BAD_TEAM });

    h.fakeStdin.emit('data', 'N'); // open the launch pad — a fresh lp, no refresh

    const frame = h.screen();
    assert.match(frame, /no team with key "ABC" — check ticketProvider\.teamKey/);
    assert.doesNotMatch(frame, /no open tickets in ABC/, 'a persisted not-found team must never render as if it were confirmed real');
  } finally {
    await h.teardown(donePromise);
  }
});

// Companion to the above: a PRIOR process's confirmed-empty (real team)
// refresh must NOT be misread as an error on a fresh process either —
// `teamFound: true` round-trips through openLaunchPad exactly like `false`
// does, just to the opposite (no-error) conclusion.
test('a stale confirmed-empty-team cache renders the header message, not an error, on a fresh process', async () => {
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async () => { throw new Error('must not fetch — no refresh was requested'); },
    resolveTeam: async () => { throw new Error('must not resolve — no refresh was requested'); },
  });

  const cacheModule = require('../lib/ui/cache');
  cacheModule.write(h.root, { teamKey: 'CON', tickets: [], epics: [], teamFound: true }, Date.now());

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N');

    const frame = h.screen();
    assert.match(frame, /no open tickets in CON/);
    assert.doesNotMatch(frame, /no team with key/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('a cold cache performs no ticket fetch and no team-resolution lookup until r is pressed', async () => {
  const fetchTicketsCalls = [];
  const resolveTeamCalls = [];
  const h = setupLaunchPadRefreshHarness({
    fetchTickets: async (opts) => { fetchTicketsCalls.push(opts.teamKey); return { teamKey: opts.teamKey, tickets: [], epics: [], pages: 1, truncated: false }; },
    resolveTeam: async (transport, apiKey, teamKey) => { resolveTeamCalls.push(teamKey); return { found: true }; },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: LAUNCHPAD_CONFIG });

    h.fakeStdin.emit('data', 'N'); // open the launch pad — no cache on disk yet
    await flushRefresh();

    assert.deepEqual(fetchTicketsCalls, [], 'opening the launch pad must never fetch on its own');
    assert.deepEqual(resolveTeamCalls, [], 'opening the launch pad must never resolve the team on its own');
    assert.match(h.screen(), /press r to fetch/);
  } finally {
    await h.teardown(donePromise);
  }
});

// =============================================================================
// CON-21: the ticket-draft flow — `n` with free text opens a headless
// drafting invocation, the draft-review screen, and (on confirm) creates the
// ticket, launches it, and refreshes the launch pad's cache. `linear.js` and
// `draft.js` are both faked via require.cache substitution — the exact same
// technique setupLaunchPadRefreshHarness already uses for `linear` — so
// nothing here ever spawns a real `claude` process or touches the network.
// =============================================================================

function setupTicketDraftHarness(overrides) {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-ticketdraft-'));

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const linearPath = require.resolve('../lib/ui/linear');
  const draftPath = require.resolve('../lib/ui/draft');
  const realLinear = require('../lib/ui/linear');
  const realDraft = require('../lib/ui/draft');

  const spawnCalls = [];
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return []; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn(ticket, cmd) { spawnCalls.push({ ticket, cmd }); },
    kill() {},
    attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.setRawMode = () => {};
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realWrite = process.stdout.write;
  const written = [];
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  const prevKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'dummy-not-a-real-key';

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };
  require.cache[linearPath] = {
    id: linearPath, filename: linearPath, loaded: true,
    exports: Object.assign({}, realLinear, overrides && overrides.linear),
  };
  require.cache[draftPath] = {
    id: draftPath, filename: draftPath, loaded: true,
    exports: Object.assign({}, realDraft, overrides && overrides.draft),
  };

  return {
    root, spawnCalls, fakeStdin, written,
    screen: () => screenOf(written),
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      if (prevKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = prevKey;
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      delete require.cache[linearPath];
      delete require.cache[draftPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const TICKETDRAFT_CONFIG = { ticketProvider: { kind: 'linear', teamKey: 'CON', idExample: 'CON-1' } };

function typeText(fakeStdin, text) {
  for (const ch of text) fakeStdin.emit('data', ch);
}

test('CON-21: free text opens the draft flow; confirming creates the ticket, composes the body, and launches it', async () => {
  const createCalls = [];
  const draftCalls = [];
  const h = setupTicketDraftHarness({
    draft: {
      draftTicket: (seed) => {
        draftCalls.push(seed);
        return {
          promise: Promise.resolve({
            title: 'Add a share button', description: 'Dashboards need a share action.', acceptanceCriteria: '- a share button appears',
          }),
          cancel() {},
        };
      },
    },
    linear: {
      createTicket: async (args) => {
        createCalls.push(args);
        return { id: 'issue-uuid', identifier: 'CON-99', url: 'https://linear.app/x/issue/CON-99' };
      },
    },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: TICKETDRAFT_CONFIG });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'add a share button to dashboards');
    h.fakeStdin.emit('data', '\r'); // not ticket-shaped -> open-ticket-draft
    await flushRefresh();

    assert.deepEqual(draftCalls, ['add a share button to dashboards']);

    // 'c' both confirms AND forces the next real redraw — proving the draft
    // screen actually opened, populated, BEFORE the creation call it kicks
    // off has had a chance to settle (draft.creating is set synchronously,
    // in the same applyAction call that fires the async createTicket).
    h.fakeStdin.emit('data', 'c');
    const midFrame = h.screen();
    assert.match(midFrame, /NEW TICKET/);
    assert.match(midFrame, /Add a share button/);
    assert.match(midFrame, /creating…/);

    await flushRefresh();

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].teamKey, 'CON');
    assert.equal(createCalls[0].title, 'Add a share button');
    // design.md Decision 1: composed once, at confirm time — description +
    // the "## Acceptance Criteria" heading + the acceptance-criteria field.
    assert.match(createCalls[0].description, /Dashboards need a share action\./);
    assert.match(createCalls[0].description, /## Acceptance Criteria/);
    assert.match(createCalls[0].description, /- a share button appears/);

    // The run launches against the REAL, provider-issued id — same
    // submitTicket path, same {{TICKET}} substitution, unchanged.
    assert.equal(h.spawnCalls.length, 1);
    assert.equal(h.spawnCalls[0].ticket, 'CON-99');
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-21: a non-Linear provider shows the gated message inline and never starts drafting', async () => {
  const draftCalls = [];
  const h = setupTicketDraftHarness({
    draft: { draftTicket: (seed) => { draftCalls.push(seed); return { promise: new Promise(() => {}), cancel() {} }; } },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'github' } } });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'add a share button');
    h.fakeStdin.emit('data', '\r');

    assert.deepEqual(draftCalls, [], 'a non-Linear provider must never start the drafting invocation');
    assert.match(h.screen(), /ticket drafting needs ticketProvider\.kind "linear"/);
    assert.match(h.screen(), /"git…/); // narrow-terminal truncation of "github" — the provider name is still visible
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-44: the sibling branch of draft.js's same `if`. openspec/specs/
// ticket-draft/spec.md's "Scenario: Local provider" describes this message
// specifically — a local project has a real ticket store, so the generic
// "needs kind linear" wording would be actively misleading: the fix is to
// write the file, not to change the provider. Modelled on the github test
// directly above.
test('CON-44: the local provider gets its own drafting message, pointing at the markdown file', async () => {
  const draftCalls = [];
  const h = setupTicketDraftHarness({
    draft: { draftTicket: (seed) => { draftCalls.push(seed); return { promise: new Promise(() => {}), cancel() {} }; } },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'local' } } });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'add a share button');
    h.fakeStdin.emit('data', '\r');

    assert.deepEqual(draftCalls, [], 'a local provider must never start the drafting invocation');
    const frame = h.screen();
    assert.match(frame, /ticket drafting from the dashboard is not available for local tickets/);
    // Not the generic non-Linear wording — that would tell a local project to
    // go change its provider, which is the wrong instruction entirely.
    assert.doesNotMatch(frame, /ticket drafting needs ticketProvider\.kind/);
  } finally {
    await h.teardown(donePromise);
  }
});

// CON-93 item 3: draft.js's gate previously compared the RAW
// ctx.config.ticketProvider.kind, so a still-`manual`-configured project got
// the generic "this project uses \"manual\"" message instead of the
// local-specific one. Fixed by resolving through ctx.deps.linear.kindFor
// (ticket-provider.js's alias table), matching local.js's own
// launchPadStatus gate.
test('CON-93: a manual-configured project (the deprecated local alias) gets the same local-specific message as local', async () => {
  const draftCalls = [];
  const h = setupTicketDraftHarness({
    draft: { draftTicket: (seed) => { draftCalls.push(seed); return { promise: new Promise(() => {}), cancel() {} }; } },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: { ticketProvider: { kind: 'manual' } } });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'add a share button');
    h.fakeStdin.emit('data', '\r');

    assert.deepEqual(draftCalls, [], 'a manual-configured project must never start the drafting invocation');
    const frame = h.screen();
    assert.match(frame, /ticket drafting from the dashboard is not available for local tickets/);
    // Never the raw-kind message this bug produced.
    assert.doesNotMatch(frame, /this project uses "manual"/);
    assert.doesNotMatch(frame, /ticket drafting needs ticketProvider\.kind "linear" — this project uses/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-21: a creation failure keeps the draft screen open with the edited content and shows an inline error — no run is launched', async () => {
  const h = setupTicketDraftHarness({
    draft: {
      draftTicket: () => ({
        promise: Promise.resolve({ title: 'T', description: 'D', acceptanceCriteria: 'A' }),
        cancel() {},
      }),
    },
    linear: {
      createTicket: async () => { throw new Error('linear: HTTP 500 — boom'); },
    },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: TICKETDRAFT_CONFIG });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'free text seed');
    h.fakeStdin.emit('data', '\r');
    await flushRefresh();

    h.fakeStdin.emit('data', 'c'); // confirm — createTicket will reject
    await flushRefresh();

    // Nothing is bound on the ticketdraft screen while draft.creating is
    // true (see ticketdraft.js's handleKey), so no keypress could have
    // forced a redraw until AFTER the rejection above reset it back to
    // false — this 't' keypress is what actually reveals the settled
    // (failed) state; it also proves the screen still accepts ordinary
    // field-edit input rather than being stuck in some half-failed mode.
    h.fakeStdin.emit('data', 't');
    const frame = h.screen();
    assert.match(frame, /NEW TICKET/, 'the draft screen must still be open, not discarded');
    assert.match(frame, /could not create ticket/);
    assert.match(frame, /HTTP 500/);
    assert.equal(h.spawnCalls.length, 0, 'nothing may be launched off a failed creation');
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-21: abandoning the draft-review screen creates nothing and returns to the fleet', async () => {
  const createCalls = [];
  const h = setupTicketDraftHarness({
    draft: {
      draftTicket: () => ({
        promise: Promise.resolve({ title: 'T', description: 'D', acceptanceCriteria: 'A' }),
        cancel() {},
      }),
    },
    linear: { createTicket: async (args) => { createCalls.push(args); return { id: 'i', identifier: 'CON-1', url: 'u' }; } },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: TICKETDRAFT_CONFIG });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'free text seed');
    h.fakeStdin.emit('data', '\r');
    await flushRefresh();

    h.fakeStdin.emit('data', '\x1b'); // abandon from the overview
    const frame = h.screen();
    assert.doesNotMatch(frame, /NEW TICKET/);
    assert.equal(createCalls.length, 0, 'abandoning must never call the provider');
    assert.equal(h.spawnCalls.length, 0);
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-21: cancelling while drafting kills the in-flight child process and returns to the fleet with no draft screen opened', async () => {
  let cancelled = false;
  let settle;
  const h = setupTicketDraftHarness({
    draft: {
      draftTicket: () => ({
        // Never resolves within this test — proves the cancel path does not
        // depend on the invocation ever actually settling.
        promise: new Promise((resolve) => { settle = resolve; }),
        cancel() { cancelled = true; },
      }),
    },
  });

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: TICKETDRAFT_CONFIG });

    h.fakeStdin.emit('data', 'n');
    typeText(h.fakeStdin, 'free text seed');
    h.fakeStdin.emit('data', '\r');
    const draftingFrame = h.screen();
    assert.match(draftingFrame, /drafting…/);

    h.fakeStdin.emit('data', '\x1b'); // cancel while drafting
    assert.equal(cancelled, true, 'the in-flight child process must have been killed');

    const frame = h.screen();
    assert.doesNotMatch(frame, /drafting…/);
    assert.doesNotMatch(frame, /NEW TICKET/, 'no draft screen may open for a cancelled invocation');

    // A late resolution (the "child" finishing after all) must still not
    // resurrect the draft screen — the sequence-number guard is what makes
    // this a no-op rather than a race.
    settle({ title: 'T', description: 'D', acceptanceCriteria: 'A' });
    await flushRefresh();
    assert.doesNotMatch(h.screen(), /NEW TICKET/);
  } finally {
    await h.teardown(donePromise);
  }
});

// ===========================================================================
// fleet-metrics-grid final-fix 2: watch.js's own scroll-accounting call
// sites — the scrollOffset re-clamp (every draw()) and scrollToShow() (every
// 'move'/'jump') — call fleetScreen.gridModeEligible()/visibleWindowGrid()/
// visibleWindow() with a hand-built `opts` object, separate from the one
// currentState() hands to renderFleet. Both omitted `prompt`/`queueNotice`/
// `restoreNotice`/`quitConfirm`/`forceStartConfirm`/`clearQueueConfirm` even
// though every one of them is a live closure variable at both call sites —
// all six lengthen buildHeadTail()'s tail, which columnAreaHeight (the
// height gate gridModeEligible checks) is computed against. Omitting them
// makes watch.js systematically OVER-estimate columnAreaHeight relative to
// what renderFleet (which always receives the full opts) actually computes,
// so watch.js could pick grid mode's own scroll/window accounting (which
// excludes FAILED from the scrollable count entirely — it renders as a
// banner) for a frame that actually renders single-column (where FAILED IS
// part of the ordinary scrollable list) — desyncing scrollOffset/
// maxScrollOffset from what is really on screen.
//
// Both tests below spy on the exact shared function (fleetScreen.
// gridModeEligible) both call sites and renderFleet itself consult — not a
// hand-rebuilt guess at watch.js's internals — so they observe precisely the
// `opts` watch.js builds at runtime.
// ===========================================================================

test('the scrollOffset re-clamp forwards every tail-lengthening opt to gridModeEligible, keeping its grid-mode decision in sync with what renderFleet actually renders (final-fix 2 regression)', async () => {
  const { EventEmitter } = require('node:events');
  const fleetScreen = require('../lib/ui/screens/fleet');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-gridsync-'));

  // The exact fixture fleet.test.js's own "gridModeEligible matches
  // renderFleet's own grid-mode decision" test uses (needs-you/failed/
  // running) — at cols:150/rows:18 this reaches columnAreaHeight: 7, the
  // documented GRID_MIN_COLUMN_AREA_HEIGHT threshold (grid-eligible).
  // Opening the `n` prompt costs buildHeadTail two extra tail lines ("new
  // run › ▏" plus the "↵ start   esc cancel" hint), pushing columnAreaHeight
  // down to 5 — single-column only. Confirmed against the real reducer/
  // fleet.js pipeline (not just fleet.test.js's synthetic `run()` fixtures)
  // before writing this test.
  // Needs-you via a BLOCKER `verdict` event, not `escalation.raised`:
  // reducer.js's deriveStatus() reaches 'needs-you' either way (an
  // escalation, or a BLOCKER lastVerdict — see its own precedence chain),
  // but only the escalation path also feeds watch.js's cross-screen banner
  // (computeLiveEscalations filters on `r.escalation`) — that banner reserves
  // its own extra row(s) on top of computeScreenRows(), which would silently
  // change this fixture's columnAreaHeight arithmetic. BLOCKER keeps this
  // fixture's needs-you/failed/running composition identical to fleet.test.js's
  // own "gridModeEligible matches renderFleet's own grid-mode decision" test
  // (same section shapes, same columnAreaHeight numbers) without that banner.
  const needsYouDir = path.join(root, '.concertino', 'runs', 'HEL-1');
  fs.mkdirSync(needsYouDir, { recursive: true });
  fs.writeFileSync(path.join(needsYouDir, 'events.jsonl'),
    JSON.stringify({ t: 500, kind: 'run.start' }) + '\n' +
    JSON.stringify({ t: 600, kind: 'verdict', role: 'skeptic', verdict: 'BLOCKER' }) + '\n');

  const failedDir = path.join(root, '.concertino', 'runs', 'HEL-2');
  fs.mkdirSync(failedDir, { recursive: true });
  fs.writeFileSync(path.join(failedDir, 'events.jsonl'),
    JSON.stringify({ t: 700, kind: 'run.start' }) + '\n' +
    JSON.stringify({ t: 800, kind: 'run.end' }) + '\n'); // no status -> defaults to 'failed'

  const runningDir = path.join(root, '.concertino', 'runs', 'HEL-3');
  fs.mkdirSync(runningDir, { recursive: true });
  fs.writeFileSync(path.join(runningDir, 'events.jsonl'),
    JSON.stringify({ t: 900, kind: 'run.start' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() {
      return [
        { ticket: 'HEL-3', alive: true, activity: null },
      ];
    },
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
  const realRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const realColsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const realWrite = process.stdout.write;
  const parkedResizeListeners = process.stdout.listeners('resize').slice();
  process.stdout.removeAllListeners('resize');
  const written = [];
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  // computeScreenRows() reserves one extra row for the persistent top bar
  // (on top of visibleWindowGrid's own "-1 for the trailing newline" budget
  // row) — process.stdout.rows: 19 is what makes opts.rows (computeScreenRows()'s
  // return value) actually land on 18, the exact boundary probed above.
  Object.defineProperty(process.stdout, 'rows', { value: 19, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 150, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  // Spy on the shared gridModeEligible — watch.js calls it as
  // `fleetScreen.gridModeEligible(...)` (a live property lookup, never
  // destructured), so patching the export here is observed by watch.js's own
  // internal calls once it's (re-)required below.
  const originalGridModeEligible = fleetScreen.gridModeEligible;
  const calls = [];
  fleetScreen.gridModeEligible = function (runs, opts) {
    calls.push({ runs, opts });
    return originalGridModeEligible(runs, opts);
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    assert.ok(calls.length > 0, 'sanity: startup draw() must have called gridModeEligible at least once');
    const startupCall = calls[calls.length - 1];
    assert.equal(startupCall.opts.cols, 150);
    assert.equal(startupCall.opts.rows, 18);

    // Baseline sanity: before the prompt opens, this fixture is genuinely
    // grid-eligible, and renderFleet actually renders it that way (RUNNING
    // and METRICS sharing a line).
    assert.equal(fleetScreen.gridModeEligible(startupCall.runs, startupCall.opts), true,
      'fixture sanity: cols:150/rows:18 with no tail growth must be grid-eligible');
    const beforeLines = screenOf(written).split('\n');
    assert.equal(
      beforeLines.findIndex((l) => l.includes('RUNNING')),
      beforeLines.findIndex((l) => l.includes('METRICS')),
      'fixture sanity: the initial frame must actually render RUNNING/METRICS side by side (grid mode)');

    // What watch.js's PRE-FIX re-clamp block built: the same cols/rows/
    // selected/scrollOffset/queueState it always had, but none of the six
    // tail-lengthening fields — even after the prompt opens.
    const preFixOpts = {
      cols: 150, rows: 18, selected: 0, scrollOffset: 0, queueState: startupCall.opts.queueState,
    };

    // Open the `n` prompt — applyAction sets `prompt` and returns true, so
    // watch.js's own draw() (and this re-clamp block) run again synchronously
    // with `prompt` now truthy.
    calls.length = 0;
    fakeStdin.emit('data', 'n');
    assert.ok(calls.length > 0, 'sanity: opening the prompt must have redrawn (the re-clamp runs on every draw())');
    const afterCall = calls[calls.length - 1];

    // The fix: the re-clamp's own opts must now carry `prompt`.
    assert.ok(afterCall.opts.prompt, 'the scrollOffset re-clamp must forward `prompt` once it is open');

    // The actual render agrees: single-column now (RUNNING and METRICS on
    // DIFFERENT lines).
    const afterLines = screenOf(written).split('\n');
    assert.notEqual(
      afterLines.findIndex((l) => l.includes('RUNNING')),
      afterLines.findIndex((l) => l.includes('METRICS')),
      'opening the prompt must have dropped columnAreaHeight below the grid-mode threshold — renderFleet must now be single-column');

    // The fixed call site's own opts agree with the real render.
    assert.equal(fleetScreen.gridModeEligible(afterCall.runs, afterCall.opts), false,
      'the re-clamp\'s own (fixed) opts must now agree with renderFleet: single-column');

    // This is the regression itself: the PRE-FIX opts shape, evaluated
    // against the exact same runs/state, disagrees — it would still have
    // reported grid-eligible, even though the real frame just rendered
    // single-column. That mismatch (watch.js: grid; renderFleet: single-
    // column) is what let scrollOffset desync from what was really on
    // screen.
    assert.equal(fleetScreen.gridModeEligible(afterCall.runs, preFixOpts), true,
      'regression check: the pre-fix opts shape (missing all six tail fields) would have disagreed with the real, single-column render');
  } finally {
    fleetScreen.gridModeEligible = originalGridModeEligible;
    // fakeStdin 'end' (routed to quit(), which clearInterval()s watch.js's
    // own poll timer) must run even when an assertion above threw — skipping
    // it on a failure would leak that interval, which keeps firing draw()
    // against whatever process.stdout.write happens to be by the time this
    // finally block finishes restoring it, hanging the whole test run.
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    if (realRowsDescriptor) Object.defineProperty(process.stdout, 'rows', realRowsDescriptor);
    else delete process.stdout.rows;
    if (realColsDescriptor) Object.defineProperty(process.stdout, 'columns', realColsDescriptor);
    else delete process.stdout.columns;
    process.stdout.removeAllListeners('resize');
    for (const l of parkedResizeListeners) process.stdout.on('resize', l);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// scrollToShow()'s own winOpts (site 2) already carried prompt/queueNotice/
// restoreNotice/quitConfirm before this fix — only forceStartConfirm/
// clearQueueConfirm were missing there. Both of those gate EVERY keypress
// while active (fleet.js's handleKey: any key but 'y' cancels them), which
// also blocks the 'move'/'jump' actions that are scrollToShow's only two
// callers — so there is no reachable keypress sequence where either field is
// truthy AT THE SAME TIME a 'move'/'jump' actually reaches scrollToShow.
// A truthy-value divergence (mirroring the test above) is therefore not
// reachable here; this instead asserts the fix directly, the same way the
// header comment above recommends when a more direct check is available:
// the winOpts object scrollToShow builds must carry all six fields as OWN
// properties (present, whatever their value) — exactly what the fix added.
test('scrollToShow forwards every tail-lengthening opt (including forceStartConfirm/clearQueueConfirm/compareSelection) to gridModeEligible (final-fix 2 regression)', async () => {
  const { EventEmitter } = require('node:events');
  const fleetScreen = require('../lib/ui/screens/fleet');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-scrollshow-'));
  for (let i = 0; i < 3; i++) {
    const runDir = path.join(root, '.concertino', 'runs', 'HEL-' + (400 + i));
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t: 1000 - i * 10, kind: 'run.start' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() {
      return [400, 401, 402].map((n) => ({ ticket: 'HEL-' + n, alive: true, activity: null }));
    },
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
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  const originalGridModeEligible = fleetScreen.gridModeEligible;
  const calls = [];
  fleetScreen.gridModeEligible = function (runs, opts) {
    calls.push(opts);
    return originalGridModeEligible(runs, opts);
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // 'j' -> a 'move' action -> scrollToShow(selected), synchronously calling
    // gridModeEligible BEFORE this keypress's own draw() (and its re-clamp
    // block, tested above) run — so the FIRST call recorded after 'j' is
    // scrollToShow's own winOpts, not the re-clamp's.
    calls.length = 0;
    fakeStdin.emit('data', 'j');
    assert.ok(calls.length > 0, 'sanity: j must have triggered scrollToShow');
    const winOpts = calls[0];

    // CON-109, design.md Decision 4 (skeptic gate round 1, finding 2):
    // bulkConfirm/bulkResult joined this same list — both lengthen
    // buildHeadTail()'s tail exactly like markDoneConfirm already does, and
    // bulkResult in particular can render several lines (one per ticket).
    // CON-114, skeptic gate (final, round 1): compareSelection joined too —
    // it now feeds a conditional `c compare` hint (and can turn on
    // `space select` with no FAILED/QUEUED section present), same
    // reasoning, same fix shape.
    for (const field of ['prompt', 'queueNotice', 'restoreNotice', 'quitConfirm', 'forceStartConfirm', 'clearQueueConfirm', 'markDoneConfirm', 'bulkConfirm', 'bulkResult', 'compareSelection']) {
      assert.ok(Object.prototype.hasOwnProperty.call(winOpts, field),
        `scrollToShow's winOpts is missing "${field}" — a tail-lengthening opt buildHeadTail() reads, ` +
        'omitting it lets columnAreaHeight (and so the grid-mode decision) drift from what renderFleet computes');
    }
  } finally {
    fleetScreen.gridModeEligible = originalGridModeEligible;
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// CON-109, design.md Decision 4 (skeptic gate round 1, finding 2): the
// scrollOffset re-clamp's own `heightOpts` object (draw()'s "site 1",
// distinct from scrollToShow's own winOpts "site 2" just above) is the
// THIRD independent "every tail-lengthening field" list this codebase
// duplicates — same field-presence check, against the object draw() itself
// hands to gridModeEligible on every ordinary poll (no keypress needed to
// reach it, unlike scrollToShow).
test('the scrollOffset re-clamp\'s heightOpts carries bulkConfirm/bulkResult (mirrors the markDoneConfirm/forceStartConfirm fields already there)', async () => {
  const { EventEmitter } = require('node:events');
  const fleetScreen = require('../lib/ui/screens/fleet');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-heightopts-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-500');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ t: 1000, kind: 'run.start' }) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return [{ ticket: 'HEL-500', alive: true, activity: null }]; },
    capture() { return ''; }, captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
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
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  const originalGridModeEligible = fleetScreen.gridModeEligible;
  const calls = [];
  fleetScreen.gridModeEligible = function (runs, opts) {
    calls.push(opts);
    return originalGridModeEligible(runs, opts);
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    assert.ok(calls.length > 0, 'sanity: the startup draw() must have called gridModeEligible via the scrollOffset re-clamp');
    const heightOpts = calls[calls.length - 1];

    for (const field of ['prompt', 'queueNotice', 'restoreNotice', 'quitConfirm', 'forceStartConfirm', 'clearQueueConfirm', 'markDoneConfirm', 'bulkConfirm', 'bulkResult', 'compareSelection']) {
      assert.ok(Object.prototype.hasOwnProperty.call(heightOpts, field),
        `the scrollOffset re-clamp's heightOpts is missing "${field}" — omitting it lets columnAreaHeight ` +
        'drift from what renderFleet actually computes (fleet-metrics-grid final-fix 2\'s own regression, ' +
        're-introduced per-field for every new tail-lengthening state)');
    }
  } finally {
    fleetScreen.gridModeEligible = originalGridModeEligible;
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// CON-109, design.md Decision 4 (skeptic gate round 1, finding 3): a bulk
// action's post-`y` per-row result list (`S.bulkResult`) is a one-shot
// notice, cleared in watch.js's onKey immediately before router.handleKey is
// called — NOT as a fourth confirm-style intercept branch inside
// fleet/keys.js's handleKey. The load-bearing property this test pins: the
// key that dismisses a visible bulkResult (here, `j`) must ALSO still
// perform its own ordinary action (moving the cursor) on that SAME
// keypress, not just clear the notice and swallow the rest.
// ===========================================================================

test('pressing j while S.bulkResult is set both clears the result list AND moves the cursor, in the same keypress (tasks.md 9.5)', async () => {
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-bulkresult-'));
  // Two FAILED runs, HEL-100 (t:1000, more recent -> index 0) and HEL-101
  // (t:990 -> index 1) — verified against the real store/reduce pipeline:
  // marking HEL-100 done re-sorts the flat `runs` array to
  // [HEL-101 (failed), HEL-100 (done)], so `selected` (unchanged at 0 by the
  // mark-done handler itself) lands on a DIFFERENT ticket (HEL-101) right
  // after 'y' — exactly the "cursor didn't move on its own" baseline this
  // test needs before asserting that `j` moves it again.
  for (const [ticket, t] of [['HEL-100', 1000], ['HEL-101', 990]]) {
    const runDir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ t, kind: 'run.start' }) + '\n' + JSON.stringify({ t: t + 1, kind: 'run.end' }) + '\n');
  }

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake', ensure() {}, listWindows() { return []; },
    capture() { return ''; }, captureFull() { return ''; }, spawn() {}, kill() {}, attach() { return { status: 0 }; },
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
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  // Faking the whole `./session` module (below, for hasTmux/createSession)
  // replaces its ENTIRE exports object — watch.js destructures
  // `writeOverrideEvent` from that same require at load time (CON-98's
  // 'confirm-mark-done'/'confirm-bulk-mark-done' both route through it), so
  // the fake must re-export the real implementation too, or the mark-done
  // path this test exercises throws "writeOverrideEvent is not a function".
  const realSessionExports = require('../lib/ui/session');
  delete require.cache[sessionPath];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: {
      hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__',
      writeOverrideEvent: realSessionExports.writeOverrideEvent,
    },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    const firstFrame = screenOf(written);
    const firstMarked = firstFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(firstMarked.length, 1);
    assert.ok(firstMarked[0].includes('HEL-100'), 'sanity: the cursor starts on HEL-100 (index 0)');

    // space -> toggle-multi-select (FAILED, HEL-100) -> d -> bulk mark-done
    // confirm (multiSelect.failed is non-empty) -> y -> confirm-bulk-mark-done.
    fakeStdin.emit('data', ' ');
    fakeStdin.emit('data', 'd');
    const confirmFrame = screenOf(written);
    assert.match(confirmFrame, /mark 1 run as done\?/, 'sanity: the bulk (not single-row) confirm opened');
    fakeStdin.emit('data', 'y');

    const afterConfirmFrame = screenOf(written);
    assert.match(afterConfirmFrame, /✓ HEL-100/, 'the bulk result list is on screen right after y');
    const afterConfirmMarked = afterConfirmFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(afterConfirmMarked.length, 1);
    assert.ok(afterConfirmMarked[0].includes('HEL-101'),
      'sanity: selected (still 0) now points at HEL-101 after the reorder — the cursor itself did not move yet');

    // The load-bearing keypress: j must BOTH clear the visible bulkResult
    // AND move the cursor, in this one keypress.
    fakeStdin.emit('data', 'j');
    const afterJFrame = screenOf(written);
    assert.doesNotMatch(afterJFrame, /✓ HEL-100/,
      'bulkResult must be cleared by the very next keypress, even though that keypress is `j`, not `y`/cancel');
    const afterJMarked = afterJFrame.split('\n').filter((l) => l.includes('▸'));
    assert.equal(afterJMarked.length, 1);
    assert.ok(afterJMarked[0].includes('HEL-100'),
      'the SAME j keypress that dismissed bulkResult must also have moved the cursor onto HEL-100 (index 1) — ' +
      'j must never be silently swallowed just because it also happened to dismiss a visible bulkResult');
  } finally {
    fakeStdin.emit('end');
    if (donePromise) await donePromise;
    process.stdout.write = realWrite;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// CON-57: the settings screen, driven end to end through the real onKey/
// applyAction pipeline (mirrors setupQuickStartHarness's own "fake session/
// stdin, real fs" technique) — `concertino.config.json` is a REAL file on
// disk here (not just an in-memory `opts.config`), since openSettings()
// deliberately re-reads it fresh off disk every time `s` is pressed
// (design.md Decision 4), and settings-save writes back to that same file.
// ===========================================================================

function setupSettingsHarness(config) {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-settings-'));
  const cfgPath = path.join(root, 'concertino.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');

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
  // isTTY true so the 'data' handler does NOT strip a trailing '\r' (used
  // throughout these tests to commit a field edit / toggle a boolean) as it
  // does for piped stdin — see watch.js's own comment there, and
  // withWatchHarness's identical setting above.
  fakeStdin.isTTY = true;
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  return {
    root, cfgPath, fakeStdin, written,
    screen: () => screenOf(written),
    readConfig: () => JSON.parse(fs.readFileSync(cfgPath, 'utf8')),
    rawBytes: () => fs.readFileSync(cfgPath, 'utf8'),
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const SETTINGS_CONFIG = {
  harnesses: ['claude-code'],
  project: { name: 'fixture-project', baseBranch: 'main' },
  ticketProvider: { kind: 'linear', idExample: 'CON-1' },
  specProvider: { kind: 'none' },
  worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
  gates: [{ name: 'test', when: 'always', command: 'true' }],
  agentMerge: { enabled: false, mergeMethod: 'squash' },
  budgets: { executionCycles: 3 },
};

test('CON-57: s opens the settings screen from the fleet', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's');
    const frame = h.screen();
    assert.match(frame, /SETTINGS/);
    assert.match(frame, /project/i);
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-57: toggling a boolean field and saving writes the change to concertino.config.json', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's'); // open settings
    // Navigate SECTIONS down to 'agentMerge', enter FIELDS, toggle `enabled`.
    const sections = configLibForOrder();
    const agentMergeIndex = sections.indexOf('agentMerge');
    for (let i = 0; i < agentMergeIndex; i++) h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', '\t'); // focus fields (agentMerge.enabled is field 0)
    h.fakeStdin.emit('data', '\r'); // toggle boolean
    h.fakeStdin.emit('data', 'S'); // save

    const written = h.readConfig();
    assert.equal(written.agentMerge.enabled, true, 'the toggled value must be persisted');
    // The rest of the file must be untouched.
    assert.equal(written.project.name, 'fixture-project');

    const frame = h.screen();
    assert.doesNotMatch(frame, /SETTINGS/, 'a successful save returns to the fleet');
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-57: Escape with no save leaves concertino.config.json byte-unchanged', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  const before = h.rawBytes();
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's');
    h.fakeStdin.emit('data', '\t'); // focus fields on the first section (harnesses is absent — first real section is project)
    h.fakeStdin.emit('data', '\r'); // would open project.name's prompt
    typeText(h.fakeStdin, 'changed-name');
    h.fakeStdin.emit('data', '\x1b'); // cancel the field prompt (not the whole screen)
    h.fakeStdin.emit('data', '\x1b'); // now discard everything and return to fleet

    const after = h.rawBytes();
    assert.equal(after, before, 'Escape must never write to concertino.config.json');
    assert.doesNotMatch(h.screen(), /SETTINGS/);
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-57: an invalid edit (non-numeric budgets.executionCycles) is rejected on save and the file is left untouched', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  const before = h.rawBytes();
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's');
    const sections = configLibForOrder();
    const budgetsIndex = sections.indexOf('budgets');
    for (let i = 0; i < budgetsIndex; i++) h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', '\t'); // focus fields (budgets.executionCycles is field 0)
    h.fakeStdin.emit('data', '\r'); // open the free-text prompt, seeded with "3"
    // Clear the seeded value and type a non-numeric one.
    h.fakeStdin.emit('data', '\x7f');
    typeText(h.fakeStdin, 'abc');
    h.fakeStdin.emit('data', '\r'); // commit into the candidate (still just staged)
    h.fakeStdin.emit('data', 'S'); // save — must be rejected

    const frame = h.screen();
    assert.match(frame, /budgets\.executionCycles/);
    assert.match(frame, /SETTINGS/, 'a rejected save must keep the screen open with the edit still staged');

    const after = h.rawBytes();
    assert.equal(after, before, 'a rejected save must never touch the file on disk');
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-57: a below-minimum dashboard value is rejected on save and the file is left untouched', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  const before = h.rawBytes();
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's');
    const sections = configLibForOrder();
    const dashboardIndex = sections.indexOf('dashboard');
    for (let i = 0; i < dashboardIndex; i++) h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', '\t'); // focus fields
    // dashboard's field order follows the schema: tmuxSession, launchCommand,
    // maxConcurrent, escalationTimeoutMinutes, retentionDays, launchPad.enabled,
    // launchPad.backlog — move down to maxConcurrent (index 2).
    h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', '\r'); // open the prompt, seeded with the schema default "2"
    h.fakeStdin.emit('data', '\x7f');
    typeText(h.fakeStdin, '0');
    h.fakeStdin.emit('data', '\r');
    h.fakeStdin.emit('data', 'S');

    const frame = h.screen();
    assert.match(frame, /dashboard\.maxConcurrent/);

    const after = h.rawBytes();
    assert.equal(after, before, 'a rejected save must never touch the file on disk');
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-57: clearing a required field (project.name) is rejected on save, inline error shown, file untouched', async () => {
  const h = setupSettingsHarness(SETTINGS_CONFIG);
  const before = h.rawBytes();
  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root: h.root, config: SETTINGS_CONFIG });

    h.fakeStdin.emit('data', 's');
    const sections = configLibForOrder();
    const projectIndex = sections.indexOf('project');
    for (let i = 0; i < projectIndex; i++) h.fakeStdin.emit('data', 'j');
    h.fakeStdin.emit('data', '\t'); // focus fields (project.name is field 0)
    h.fakeStdin.emit('data', '\r'); // open the prompt, seeded with "fixture-project"
    for (let i = 0; i < 'fixture-project'.length; i++) h.fakeStdin.emit('data', '\x7f'); // clear it
    h.fakeStdin.emit('data', '\r'); // commit the now-empty value into the candidate
    h.fakeStdin.emit('data', 'S'); // save — must be rejected

    const frame = h.screen();
    assert.match(frame, /project\.name/);
    assert.match(frame, /SETTINGS/, 'a rejected save must keep the screen open with the edit still staged');

    const after = h.rawBytes();
    assert.equal(after, before, 'a rejected save must never touch the file on disk');
  } finally {
    await h.teardown(donePromise);
  }
});

function configLibForOrder() {
  const configLib = require('../lib/config');
  return configLib.schemaSectionOrder(configLib.loadSchema());
}

// ===========================================================================
// CON-55 — PR artifact type in the EVIDENCE panel: openInBrowser() (the one
// new child-process call), and the 'open-external-url' action handler's
// success/failure paths (design.md Decisions 3/4).
//
// No real `xdg-open` (or any real browser) is ever touched — a fake
// executable named `xdg-open` is put on PATH ahead of the real one for the
// duration of each test, the same PATH-shadowing technique
// test/scripts/check-merge-readiness.test.sh already uses for its own
// MOCKBIN. This proves the real execFileSync('xdg-open', ...) call site
// behaves correctly against a controlled success/failure/missing-binary
// outcome, without requiring a display or a real browser in CI.
// ===========================================================================

// Writes an executable script named `xdg-open` into a fresh temp dir and
// returns that dir's path, ready to be prepended to PATH. `exitCode` controls
// whether the fake opener succeeds or fails; omit the file entirely
// (`missing: true`) to exercise the "binary not found" failure mode.
// Shebang uses an ABSOLUTE interpreter path (never `#!/usr/bin/env bash`,
// which itself has to resolve `bash` via PATH) — that would defeat the whole
// point of replacing PATH below, since a system that HAS a real `xdg-open`
// (this project's own dev box does) would leave it reachable through `env`'s
// own PATH search regardless of what process.env.PATH is set to for the
// `execFileSync('xdg-open', ...)` lookup itself.
const SHELL = fs.existsSync('/bin/sh') ? '/bin/sh' : '/usr/bin/bash';
function fakeXdgOpenDir({ exitCode, missing }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-xdg-open-'));
  if (!missing) {
    const bin = path.join(dir, 'xdg-open');
    fs.writeFileSync(bin, '#!' + SHELL + '\nexit ' + exitCode + '\n');
    fs.chmodSync(bin, 0o755);
  }
  return dir;
}

// REPLACES process.env.PATH for the duration of `body` (never merely
// prepends — this system has a real `xdg-open` at /usr/bin/xdg-open, and
// leaving the real PATH reachable would let the "missing"/shadow tests below
// silently fall through to it), restoring it afterward even if `body`
// throws.
function withPath(dir, body) {
  const realPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    return body();
  } finally {
    process.env.PATH = realPath;
  }
}

test('openInBrowser succeeds silently when xdg-open exits 0', () => {
  const dir = fakeXdgOpenDir({ exitCode: 0 });
  withPath(dir, () => {
    assert.doesNotThrow(() => openInBrowser('https://example.com/pr/1'));
  });
});

test('openInBrowser throws when xdg-open exits non-zero', () => {
  const dir = fakeXdgOpenDir({ exitCode: 1 });
  withPath(dir, () => {
    assert.throws(() => openInBrowser('https://example.com/pr/1'));
  });
});

test('openInBrowser throws when xdg-open is not on PATH at all', () => {
  const dir = fakeXdgOpenDir({ missing: true });
  withPath(dir, () => {
    assert.throws(() => openInBrowser('https://example.com/pr/1'));
  });
});

// A single-run fleet whose event log has both a file-based `evidence` event
// and a `pr` event — enough to drill in, focus EVIDENCE, and select either
// kind of entry. Mirrors setupSettingsHarness's shape (fake session/stdin/
// stdout via require.cache, no real tmux).
function setupPrEvidenceHarness() {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-pr-'));
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-77');
  fs.mkdirSync(runDir, { recursive: true });
  const events = [
    { t: 1000, kind: 'run.start', harness: 'claude', model: 'opus-5' },
    { t: 2000, kind: 'evidence', role: 'evaluator', label: 'plan.md', ref: path.join(runDir, 'plan.md') },
    { t: 3000, kind: 'pr', role: 'orchestrator', url: 'https://github.com/example/repo/pull/9', label: 'PR: add widget' },
  ];
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'plan.md'), '# plan\n');

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  const fakeSessionObj = {
    name: 'fake',
    ensure() {},
    listWindows() { return [{ ticket: 'HEL-77', alive: true, activity: null }]; },
    capture() { return ''; },
    captureFull() { return ''; },
    spawn() {},
    kill() {},
    attach() { return { status: 0 }; },
  };

  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
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
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  return {
    root, fakeStdin, written,
    screen: () => screenOf(written),
    // 'l' drills into the (only, selected) run; '4' jumps straight to the
    // EVIDENCE panel (DRILL_PANELS index 3 — drilldown.js); 'j' moves the
    // selection down from the leading (evidence) entry onto the pr entry.
    openEvidencePanelOnPrEntry() {
      this.fakeStdin.emit('data', 'l');
      this.fakeStdin.emit('data', '4');
      this.fakeStdin.emit('data', 'j');
    },
    openEvidencePanelOnFileEntry() {
      this.fakeStdin.emit('data', 'l');
      this.fakeStdin.emit('data', '4');
    },
    async teardown(donePromise) {
      fakeStdin.emit('end');
      if (donePromise) await donePromise;
      process.stdout.write = realWrite;
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
      delete require.cache[watchPath];
      delete require.cache[require.resolve('../lib/ui/ticket-provider')];
      delete require.cache[sessionPath];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('CON-55: Enter on the pr entry opens the browser and leaves the dashboard on the drill-down (not docview)', async () => {
  const h = setupPrEvidenceHarness();
  const dir = fakeXdgOpenDir({ exitCode: 0 });
  let donePromise;
  try {
    await withPath(dir, async () => {
      const watchModule = require('../lib/ui/watch');
      donePromise = watchModule.watch({ root: h.root, config: {} });

      h.openEvidencePanelOnPrEntry();
      h.fakeStdin.emit('data', '\r');

      const frame = h.screen();
      assert.match(frame, /EVIDENCE/, 'must still be on the drill-down, not docview');
      assert.doesNotMatch(frame, /could not open/, 'a successful open must show no failure notice');
    });
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-55: Enter on the pr entry shows a visible notice (not a crash) when xdg-open fails', async () => {
  const h = setupPrEvidenceHarness();
  const dir = fakeXdgOpenDir({ exitCode: 1 });
  let donePromise;
  try {
    await withPath(dir, async () => {
      const watchModule = require('../lib/ui/watch');
      donePromise = watchModule.watch({ root: h.root, config: {} });

      h.openEvidencePanelOnPrEntry();
      h.fakeStdin.emit('data', '\r');

      const frame = h.screen();
      assert.match(frame, /could not open/, 'a failed open must surface a visible drillNotice');
      assert.match(frame, /https:\/\/github\.com\/example\/repo\/pull\/9/, 'the notice must identify the URL');
      assert.match(frame, /EVIDENCE/, 'a failed open must not crash — the dashboard stays on the drill-down');
    });
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-55: Enter on the pr entry shows a visible notice when xdg-open is missing entirely', async () => {
  const h = setupPrEvidenceHarness();
  const dir = fakeXdgOpenDir({ missing: true });
  let donePromise;
  try {
    await withPath(dir, async () => {
      const watchModule = require('../lib/ui/watch');
      donePromise = watchModule.watch({ root: h.root, config: {} });

      h.openEvidencePanelOnPrEntry();
      h.fakeStdin.emit('data', '\r');

      const frame = h.screen();
      assert.match(frame, /could not open/, 'a missing xdg-open must surface a visible drillNotice, not crash');
    });
  } finally {
    await h.teardown(donePromise);
  }
});

test('CON-55: Enter on a file-based evidence entry still opens docview, unaffected by the pr entry also being present', async () => {
  const h = setupPrEvidenceHarness();
  const dir = fakeXdgOpenDir({ exitCode: 0 });
  let donePromise;
  try {
    await withPath(dir, async () => {
      const watchModule = require('../lib/ui/watch');
      donePromise = watchModule.watch({ root: h.root, config: {} });

      h.openEvidencePanelOnFileEntry();
      h.fakeStdin.emit('data', '\r');

      const frame = h.screen();
      assert.match(frame, /plan\.md/, 'docview must show the selected file entry\'s title/content');
      assert.doesNotMatch(frame, /could not open/, 'opening a file entry must never touch the browser-open path');
    });
  } finally {
    await h.teardown(donePromise);
  }
});

// --- CON-68: the single-writer lock refuses a second dashboard --------------

test('watch() refuses to start when a live dashboard already owns the repo', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-watch-lock-'));
  const watchLock = require('../lib/ui/watch-lock');
  // A live holder: this very process's pid, planted as if another dashboard
  // owned the repo (acquire() only ever refuses on a pid that is not the
  // caller's own, so the "other" dashboard here must be the one calling —
  // plant the file directly instead of acquiring).
  fs.mkdirSync(path.dirname(watchLock.lockPath(root)), { recursive: true });
  fs.writeFileSync(watchLock.lockPath(root),
    JSON.stringify({ pid: process.pid, startedAt: 1, heartbeatAt: 1 }));

  const watchPath = require.resolve('../lib/ui/watch');
  const sessionPath = require.resolve('../lib/ui/session');
  delete require.cache[watchPath];
  delete require.cache[require.resolve('../lib/ui/ticket-provider')];
  let sessionTouched = false;
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: {
      hasTmux: () => true,
      createSession: () => ({
        ensure() { sessionTouched = true; },
        listWindows() { sessionTouched = true; return []; },
        capture() { return ''; }, captureFull() { return ''; },
        spawn() {}, kill() {}, attach() { return { status: 0 }; },
      }),
      PLACEHOLDER: '__concertino__',
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
  const realError = console.error;
  let wrote = '';
  let errs = '';
  process.stdout.write = (s) => { wrote += s; return true; };
  console.error = (s) => { errs += s + '\n'; };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  const prevExitCode = process.exitCode;

  try {
    // watchLock cannot see the planted pid as "another dashboard" if the
    // module compares to OUR pid... it does: acquire(root, process.pid)
    // finds existing.pid === process.pid and would succeed. So the planted
    // holder must be a DIFFERENT live pid: use the parent process (pid 1 is
    // init — always alive, never us).
    fs.writeFileSync(watchLock.lockPath(root),
      JSON.stringify({ pid: 1, startedAt: 1, heartbeatAt: 1 }));

    const watchModule = require('../lib/ui/watch');
    await watchModule.watch({ root, config: {} });

    assert.equal(process.exitCode, 1, 'refusal must set a non-zero exit code');
    assert.match(errs, /another dashboard \(pid 1/);
    assert.match(errs, /watch\.lock/);
    assert.equal(sessionTouched, false, 'must refuse before touching tmux at all');
    assert.doesNotMatch(wrote, /\x1b\[\?1049h/, 'must never enter the alternate screen');
    // The live holder's lock is untouched.
    assert.equal(watchLock.readLock(root).pid, 1);
  } finally {
    process.exitCode = prevExitCode;
    process.stdout.write = realWrite;
    console.error = realError;
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
    delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/ui/ticket-provider')];
    delete require.cache[sessionPath];
  }
});
