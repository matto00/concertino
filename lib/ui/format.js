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

function visibleLength(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
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

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  if (n <= 0) return '';
  if (str.length <= n) return str;
  return str.slice(0, n - 1) + '…';
}

function padTo(s, n) {
  const t = truncate(s, n);
  return t + ' '.repeat(Math.max(0, n - t.length));
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
