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

function visibleLength(s) {
  return String(s).replace(ANSI, '').length;
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
// rest of the terminal. Not observable under `node --test`, where isTTY is false
// and no colour is emitted, so it has to be got right by construction.
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
    out += str[i];
    visible++;
    i++;
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
