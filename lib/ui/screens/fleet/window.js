'use strict';

// Scroll/viewport math for the fleet screen: per-section natural heights,
// the Stage A/B windowing core (computeWindow) and its single-column
// wrapper (visibleWindow).

const layout = require('../../layout');
const { renderRun } = require('./rows');
const {
  BOX_BORDER_PADDING_COLS, bucketRuns, buildSections, buildHeadTail,
} = require('./sections');

// Stage A (design.md Decision 2): scroll-windows every selectable, non-
// pinned section (FAILED/RUNNING/DONE) by opts.scrollOffset, walked in
// render order. NEEDS YOU is pinned — it still consumes its own slice of the
// flat selectable-index space (`selected` can land on one of its rows) but
// never consumes scrollOffset's "remaining rows to skip" budget, and always
// shows in full (design.md Decision 4). QUEUED is unselectable and stays
// out of both accountings entirely (design.md Decision 1), unaffected.
//
// Stage B (design.md Decision 3): the whole-frame height budget, trimming
// from the bottom section upward exactly as today — except a section that
// currently holds `opts.selected` within its shown window is trimmed from
// whichever edge is FARTHER from `selected`, never past the point that
// would evict it (the accepted exception being total collapse, when even
// one row cannot fit — see design.md Decision 3's final paragraph).
//
// Returns { sections: [{ shown, startOffset, hidden }, ...] } — one entry
// per section, same order/length as buildSections' own output (including
// QUEUED's, unaffected) — plus firstVisibleIndex/lastVisibleIndex (the
// selectable-index range actually rendered this frame) and maxScrollOffset
// (a structural property of `runs`/MAX_FINISHED alone, NOT of opts.rows —
// see below — so callers that only need it, e.g. watch.js's every-draw()
// re-clamp, can pass rows: 0 safely and cheaply).
//
// The Stage A/B trim-loop core of visibleWindow (below), extracted so
// grid-mode rendering (visibleWindowGrid, Task 7) can run the identical
// scroll/trim arithmetic over a DIFFERENT, restricted section list (just
// column 1's own sections) and a DIFFERENT row budget (the column area's
// height, not the whole terminal) — without a second, drifting
// implementation of this trim loop. See the Stage A/B paragraphs above for
// what Stage A/B actually do; nothing about that logic changed here, only
// which `sections`/`runs` it's handed and whether it accounts for the page
// header/footer.
//
// A section's own natural rendered height for a given `shown` count — one
// implementation, used both by computeWindow's height-budget trim loop
// (below) and by visibleWindowGrid's banner-height accounting (NEEDS YOU/
// FAILED render as banners outside computeWindow's own trim loop, but still
// need this exact same math to size the column area's height budget), so
// the two can never silently diverge (mirrors this file's existing
// "one implementation, used both to print and to size the budget"
// convention — see buildHeadTail's own header comment, and
// renderStackedSection's "must stay in lockstep with sectionHeight" note).
function sectionNaturalHeight(s, shown, groupLen, cols) {
  // CON-40: a `forceRender`-flagged, zero-eligible QUICK START still costs
  // exactly one hint content line plus its 2-row border (design.md
  // Decision 4, mechanism step 2; tasks.md 2.6) — it stays truthfully
  // accounted for in the height-budget trim loop below rather than being
  // invisible to it. Every other section's `forceRender` is `undefined`
  // (falsy), so this is a no-op change for them: `!groupLen` alone still
  // governs their existing "costs nothing" behaviour exactly as before.
  // The lazygit-layout pass established 3 = one emptyHint content line +
  // 2-row border. Generalized here to N content lines via `emptyLines` —
  // METRICS now uses 5; QUICK START (see its own `sections.push` entry in
  // buildSections, above) still passes a single `emptyHint` string,
  // covered by the `[s.emptyHint]` fallback (additive, not a breaking
  // rename).
  if (!groupLen) return s.forceRender ? (s.emptyLines || [s.emptyHint]).length + 2 : 0;
  if (shown === 0) return 1;
  // CON-53: NEEDS YOU rows can now wrap the escalation question onto
  // multiple lines, so the flat `linesPerRow * shown` estimate can
  // under-count this section's real height and under-trim the sections
  // below it. Sum each run's actual rendered line count instead — reusing
  // renderRun() itself (rather than a second, parallel line-counting
  // formula) guarantees this can never drift from what the real render
  // pass actually emits. `innerCols` must match the real render pass's own
  // derivation exactly (fleet.js's renderRun call site, `{ cols: innerCols
  // }`) — the un-reduced `cols` would estimate against a 4-column-wider
  // budget than what's actually rendered.
  if (s.kind === 'needs-you') {
    const innerCols = Math.max(0, (cols || 80) - BOX_BORDER_PADDING_COLS);
    const lineCount = s.group.reduce(
      (n, run) => n + renderRun(run, { cols: innerCols }, false).length, 0);
    return 2 + lineCount + (groupLen > shown ? 1 : 0);
  }
  return 2 + s.linesPerRow * shown + (groupLen > shown ? 1 : 0);
}

// `opts.includeHeadTail` (default true): when false, skips buildHeadTail's
// row count entirely — used by grid mode, which has already netted out
// the header/footer when it computed the column area's own height budget,
// and would otherwise double-subtract them.
function computeWindow(runs, sections, opts) {
  const rows = (opts && opts.rows) || 0;
  const selected = Math.max(0, (opts && opts.selected) || 0);
  const scrollOffset = Math.max(0, (opts && opts.scrollOffset) || 0);
  const includeHeadTail = !(opts && opts.includeHeadTail === false);
  const cols = Math.max(40, (opts && opts.cols) || 80);

  let remaining = scrollOffset;
  let globalIndex = 0;
  const win = sections.map((s) => {
    const groupLen = s.group.length;
    if (s.unselectable) {
      const shown = Math.min(groupLen, s.cap);
      return { shown, startOffset: 0, hidden: groupLen - shown, sectionStartIndex: null };
    }
    const sectionStartIndex = globalIndex;
    let startOffset = 0;
    let shown;
    if (s.pinned) {
      shown = groupLen; // NEEDS YOU: never capped, never scrolled.
    } else if (remaining >= groupLen) {
      // Entirely scrolled past — nothing of this section renders this frame.
      remaining -= groupLen;
      shown = 0;
      startOffset = groupLen;
    } else if (remaining > 0) {
      // The offset lands inside this section: render from its mid-group
      // startOffset up to `cap` further rows — the shared selectionWindow
      // helper computes this identically (selection pinned at `remaining`,
      // its own local offset), so this is the same arithmetic as the
      // `else` branch just below, not a second implementation.
      const win = layout.selectionWindow(groupLen, remaining, s.cap, remaining);
      startOffset = win.start;
      shown = win.count;
      remaining = 0;
    } else {
      // Reached (remaining already 0): render from its own start, as today.
      const win = layout.selectionWindow(groupLen, 0, s.cap, 0);
      shown = win.count;
    }
    globalIndex += groupLen;
    return { shown, startOffset, hidden: groupLen - shown, sectionStartIndex };
  });

  const headTailRows = includeHeadTail ? (() => {
    const { head, tail } = buildHeadTail(runs, opts);
    return head.length + tail.length;
  })() : 0;
  const sectionHeight = (s, w) => sectionNaturalHeight(s, w.shown, s.group.length, cols);
  const totalHeight = () => headTailRows +
    sections.reduce((h, s, i) => h + sectionHeight(s, win[i]), 0);

  // One row is reserved for the newline the writer appends: filling the last
  // terminal row and then emitting \n scrolls the screen by one, which is the
  // very thing the cap exists to prevent.
  const budget = rows > 0 ? rows - 1 : 0;
  if (budget > 0) {
    for (let i = sections.length - 1; i >= 0 && totalHeight() > budget; i--) {
      // NEEDS YOU is never trimmed. If it alone overflows the terminal we lose
      // the header, which is the right thing to lose.
      if (sections[i].pinned) continue;
      const s = sections[i];
      const w = win[i];
      const containsSelected = !s.unselectable && w.sectionStartIndex !== null &&
        selected >= w.sectionStartIndex + w.startOffset &&
        selected < w.sectionStartIndex + w.startOffset + w.shown;

      while (w.shown > 0 && totalHeight() > budget) {
        if (containsSelected) {
          const localSelected = selected - w.sectionStartIndex;
          const distFromHead = localSelected - w.startOffset;
          const distFromTail = (w.startOffset + w.shown - 1) - localSelected;
          if (distFromTail >= distFromHead) {
            w.shown--;              // selected nearer the head — trim the tail
          } else {
            w.startOffset++;        // selected nearer the tail — trim the head
            w.shown--;
          }
        } else {
          w.shown--;                // no selected row to protect — tail-first, as today
        }
        w.hidden = s.group.length - w.shown;
      }
    }
  }

  // NEEDS YOU is deliberately EXCLUDED here, even though it is selectable
  // and occupies its own slice of the flat index space: it is always fully
  // shown regardless of scrollOffset (Decision 4), so it must never be
  // averaged into the scrollable window's own bounds. Doing so would create
  // a false "visible range" spanning the gap between NEEDS YOU (index 0..)
  // and wherever the scrollable window actually starts — a row scrolled
  // entirely out of view in between (e.g. a short RUNNING section, once
  // scrolled past) would then read as "in range" and never get scrolled
  // back into view. firstVisibleIndex/lastVisibleIndex describe ONLY the
  // scrollable region's own contiguous visible window; a selected row
  // inside NEEDS YOU trivially needs no scroll adjustment regardless of
  // what these two report (moving onto it and clamping toward scrollOffset
  // 0 is harmless either way).
  let firstVisibleIndex = null;
  let lastVisibleIndex = null;
  sections.forEach((s, i) => {
    if (s.unselectable || s.pinned) return;
    const w = win[i];
    if (w.shown > 0) {
      const start = w.sectionStartIndex + w.startOffset;
      const end = w.sectionStartIndex + w.startOffset + w.shown - 1;
      if (firstVisibleIndex === null) firstVisibleIndex = start;
      lastVisibleIndex = end;
    }
  });
  // Nothing in the scrollable region rendered at all this frame (either it
  // is entirely empty, or the height budget collapsed every non-pinned
  // section) — there is nothing to scroll TOWARD or AWAY FROM, so report
  // bounds that can never spuriously trigger a scroll in either direction.
  if (firstVisibleIndex === null) firstVisibleIndex = 0;
  if (lastVisibleIndex === null) lastVisibleIndex = Math.max(0, runs.length - 1);

  // A structural property of `runs`/MAX_FINISHED alone — how far scrollOffset
  // can go before the LAST selectable row is already at the tail of its
  // (capped) window — independent of `rows`/the height budget, which can
  // only ever shrink what is ACTUALLY shown this frame, never how far
  // scrolling itself can reach (design.md Decision 3).
  const scrollable = sections.filter((s) => !s.unselectable && !s.pinned);
  let maxScrollOffset = 0;
  const lastNonEmpty = scrollable.slice().reverse().find((s) => s.group.length > 0);
  if (lastNonEmpty) {
    const totalScrollableRows = scrollable.reduce((n, s) => n + s.group.length, 0);
    const windowAtEnd = Math.min(lastNonEmpty.cap, lastNonEmpty.group.length);
    maxScrollOffset = Math.max(0, totalScrollableRows - windowAtEnd);
  }

  return {
    sections: win.map((w) => ({ shown: w.shown, startOffset: w.startOffset, hidden: w.hidden })),
    firstVisibleIndex,
    lastVisibleIndex,
    maxScrollOffset,
  };
}

// The single source of truth for "which selectable rows render this frame".
// Used internally by renderFleet (to decide what to actually print) AND
// exported for watch.js (to decide whether/how far a `move` action needs to
// scroll) — the same function, not two implementations that could drift
// (design.md Decision 3's risk mitigation). A thin bucketRuns + buildSections
// + computeWindow wrapper; see computeWindow's own header comment (above)
// for the Stage A/B trim-loop logic and return shape this delegates to.
function visibleWindow(runs, opts) {
  const queueState = (opts && opts.queueState) || null;
  const buckets = bucketRuns(runs);
  // CON-40: forwards `opts` — already `visibleWindow`'s own parameter — so
  // this call actually learns `quickStartVisible`/`quickStartTickets` and
  // sizes a QUICK START entry into the height budget below (design.md
  // Decision 4, "none of buildSections' three call sites forward opts",
  // point 1; tasks.md 2.10). Without this, QUICK START's row/height cost
  // would never be accounted for here regardless of whether it is actually
  // visible.
  const sections = buildSections(buckets, queueState, opts);
  return computeWindow(runs, sections, opts);
}

module.exports = { sectionNaturalHeight, computeWindow, visibleWindow };
