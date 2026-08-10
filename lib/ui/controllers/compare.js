'use strict';

// The side-by-side run-comparison screen's own actions (CON-114): returning
// to whichever screen it was opened from, and each column's independent
// scroll. `open-compare`/`toggle-compare-select` are dispatched from — and
// handled by — controllers/archive.js and controllers/fleet.js instead (the
// two screens that can open this one), since which screen it was opened
// FROM is `state.mode` at the moment of dispatch, something only those two
// controllers can observe directly (design.md Decision 3). This module owns
// only what happens once the compare screen is already on screen.
//
// Dispatched from watch.js's applyAction — see controllers/index.js for the
// shared contract.

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    // design.md Decision 3 / tasks.md 5.2: routes to whichever screen
    // opened this one (S.compareReturnMode, set by 'open-compare' — see
    // controllers/archive.js / controllers/fleet.js), defaulting to 'fleet'
    // for the defensive case where this screen was somehow reached with no
    // recorded origin (mirrors 'back-to-launchpad''s own fallback for
    // ticketviewReturnMode). S.compareSelection is deliberately left
    // untouched — see app-state.js's own comment on why.
    case 'back-to-origin-from-compare':
      S.mode = S.compareReturnMode === 'archive' ? 'archive' : 'fleet';
      S.compareReturnMode = null;
      S.compareLeftScroll = 0;
      S.compareRightScroll = 0;
      S.compareFocus = 'left';
      return true;

    case 'switch-compare-focus':
      S.compareFocus = action.focus === 'right' ? 'right' : 'left';
      return true;

    // tasks.md 4.6/5.3: each column scrolls independently — never clamped
    // to an upper bound here (mirrors drill-panel-scroll's own lazy
    // clamping discipline — see controllers/drilldown.js's matching
    // comment): the real, possibly-shrunk content length is only known at
    // render time (screens/compare.js, via docview.windowBody's own
    // clampScroll).
    case 'compare-scroll': {
      if (action.column === 'right') {
        S.compareRightScroll = Math.max(0, S.compareRightScroll + action.delta);
      } else {
        S.compareLeftScroll = Math.max(0, S.compareLeftScroll + action.delta);
      }
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle };
