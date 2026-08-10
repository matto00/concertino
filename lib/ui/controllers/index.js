'use strict';

// The controller registry — the state-mutation half of the router seam.
// Screens stay pure ((state, opts) -> string, handleKey -> action); these
// modules are the ONE place actions become state changes, dispatched from
// watch.js's applyAction. Every controller shares the same contract:
//
//   handle(action, ctx) -> boolean
//
// — `true` when the action was recognised and applied (a redraw follows),
// `false` when it belongs to another controller. Controllers mutate ONLY
// `ctx.S` (the app-state container from lib/ui/app-state.js) and call side
// effects through `ctx` (the launcher, ctx.deps' modules, navigation
// helpers) — never through their own requires of stateful modules, so the
// require-cache fakes test/watch.test.js installs (session/linear/draft/
// reap) keep flowing through watch.js alone. See each controller's own
// header for what arrives via ctx and why.
//
// Action-type sets are disjoint across controllers (each returns false for
// anything it doesn't own), so registry order carries no meaning — it just
// mirrors the old switch's own section order.

const fleet = require('./fleet');
const draft = require('./draft');
const escalation = require('./escalation');
const drilldown = require('./drilldown');
const launchpad = require('./launchpad');
const settings = require('./settings');
const sessions = require('./sessions');
const presets = require('./presets');
const archive = require('./archive');

const CONTROLLERS = [fleet, draft, escalation, drilldown, launchpad, settings, sessions, presets, archive];

function applyAction(action, ctx) {
  for (const controller of CONTROLLERS) {
    if (controller.handle(action, ctx)) return true;
  }
  return false;
}

module.exports = { applyAction, CONTROLLERS };
