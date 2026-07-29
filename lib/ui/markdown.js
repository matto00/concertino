'use strict';

// A small, dependency-free markdown-to-plain-text helper (design.md Decision
// 5). Strips markdown SYNTAX so a Linear-authored description reads as plain
// text on a terminal panel, rather than reproducing markdown's rich layout
// (no tables, no nested-list indentation, no syntax highlighting — see
// design.md's Non-Goals). This module never touches control bytes: that is
// handled downstream, once, at the screen's own final `f.truncate` pass
// (design.md Decision 6) — every other string on this screen gets its
// control-byte safety the same way, and adding a second strip here would be
// redundant with, not an improvement on, that single choke point.

// Fenced code block markers ("```", optionally with a language tag) toggle
// in/out of a code region. The fence line itself is dropped; the code text
// between fences is kept as-is (no further inline stripping — a code sample
// is not prose, and stripping ** or _ INSIDE code would corrupt it).
const FENCE_RE = /^\s*```/;

// Heading markers: 1-6 '#' at the start of the line (with up to 3 leading
// spaces, matching CommonMark's own tolerance), followed by at least one
// space.
const HEADING_RE = /^\s{0,3}#{1,6}\s+/;

// Blockquote markers: one or more leading '>' (nesting is flattened, not
// reproduced — this is plain text, not a rendered quote block).
const BLOCKQUOTE_RE = /^\s*>+\s?/;

// Ordered-list numbering ("1. ", "2) ") — the number itself carries no
// meaning once rendered as a bounded plain-text block, so it is dropped
// rather than kept as noise competing with the actual list text for width.
const ORDERED_LIST_RE = /^(\s*)\d+[.)]\s+/;

// Bullet markers ("-", "*", "+") become a plain bullet glyph + space, so a
// bulleted list still reads as a list once the list-syntax markup is gone.
const BULLET_RE = /^(\s*)[-*+]\s+/;

// Inline link syntax: `[text](url)` -> `text`. The URL is dropped, not kept
// alongside the text (design.md Decision 5): this is a bounded terminal
// panel, not a browser, and a bare URL competing with the link text for the
// same width budget is worse than dropping it — the panel already truncates
// visibly when content overflows.
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;

// Inline code: `` `code` `` -> `code`.
const INLINE_CODE_RE = /`([^`]*)`/g;

// Emphasis: **bold**/__bold__ -> bold, *italic*/_italic_ -> italic. Bold's
// double-delimiter forms are stripped BEFORE the single-delimiter italic
// forms, so `**bold**` never gets half-consumed by the italic regex first.
const BOLD_STAR_RE = /\*\*([^*]+)\*\*/g;
const BOLD_UNDERSCORE_RE = /__([^_]+)__/g;
const ITALIC_STAR_RE = /\*([^*]+)\*/g;
const ITALIC_UNDERSCORE_RE = /_([^_]+)_/g;

function toPlainText(md) {
  const text = String(md == null ? '' : md);
  const lines = text.split('\n');
  const out = [];
  let inFence = false;

  for (const rawLine of lines) {
    if (FENCE_RE.test(rawLine)) {
      inFence = !inFence;
      continue; // the fence marker itself is never shown
    }
    if (inFence) {
      out.push(rawLine); // code text, unmodified
      continue;
    }

    let line = rawLine;
    line = line.replace(HEADING_RE, '');
    line = line.replace(BLOCKQUOTE_RE, '');
    line = line.replace(ORDERED_LIST_RE, '$1');
    line = line.replace(BULLET_RE, '$1• ');

    line = line.replace(LINK_RE, '$1');
    line = line.replace(INLINE_CODE_RE, '$1');
    line = line.replace(BOLD_STAR_RE, '$1');
    line = line.replace(BOLD_UNDERSCORE_RE, '$1');
    line = line.replace(ITALIC_STAR_RE, '$1');
    line = line.replace(ITALIC_UNDERSCORE_RE, '$1');

    out.push(line);
  }

  return out.join('\n');
}

module.exports = { toPlainText };
