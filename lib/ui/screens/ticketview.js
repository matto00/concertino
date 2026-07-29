'use strict';

// The ticket viewer. Pure: (state, opts) -> string. Reached with `↵` on a
// ticket in the launch pad's tickets pane — the entire reason the cache holds
// full descriptions and comments rather than fetching them lazily per
// keystroke (see the design doc's "Ticket cache" section). Reading the
// ticket properly is what you do before handing it to an autonomous agent.

const f = require('../format');
const layout = require('../layout');
const ticketDetail = require('../ticketDetail');

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

// wrap/metaLine/etc. are re-exported below for backward compatibility (and
// for callers that only need the small helpers) — the body content itself
// now comes from lib/ui/ticketDetail.js's buildDetailLines, the one shared
// implementation this screen and the launch pad's inline detail pane both
// call (CON-35, design.md Decision 2). ticketDetail.js's own word-wrap
// delegates to lib/ui/textwrap.js (CON-18, extracted for drilldown.js's
// TICKET panel) rather than duplicating it, so there is exactly one
// word-wrap implementation project-wide, not two.
const { wrap, metaLine } = ticketDetail;

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
  const boxContent = ticketDetail.buildDetailLines(ticket, innerWidth);

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
