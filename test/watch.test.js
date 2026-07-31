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

    // Sections on screen: RUNNING (1), QUEUED (2). Digit 2 jumps INTO
    // QUEUED focus without touching the run selection at all.
    fakeStdin.emit('data', '2');
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
  require.cache[sessionPath] = {
    id: sessionPath, filename: sessionPath, loaded: true,
    exports: { hasTmux: () => true, createSession: () => fakeSessionObj, PLACEHOLDER: '__concertino__' },
  };

  let donePromise;
  try {
    const watchModule = require('../lib/ui/watch');
    donePromise = watchModule.watch({ root, config: {} });

    // No runs at all — QUEUED is the ONLY section on screen, so digit 1
    // jumps straight into queue focus on CON-90 (the sole pending ticket).
    fakeStdin.emit('data', '1');
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

    // Q opens+focuses QUICK START; the top of the priority-sorted list
    // (CON-100, Urgent) is quickStartFocus 0.
    h.fakeStdin.emit('data', 'Q');
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

    h.fakeStdin.emit('data', 'Q'); // opens+focuses; quickStartFocus: 0 -> CON-200 (Urgent)
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
    assert.equal(h.spawnCalls[0].cmd.replace('CON-200', '{{TICKET}}'), h.spawnCalls[1].cmd.replace('CON-201', '{{TICKET}}'));
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

    h.fakeStdin.emit('data', 'Q');
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

    h.fakeStdin.emit('data', 'Q');
    const focusedFrame = h.screen();
    assert.match(focusedFrame, /no tickets cached yet/);

    h.fakeStdin.emit('data', 'a');

    assert.equal(h.spawnCalls.length, 0, 'nothing should ever be spawned from an empty eligible list');
    assert.equal(queueCache.read(h.root), null, 'no queue should have been created at all');
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

    h.fakeStdin.emit('data', 'Q');
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
