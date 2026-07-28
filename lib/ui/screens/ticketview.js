'use strict';

// The ticket viewer. Pure: (state, opts) -> string. Reached with `↵` on a
// ticket in the launch pad's tickets pane — the entire reason the cache holds
// full descriptions and comments rather than fetching them lazily per
// keystroke (see the design doc's "Ticket cache" section). Reading the
// ticket properly is what you do before handing it to an autonomous agent.

const f = require('../format');
const layout = require('../layout');

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — see fleet.js/drilldown.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;

// Draws the description/comments body through layout.box(), or — below
// layout.degrade()'s threshold — falls back to the pre-change flat rendering
// (no frame). See drilldown.js's identical `pane()` helper.
function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    return contentLines.map((l) => f.truncate(l, opts.width));
  }
  return layout.box(contentLines, opts);
}

// A simple greedy word-wrap, visible-column aware (CJK/emoji-safe) via
// f.visibleLength, so a wide character in a ticket description — model- or
// human-authored free text, unlike this codebase's own strings — cannot push
// a wrapped line past its budget. Not folded into format.js: nothing else in
// the UI wraps free-flowing prose onto multiple lines, so this stays local
// rather than growing the shared module's surface for one caller.
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

function renderTicketView(ticket, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);

  if (!ticket) {
    return [f.bold('TICKET'), '', f.dim('  ticket no longer in the cache'), '', f.dim('  esc back')].join('\n');
  }

  const out = [];
  out.push(f.bold(ticket.identifier || '?') + '  ' + f.truncate(ticket.title || '', cols - 12));
  out.push(f.dim('  ' + f.truncate(metaLine(ticket), cols - 2)));
  if (ticket.url) out.push(f.dim('  ' + f.truncate(ticket.url, cols - 2)));
  out.push('');

  // The description/comments body is this screen's one interactive surface —
  // wrapped in a single box, plain/unfocused border set, matching design.md
  // Decision 2's single-pane rule (same reasoning as escalation.js's
  // question/context/options block).
  const boxWidth = cols;
  const innerWidth = Math.max(0, boxWidth - BOX_BORDER_PADDING_COLS);
  const boxContent = [];
  boxContent.push(f.bold('DESCRIPTION'));
  const description = ticket.description && ticket.description.trim();
  if (description) {
    for (const l of wrap(description, innerWidth - 2)) boxContent.push('  ' + l);
  } else {
    boxContent.push('  ' + f.dim('(no description)'));
  }
  boxContent.push('');

  const commentCount = typeof ticket.commentCount === 'number' ? ticket.commentCount : (ticket.comments || []).length;
  const header = 'COMMENTS' + (commentCount ? '  (' + commentCount + ')' : '');
  boxContent.push(f.bold(header));
  if (!ticket.comments || !ticket.comments.length) {
    boxContent.push('  ' + f.dim('(no comments)'));
  } else {
    for (const c of ticket.comments) {
      for (const l of commentBlock(c, innerWidth - 2)) boxContent.push('  ' + l);
      boxContent.push('');
    }
    if (ticket.commentsTruncated) {
      boxContent.push('  ' + f.dim('showing ' + ticket.comments.length + ' of ' + (ticket.commentCount || '?') + ' — see ' + (ticket.url || 'Linear') + ' for the rest'));
    }
  }

  const boxHeight = boxContent.length + 2;
  for (const line of pane(boxContent, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');
  out.push(f.dim('  esc back'));

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

function findTicket(launchPad, identifier) {
  const tickets = (launchPad && launchPad.cache && launchPad.cache.tickets) || [];
  return tickets.find((t) => t.identifier === identifier) || null;
}

function handleKey(key, state) {
  if (key === '\x1b') return { type: 'back-to-launchpad' };
  return null;
}

function render(state, opts) {
  const ticket = findTicket(state.launchPad, state.launchPad && state.launchPad.viewingTicket);
  return renderTicketView(ticket, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, state);
}

module.exports = { renderTicketView, handleKey, render, routeHandleKey, wrap, findTicket };
