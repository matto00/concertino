'use strict';

// The shared text-input-field widget (design.md Decision 2). Fleet's new-run
// prompt, escalation.js's reply box, and banner.js's reply box each
// independently render the same `label + ' › ' + truncated-value + '▏'` line,
// plus an optional error line — this widget is a byte-for-byte extraction of
// that shape. `ticketdraft.js`'s draft-field rendering is a materially
// different shape (a wrapped multi-line textarea, not a single truncated
// value) and is deliberately NOT a consumer of this widget.
//
// Render-only: cursor/backspace key handling stays with each caller's own
// `handleKey` (design.md Decision 2's "Alternative considered").

const f = require('../format');

// inputLines({ label, value, cols, error }) -> [inputLine] | [inputLine, errorLine].
function inputLines({ label, value, cols, error }) {
  const inputLine = '  ' + f.bold(label) + f.dim(' › ') +
    f.truncate(value || '', Math.max(0, cols - 14)) + '▏';
  const lines = [inputLine];
  if (error) lines.push('  ' + f.red(f.truncate(error, Math.max(0, cols - 4))));
  return lines;
}

module.exports = { inputLines };
