'use strict';

// The terminal-frame layer: the differential line-diff writer and the small
// pure helpers the poll loop leans on. Everything here is pure (no
// process.stdout access, no state) — which is exactly what makes it
// unit-testable without a real TTY (test/watch.test.js). watch.js re-exports
// this module's public names unchanged, so every pre-existing
// `require('../lib/ui/watch')` import keeps working.

// Idle time as a pure, stateless function of tmux's own per-window
// `#{window_activity}` timestamp (epoch seconds, as returned by
// session.listWindows()) and the current poll's `now` (epoch ms). No
// per-ticket memory is needed: `window_activity` is tracked by the tmux
// server itself from pty writes, so it advances on every poll where the
// window's process has written anything — including a redraw that happens
// to reproduce byte-identical pane content (verified directly against a
// real detached tmux session; see design.md) — which is exactly the case
// the previous pane-content-hash approach misreported as idle. Falls back
// to `0` (matching the old seed path's behavior) when tmux has no activity
// timestamp yet for this window.
function idleMsFromActivity(activity, now) {
  return activity != null ? Math.max(0, now - activity * 1000) : 0;
}

// Terminal-control byte sequences the dashboard writes. Named and centralised
// here (rather than inlined at each call site) so the "textually paired"
// guarantee CON-17's design doc relies on — exactly one \x1b[?1049h at
// startup, one \x1b[?1049l in quit(), and one suspend/restore pair around
// attach — is something a test can grep for by name, and so `\x1b[2J` (the
// old full-screen clear CON-17 removed) never reappears anywhere under a
// different spelling.
const CURSOR_HOME = '\x1b[H';
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';
// The differential writer parks the real terminal cursor at the end of the
// last row after every frame (Decision 8, below) so redraw-diffing has a
// fixed resting position — but a visible cursor sitting there reads as a
// stray blinking block at the bottom-right of the screen. Hidden/shown in
// lockstep with the alternate-buffer pair above: hide on every ALT_SCREEN_
// ENTER (dashboard owns the terminal), show on every ALT_SCREEN_EXIT
// (something else — the shell, tmux — is about to own it and must get a
// normal cursor back).
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
// CON-27: absolute placement of the cursor at the start of a given 1-based
// terminal row — the differential writer's per-row prefix. Named here for
// the same reason as the constants above: buildFrame emits it from three
// places (the shrink-blanking loop, the diff loop, and the cursor-park
// write), and those three are meant to be, and must stay, byte-identical.
const rowAt = (row) => '\x1b[' + row + ';1H';

const format = require('./format');

// Differential (line-diff) rendering — never a full-screen clear (CON-27,
// design.md Decisions 2, 6 and 8; CON-17's own Decision 1 established the
// no-clear guarantee this builds on). There are two writer modes:
//
//   1. The DIFF path (every frame that fits the terminal). Each new padded
//      line is compared by strict string equality against `prevLines[i]` —
//      the same row's already-padded content from the previous frame. Only
//      the rows that differ are written, each preceded by its own absolute
//      cursor placement (`\x1b[<row>;1H`), so an unchanged row costs zero
//      bytes and a fully unchanged tick produces `bytes === ''` (Decision
//      5 — draw()'s call site then skips the stdout write entirely). Rows
//      the new, shorter frame no longer has are blanked, exactly as before.
//      Whenever this path writes anything at all, it finishes by rewriting
//      the frame's LAST row (Decision 8): that parks the cursor at the same
//      fixed resting position a full-frame rewrite already left it at, so it
//      does not visibly hop to whichever row happened to change this tick,
//      AND it repairs the one case where the shrink loop's blanking can
//      clamp onto the last real row (a resize sentinel can leave
//      `prevLines.length` above the current `rows` — see Decision 8).
//
//   2. The FULL-REWRITE fallback (`CURSOR_HOME` + newline flow), used only
//      when the frame is taller than the terminal (`rows > 0 && lines.length
//      > rows`). Absolute row addressing cannot reproduce a scroll — a
//      `\x1b[<row>;1H` beyond the terminal's height clamps onto the last row
//      — so an over-tall frame keeps relying on the terminal's own
//      newline-driven auto-scroll, exactly as it did before this change.
//      That is what preserves screens/fleet.js's deliberate "NEEDS YOU stays
//      visible, the header scrolls off" trade-off (Decision 6). When `rows`
//      is 0/falsy (no TTY — a redirected stdout, as the smoke gate and the
//      unit tests run under) this fallback never triggers.
//
// `buildFrame` strips exactly one trailing '\n' before splitting into lines
// (CON-26), so `draw()`'s appended newline never contributes an extra row —
// the lines this function pads from and the lines it returns stay in
// one-to-one correspondence with actual rendered content. Under the diff
// path that strip matters more than it did under the full rewrite: a
// phantom trailing blank row would not only be written, it would also be
// where the cursor-park write below leaves the cursor resting. Padding
// reuses format.js's own visible-column-width `padTo`, not a raw `.length`
// scheme — outer-frame lines carry ANSI SGR colour escapes
// (f.bold/f.dim/f.yellow/...) that `.length` would wrongly count as columns
// they do not occupy.
//
// Returns `{ bytes, lines }`, where `lines` is what the caller must store as
// the next call's `prevLines`. On the diff path that is simply the new
// frame's own padded lines; on the overflow fallback it is only the TAIL the
// terminal's scroll actually leaves visible (`lines.slice(length - rows)`),
// because that — not the whole over-tall frame — is what physical rows
// `1..rows` hold once the scroll settles, and restoring that invariant is
// what lets a later, back-within-bounds frame resume trustworthy per-row
// diffing (Decision 6).
//
// Pure: no process.stdout access. `rows` is the WHOLE terminal height
// (`process.stdout.rows || 0`), not draw()'s `screenRows` sub-budget — the
// terminal's auto-scroll behaves on total rows, and the text passed here
// already includes the banner.
function buildFrame(text, cols, rows, prevLines) {
  const lines = text.replace(/\n$/, '').split('\n').map((line) => format.padTo(line, cols));
  const prev = prevLines || [];
  const blank = ' '.repeat(Math.max(0, cols));
  // A frame shorter than its predecessor leaves the rows below its own last
  // line untouched — blank them explicitly, each preceded by its own cursor
  // position rather than relying on line-feed sequencing. `\x1b[J`
  // (erase-to-end-of-screen) was considered and rejected for this: it is
  // exactly the same class of "erase, don't overwrite" operation as
  // `\x1b[2J`, just scoped to the tail, and reopens the blank-frame window
  // CON-17 exists to close for precisely the rows it touches.
  const blankTrailingRows = () => {
    let out = '';
    for (let row = lines.length + 1; row <= prev.length; row++) {
      out += rowAt(row) + blank;
    }
    return out;
  };

  // Mode 2 — the over-tall fallback. This is the ONLY fallback condition
  // (Decision 6): a `prevLines.length > rows` disjunct was considered and
  // rejected as both redundant (the tail-truncation below already restores
  // `prevLines.length <= rows` after every overflow write) and, at
  // `rows === 0`, self-contradictory with "never triggers when rows is
  // unknown".
  const overflow = rows > 0 && lines.length > rows;
  if (overflow) {
    const bytes = CURSOR_HOME + lines.join('\n') + blankTrailingRows();
    return { bytes, lines: lines.slice(Math.max(0, lines.length - rows)) };
  }

  // Mode 1 — the diff. `lines[i] !== prev[i]` is true for a genuinely
  // changed row, for a row the previous frame did not have at all
  // (`undefined`), and for a row the resize listener invalidated with a
  // sentinel (`null`) — all three want the same thing: write this row.
  let bytes = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== prev[i]) bytes += rowAt(i + 1) + lines[i];
  }
  bytes += blankTrailingRows();
  // Decision 8's cursor park. Unconditional whenever anything was written —
  // deliberately NOT skipped when the last row is already in the changed
  // set, because it is also what repairs a shrink-blank that clamped onto
  // the last real row. Never added on a fully unchanged tick, so Decision
  // 5's "an unchanged tick touches stdout not at all" is unaffected.
  if (bytes) bytes += rowAt(lines.length) + lines[lines.length - 1];
  return { bytes, lines };
}

// The set of escalations the cross-screen banner (CON-25 / lib/ui/banner.js)
// can actually do something about, sorted oldest-`raisedAt`-first — deliberately
// NOT the same filter fleet.js's `needsYou` uses (`status === 'needs-you'`
// also matches a BLOCKER-verdict run with no live `run.escalation` at all,
// i.e. nothing `answer.json` could resolve). Pure and exported so it is
// testable without a real poll loop (see test/watch.test.js).
function computeLiveEscalations(runs) {
  return (runs || [])
    .filter((r) => r.escalation && !r.escalationStale)
    .slice()
    .sort((a, b) => a.escalation.raisedAt - b.escalation.raisedAt);
}

// Runs `fn`, then unconditionally runs `restore` — even if `fn` throws,
// which is then rethrown after `restore` completes. This is the exact
// try/finally shape `doAttach()` needs around handing the terminal to tmux
// (design.md Decision 4: "if attach throws we must still hand the terminal
// back"), factored out so that guarantee is unit-testable against a fake,
// throwing `fn` without a real tmux session or stdin.
function attachAndRestore(fn, restore) {
  try {
    return fn();
  } finally {
    restore();
  }
}

// One stdin chunk is not one key. In raw mode it usually is, but a paste — or
// any piped stdin, where the whole script arrives in a single read — delivers
// several at once, and an exact compare against the chunk then matches nothing.
// Split into keys so both paths run the same handler.
//
// An escape sequence must survive as ONE key: arrow keys arrive as `\x1b[A`, and
// splitting per character would deliver a bare `\x1b` — which cancels the
// prompt — followed by a literal `[A` typed into it.
function splitKeys(chunk) {
  const keys = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === '\x1b' && (chunk[i + 1] === '[' || chunk[i + 1] === 'O')) {
      let j = i + 2;
      // CSI/SS3 runs to its final byte, @ through ~.
      while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
      keys.push(chunk.slice(i, Math.min(j + 1, chunk.length)));
      i = j + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

module.exports = {
  idleMsFromActivity, buildFrame, computeLiveEscalations, attachAndRestore, splitKeys,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, CURSOR_HIDE, CURSOR_SHOW, rowAt,
};
