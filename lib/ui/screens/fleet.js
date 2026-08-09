'use strict';

// The fleet screen. Pure: (runs, opts) -> string. Attention is the sort key,
// so whatever is blocking you is always at the top and can never scroll away.
//
// Facade over the fleet/ package: the implementation is split into focused
// modules (fleet/metrics.js, fleet/rows.js, fleet/sections.js,
// fleet/window.js, fleet/grid.js, fleet/render.js, fleet/keys.js), but this
// file stays the ONE module every consumer resolves — lib/ui/router.js's
// require('./screens/fleet'), watch.js, drilldown.js and the tests all keep
// landing here, with the exact same export surface the single file had.
// (Node resolves this file ahead of the fleet/ directory, so the path
// contract is preserved by construction.)

// Several tests (fleet.test.js's coloured/degraded renders, drilldown.test.js,
// format-colour.test.js) reload this screen against a swapped-out ../format /
// ../layout by deleting the require.cache entries for THOSE modules plus this
// path, then re-requiring it. With the implementation split across fleet/*,
// deleting only this facade's cache entry would leave the submodules cached
// against the OLD format/layout instances — the reload would silently take no
// effect. Busting the submodule entries here, before requiring them, makes a
// re-require of this facade rebuild the whole package, so the facade keeps
// behaving exactly like the single file it replaced. (On a normal first load
// these deletes are no-ops.)
for (const m of [
  './fleet/metrics', './fleet/rows', './fleet/sections', './fleet/window',
  './fleet/grid', './fleet/render', './fleet/keys',
]) {
  delete require.cache[require.resolve(m)];
}

// The canonical phase list is owned by reducer.js (next to its other
// telemetry vocabularies, TIER2_KINDS/TIER3_KINDS) — re-exported here under
// the same name so drilldown.js and existing tests that import it from this
// module do not need to change their import path.
const { PHASE_ORDER } = require('../reducer');

const { metricsFor, metricsColumnLines } = require('./fleet/metrics');
const { phaseFraction } = require('./fleet/rows');
const {
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, QUICK_START_COUNT, buildSections,
} = require('./fleet/sections');
const { visibleWindow, computeWindow } = require('./fleet/window');
const {
  GRID_MIN_COLS, GRID_MIN_COLUMN_AREA_HEIGHT, COLUMN_ONE_WIDTH,
  visibleWindowGrid, gridModeEligible, renderStackedSection,
} = require('./fleet/grid');
const { renderFleet, renderFleetRowMap, render, renderRowMap } = require('./fleet/render');
const { sectionJumpTargets, handleKey } = require('./fleet/keys');

module.exports = {
  renderFleet, renderFleetRowMap, phaseFraction, handleKey, render, renderRowMap, routeHandleKey: handleKey, PHASE_ORDER,
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, visibleWindow, visibleWindowGrid, computeWindow,
  sectionJumpTargets, buildSections, QUICK_START_COUNT, metricsFor,
  metricsColumnLines, renderStackedSection, GRID_MIN_COLS, COLUMN_ONE_WIDTH,
  GRID_MIN_COLUMN_AREA_HEIGHT, gridModeEligible,
};
