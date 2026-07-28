'use strict';

// The ticket viewer. Pure: (state, opts) -> string. Reached with `↵` on a
// ticket in the launch pad's tickets pane — the entire reason the cache holds
// full descriptions and comments rather than fetching them lazily per
// keystroke (see the design doc's "Ticket cache" section). Reading the
// ticket properly is what you do before handing it to an autonomous agent.

const f = require('../format');

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
  out.push(f.bold('DESCRIPTION'));
  const description = ticket.description && ticket.description.trim();
  if (description) {
    for (const l of wrap(description, cols - 2)) out.push('  ' + l);
  } else {
    out.push('  ' + f.dim('(no description)'));
  }
  out.push('');

  const commentCount = typeof ticket.commentCount === 'number' ? ticket.commentCount : (ticket.comments || []).length;
  const header = 'COMMENTS' + (commentCount ? '  (' + commentCount + ')' : '');
  out.push(f.bold(header));
  if (!ticket.comments || !ticket.comments.length) {
    out.push('  ' + f.dim('(no comments)'));
  } else {
    for (const c of ticket.comments) {
      for (const l of commentBlock(c, cols - 2)) out.push('  ' + l);
      out.push('');
    }
    if (ticket.commentsTruncated) {
      out.push('  ' + f.dim('showing ' + ticket.comments.length + ' of ' + (ticket.commentCount || '?') + ' — see ' + (ticket.url || 'Linear') + ' for the rest'));
    }
  }

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
