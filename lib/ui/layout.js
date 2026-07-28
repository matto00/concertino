'use strict';

// The shared layout module every dashboard screen draws its bordered panes
// through, rather than each screen hand-rolling its own box-drawing (the
// state before this change: `twoCol()` in drilldown.js, the inline loop at
// the end of `renderLaunchPad`, and four other screens with no shared frame
// at all). Pure: no I/O, no held state, no terminal queries — everything here
// is computed only from its arguments. See design.md Decision 1.

const f = require('./format');

// Below these thresholds a border cannot be drawn legibly (border line plus
// at least one padded content column/row) — see design.md Decision 3. A
// screen calls degrade() itself and, when it returns true, skips box()
// entirely rather than drawing a frame that would have to be truncated into
// illegibility.
const MIN_BOX_WIDTH = 8;
const MIN_BOX_HEIGHT = 3;

// The structural focus distinction (design.md Decision 2): different
// characters, not only different colour, so focus still reads on a terminal
// that renders bold but not colour at all.
const BORDERS = {
  plain: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  focused: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
};

function degrade(width, height) {
  return width < MIN_BOX_WIDTH || height < MIN_BOX_HEIGHT;
}

// Colours only the border characters themselves, never content — content
// rows can already carry their own ANSI colour (a yellow escalation line, a
// STATUS_COLOUR title), and wrapping the whole line in a second colour would
// either clobber that or leave a stray reset in the middle of the line.
// `f.bold`/`f.cyan` already no-op under `!isTTY` (see format.js's `wrap`), so
// this falls out of the existing colour-gating for free.
function borderColour(focused) {
  return focused ? (s) => f.bold(f.cyan(s)) : (s) => s;
}

// Draws a single bordered pane. `opts`: { width, height, title, focused,
// padding = 1 }. Returns an array of exactly `width`-visible-column lines —
// a top border (title woven in, if given), exactly `height - 2` content
// rows, and a bottom border. If `height` is omitted, the box is exactly
// `contentLines.length + 2` lines tall.
//
// Padding is horizontal-only (design.md Decision 1): it indents each content
// row by `padding` columns on each side and never reserves an extra blank
// row — a screen that wants breathing room passes an explicit blank content
// line, exactly as every screen already does today.
function box(contentLines, opts) {
  const o = opts || {};
  const width = Math.max(0, o.width || 0);
  const padding = o.padding == null ? 1 : o.padding;
  const focused = !!o.focused;
  const title = o.title;
  const set = focused ? BORDERS.focused : BORDERS.plain;
  const colour = borderColour(focused);
  const lines = contentLines || [];

  const height = o.height != null ? o.height : lines.length + 2;
  const contentRows = Math.max(0, height - 2);
  const innerWidth = Math.max(0, width - 2 * padding - 2);

  const out = [];

  // Top border. Title overflow uses the SAME contract as content: f.truncate
  // with the same ellipsis convention, including when the title carries an
  // ANSI colour escape (f.truncate already treats those as zero-width — see
  // design.md Decision 1's "title overflow" note).
  if (title) {
    // Available width for the title itself: the border width minus the two
    // corner characters and a fixed 2-column margin (one space on each side
    // of the title — the ` title ` style).
    const available = Math.max(0, width - 2 - 2);
    const truncatedTitle = f.truncate(title, available);
    const titleVisible = f.visibleLength(truncatedTitle);
    const fill = Math.max(0, width - 2 - 1 - titleVisible - 1);
    out.push(colour(set.tl) + ' ' + truncatedTitle + ' ' + colour(set.h.repeat(fill) + set.tr));
  } else {
    out.push(colour(set.tl + set.h.repeat(Math.max(0, width - 2)) + set.tr));
  }

  // Content rows: exactly `contentRows`, full stop, regardless of `padding`.
  for (let i = 0; i < contentRows; i++) {
    const raw = lines[i] != null ? lines[i] : '';
    const inner = f.padTo(f.truncate(raw, innerWidth), innerWidth);
    out.push(colour(set.v) + ' '.repeat(padding) + inner + ' '.repeat(padding) + colour(set.v));
  }

  // Bottom border.
  out.push(colour(set.bl + set.h.repeat(Math.max(0, width - 2)) + set.br));

  return out;
}

// Composes boxes that are already the same height side by side with a
// one-column gap. Each entry is `{ lines, width }` — `lines` a pre-rendered
// box() result (or any array of already-bordered/plain lines the caller has
// prepared, e.g. GATES and EVIDENCE stacked into one array for drilldown.js's
// right column), `width` that pane's own visible-column width. Lenient about
// mismatched line counts (pads the shorter pane's missing rows with blanks
// of its own width) — height reconciliation across panes is still the
// caller's job (design.md Decision 3), this is just a safety net so a
// mismatch degrades gracefully instead of throwing.
function hsplit(panes) {
  const list = panes || [];
  let rows = 0;
  for (const p of list) rows = Math.max(rows, (p.lines || []).length);

  const out = [];
  for (let i = 0; i < rows; i++) {
    out.push(list.map((p) => {
      const line = p.lines && p.lines[i] != null ? p.lines[i] : '';
      return f.padTo(line, p.width);
    }).join(' '));
  }
  return out;
}

module.exports = { box, hsplit, degrade, BORDERS, MIN_BOX_WIDTH, MIN_BOX_HEIGHT };
