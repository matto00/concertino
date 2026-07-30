'use strict';

// The ticket viewer. Pure: (state, opts) -> string. Reached with `↵` on a
// ticket in the launch pad's tickets pane — the entire reason the cache holds
// full descriptions and comments rather than fetching them lazily per
// keystroke (see the design doc's "Ticket cache" section). Reading the
// ticket properly is what you do before handing it to an autonomous agent.

const f = require('../format');
const ticketDetail = require('../ticketDetail');
const docview = require('./docview');

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — see fleet.js/drilldown.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;

// This screen's own non-box row overhead, around docview.bodyBox()'s box:
// the id/title row, the meta row, a blank line before the box and one after
// it, and the `esc back` footer row — five rows, plus one more when the
// ticket carries a URL (its own row). Sized once here so renderTicketView's
// own composition and computeViewportRows (used by watch.js to pre-compute
// the SAME budget ahead of the next keypress — router.handleKey's own seam
// carries no `opts`, so this cannot be recomputed live at keypress time; see
// docview.js's identical DOC_CHROME_ROWS reasoning) can never disagree about
// how many rows the chrome around the box costs.
const CHROME_ROWS_BASE = 5;

// The viewport row budget this screen's own box gets, given the terminal's
// total row count (0/absent = unbounded — this screen's own pre-change
// behaviour, and what lets a caller/test that omits `rows` see the whole
// description/comments body in one box, exactly as before this change).
function computeViewportRows(rows, hasUrl) {
  if (!(rows > 0)) return Infinity;
  const chrome = CHROME_ROWS_BASE + (hasUrl ? 1 : 0);
  return Math.max(0, Math.max(0, rows - 1) - chrome);
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
  const rows = (opts && opts.rows) || 0;
  const scrollOffset = (opts && opts.scrollOffset) || 0;

  if (!ticket) {
    return [f.bold('TICKET'), '', f.dim('  ticket no longer in the cache'), '', f.dim('  esc back')].join('\n');
  }

  const out = [];
  out.push(f.bold(ticket.identifier || '?') + '  ' + f.truncate(ticket.title || '', cols - 12));
  out.push(f.dim('  ' + f.truncate(metaLine(ticket), cols - 2)));
  if (ticket.url) out.push(f.dim('  ' + f.truncate(ticket.url, cols - 2)));
  out.push('');

  // The description/comments body is this screen's one interactive surface —
  // scrolled and wrapped in a single box, plain/unfocused border set,
  // matching design.md Decision 2's single-pane rule (same reasoning as
  // escalation.js's question/context/options block). Box-drawing/windowing
  // itself is delegated to docview.bodyBox (design.md Decision 1, task 2.1)
  // rather than kept as a second, independent implementation — this screen
  // keeps only its own header rows and its own `esc back` footer below,
  // unchanged.
  const boxWidth = cols;
  const innerWidth = Math.max(0, boxWidth - BOX_BORDER_PADDING_COLS);
  const boxContent = ticketDetail.buildDetailLines(ticket, innerWidth);
  const viewportRows = computeViewportRows(rows, !!ticket.url);

  for (const line of docview.bodyBox(boxContent, { width: boxWidth, viewportRows, scrollOffset, focused: false })) {
    out.push(line);
  }
  out.push('');
  out.push(f.dim('  esc back'));

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

function findTicket(launchPad, identifier) {
  const tickets = (launchPad && launchPad.cache && launchPad.cache.tickets) || [];
  return tickets.find((t) => t.identifier === identifier) || null;
}

// Pure, generic-key handling only — esc always dispatches
// `{ type: 'back-to-launchpad' }` directly, exactly as before this change
// (design.md Decision 3a; task 2.3): this is ticketview.js's OWN hardcoded
// routing, never delegated to docview.js's generic `back` action, which is
// used only by the evidence reader.
function handleKey(key, state) {
  if (key === '\x1b') return { type: 'back-to-launchpad' };
  return null;
}

function render(state, opts) {
  const ticket = findTicket(state.launchPad, state.launchPad && state.launchPad.viewingTicket);
  return renderTicketView(ticket, Object.assign({}, opts, { scrollOffset: state.ticketviewScroll || 0 }));
}

// Extends handleKey with scroll handling (task 2.2), using
// docview.scrollDelta/docview.clampScroll (task 1.4/1.3) for the scroll-key
// logic itself — no second copy of scroll-key recognition — applied to this
// screen's own scroll variable (`state.ticketviewScroll`, owned by watch.js;
// see design.md Decision 2). `state.ticketviewViewportRows` and
// `state.ticketviewBodyLineCount` are precomputed by watch.js's draw() each
// poll (the same "rows"/"body length" this screen's own render() needs, but
// router.handleKey's seam carries no `opts`, so they cannot be recomputed
// live at keypress time).
function routeHandleKey(key, state) {
  const base = handleKey(key, state);
  if (base) return base;
  const viewportRows = state.ticketviewViewportRows != null ? state.ticketviewViewportRows : Infinity;
  const delta = docview.scrollDelta(key, viewportRows);
  if (!delta) return null;
  const bodyLineCount = state.ticketviewBodyLineCount || 0;
  const next = docview.clampScroll(bodyLineCount, viewportRows, (state.ticketviewScroll || 0) + delta.lines);
  return { type: 'ticketview-scroll', offset: next };
}

module.exports = { renderTicketView, handleKey, render, routeHandleKey, wrap, findTicket, computeViewportRows };
