'use strict';

// The side-by-side run-comparison screen (CON-114). Once exactly two DONE
// runs are marked for comparison (lib/ui/compare-selection.js, and the
// archive/fleet screens' own marking affordances), `c` opens this screen —
// two narrower TIMELINE/GATES columns, one per marked run, plus a duration/
// delta header. Reached from either the archive screen's list zone or
// fleet's DONE section; `esc` returns to whichever it was opened from
// (S.compareReturnMode — see controllers/compare.js and controllers/
// archive.js / controllers/fleet.js's own 'open-compare' handling).
//
// Pure: (state, opts) -> string / (key, state) -> action | null — the same
// router seam every other screen uses.
//
// design.md Decision 2: this screen's own TIMELINE/GATES rendering
// (compareTimelineLines/compareGatesLines below) is deliberately NOT
// drilldown.js's timelineLines/gatesLines reused verbatim at a narrower
// width — the drill-down's line format bakes in a fixed 12-column role
// field and a duration-column budget sized for one full-width run, both of
// which read as cramped (not merely narrower) at compare's roughly-half-
// terminal column budget. `describeEvent`/`fmtGateDuration` ARE reused
// as-is from drilldown.js (imported below) — only the line-assembly width/
// column budget differs here, never the event-to-text mapping itself.

const f = require('../format');
const layout = require('../layout');
const docview = require('./docview');
const icons = require('../icons');
const drilldown = require('./drilldown');
const { sectionHeader } = require('../widgets/header');
const footer = require('../widgets/footer');

// Every box costs 2 columns to its border characters and 2 more to box()'s
// default horizontal padding — see fleet.js/drilldown.js/docview.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;
// hsplit()'s own one-column gap between the two columns.
const GAP = 1;

// Each column's own fixed scroll viewport (design.md Decision 2 / tasks.md
// 4.6: "each column's independent scroll state") — a single scrollable
// region per column holding TIMELINE stacked over GATES, not four
// independently-scrolling sub-panels the way drilldown.js's four focusable
// panels are. Mirrors drilldown's own fixed TIMELINE_VIEWPORT_ROWS/
// GATES_VIEWPORT_ROWS precedent (a fixed budget, not derived from terminal
// height).
const COLUMN_VIEWPORT_ROWS = 20;

function hhmm(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// compareTimelineLines(run, width): the same event-history rendering
// drilldown.js's timelineLines produces, but with a compact 3-character
// role abbreviation instead of a full 12-column role field (design.md
// Decision 2) — `describeEvent` (imported from drilldown.js) supplies the
// identical label/detail text either screen shows for the same event, so a
// compare column never describes an event differently than a drill-down
// would.
function compareTimelineLines(run, width) {
  const events = (run && run.events) || [];
  if (!events.length) {
    return [f.yellow('no events recorded')];
  }
  const lines = [];
  for (const ev of events) {
    const role = ev.role || 'script';
    const colour = f.ROLE_COLOUR[role] || f.dim;
    const roleAbbrev = colour(f.padTo(role.slice(0, 3), 3));
    const time = hhmm(ev.t) || '--:--';
    const { label, detail } = drilldown.describeEvent(ev);
    let line = time + ' ' + roleAbbrev + ' ' + label;
    if (detail) line += ' ' + f.dim(detail);
    lines.push(f.truncate(line, width));
  }
  return lines;
}

// compareGateLine/compareGatesLines(run, width): the same icon/name/
// duration shape drilldown.js's own gateLine/gatesLines produce —
// `fmtGateDuration` is reused as-is (design.md Decision 2: "it's already
// compact") — plus the same indented first-error convention (tasks.md 4.5 /
// spec.md's "a gate's first error is shown when present").
function compareGateLine(gate, width) {
  const icon = gate.status === 'pass' ? f.STATUS_COLOUR.pass('✓')
    : gate.status === 'fail' ? f.STATUS_COLOUR.fail('✗') : f.dim('○');
  const durStr = drilldown.fmtGateDuration(gate.durationMs);
  const nameWidth = Math.max(1, width - 2 - f.visibleLength(durStr) - 1);
  const name = f.padTo(gate.name || '?', nameWidth);
  return icon + ' ' + name + ' ' + durStr;
}

function compareGatesLines(run, width) {
  const gates = (run && run.gates) || [];
  if (!gates.length) {
    return [f.yellow('no gate results recorded')];
  }
  const lines = [];
  for (const g of gates) {
    lines.push(compareGateLine(g, width));
    if (g.firstError) lines.push(f.dim('  └ ' + f.truncate(g.firstError, Math.max(0, width - 4))));
  }
  return lines;
}

// One column's full content: TIMELINE stacked over GATES, each under its
// own labelled sub-header (icons reused from drilldown's own TIMELINE/GATES
// panel icons, per dashboard-iconography's shared vocabulary).
function columnLines(run, width) {
  const lines = [];
  lines.push(sectionHeader({ icon: icons.timeline, label: 'TIMELINE', colour: f.bold }));
  for (const l of compareTimelineLines(run, width)) lines.push(l);
  lines.push('');
  lines.push(sectionHeader({ icon: icons.gates, label: 'GATES', colour: f.bold }));
  for (const l of compareGatesLines(run, width)) lines.push(l);
  return lines;
}

// Draws a single column through layout.box(), or — below layout.degrade()'s
// threshold — falls back to a plain, unbordered rendering rather than a
// border that would itself have to be truncated into illegibility. Mirrors
// drilldown.js's own `pane` helper exactly; not exported there, so a small,
// self-contained copy lives here (the same "own narrower rendering, not a
// truncated reuse" spirit design.md Decision 2 applies to the content
// itself extends to this presentation helper too).
function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    const out = [];
    if (opts.title) out.push(f.truncate(opts.title, opts.width));
    for (const line of contentLines) out.push(f.truncate(line, opts.width));
    return out;
  }
  return layout.box(contentLines, opts);
}

// The two marked runs, in insertion order (design.md Decision 1: "insertion
// order preserved for consistent left/right assignment") — `null` for a
// ticket no longer present in `state.runs` (pruned by retention between
// marking and opening compare), handled by the render call site's own
// "no longer available" fallback rather than throwing.
function resolveCompareRuns(state) {
  const sel = (state && state.compareSelection) || [];
  const runs = (state && state.runs) || [];
  return sel.map((ticket) => runs.find((r) => r.ticket === ticket) || null);
}

// tasks.md 4.4: each run's total duration (`f.dur`, matching drilldown's
// own elapsedText convention so the numbers read identically to the
// drill-down's), plus the absolute difference between the two.
function durationHeaderLine(runA, runB) {
  const durA = f.dur(runA.elapsedMs);
  const durB = f.dur(runB.elapsedMs);
  let deltaText = '';
  if (runA.elapsedMs != null && runB.elapsedMs != null) {
    deltaText = '   Δ ' + f.dur(Math.abs(runA.elapsedMs - runB.elapsedMs));
  }
  return f.bold(runA.ticket) + '  ' + durA + '    vs    ' + f.bold(runB.ticket) + '  ' + durB + deltaText;
}

function renderCompare(state, opts) {
  const s = state || {};
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const [runA, runB] = resolveCompareRuns(s);

  const out = [];
  out.push(f.bold('concertino') + f.dim(' · compare'));
  out.push('');

  // The run vanished (retention pruned it) or fewer than two are actually
  // resolvable — render safely rather than throw (mirrors drilldown.js's
  // own "run no longer available" fallback).
  if (!runA || !runB) {
    out.push('  ' + f.yellow('one or both marked runs are no longer available'));
    out.push('');
    for (const line of footer.footer({ hints: ['esc back'], cols }).lines) out.push(line);
    return out.map((l) => f.truncate(l, cols)).join('\n');
  }

  out.push(f.truncate(durationHeaderLine(runA, runB), cols));
  out.push('');

  const colWidth = Math.max(20, Math.floor((cols - GAP) / 2));
  const innerWidth = Math.max(10, colWidth - BOX_BORDER_PADDING_COLS);

  const focus = (opts && opts.focus) === 'right' ? 'right' : 'left';
  const leftScroll = Math.max(0, (opts && opts.leftScroll) || 0);
  const rightScroll = Math.max(0, (opts && opts.rightScroll) || 0);

  const leftAll = columnLines(runA, innerWidth);
  const rightAll = columnLines(runB, innerWidth);
  const leftContent = leftAll.length <= COLUMN_VIEWPORT_ROWS
    ? leftAll : docview.windowBody(leftAll, COLUMN_VIEWPORT_ROWS, leftScroll);
  const rightContent = rightAll.length <= COLUMN_VIEWPORT_ROWS
    ? rightAll : docview.windowBody(rightAll, COLUMN_VIEWPORT_ROWS, rightScroll);

  // Height reconciliation is the caller's job (mirrors drilldown.js's own
  // discipline) — whichever column is naturally shorter gets padded, via
  // box()'s own `height` option, up to the taller column's total.
  const height = Math.max(leftContent.length, rightContent.length) + 2;
  const leftBox = pane(leftContent, { width: colWidth, height, title: runA.ticket, focused: focus === 'left' });
  const rightBox = pane(rightContent, { width: colWidth, height, title: runB.ticket, focused: focus === 'right' });

  for (const line of layout.hsplit([
    { lines: leftBox, width: colWidth },
    { lines: rightBox, width: colWidth },
  ])) out.push(line);
  out.push('');

  const hints = ['tab/←/→ switch column', '↑/↓ scroll', 'esc back'];
  for (const line of footer.footer({ hints, cols }).lines) out.push(line);

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// Given a keypress and the local screen state ({ compareFocus }), returns an
// action for watch.js to carry out, or null for "no-op, no redraw". Never
// mutates, same seam as drilldown.js/docview.js.
function handleKey(key, state) {
  const s = state || {};
  // tasks.md 4.7: esc dispatches a screen-specific action — not the generic
  // `back` drilldown uses — so its controller can route to 'archive' or
  // 'fleet' without touching drilldown's own unconditional-to-fleet
  // behaviour (design.md Decision 3 / Non-Goals).
  if (key === '\x1b') return { type: 'back-to-origin-from-compare' };

  const focus = s.compareFocus === 'right' ? 'right' : 'left';

  if (key === '\t') return { type: 'switch-compare-focus', focus: focus === 'left' ? 'right' : 'left' };
  if (key === '\x1b[C') return { type: 'switch-compare-focus', focus: 'right' }; // right arrow
  if (key === '\x1b[D') return { type: 'switch-compare-focus', focus: 'left' };  // left arrow

  if (key === 'j' || key === '\x1b[B') return { type: 'compare-scroll', column: focus, delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'compare-scroll', column: focus, delta: -1 };
  if (key === '\x1b[5~') return { type: 'compare-scroll', column: focus, delta: -5 };
  if (key === '\x1b[6~') return { type: 'compare-scroll', column: focus, delta: 5 };

  return null;
}

// Uniform router seam: state.compareSelection/state.runs pick the two runs
// this screen shows, so it always reflects the latest poll rather than a
// snapshot taken when the screen was opened.
function render(state, opts) {
  return renderCompare(state, Object.assign({}, opts, {
    leftScroll: state.compareLeftScroll,
    rightScroll: state.compareRightScroll,
    focus: state.compareFocus,
  }));
}

function routeHandleKey(key, state) {
  return handleKey(key, { compareFocus: state.compareFocus });
}

module.exports = {
  compareTimelineLines, compareGatesLines,
  renderCompare, handleKey, render, routeHandleKey,
};
