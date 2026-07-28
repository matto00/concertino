'use strict';

// The screen router. Every screen module exports the same seam —
// `render(state, opts) -> string` and `handleKey(key, state) -> action | null`
// — so watch.js can dispatch on `state.mode` without knowing a screen's
// internals, and adding drill-down or the launch pad later is one more
// registry entry, not a new branch threaded through the poll loop.
//
// `state` is the whole app-level snapshot watch.js maintains (runs, mode,
// selection, prompt, escalation sub-state, ...). Screens read only the slice
// they care about — see lib/ui/screens/fleet.js and screens/escalation.js —
// and never mutate it: handleKey returns an action describing what happened,
// and watch.js is the only place state changes.

const fleet = require('./screens/fleet');
const escalation = require('./screens/escalation');
const drilldown = require('./screens/drilldown');

const SCREENS = {
  fleet: { render: fleet.render, handleKey: fleet.routeHandleKey },
  escalation: { render: escalation.render, handleKey: escalation.routeHandleKey },
  drilldown: { render: drilldown.render, handleKey: drilldown.routeHandleKey },
};

// An unknown mode must never throw and never render as if it were the fleet —
// that would be "absent data rendering as healthy data" one layer up, at the
// level of which screen you are even looking at.
function render(state, opts) {
  const screen = SCREENS[state && state.mode];
  if (!screen) return 'concertino: unknown screen "' + (state && state.mode) + '"\n';
  return screen.render(state, opts);
}

function handleKey(key, state) {
  const screen = SCREENS[state && state.mode];
  if (!screen) return null;
  return screen.handleKey(key, state);
}

module.exports = { render, handleKey, SCREENS };
