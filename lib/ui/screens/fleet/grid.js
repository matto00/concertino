'use strict';

// Grid (two-column) mode for the fleet screen: the eligibility gate, its
// own windowing arithmetic (visibleWindowGrid), the per-section box
// renderer shared by banners and column 1 (renderStackedSection), and the
// grid-mode frame renderer (renderFleetGrid).

const f = require('../../format');
const layout = require('../../layout');
const { metricsColumnLines } = require('./metrics');
const {
  renderRun, renderFinishedRow, renderQueuedRow, renderQuickStartRow,
} = require('./rows');
const {
  BOX_BORDER_PADDING_COLS, bucketRuns, buildSections, buildHeadTail,
} = require('./sections');
const { computeWindow, sectionNaturalHeight } = require('./window');

// fleet-metrics-grid design: the two-column layout only engages at this
// width; below it, renderFleet is the single-column stack, unchanged.
// Exported so watch.js's scroll logic can use the exact same threshold —
// two implementations of "is this wide enough for grid mode" that could
// ever disagree is exactly the risk design.md's own precedent (e.g.
// buildHeadTail being the ONE head/tail-row-count implementation both the
// renderer and the height budget call) warns against.
const GRID_MIN_COLS = 110;
// Final whole-branch review, Finding 1: the height component of the
// grid-mode gate, alongside GRID_MIN_COLS' width component — METRICS'
// compact tier (metricsColumnLines) is a fixed 5 content lines + 2-row
// border, and renderFleetGrid's `layout.box` call silently drops content
// beyond that floor with no signal, so grid mode is only viable when the
// column area has at least this many rows. Exported (alongside
// gridModeEligible, below) so watch.js's scroll-accounting call sites —
// which must pick the exact same windowing function (visibleWindowGrid vs
// visibleWindow) the renderer will use THIS frame — apply the identical
// gate renderFleet does, not just its own width check.
const GRID_MIN_COLUMN_AREA_HEIGHT = 7;
// Column 1's fixed width in grid mode, regardless of total terminal width
// — see the design doc's "Sizing thresholds" section for why this is a
// constant rather than a proportional split.
const COLUMN_ONE_WIDTH = 70;

// The grid-mode counterpart to visibleWindow (fleet-metrics-grid design):
// NEEDS YOU and FAILED render as full-width banners above a two-column
// area (column 1: RUNNING/QUICK START/QUEUED/DONE stacked at a fixed
// width; column 2: METRICS filling the rest), so height/scroll accounting
// can no longer be one flat sequential sum the way visibleWindow's is —
// METRICS renders BESIDE column 1, not below it, and FAILED (now a
// banner, not part of column 1's own scrollable stack) is capped but
// never scrolled or trimmed, the same "always shows, never adjusts"
// treatment NEEDS YOU already gets. Same public shape as visibleWindow —
// one entry per buildSections() section, same order — so callers
// (renderFleet's grid branch, watch.js's scroll logic) can use either
// function interchangeably depending on `opts.cols`.
function visibleWindowGrid(runs, opts) {
  const totalRows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const queueState = (opts && opts.queueState) || null;
  const cols = Math.max(40, (opts && opts.cols) || 80);

  const buckets = bucketRuns(runs);
  const allSections = buildSections(buckets, queueState, opts);

  const needsYouSection = allSections.find((s) => s.kind === 'needs-you');
  const failedSection = allSections.find((s) => s.kind === 'failed');
  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');

  const needsYouShown = needsYouSection ? needsYouSection.group.length : 0;
  const failedWindow = failedSection
    ? layout.selectionWindow(failedSection.group.length, 0, failedSection.cap, 0)
    : { start: 0, count: 0 };
  const failedShown = failedWindow.count;
  const failedHidden = failedSection ? failedSection.group.length - failedShown : 0;

  const needsYouHeight = needsYouSection ? sectionNaturalHeight(needsYouSection, needsYouShown, needsYouSection.group.length, cols) : 0;
  const failedHeight = failedSection ? sectionNaturalHeight(failedSection, failedShown, failedSection.group.length, cols) : 0;

  const { head, tail } = buildHeadTail(runs, opts);
  // The "-1" mirrors computeWindow's own `budget = rows > 0 ? rows - 1 : 0`
  // — one row reserved for the trailing newline the writer appends,
  // applied ONCE where raw terminal rows become a usable budget. Applied
  // here (not inside computeWindow's own call below, which already gets a
  // pre-netted `columnAreaHeight` and must not reserve a second row on
  // top of it) so the whole page's height accounting has exactly one
  // place that does this subtraction, matching every other budget
  // computation in this file.
  const pageBudget = totalRows > 0 ? totalRows - 1 : 0;
  const columnAreaHeight = Math.max(0, pageBudget - head.length - tail.length - needsYouHeight - failedHeight);

  // FAILED and NEEDS YOU still occupy the flat row-index space `selected`
  // lives in (the one renderFleet builds, watch.js's `runs[selected]`
  // indexes, and Task 8's renderer reproduces via its own
  // sectionStartIndices walk), but computeWindow re-bases its internal
  // globalIndex at 0 over whatever section list it's handed — so a raw
  // global `selected` handed to a RESTRICTED columnSections list would be
  // off by however many rows NEEDS YOU/FAILED occupy ahead of it,
  // corrupting both the selected-row trim protection and
  // firstVisibleIndex/lastVisibleIndex. Translate in here, and translate
  // computeWindow's returned indices back out below.
  const columnIndexBase = (needsYouSection ? needsYouSection.group.length : 0) +
    (failedSection ? failedSection.group.length : 0);

  const columnWindow = computeWindow(runs, columnSections, {
    rows: columnAreaHeight > 0 ? columnAreaHeight + 1 : 0,
    // computeWindow clamps a negative `selected` to 0, which is correct
    // here too — a selection that's actually inside a banner (NEEDS YOU/
    // FAILED) needs no scroll adjustment in column 1 either way.
    selected: selected - columnIndexBase,
    scrollOffset, includeHeadTail: false,
  });

  // computeWindow's own `rows: 0` contract means "unbounded, don't trim" —
  // exactly what other callers need for a structural, height-independent
  // maxScrollOffset (see computeWindow's own header comment), and exactly
  // what `visibleWindowGrid` must ALSO still honour when the CALLER passed
  // `rows: 0`/omitted `rows` (a deliberate structural-only query — e.g.
  // watch.js's every-draw scrollOffset re-clamp, and this file's own
  // "visibleWindowGrid with rows:0 returns an unbounded (untrimmed) window"
  // test) — but NOT what column 1 should do when a REAL, positive row
  // budget was given and the column area still nets out to genuinely zero
  // rows (banners consuming the whole page). Both cases compute
  // `columnAreaHeight === 0` (pageBudget is 0 either way when totalRows is
  // 0), so `columnAreaHeight` alone cannot tell them apart — `totalRows > 0`
  // is the one fact that distinguishes "the caller gave a real budget and
  // it was consumed entirely by banners" from "the caller asked for an
  // unbounded structural query". Passed straight through in the former
  // case, `rows: 0` renders column 1 at its full, untrimmed natural height
  // instead of collapsing, which can make a SHORTER terminal produce a
  // LONGER frame than a slightly taller one (columnAreaHeight going from 1
  // to 0) — the opposite of what a height budget is for. Force the real
  // collapse only in that case — one shown:0/hidden:full entry per column
  // section, which renderStackedSection already renders as a single "… and
  // N more" line for a section with rows to hide (per its own group.length-
  // first branch: a forceRender-empty section like METRICS renders a FULL
  // BOX instead, and a non-forceRender empty section renders nothing at
  // all) — while still reusing columnWindow's own maxScrollOffset below,
  // unaffected by this either way (a structural property of `runs`/
  // MAX_FINISHED alone, per computeWindow's own contract).
  const columnSectionWindows = (totalRows > 0 && columnAreaHeight === 0)
    ? columnSections.map((s) => ({ shown: 0, startOffset: 0, hidden: s.group.length }))
    : columnWindow.sections;

  // Nothing in column 1 actually rendered this frame — either because we
  // just forced the collapse above, or because computeWindow's own trim
  // loop collapsed every section on its own. There is then no real
  // column-1 window to translate into the global flat-index space via
  // columnIndexBase — doing so anyway (the pre-fix behaviour) reports a
  // bogus "first visible row" (columnIndexBase itself) that corresponds to
  // nothing actually on screen. Report the same "nothing to scroll toward
  // or away from" sentinel computeWindow itself falls back to in this
  // situation (its own header comment, above) instead, left untranslated.
  const columnNothingVisible = columnSectionWindows.every((w) => w.shown === 0);

  let columnCursor = 0;
  const sections = allSections.map((s) => {
    if (s.kind === 'needs-you') return { shown: needsYouShown, startOffset: 0, hidden: 0 };
    if (s.kind === 'failed') return { shown: failedShown, startOffset: failedWindow.start, hidden: failedHidden };
    if (s.kind === 'metrics') return { shown: 0, startOffset: 0, hidden: 0 };
    const w = columnSectionWindows[columnCursor];
    columnCursor++;
    return w;
  });

  return {
    sections,
    // Translated back into the global flat-index space (see
    // columnIndexBase above) — maxScrollOffset does NOT need translation,
    // it's a count/offset, not an absolute index.
    firstVisibleIndex: columnNothingVisible ? 0 : columnWindow.firstVisibleIndex + columnIndexBase,
    lastVisibleIndex: columnNothingVisible ? Math.max(0, runs.length - 1) : columnWindow.lastVisibleIndex + columnIndexBase,
    maxScrollOffset: columnWindow.maxScrollOffset,
    // Exposed so renderFleetGrid (Task 8) sizes METRICS' box against the
    // EXACT SAME value that decided column 1's own trim — never a second,
    // independently-recomputed columnAreaHeight that could drift by even
    // one row and reintroduce the scroll-by-one bug the "-1" above exists
    // to prevent.
    columnAreaHeight,
  };
}

// Final whole-branch review, Finding 1: the single source of truth for
// "will THIS frame actually render in grid mode" — width alone
// (`cols >= GRID_MIN_COLS`) is necessary but not sufficient; the column
// area also needs room for METRICS' compact-tier floor
// (GRID_MIN_COLUMN_AREA_HEIGHT, above). Shared by renderFleet (which
// inlines the equivalent check itself, since it also wants to keep the
// computed `visibleWindowGrid` result to avoid a second call — see its own
// header comment) and watch.js's scroll-accounting call sites, which only
// need the boolean. The two must never disagree about which mode is
// actually on screen this frame, or a `scrollOffset`/`maxScrollOffset`
// computed against grid mode's own (FAILED-excluded, banner-adjusted)
// accounting could be applied to a frame that actually rendered
// single-column (where FAILED IS part of the scrollable flat list) —
// exactly the kind of two-implementations-that-could-drift risk
// design.md's own precedent (e.g. buildHeadTail) warns against.
//
// `opts.rows` must be the REAL row count this frame will actually render
// at — passing `rows: 0` here always reports `false` (columnAreaHeight
// computes to 0 whenever the page budget is 0), which is correct for
// "would a 0-row frame fit grid mode" but not what a caller wants if it
// separately relies on `rows: 0` as a rows-independent structural query
// (visibleWindow's/visibleWindowGrid's own documented `rows: 0` contract,
// used for e.g. a structural `maxScrollOffset`) — such callers must decide
// eligibility against the real row count first, then make that separate
// `rows: 0` call afterward.
function gridModeEligible(runs, opts) {
  const cols = (opts && opts.cols) || 80;
  if (cols < GRID_MIN_COLS) return false;
  return visibleWindowGrid(runs, opts).columnAreaHeight >= GRID_MIN_COLUMN_AREA_HEIGHT;
}

// Grid mode's per-section box renderer (fleet-metrics-grid design) — used
// for NEEDS YOU/FAILED banners and column 1's RUNNING/QUICK START/QUEUED/
// DONE boxes. Deliberately NOT shared with renderFleet's own per-section
// loop below: that loop's last-section grow-to-fill behavior does not
// apply here (only the two-column area as a WHOLE grows, via
// layout.hsplit padding column 1 out to METRICS' height — see the design
// doc) — every section this function draws is always at its own natural
// height. `w`: `{shown, startOffset, hidden}` for this section (from
// computeWindow/visibleWindowGrid). `ctx`: `{ cols, avgDoneMs, selected,
// sectionStartIndex, queuedTitles, queueFocus, quickStartFocus, focus,
// queueLaunchInfo, searchQuery }` — `searchQuery` (CON-110) is the active
// search query string, forwarded through to every row-renderer call below
// exactly like renderFleet's own single-column loop does, so grid mode can
// never silently fail to highlight a match (see this file's own header
// comment for the CON-40 precedent this mistake would otherwise repeat).
function renderStackedSection(s, jumpNumber, w, ctx) {
  const cols = ctx.cols;
  const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
  const numberedTitle = `[${jumpNumber}] ${s.title}`;
  const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);

  if (!s.group.length) {
    if (!s.forceRender) return [];
    const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
    if (layout.degrade(cols, contentLines.length + 2)) {
      return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
    }
    return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
  }

  if (w.shown === 0) {
    return ['      ' + f.dim(`… and ${w.hidden} more ${s.title.toLowerCase()}`)];
  }

  const contentLines = [];
  for (let k = w.startOffset; k < w.startOffset + w.shown; k++) {
    const rowIndex = ctx.sectionStartIndex + k;
    if (s.kind === 'queued') {
      const ticket = s.group[k];
      const title = ctx.queuedTitles ? ctx.queuedTitles.get(ticket) : null;
      const focused = ctx.focus === 'queue' && ctx.queueFocus === k;
      const multiSelected = ctx.multiSelect ? ctx.multiSelect.queued.has(ticket) : false;
      for (const line of renderQueuedRow(ticket, k + 1, title, innerCols, {
        focused, speed: ctx.queueLaunchInfo && ctx.queueLaunchInfo.speed,
        agentMerge: ctx.queueLaunchInfo ? ctx.queueLaunchInfo.agentMerge : null,
        searchQuery: ctx.searchQuery, multiSelected,
      })) contentLines.push(line);
    } else if (s.kind === 'quickstart') {
      const ticket = s.group[k];
      const focused = ctx.focus === 'quickstart' && ctx.quickStartFocus === k;
      for (const line of renderQuickStartRow(ticket, focused, innerCols, ctx.searchQuery)) contentLines.push(line);
    } else if (s.kind === 'failed' || s.kind === 'done') {
      const multiSelected = s.kind === 'failed' && ctx.multiSelect
        ? ctx.multiSelect.failed.has(s.group[k].ticket) : false;
      for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs, searchQuery: ctx.searchQuery, multiSelected }, rowIndex === ctx.selected)) contentLines.push(line);
    } else {
      for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs: ctx.avgDoneMs, searchQuery: ctx.searchQuery }, rowIndex === ctx.selected)) contentLines.push(line);
    }
  }
  if (w.hidden) contentLines.push('      ' + f.dim(`… and ${w.hidden} more`));

  if (layout.degrade(cols, contentLines.length + 2)) {
    return ['  ' + colourTitle(numberedTitle), ...contentLines, ''];
  }
  return layout.box(contentLines, { width: cols, title: colourTitle(numberedTitle), focused: false });
}

// The two-column grid renderer (fleet-metrics-grid design): NEEDS YOU and
// FAILED as full-width banners, RUNNING/QUICK START/QUEUED/DONE stacked in
// a fixed-width column 1, METRICS filling a full-height column 2. Composes
// layout.hsplit over two independently-built panes rather than inventing
// new box-composition machinery.
function renderFleetGrid(runs, ctx) {
  const {
    cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
    queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets, searchQuery,
  } = ctx;
  // CON-109, fleet-bulk-select spec: mirrors render.js's own default —
  // grid mode's row loop (renderStackedSection, above) needs the identical
  // `{ failed: Set, queued: Set }` shape single-column mode already reads.
  const multiSelect = ctx.multiSelect || { failed: new Set(), queued: new Set() };

  const { head, tail } = buildHeadTail(runs, augmentedOpts);
  // Final whole-branch review, Finding 1: `renderFleet`'s grid-mode gate
  // (above) already computed this exact window to decide whether to call
  // this function at all — reuse it (`ctx.win`) rather than recomputing a
  // second time, so the decision and the render can never drift by even one
  // row. Falls back to computing it fresh only for direct callers/tests
  // that invoke `renderFleetGrid` without going through that gate.
  const win = ctx.win || visibleWindowGrid(runs, augmentedOpts);
  const allSections = buildSections(buckets, queueState, augmentedOpts);

  // sectionStartIndex per section, walking the FULL canonical order — the
  // same accumulation renderFleet's single-column loop and
  // sectionJumpTargets both already do, so `selected`'s meaning never
  // disagrees between single-column and grid mode.
  let flatIndex = 0;
  const sectionStartIndices = allSections.map((s) => {
    const start = s.unselectable ? null : flatIndex;
    if (!s.unselectable) flatIndex += s.group.length;
    return start;
  });

  const rowCtx = { avgDoneMs, selected, queuedTitles, queueFocus, quickStartFocus, focus, queueLaunchInfo, searchQuery, multiSelect };
  let jumpNumber = 0;
  const out = head.slice();

  allSections.forEach((s, i) => {
    if (s.kind !== 'needs-you' && s.kind !== 'failed') return;
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols, sectionStartIndex: sectionStartIndices[i] }))) out.push(line);
  });

  const columnSections = allSections.filter((s) =>
    s.kind === 'running' || s.kind === 'quickstart' || s.kind === 'queued' || s.kind === 'done');
  const metricsSection = allSections.find((s) => s.kind === 'metrics');

  // Read directly off `win` — NEVER recompute this independently. It must
  // be the exact value visibleWindowGrid used to decide column 1's own
  // trim, or METRICS' box height and column 1's actual rendered height can
  // drift by a row and reintroduce the scroll-by-one bug the codebase's
  // "-1 for the trailing newline" convention exists to prevent.
  const columnAreaHeight = win.columnAreaHeight;

  const col1Lines = [];
  columnSections.forEach((s) => {
    const i = allSections.indexOf(s);
    if (!(s.group.length > 0 || s.forceRender)) return;
    jumpNumber += 1;
    for (const line of renderStackedSection(s, jumpNumber, win.sections[i],
      Object.assign({}, rowCtx, { cols: COLUMN_ONE_WIDTH, sectionStartIndex: sectionStartIndices[i] }))) col1Lines.push(line);
  });

  // No Math.max(40, ...) floor here (unlike other width computations in
  // this file): `cols >= GRID_MIN_COLS` (110) is already guaranteed by the
  // branch in renderFleet that calls this function, so this is always
  // `>= 39` — comfortably above layout.MIN_BOX_WIDTH (8), so layout.degrade
  // below still engages correctly whenever the terminal is genuinely too
  // narrow. A floor here was a bug, not a safety net: at cols === 110 (the
  // GRID_MIN_COLS threshold itself — the width a user resizing into grid
  // mode is most likely to land on), flooring to 40 makes the composed
  // hsplit row 70 + 1 + 40 = 111 columns wide against a 110-column budget,
  // so the final `f.truncate(l, cols)` below strips METRICS' own right
  // border and stamps a stray ellipsis on every line.
  const metricsWidth = cols - COLUMN_ONE_WIDTH - 1;
  let metricsLines = [];
  if (metricsSection) {
    jumpNumber += 1;
    const metricsInner = Math.max(0, metricsWidth - BOX_BORDER_PADDING_COLS);
    const metricsContentRows = Math.max(0, columnAreaHeight - 2);
    const content = metricsColumnLines(metrics, { cols: metricsInner, contentRows: metricsContentRows });
    const metricsColour = f.STATUS_COLOUR.metrics || ((x) => x);
    const numberedTitle = `[${jumpNumber}] ${metricsSection.title}`;
    metricsLines = layout.degrade(metricsWidth, columnAreaHeight)
      ? ['  ' + metricsColour(numberedTitle), ...content]
      : layout.box(content, { width: metricsWidth, height: columnAreaHeight, title: metricsColour(numberedTitle), focused: false });
  }

  for (const line of layout.hsplit([
    { lines: col1Lines, width: COLUMN_ONE_WIDTH },
    { lines: metricsLines, width: metricsWidth },
  ])) out.push(line);

  for (const line of tail) out.push(line);
  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

module.exports = {
  GRID_MIN_COLS, GRID_MIN_COLUMN_AREA_HEIGHT, COLUMN_ONE_WIDTH,
  visibleWindowGrid, gridModeEligible, renderStackedSection, renderFleetGrid,
};
