'use strict';

// The fleet screen's frame composition: renderFleet (single-column, with
// the grid-mode handoff) and the router-facing render(state, opts) wrapper.

const f = require('../../format');
const layout = require('../../layout');
// CON-39: parseLaunchCommand is the one shared implementation of "read the
// speed/agent-merge token(s) back out of a launchCommand string" — see its
// own header comment in launchplan.js for why this is not a second regex
// duplicated here.
const launchplan = require('../launchplan');
const { metricsFor } = require('./metrics');
const {
  renderRun, renderFinishedRow, renderQueuedRow, renderQuickStartRow,
} = require('./rows');
const {
  BOX_BORDER_PADDING_COLS, bucketRuns, buildSections, buildHeadTail,
} = require('./sections');
const { visibleWindow } = require('./window');
const {
  GRID_MIN_COLS, GRID_MIN_COLUMN_AREA_HEIGHT, visibleWindowGrid, renderFleetGrid,
} = require('./grid');

// CON-112, design.md Decision 3: the actual layout/box computation shared by
// `renderFleet` (unchanged, string-only contract every existing caller
// already relies on — ~150 call sites across fleet.test.js/drilldown.test.js/
// format-colour.test.js) and the new `renderFleetRowMap` (below), so there is
// exactly one place that decides where a run row ends up on screen, never
// two independently-computed layouts that could drift apart (the same
// "single source of truth" discipline gridModeEligible/visibleWindowGrid
// already established for grid mode). Returns `{ text, rowMap }`, where
// `rowMap` is `{ [terminalRow]: runsIndex }` for every content line that
// belongs to a NEEDS YOU/FAILED/RUNNING/DONE run row this frame actually
// rendered — QUEUED/QUICK START rows, the collapsed "…and N more" summary
// line, and (per design.md's explicit scope decision) grid mode all
// contribute no entries, so a click there is a no-op, matching this pass's
// deliberately narrow single-column-only, fleet-row-list-only scope.
// `terminalRow` is 0-based WITHIN this screen's own text block — watch.js
// adds the top-bar/banner line offset before treating it as an absolute
// terminal row, exactly as `rendered`'s own template literal composes them.
function buildFleetOutput(runs, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const selected = (opts && opts.selected) || 0;
  // A ticket-id -> title lookup built by watch.js's draw() from the on-disk
  // ticket cache (design.md Decision 3). Read directly by the QUEUED-only
  // branch of the per-row render loop below (design.md Decision 5) — closed
  // over here rather than threaded per-call, exactly like queueState/selected.
  const queuedTitles = (opts && opts.queuedTitles) || null;
  const queueState = (opts && opts.queueState) || null;
  // CON-110, design.md Decision 3: the active search query string (`null`
  // when search is not open), derived once here from `opts.search`'s own
  // `{ value }` shape (the STATE object buildHeadTail's own `search` branch
  // renders the input line from — a different concern from this plain
  // string) — threaded through augmentedOpts/renderFleetGrid's ctx below so
  // every row-renderer call site, in both the single-column and grid-mode
  // paths, can highlight against the exact same value.
  const searchQuery = (opts && opts.search && opts.search.value) || null;
  // CON-39: the QUEUED-local focus cursor (design.md Decision 1) — `focus`
  // defaults to 'runs' (ordinary run selection, unaffected by any of this)
  // and `queueFocus` is only meaningful while `focus === 'queue'`.
  const focus = (opts && opts.focus) || 'runs';
  const queueFocus = opts && opts.queueFocus;
  // CON-40: the QUICK START-local focus cursor (design.md Decision 3) —
  // meaningful only while `focus === 'quickstart'`, exactly like `queueFocus`
  // just above.
  const quickStartFocus = opts && opts.quickStartFocus;
  // CON-109, fleet-bulk-select spec: `{ failed: Set, queued: Set }`, read
  // straight off opts (mergeRenderOpts threads it from state) — the per-row
  // loop below (and renderFleetGrid's own rowCtx) consult this to decide
  // whether a given row's dedicated multi-select marker (`✓`) renders,
  // independent of the ordinary `▸`/`»` cursor markers.
  const multiSelect = (opts && opts.multiSelect) || { failed: new Set(), queued: new Set() };
  // CON-114, design.md Decision 1: the run-comparison feature's own
  // capped-at-2 selection, read straight off opts (mergeRenderOpts threads
  // it from state) — the per-row loop below consults this to decide
  // whether a given DONE row's marked-for-comparison indicator (the same
  // `✓` slot multiSelect's own marker uses — see rows.js) renders.
  const compareSelection = (opts && opts.compareSelection) || [];
  // Parsed ONCE per render, not per queued row (design.md Decision 5) — a
  // single regex exec against one shared batch-level string. Skipped
  // entirely when there is no populated QUEUED section to draw at all.
  const queueLaunchInfo = (queueState && queueState.pending && queueState.pending.length)
    ? launchplan.parseLaunchCommand(queueState.launchCommand)
    : null;

  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const buckets = bucketRuns(runs);
  // The DONE section only ever shows MAX_FINISHED rows, but the average this
  // repo's deliveries are judged against must be over every delivered ticket
  // `.concertino/runs/` still has history for (design intent: "get all
  // tickets, avg time to deliver") — metricsFor's own `done` filter walks
  // the FULL `runs` array, unlike what visibleWindow later trims for
  // display. Also feeds the METRICS panel below — one shared computation,
  // not two (this used to be a separate inline avgDoneMs computation here).
  const metrics = metricsFor(runs, now);
  const avgDoneMs = metrics.avgMs;
  // Threaded into every buildSections call site (both visibleWindow's own
  // internal one and the direct one below) so METRICS' row/height cost is
  // accounted for in the height budget wherever sections are enumerated —
  // the same "opts must carry every section-shaping flag" discipline
  // quickStartTickets already established.
  const augmentedOpts = Object.assign({}, opts, { metrics, searchQuery });

  // Final whole-branch review, Finding 1: width alone is not enough to
  // commit to grid mode. `metricsColumnLines`' compact tier always returns
  // exactly 5 lines with no shorter fallback, but `renderFleetGrid` sizes
  // METRICS' box to exactly `columnAreaHeight` via `layout.box(content,
  // { height: columnAreaHeight })`, which renders EXACTLY `height - 2`
  // content rows and silently DROPS anything beyond that — no ellipsis, no
  // signal. A terminal can be wide AND short (a horizontally-split tmux
  // pane, a half-height terminal window), so the width-only
  // `cols >= GRID_MIN_COLS` gate can land `columnAreaHeight` in the 3-6
  // range, where METRICS renders only 1-4 of its 5 compact lines. Compute
  // what `columnAreaHeight` would actually be (visibleWindowGrid is the one
  // place that already does this arithmetic — see its own header comment)
  // and require at least 7 rows (5 content lines + 2-row border) before
  // committing to grid mode; below that, fall back to the single-column
  // path exactly as if `cols < GRID_MIN_COLS` — it already handles short
  // terminals correctly via its own existing degrade/trim logic. The
  // computed window is threaded into `renderFleetGrid` as `win` so it never
  // has to recompute it (one call, one source of truth for the decision AND
  // the render).
  if (cols >= GRID_MIN_COLS) {
    const gridWin = visibleWindowGrid(runs, augmentedOpts);
    if (gridWin.columnAreaHeight >= GRID_MIN_COLUMN_AREA_HEIGHT) {
      // CON-112: grid mode contributes no row-map entries this pass (design.md
      // Non-Goals — a generic, fleet-wide hit-test layer is explicitly out of
      // scope) — a click while grid mode is on screen is therefore always a
      // no-op, same as a click outside the row list in single-column mode.
      return {
        text: renderFleetGrid(runs, {
          cols, selected, queuedTitles, queueState, focus, queueFocus, quickStartFocus,
          queueLaunchInfo, avgDoneMs, metrics, augmentedOpts, buckets, win: gridWin,
          searchQuery, multiSelect,
        }),
        rowMap: {},
      };
    }
  }

  const { head, tail } = buildHeadTail(runs, opts);
  const win = visibleWindow(runs, augmentedOpts);
  // CON-40: forwards `opts` — the single most load-bearing of the three
  // buildSections call-site fixes (design.md Decision 4, point 2; tasks.md
  // 2.11): skipping this one specifically means QUICK START is never drawn
  // on screen AT ALL, even if digit-jump/focus are all individually correct
  // elsewhere.
  const sections = buildSections(buckets, queueState, augmentedOpts);

  const out = head.slice();
  // CON-112, design.md Decision 3/4: `{ [terminalRow]: runsIndex }` — built
  // alongside `out` itself, from the exact post-box/post-degrade coordinates
  // `out`'s own indices already are (never the pre-box `contentLines` index —
  // see design.md's implementation note on why that would be wrong once a
  // section renders inside `layout.box()`'s border/padding).
  const rowMap = {};
  let index = 0;
  // Lazygit-layout pass: labels each rendered section's title with its own
  // digit-jump number, right in the border — so the `1-9 jump` footer hint
  // is discoverable on screen, not just in the hint text. Incremented once
  // per section that survives BOTH early-returns below (i.e. once per
  // section actually drawn, whether boxed or degraded-flat) — exactly the
  // same population sectionJumpTargets() numbers via its own `s.group.length
  // > 0 || s.forceRender` filter, so the two can never disagree.
  let jumpNumber = 0;
  // Lazygit-layout pass: grow-to-fill. `budget` is the same `rows - 1`
  // convention this file already uses elsewhere (one row reserved for the
  // trailing newline the writer appends) — 0/absent means unbounded, in
  // which case nothing grows (byte-identical to this function's pre-change
  // output). `lastRenderableIndex` is the index (into `sections`) of the
  // LAST section that will actually draw this frame — computed once, up
  // front, via the exact same `s.group.length > 0 || s.forceRender` test
  // sectionJumpTargets() and jumpNumber above already use, so it can never
  // disagree with what the loop below actually renders.
  const budget = (opts && opts.rows) > 0 ? opts.rows - 1 : 0;
  const renderableIndices = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.group.length > 0 || s.forceRender)
    .map(({ i }) => i);
  const lastRenderableIndex = renderableIndices.length ? renderableIndices[renderableIndices.length - 1] : -1;
  sections.forEach((s, i) => {
    const colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x);
    // CON-40, design.md Decision 4, mechanism step 3: a `forceRender`-
    // flagged, zero-eligible section (QUICK START, when explicitly toggled
    // on with nothing eligible; METRICS, always) renders a normal bordered
    // box whose content lines come from `emptyLines` — or, for QUICK
    // START's single-line case, its own `emptyHint` wrapped in an array (see
    // `contentLines` just below) — rather than being skipped outright the
    // way every other empty section still is. An empty QUICK START while
    // explicitly toggled on is itself informative, not silence; METRICS is
    // always informative by design.
    if (!s.group.length) {
      if (!s.forceRender) return;
      jumpNumber += 1;
      const numberedTitle = `[${jumpNumber}] ${s.title}`;
      const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
      // METRICS pre-fits its own lines (segment-aware, via layout.fitSegments)
      // against this same innerCols budget when buildSections builds
      // `emptyLines` — this truncate is a no-op safety net for those lines,
      // and the only truncation QUICK START's plain `emptyHint` string ever
      // gets.
      const contentLines = (s.emptyLines || [s.emptyHint || '']).map((line) => f.truncate(line, innerCols));
      const naturalBoxHeight = contentLines.length + 2;
      let boxHeight = naturalBoxHeight;
      if (budget > 0 && i === lastRenderableIndex) {
        const usedSoFar = out.length + tail.length;
        boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
      }
      if (layout.degrade(cols, boxHeight)) {
        out.push('  ' + colourTitle(numberedTitle));
        for (const line of contentLines) out.push(line);
        out.push('');
      } else {
        for (const line of layout.box(contentLines, { width: cols, height: boxHeight, title: colourTitle(numberedTitle), focused: false })) {
          out.push(line);
        }
      }
      return;
    }
    jumpNumber += 1;
    const numberedTitle = `[${jumpNumber}] ${s.title}`;
    const w = win.sections[i];
    const hidden = w.hidden;
    const sectionStartIndex = index;
    if (!s.unselectable) index += s.group.length;

    // Fully collapsed: one line, no title and no trailing blank, no border —
    // there is nothing to put a frame around (design.md Decision 3, "a fully-
    // collapsed fleet section stays a single unbordered line"). Must stay in
    // lockstep with visibleWindow's own sectionHeight().
    if (w.shown === 0) {
      out.push('      ' + f.dim(`… and ${hidden} more ${s.title.toLowerCase()}`));
      return;
    }

    // Content is generated against the box's own inner width, not the full
    // section width — otherwise a run row sized to `cols` would overflow the
    // box by exactly the border+padding overhead once framed.
    const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
    const contentLines = [];
    // CON-112: parallel to `contentLines` — the `runs[]` index (rowIndex,
    // already index-into-`runs` per sections.js's own "the Nth rendered
    // (selectable) row is runs[N]" invariant) that OWNS this content line,
    // or `null` for a line no click should resolve to (every QUEUED/QUICK
    // START row — neither has a run object at all — and the "…and N more"
    // summary line below). A run row spanning >1 line (renderRun's own
    // 2-line shape, more if an escalation question wraps) pushes the SAME
    // rowIndex once per line it contributes, so a click anywhere in that
    // row's block resolves to it, not just its first line.
    const contentLineOwners = [];
    for (let k = w.startOffset; k < w.startOffset + w.shown; k++) {
      // CON-40, design.md Decision 4, mechanism step 5: dispatch on `s.kind`,
      // not merely `s.unselectable` — QUEUED's `group` holds ticket-id
      // strings (looked up against `queuedTitles`), QUICK START's holds full
      // ticket OBJECTS (design.md Decision 4's own eligible-list shape).
      // Calling renderQueuedRow on a ticket object would be structurally
      // wrong, not just cosmetically — `queuedTitles.get(ticketObject)`
      // would never match, and the object itself would be passed where an
      // id string is expected.
      if (s.kind === 'queued') {
        // QUEUED rows have no run object and are never selectable — call the
        // 1-line renderer (per linesPerRow: 1) with the ticket's 1-based
        // queue position and its cached title, if any (design.md Decision 5).
        const ticket = s.group[k];
        const title = queuedTitles ? queuedTitles.get(ticket) : null;
        const focused = focus === 'queue' && queueFocus === k;
        for (const line of renderQueuedRow(ticket, k + 1, title, innerCols, {
          focused,
          speed: queueLaunchInfo && queueLaunchInfo.speed,
          agentMerge: queueLaunchInfo ? queueLaunchInfo.agentMerge : null,
          searchQuery,
          multiSelected: multiSelect.queued.has(ticket),
        })) { contentLines.push(line); contentLineOwners.push(null); }
      } else if (s.kind === 'quickstart') {
        const ticket = s.group[k];
        const focused = focus === 'quickstart' && quickStartFocus === k;
        for (const line of renderQuickStartRow(ticket, focused, innerCols, searchQuery)) { contentLines.push(line); contentLineOwners.push(null); }
      } else if (s.kind === 'failed' || s.kind === 'done') {
        const rowIndex = sectionStartIndex + k;
        const multiSelected = s.kind === 'failed' && multiSelect.failed.has(s.group[k].ticket);
        // CON-114: only a DONE row can be marked for comparison — mirrors
        // multiSelected's own `s.kind === 'failed'` gating just above.
        const compareSelected = s.kind === 'done' && compareSelection.indexOf(s.group[k].ticket) !== -1;
        for (const line of renderFinishedRow(s.group[k], { cols: innerCols, avgDoneMs, searchQuery, multiSelected, compareSelected }, rowIndex === selected)) { contentLines.push(line); contentLineOwners.push(rowIndex); }
      } else {
        const rowIndex = sectionStartIndex + k;
        for (const line of renderRun(s.group[k], { cols: innerCols, avgDoneMs, searchQuery }, rowIndex === selected)) { contentLines.push(line); contentLineOwners.push(rowIndex); }
      }
    }
    if (hidden) { contentLines.push('      ' + f.dim(`… and ${hidden} more`)); contentLineOwners.push(null); }

    const naturalBoxHeight = contentLines.length + 2;
    // Lazygit-layout pass: only the LAST section actually rendered this
    // frame grows to absorb leftover budget — every earlier section keeps
    // its natural content height exactly as before, so the frame reads
    // top-to-bottom with one box (the last) doing the filling, not every
    // box stretching independently.
    let boxHeight = naturalBoxHeight;
    if (budget > 0 && i === lastRenderableIndex) {
      const usedSoFar = out.length + tail.length;
      boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
    }

    // Below layout.degrade()'s threshold, render exactly as this screen did
    // before this change (no frame) rather than drawing a border that would
    // itself have to be truncated into illegibility — design.md Decision 3's
    // degradation order. Per that same decision, the row COUNT is identical
    // either way (2 + 2*shown + moreFlag), so sectionHeight()/height()/budget
    // above never need to know which path a section actually took.
    if (layout.degrade(cols, boxHeight)) {
      out.push('  ' + colourTitle(numberedTitle));
      // CON-112: the degraded (unboxed) path — content lines land in `out`
      // one-for-one, right after the title line just pushed above.
      const contentStart = out.length;
      contentLines.forEach((line, ci) => {
        out.push(line);
        if (contentLineOwners[ci] != null) rowMap[contentStart + ci] = contentLineOwners[ci];
      });
      out.push('');
    } else {
      // All sections use the plain (unfocused) border set — the fleet
      // has one flat selection list and no second pane to contrast a
      // "focused" style against (design.md Decision 2).
      const boxStart = out.length;
      for (const line of layout.box(contentLines, { width: cols, height: boxHeight, title: colourTitle(numberedTitle), focused: false })) {
        out.push(line);
      }
      // CON-112, design.md Decision 3's implementation note: `layout.box()`'s
      // own FIRST returned line is the top border, so content row `ci` lands
      // at `boxStart + 1 + ci`, not `boxStart + ci` — this is exactly the
      // "post-box, not pre-box" coordinate correction the design doc calls
      // out (border/title padding overhead the raw `contentLines` index does
      // not itself account for).
      contentLineOwners.forEach((owner, ci) => {
        if (owner != null) rowMap[boxStart + 1 + ci] = owner;
      });
    }
  });

  for (const line of tail) out.push(line);

  return { text: out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n'), rowMap };
}

// Kept separate from `buildFleetOutput` so existing callers (tests, in
// particular — ~150 call sites across fleet.test.js/drilldown.test.js/
// format-colour.test.js) keep working against the plain
// (runs, opts) -> string function, byte-for-byte unchanged.
function renderFleet(runs, opts) {
  return buildFleetOutput(runs, opts).text;
}

// CON-112: the row-index-map counterpart to `renderFleet` — same inputs,
// same underlying computation (`buildFleetOutput`, above), returns only the
// `{ [terminalRow]: runsIndex }` map. watch.js's draw() calls this once per
// frame, alongside (not instead of) `renderFleet`/`render`, only while
// `state.mode === 'fleet'` (design.md's explicit single-screen scope).
function renderFleetRowMap(runs, opts) {
  return buildFleetOutput(runs, opts).rowMap;
}

// Shared by `render` and `renderRowMap` (CON-112) — the one place `state`'s
// own fields are merged onto the router's `opts` before either reaches
// `renderFleet`/`renderFleetRowMap`, so the two can never be handed
// different opts for what is supposed to be the exact same frame.
function mergeRenderOpts(state, opts) {
  return Object.assign({}, opts, {
    selected: state.selected,
    scrollOffset: state.scrollOffset,
    prompt: state.prompt,
    // CON-110: the `/` search prompt's own state, mirroring `prompt` just
    // above — read straight off `state` (currentState() already carries it,
    // app-state.js's currentState()) and forwarded so buildFleetOutput can
    // both render the input line (buildHeadTail) and derive `searchQuery`
    // for row highlighting from the exact same value.
    search: state.search,
    queueNotice: state.queueNotice,
    restoreNotice: state.restoreNotice,
    queueState: state.queueState,
    // Built by watch.js's draw() from the on-disk ticket cache and passed in
    // as a plain opt alongside queueState (design.md Decisions 3 and 5) —
    // forwarded explicitly here for the same reason queueState is, even
    // though it already arrives on `opts` unchanged.
    queuedTitles: opts && opts.queuedTitles,
    quitConfirm: state.quitConfirm,
    // CON-39: the QUEUED-local focus cursor and its own force-start
    // confirmation gate — same "read straight off state" pattern as
    // quitConfirm just above.
    focus: state.focus,
    queueFocus: state.queueFocus,
    forceStartConfirm: state.forceStartConfirm,
    // CON-40: `quickStartFocus` is read straight off `state` (currentState()
    // carries it — tasks.md 4.1), same pattern as `focus`/`queueFocus` just
    // above. `quickStartTickets`/`quickStartCold` are built fresh by
    // watch.js's draw() from the on-disk ticket cache (design.md Decision 4)
    // and forwarded explicitly here for the same reason `queuedTitles` is,
    // just above.
    quickStartFocus: state.quickStartFocus,
    quickStartTickets: opts && opts.quickStartTickets,
    quickStartCold: opts && opts.quickStartCold,
    clearQueueConfirm: state.clearQueueConfirm,
    // CON-98, design.md Decision 2 / skeptic gate round 1 finding 3: threaded
    // through exactly like forceStartConfirm/clearQueueConfirm just above —
    // without this, markDoneConfirm's banner would never actually render.
    markDoneConfirm: state.markDoneConfirm,
    addressFailureNotice: state.addressFailureNotice,
    // CON-109, design.md Decision 1/4 (skeptic gate round 1, finding 1):
    // threaded through exactly like markDoneConfirm/forceStartConfirm/
    // clearQueueConfirm just above — multiSelect drives the per-row `✓`
    // marker, bulkConfirm/bulkResult drive the bulk confirmation banner and
    // the post-confirm per-row result list respectively.
    multiSelect: state.multiSelect,
    bulkConfirm: state.bulkConfirm,
    bulkResult: state.bulkResult,
    // CON-114: the run-comparison feature's own shared selection — read
    // straight off `state` (currentState() carries it — app-state.js's
    // currentState()), same "read straight off state" pattern as
    // multiSelect just above.
    compareSelection: state.compareSelection,
  });
}

// Uniform router seam: every screen exposes render(state, opts) so the router
// never needs to know a screen's own shape. Kept separate from `renderFleet`
// so existing callers (tests, in particular) keep working against the plain
// (runs, opts) -> string function unchanged.
function render(state, opts) {
  return renderFleet(state.runs, mergeRenderOpts(state, opts));
}

// CON-112: the `state`-level counterpart to `renderFleetRowMap` — same
// `state`-merge `render` itself uses (`mergeRenderOpts`), so watch.js can
// call this with the identical `opts` it already builds for `router.render`
// and get back a row map describing that exact same frame. NOT part of the
// router.js `SCREENS` table — router.render(state, opts) -> string is a
// contract every screen shares uniformly; this is fleet-only, called
// directly by watch.js's draw() (design.md Decision 3).
function renderRowMap(state, opts) {
  return renderFleetRowMap(state.runs, mergeRenderOpts(state, opts));
}

module.exports = { renderFleet, renderFleetRowMap, render, renderRowMap };
