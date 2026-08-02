'use strict';

// The single shared table of structural icon glyphs used across the
// dashboard's screens (drilldown.js, fleet.js, launchpad.js, ticketDetail.js,
// docview.js). See openspec/changes/dashboard-iconography-pass/design.md
// Decision 1/2. Every glyph here is a bare string with no colour/SGR of its
// own — callers wrap with `f.dim`/`f.bold`/etc. exactly as they already do
// for plain text, so icon colour follows the same per-call styling as the
// label it sits next to.
//
// Glyph selection is restricted to `Emoji_Presentation=No` codepoints from
// Geometric Shapes (U+25xx), Dingbats (U+27xx), Miscellaneous Technical
// (U+23xx), and Mathematical Operators (U+22xx) — the same character classes
// the codebase's existing `✓`/`✗`/`○`/`●`/`▲` markers already draw from.
// None of these codepoints carry Unicode's `Emoji_Presentation=Yes` property,
// so no terminal's emoji font stack renders them at 2 columns; each costs
// exactly 1 visible column under `format.js`'s `visibleLength`. A future
// addition to this file MUST follow the same constraint — do not pull glyphs
// from Miscellaneous Symbols (U+2600-U+26FF) or any astral pictograph block
// (see design.md Decision 2's "Alternative considered" for why).

const icons = {
  branch: '⎇',      // ⎇  U+2387  branch
  ticket: '▤',      // ▤  U+25A4  ticket
  timeline: '▬',    // ▬  U+25AC  timeline
  gates: '◆',       // ◆  U+25C6  gate/checkpoint
  evidence: '▧',    // ▧  U+25A7  evidence/document
  description: '❏', // ❏  U+274F  description/page
  comments: '✎',    // ✎  U+270E  comment
  epics: '▣',       // ▣  U+25A3  epic/group
  quickStart: '▶',  // ▶  U+25B6  quick start
  queue: '≡',       // ≡  U+2261  queue/list
  metrics: '◫',     // ◫  U+25EB  metrics
  pr: '⏏',          // ⏏  U+23CF  PR/link artifact — leaves the TUI for the OS browser
};

module.exports = icons;
