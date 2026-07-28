'use strict';

const TTY = !!process.stdout.isTTY;
const wrap = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);

const bold   = (s) => wrap('1', s);
const dim    = (s) => wrap('2', s);
const red    = (s) => wrap('31', s);
const green  = (s) => wrap('32', s);
const yellow = (s) => wrap('33', s);
const blue   = (s) => wrap('34', s);
const magenta= (s) => wrap('35', s);
const cyan   = (s) => wrap('36', s);

// Colour per agent role — the "role gutter" that makes handoffs and the
// skeptic's isolated cold spikes readable without swimlanes.
const ROLE_COLOUR = {
  orchestrator: blue,
  executor: cyan,
  evaluator: yellow,
  skeptic: magenta,
  script: dim,
  human: green,
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

// --- display width ---------------------------------------------------------
// A terminal lays out COLUMNS, not code units. Three things diverge:
//   - an astral code point (emoji, CJK ext-B) is two UTF-16 units but one glyph;
//   - a CJK or fullwidth glyph occupies two columns;
//   - a combining mark or variation selector occupies none.
// Counting `.length` gets all three wrong, and the width guard in the fleet
// renderer then passes lines that wrap — which, on a screen that is cleared and
// rewritten every second, pushes content off the bottom.
//
// A compact range table, not a dependency. Ranges are inclusive and sorted, so
// a linear scan with an early exit is plenty at terminal-line sizes.

const ZERO_WIDTH = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff],
  [0x200b, 0x200f], [0x2060, 0x2064], [0x20d0, 0x20f0], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f], [0xfeff, 0xfeff],
];

const WIDE = [
  [0x1100, 0x115f],   // Hangul Jamo
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],   // CJK radicals .. CJK symbols and punctuation
  [0x3041, 0x33ff],   // Hiragana, Katakana, Hangul compat jamo, enclosed CJK
  [0x3400, 0x4dbf],   // CJK ext A
  [0x4e00, 0x9fff],   // CJK unified ideographs
  [0xa000, 0xa4cf],   // Yi
  [0xa960, 0xa97f],   // Hangul Jamo ext-A
  [0xac00, 0xd7a3],   // Hangul syllables
  [0xf900, 0xfaff],   // CJK compatibility ideographs
  [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60],   // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x17000, 0x18aff],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd], // CJK ext B and beyond
];

function inRanges(cp, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (cp < ranges[i][0]) return false;   // sorted: nothing further can match
    if (cp <= ranges[i][1]) return true;
  }
  return false;
}

// Columns occupied by one code point.
function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 0x0300) return 1;               // the overwhelmingly common case
  if (inRanges(cp, ZERO_WIDTH)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

// Width in terminal COLUMNS of the visible (non-escape) part of `s`.
function visibleLength(s) {
  const str = String(s).replace(ANSI, '');
  let w = 0;
  for (const ch of str) w += charWidth(ch.codePointAt(0));
  return w;
}

function dur(ms) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return total + 's';
  const mins = Math.floor(total / 60);
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  return hours + 'h' + String(mins % 60).padStart(2, '0') + 'm';
}

// Truncates to n VISIBLE columns. Escape sequences are copied through with zero
// width, so a coloured line is never sliced mid-escape — doing that both loses
// content (raw length overcounts) and strips the reset, bleeding colour into the
// rest of the terminal.
//
// Content advances by CODE POINT, never by UTF-16 code unit. Cutting between the
// halves of a surrogate pair emits a lone surrogate, which a terminal renders as
// a replacement glyph — and escalation questions are model-authored free text,
// so emoji arrive there routinely. A wide glyph that would overrun the budget is
// dropped whole rather than half-drawn.
function truncate(s, n) {
  const str = String(s == null ? '' : s);
  if (n <= 0) return '';
  if (visibleLength(str) <= n) return str;

  const budget = n - 1;          // leave a column for the ellipsis
  let out = '';
  let visible = 0;
  let open = false;
  let i = 0;

  while (i < str.length && visible < budget) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(str);
    if (m && m.index === i) {    // an escape starts here: zero width
      out += m[0];
      open = m[0] !== '\x1b[0m';
      i += m[0].length;
      continue;
    }
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const w = charWidth(cp);
    if (visible + w > budget) break;
    out += ch;
    visible += w;
    i += ch.length;            // 2 for an astral code point, 1 otherwise
  }

  return out + '…' + (open ? '\x1b[0m' : '');
}

// Pads to n VISIBLE columns, for the same reason truncate counts them: a
// coloured string's escape bytes are not content, and padding by raw length
// adds nothing at all for a short coloured string, silently breaking column
// alignment. `truncate` has already capped the visible width to n.
function padTo(s, n) {
  const t = truncate(s, n);
  return t + ' '.repeat(Math.max(0, n - visibleLength(t)));
}

function bar(frac, width) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const filled = Math.round(f * width);
  return '▪'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

module.exports = {
  dur, truncate, padTo, bar, visibleLength,
  bold, dim, red, green, yellow, blue, magenta, cyan, ROLE_COLOUR,
};
