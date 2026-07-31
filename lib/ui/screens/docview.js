'use strict';

// The shared, pure "read a long text document in a bounded, scrollable pane"
// core. Two exports (design.md Decision 1):
//   - bodyBox(bodyLines, opts): box-only, no title, no footer — the direct
//     generalisation of ticketview.js's old pane() helper. ticketview.js
//     calls ONLY this, keeping its own header rows/esc-footer unchanged.
//   - renderDocView({ title, body }, opts): a full-screen composition built
//     on top of bodyBox — one title row, the box, one footer row. This is
//     what the evidence reader (mode = 'docview') actually renders; nothing
//     else calls it (design.md Decision 3a: mode = 'docview' has exactly one
//     real caller, so its own `back` action always means "return to the
//     drill-down" — see routeHandleKey below).
//
// Neither export knows about tickets, evidence, or any other caller-specific
// concept (spec.md's "docview's exports are generic and reusable" — the only
// inputs are content lines / a { title, body } pair plus viewport/scroll
// options). `bodyLines`/`body` are already-wrapped content lines — this
// module does no markdown stripping or word-wrap of its own (that is each
// caller's own job: drilldown.js's ticketPanelLines already does this for
// the TICKET panel; watch.js's open-evidence-doc handler does it for the
// evidence reader — see design.md Decision 6).

const f = require('../format');
const layout = require('../layout');

// A bordered pane costs exactly 2 rows to its own top/bottom border,
// regardless of how many content rows sit between them — see
// fleet.js/drilldown.js/ticketview.js's identical BOX_BORDER_PADDING_COLS
// (the column-side equivalent of this).
const BOX_BORDER_ROWS = 2;

// renderDocView's own non-box overhead: one title row, a blank line under
// it, a blank line above the footer, and the footer row itself — four rows,
// plus the box's own two border rows (BOX_BORDER_ROWS) = 6 total. Sized once
// here so renderDocView's own composition and computeViewportRows (used by
// watch.js to pre-compute the SAME budget for the next keypress — see
// routeHandleKey below and watch.js's draw()) can never disagree about how
// many rows the chrome around the box actually costs.
const DOC_CHROME_ROWS = 4 + BOX_BORDER_ROWS;

// --- scrolling: shared by both exports, and by ticketview.js's own reuse ---

// clampScroll: pure, bounds a proposed scroll offset to [0, max(0,
// bodyLineCount - viewportRows)] — never negative, never past the point
// where the document's own last line would still be the last line shown.
function clampScroll(bodyLineCount, viewportRows, scrollOffset) {
  const max = Math.max(0, (bodyLineCount || 0) - Math.max(0, viewportRows || 0));
  return Math.max(0, Math.min(scrollOffset || 0, max));
}

// scrollDelta: pure, recognises the same scroll keys for every caller so no
// caller hardcodes '\x1b[5~'/'\x1b[6~' (page up/down) itself — the one place
// this codebase's scroll-key vocabulary is spelled out (design.md Decision
// 2). `viewportRows` resolves a page key to "one viewport's worth" of lines;
// both callers (this module's own handleKey, below, and ticketview.js's
// task 2.2 reuse) already know their own viewport budget by the point they
// call this.
function scrollDelta(key, viewportRows) {
  if (key === '\x1b[A' || key === 'k') return { lines: -1 };
  if (key === '\x1b[B' || key === 'j') return { lines: 1 };
  const page = Math.max(1, viewportRows || 1);
  if (key === '\x1b[5~') return { lines: -page };
  if (key === '\x1b[6~') return { lines: page };
  return null;
}

// --- bodyBox: the shared box-only core -------------------------------------

// Windows `bodyLines` to `viewportRows`, reserving exactly ONE of those rows
// for a "showing X-Y of N" position indicator (this codebase's existing "…
// N more" family — see drilldown.js's timelineLines/ticketPanelLines — bent
// here into a single row that works at every scroll position, above/below/
// both) whenever the document does not fit in one screen at all. The
// reservation is unconditional (not "1 or 2, depending on position") so the
// actual content window's own size never varies with scroll position —
// which is what keeps it consistent with clampScroll's own max-offset
// arithmetic below: a two-directional (only-reserve-what's-needed) version
// was tried and rejected during implementation — at the maximum scroll
// offset, reserving a row for "more above" alone shrinks the trailing
// content window by exactly one line, which (since clampScroll's own max is
// computed against the FULL viewportRows) either silently drops the
// document's true last line or spuriously claims more content exists below
// when none does. Reserving one row unconditionally sidesteps that
// inconsistency entirely: `contentRows` is fixed, so the offset that
// clampScroll computes and the window this function actually renders always
// agree on how many content rows are available. The indicator comes OUT OF
// the fixed viewport budget, not on top of it: `viewportRows` is a hard cap
// on rendered rows, matching a real terminal's own hard cap.
function windowBody(bodyLines, viewportRows, scrollOffset) {
  const total = bodyLines.length;
  const contentRows = Math.max(0, viewportRows - 1);
  const offset = clampScroll(total, contentRows, scrollOffset);
  const windowed = bodyLines.slice(offset, offset + contentRows);

  const out = windowed.slice();
  out.push(f.dim('… showing ' + (offset + 1) + '-' + (offset + windowed.length) + ' of ' + total));
  return out;
}

// bodyBox(bodyLines, opts) — opts: { width, viewportRows, scrollOffset,
// focused }. NO `title:` option is ever passed to layout.box() here (this
// codebase's single-pane convention — see escalation.js/ticketview.js, as
// distinct from drilldown.js's/launchpad.js's box-owns-its-title multi-panel
// convention) and no footer — that is renderDocView's job, below.
//
// Content that fits within `viewportRows` renders with NO windowing and NO
// indicator, at a box height sized to the content itself (content.length +
// 2), byte-identical to ticketview.js's pre-change, unbounded `pane()` call
// for that same content (design.md's own risk log; task 1.6). Only content
// that exceeds `viewportRows` is windowed down to fit it.
function bodyBox(bodyLines, opts) {
  const o = opts || {};
  const width = Math.max(0, o.width || 0);
  const viewportRows = Math.max(0, o.viewportRows || 0);
  const focused = !!o.focused;
  const lines = bodyLines || [];

  const content = lines.length <= viewportRows ? lines : windowBody(lines, viewportRows, o.scrollOffset || 0);
  const height = content.length + BOX_BORDER_ROWS;

  if (layout.degrade(width, height)) {
    return content.map((l) => f.truncate(l, width));
  }
  return layout.box(content, { width, height, focused });
}

// --- renderDocView: the full-screen composition -----------------------

// The viewport row budget renderDocView's own box gets, given the terminal's
// total row count (0/absent = unbounded — the same convention fleet.js's/
// launchpad.js's own `rows: 0` fallback already uses, and what lets a caller
// or test that omits `rows` see the whole document rendered in one box,
// matching every other screen's pre-existing behaviour when dimensions are
// unknown). Exported so watch.js's draw() can precompute the SAME budget
// ahead of the next keypress (routeHandleKey, below, needs it to resolve a
// page-up/page-down key — router.handleKey's own seam carries no `opts`, so
// this cannot be recomputed live at keypress time; see design.md Decision 2
// and watch.js's own `docViewportRows`).
function computeViewportRows(rows) {
  if (!(rows > 0)) return Infinity;
  return Math.max(0, Math.max(0, rows - 1) - DOC_CHROME_ROWS);
}

function footerLine(bodyLineCount, viewportRows, scrollOffset) {
  const hints = ['esc back'];
  if (bodyLineCount > viewportRows) {
    // Mirrors windowBody's own contentRows math exactly (one row of the
    // fixed viewportRows budget is always reserved for bodyBox's own
    // internal position indicator once windowed) — using the unreduced
    // `viewportRows` here would report a range one row wider than what
    // bodyBox actually rendered just above this footer.
    const contentRows = Math.max(0, viewportRows - 1);
    const offset = clampScroll(bodyLineCount, contentRows, scrollOffset);
    const start = offset + 1;
    const end = Math.min(bodyLineCount, offset + contentRows);
    hints.push(start + '-' + end + ' of ' + bodyLineCount);
  }
  return f.dim('  ' + hints.join('   '));
}

// renderDocView({ title, body }, opts) — opts: { cols, rows, scrollOffset }.
// Composes one plain-text title row, a bodyBox() call, and one footer row
// (esc back, plus a scroll position indicator when windowed) — delegating
// all content rendering to bodyBox rather than reimplementing box-drawing or
// windowing independently (spec.md's own requirement).
function renderDocView(doc, opts) {
  const o = opts || {};
  const cols = Math.max(40, o.cols || 80);
  const rows = o.rows || 0;
  const scrollOffset = o.scrollOffset || 0;
  const title = (doc && doc.title) || '';
  const body = (doc && doc.body) || [];

  const viewportRows = computeViewportRows(rows);

  const out = [];
  out.push(f.bold(f.truncate(title, cols)));
  out.push('');
  for (const line of bodyBox(body, { width: cols, viewportRows, scrollOffset, focused: false })) out.push(line);
  out.push('');
  out.push(footerLine(body.length, viewportRows, scrollOffset));

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// renderDocView's own handleKey(key, state) — state: { bodyLineCount,
// viewportRows, scrollOffset }. Scrolls via scrollDelta/clampScroll; `\x1b`
// (esc) returns a `back` action OPAQUE to this module — docview.js itself
// names no caller (design.md Decision 3a). See routeHandleKey below for how
// the router seam interprets both of these for the evidence reader
// specifically.
function handleKey(key, state) {
  const s = state || {};
  if (key === '\x1b') return { type: 'back' };
  const viewportRows = s.viewportRows != null ? s.viewportRows : Infinity;
  const delta = scrollDelta(key, viewportRows);
  if (!delta) return null;
  const next = clampScroll(s.bodyLineCount || 0, viewportRows, (s.scrollOffset || 0) + delta.lines);
  return { type: 'scroll', offset: next };
}

// --- router seam ---------------------------------------------------------
// mode = 'docview' is entered ONLY via the evidence reader's
// 'open-evidence-doc' action (design.md Decision 3a) — ticketview.js never
// enters this mode at all (it keeps its own mode = 'ticketview' and its own
// hardcoded esc routing; see ticketview.js's task 2.3). So the generic
// `back` action handleKey returns above always means "return to the
// drill-down" here, and is translated to that concrete action name.

function render(state, opts) {
  return renderDocView(
    { title: state.docTitle, body: state.docBody || [] },
    Object.assign({}, opts, { scrollOffset: state.docScroll || 0 }),
  );
}

function routeHandleKey(key, state) {
  const body = state.docBody || [];
  const action = handleKey(key, {
    bodyLineCount: body.length,
    viewportRows: state.docViewportRows != null ? state.docViewportRows : Infinity,
    scrollOffset: state.docScroll || 0,
  });
  if (!action) return null;
  if (action.type === 'back') return { type: 'back-to-drilldown-from-doc' };
  return { type: 'doc-scroll', offset: action.offset };
}

module.exports = {
  bodyBox, renderDocView, clampScroll, scrollDelta, handleKey,
  computeViewportRows, render, routeHandleKey, windowBody,
};
