'use strict';

// A simple greedy word-wrap, visible-column aware (CJK/emoji-safe) via
// f.visibleLength, so a wide character in free-flowing prose — model- or
// human-authored text, unlike this codebase's own strings — cannot push a
// wrapped line past its budget. Extracted from ticketview.js (its original,
// and still only other, caller) so drilldown.js's TICKET panel does not
// duplicate it — see design.md's "Impact" section. Behavior is unchanged
// from the original inline version.

const f = require('./format');

function wrap(text, width) {
  const w = Math.max(10, width);
  const lines = [];
  for (const paragraph of String(text || '').split(/\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + ' ' + word : word;
      if (f.visibleLength(candidate) > w && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

module.exports = { wrap };
