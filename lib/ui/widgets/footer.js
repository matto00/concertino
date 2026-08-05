'use strict';

// The shared footer widget (design.md Decision 3). A thin wrapper around
// `f.hintLines` that owns its own rendered-row-count accounting — so a
// screen's height-budget math reads `rows` off this widget's return value
// instead of separately re-deriving `f.hintLines(...).length` at a second
// call site, out of sync with the first (the exact class of off-by-one bug
// CON-26/CON-43 fixed once each, screen by screen). `f.hintLines`'s own
// wrapping algorithm is unchanged — the gap being closed is purely "own the
// row count", not the wrapping itself.
//
// Applied only where a screen was verified to genuinely re-derive this row
// count a second time (drilldown.js, launchplan.js) — see design.md's
// "Design-gate round 1 findings" for why escalation.js/ticketview.js/
// docview.js/fleet/settings.js are not consumers.

const f = require('../format');

// footer({ hints, cols }) -> { lines, rows }.
function footer({ hints, cols }) {
  const lines = f.hintLines(hints, cols);
  return { lines, rows: lines.length };
}

module.exports = { footer };
