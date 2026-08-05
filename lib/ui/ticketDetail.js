'use strict';

// The one description/comments body renderer shared by the full-screen
// ticket view (`screens/ticketview.js`, reached via `↵`) and the launch
// pad's inline detail pane (CON-35). Pure: no I/O, no layout/box concerns —
// callers wrap the returned lines in their own `layout.box()`/`layout.degrade()`
// call with their own dimensions (design.md Decision 2). Keeping exactly one
// implementation here is the point: a future fix to, say, `commentsTruncated`
// wording lands once, not once per screen.

const f = require('./format');
// The word-wrap this module's description/comment bodies use lives in
// lib/ui/textwrap.js (extracted independently by CON-18 for drilldown.js's
// TICKET panel, which imports it directly). Delegating here — rather than
// keeping a second, byte-identical copy — keeps exactly one word-wrap
// implementation project-wide, consistent with this file's own "one shared
// implementation" reason for existing in the first place.
const { wrap } = require('./textwrap');
const icons = require('./icons');
const { sectionHeader } = require('./widgets/header');

function fmtDate(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function metaLine(ticket) {
  const parts = [];
  parts.push(ticket.state && ticket.state.name ? ticket.state.name : 'Todo');
  if (ticket.assignee) parts.push(ticket.assignee);
  if (ticket.estimate != null) parts.push(ticket.estimate + ' pts');
  if (ticket.epicName) parts.push(ticket.epicName);
  if (ticket.labels && ticket.labels.length) parts.push(ticket.labels.join(', '));
  return parts.join('   ·   ');
}

function commentBlock(comment, width) {
  const lines = [];
  const who = comment.author || 'unknown';
  const when = fmtDate(comment.createdAt);
  lines.push(f.bold(who) + (when ? f.dim('  ' + when) : ''));
  for (const l of wrap(comment.body, width - 2)) lines.push('  ' + l);
  return lines;
}

// Builds the DESCRIPTION/COMMENTS content lines against `innerWidth` (the
// space available INSIDE whatever box the caller draws around it — same
// convention as every other screen's content-generation width). Includes
// the empty-description message and the commentsTruncated line: both are
// spec-level guarantees (see specs/launchpad-detail-pane/spec.md) that must
// survive in every caller, not just ticketview.js.
function buildDetailLines(ticket, innerWidth) {
  const lines = [];
  lines.push(f.bold(sectionHeader({ icon: icons.description, label: 'DESCRIPTION' })));
  const description = ticket && ticket.description && ticket.description.trim();
  if (description) {
    for (const l of wrap(description, innerWidth - 2)) lines.push('  ' + l);
  } else {
    // A ticket with an empty description must say so explicitly — rendering
    // blank is the "absent data as healthy data" failure this project treats
    // as a wall (see the ticket's own "Detail pane" section).
    lines.push('  ' + f.dim('(no description)'));
  }
  lines.push('');

  const comments = (ticket && ticket.comments) || [];
  const commentCount = ticket && typeof ticket.commentCount === 'number' ? ticket.commentCount : comments.length;
  const header = sectionHeader({ icon: icons.comments, label: 'COMMENTS' }) + (commentCount ? '  (' + commentCount + ')' : '');
  lines.push(f.bold(header));
  if (!comments.length) {
    lines.push('  ' + f.dim('(no comments)'));
  } else {
    for (const c of comments) {
      for (const l of commentBlock(c, innerWidth - 2)) lines.push('  ' + l);
      lines.push('');
    }
    if (ticket && ticket.commentsTruncated) {
      // `commentsTruncated` must stay visible — a silently shortened thread
      // reads as a complete one (see linear.js's own normaliser comment).
      lines.push('  ' + f.dim('showing ' + comments.length + ' of ' + (ticket.commentCount || '?') + ' — see ' + (ticket.url || 'Linear') + ' for the rest'));
    }
  }

  return lines;
}

module.exports = { buildDetailLines, wrap, commentBlock, metaLine, fmtDate };
