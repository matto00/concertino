'use strict';

// CON-44: the one place that knows which ticket provider a project uses.
//
// Every call site in the dashboard goes through here instead of requiring
// linear.js directly, so adding a provider is a new module plus a line in
// moduleFor() rather than a `kind` check sprayed across watch.js, draft.js
// and the screens.
//
// linear.js is deliberately NOT moved into a providers/ directory for this
// change: doing so would relocate a 578-line module and every require-cache
// fake in test/watch.test.js for no behavioural gain. Promote when a third
// implementation exists and the interface has been proven by two.
//
// Two signatures here differ from linear.js's own, so that one shape serves
// both providers:
//   - resolveTeam takes ({ root, apiKey, teamKey }) — linear.js's is
//     positional (transport, apiKey, teamKey), and local needs `root`, which
//     that positional shape has nowhere to put.
//   - teamNotFoundMessage takes (config, teamKey) so it can dispatch at all.
// fetchTickets simply gains a `root` key, which the linear branch ignores.

const linear = require('./linear');
const local = require('./tickets/local');

const MODULES = { linear, local };

function moduleFor(config) {
  const kind = ((config || {}).ticketProvider || {}).kind;
  const mod = MODULES[kind];
  // Loud, not silent. A typo'd or not-yet-implemented kind that quietly fell
  // back to linear would present an empty launch pad with no explanation —
  // exactly the failure mode linear.js's own launchPadStatus comment calls
  // out as "a feature the user reports as broken".
  if (!mod) throw new Error('unknown ticketProvider.kind "' + (kind || 'none') + '"');
  return mod;
}

function launchPadStatus(config, env) {
  return moduleFor(config).launchPadStatus(config, env);
}

function teamKeyFromConfig(config, env) {
  return moduleFor(config).teamKeyFromConfig(config, env);
}

function stateTypesFromConfig(config) {
  return moduleFor(config).stateTypesFromConfig(config);
}

// linear.js exports no `teamNotFoundMessage` of its own — that wording lives
// in watch.js today (see its own comment: one function so refreshLaunchPad
// and ensureLaunchPad can never drift apart) and design.md Decision 2 is
// explicit that linear.js stays UNCHANGED by this change. So the linear
// branch is inlined here, verbatim from watch.js's current string, rather
// than delegated — this resolver is the new home for "the string is
// dispatched with everything else", not linear.js.
function teamNotFoundMessage(config, teamKey) {
  const mod = moduleFor(config);
  if (mod === linear) return 'no team with key "' + teamKey + '" — check ticketProvider.teamKey';
  return local.teamNotFoundMessage(teamKey);
}

// `opts` is { root, apiKey, teamKey, stateTypes }. Linear ignores `root`;
// local ignores `apiKey`. Both branches are awaitable: linear.fetchTickets is
// already async, local.fetchTickets is synchronous so it is wrapped —
// watch.js's refreshLaunchPad awaits this unconditionally.
function fetchTickets(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.fetchTickets(opts);
  return Promise.resolve(local.fetchTickets(opts));
}

function resolveTeam(config, opts) {
  const mod = moduleFor(config);
  const o = opts || {};
  if (mod === linear) return linear.resolveTeam(undefined, o.apiKey, o.teamKey);
  return local.resolveTeam(o);
}

function createTicket(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.createTicket(opts);
  return local.createTicket(opts);
}

module.exports = {
  moduleFor,
  launchPadStatus,
  teamKeyFromConfig,
  stateTypesFromConfig,
  teamNotFoundMessage,
  fetchTickets,
  resolveTeam,
  createTicket,
};
