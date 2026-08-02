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
const launchpad = require('./screens/launchpad');
const ticketview = require('./screens/ticketview');
const launchplan = require('./screens/launchplan');
const docview = require('./screens/docview');
const ticketdraft = require('./screens/ticketdraft');
const settings = require('./screens/settings');

const SCREENS = {
  fleet: { render: fleet.render, handleKey: fleet.routeHandleKey },
  escalation: { render: escalation.render, handleKey: escalation.routeHandleKey },
  drilldown: { render: drilldown.render, handleKey: drilldown.routeHandleKey },
  launchpad: { render: launchpad.render, handleKey: launchpad.routeHandleKey },
  ticketview: { render: ticketview.render, handleKey: ticketview.routeHandleKey },
  launchplan: { render: launchplan.render, handleKey: launchplan.routeHandleKey },
  // The evidence reader (CON-19) — mode = 'docview' is entered ONLY via the
  // drill-down's EVIDENCE panel (open-evidence-doc); see docview.js's own
  // router-seam comment and design.md Decision 3a.
  docview: { render: docview.render, handleKey: docview.routeHandleKey },
  // The ticket-draft screen (CON-21) — mode = 'ticketdraft' is entered ONLY
  // once a headless drafting invocation resolves (fleet.js's `n` prompt ->
  // 'open-ticket-draft' -> watch.js's applyAction); see ticketdraft.js's own
  // header comment and design.md Decision 3.
  ticketdraft: { render: ticketdraft.render, handleKey: ticketdraft.routeHandleKey },
  // The settings screen (CON-57) — mode = 'settings' is entered ONLY from
  // the fleet screen's `s` key (fleet.js's handleKey -> 'open-settings');
  // see settings.js's own header comment and design.md Decision 1.
  settings: { render: settings.render, handleKey: settings.routeHandleKey },
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
