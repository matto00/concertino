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

// `manual` is the pre-CON-44 name for the same boardless provider. lib/config.js's
// withDefaults() already rewrites it, and lib/cli/watch.js's cmdWatch now runs a
// successfully-parsed config through withDefaults before handing it to watch()
// (CON-92) — but that's not guaranteed: cmdWatch falls back to the raw,
// un-normalised parsed object when there's no config file, the JSON fails to
// parse, or withDefaults itself throws (see cmdWatch's own comment). So the
// alias is resolved HERE too, at the one seam every provider consumer goes
// through, rather than trusting that some earlier loader normalised it —
// otherwise `concertino validate`'s "reads as local" promise is true of the
// agent half and only sometimes true of the dashboard.
const ALIASES = { manual: 'local' };

// The resolved (post-alias) `ticketProvider.kind`, or undefined when none is
// configured. Never throws — callers that need a module use moduleFor(), which
// does; callers that only need to know WHICH provider (watch.js's
// auto-refresh-on-open branch) must not blow up on an unknown kind.
function kindFor(config) {
  const raw = ((config || {}).ticketProvider || {}).kind;
  return ALIASES[raw] || raw;
}

// A config with its `kind` alias resolved, so a provider module's own gate
// (local.js's launchPadStatus) never has to know the alias table. Returns the
// original object untouched unless an alias actually applied.
function canonicalConfig(config) {
  const cfg = config || {};
  const provider = cfg.ticketProvider || {};
  const kind = kindFor(cfg);
  if (kind === provider.kind) return cfg;
  return Object.assign({}, cfg, { ticketProvider: Object.assign({}, provider, { kind }) });
}

function moduleFor(config) {
  const kind = kindFor(config);
  const mod = MODULES[kind];
  // Loud, not silent. A typo'd or not-yet-implemented kind that quietly fell
  // back to linear would present an empty launch pad with no explanation —
  // exactly the failure mode linear.js's own launchPadStatus comment calls
  // out as "a feature the user reports as broken".
  //
  // The wording is a provider GATE, not an internal error: `github` is
  // `concertino init`'s default kind and ships in two config/examples, so the
  // commonest way to reach this line is a perfectly valid project that simply
  // has no dashboard provider — and watch.js's ensureLaunchPad renders this
  // message verbatim as the launch pad's gate text. It must read like the
  // other two gate messages (local.js's launchPadStatus, linear.js's own),
  // not like a stack trace that leaked.
  //
  // Kept under 74 characters — the length of the message this replaced — so
  // the offending kind is still VISIBLE rather than truncated away by
  // launchpad.js's single-line f.truncate on an 80-column terminal. That is
  // the whole diagnostic value of the message, so the terser "not X" wins over
  // local.js's longer "this project uses X" phrasing.
  if (!mod) {
    throw new Error('launch pad needs ticketProvider.kind "linear" or "local" — ' +
      (kind ? 'not "' + kind + '"' : 'none is set'));
  }
  return mod;
}

// Whether `ticketProvider.teamKey` is load-bearing for this provider. Linear
// cannot query without one — a team key IS the query. Local scans `tickets/`
// and never reads the key for anything but echoing it back into the fetch
// result, so requiring it would hard-fail the smallest schema-valid local
// config (`{"ticketProvider":{"kind":"local"}}`) the instant the launch pad
// auto-refreshes on open. Kept as a table here rather than a flag on each
// module because linear.js is deliberately not modified by this change.
const NEEDS_TEAM_KEY = { linear: true, local: false };

function requiresTeamKey(config) {
  return NEEDS_TEAM_KEY[kindFor(config)] === true;
}

// The provider modules see the canonical config, so a project still on the
// deprecated `manual` passes local.js's own `kind !== 'local'` gate instead of
// being told the launch pad needs a kind it was just told it already has.
function launchPadStatus(config, env) {
  return moduleFor(config).launchPadStatus(canonicalConfig(config), env);
}

function teamKeyFromConfig(config, env) {
  return moduleFor(config).teamKeyFromConfig(canonicalConfig(config), env);
}

function stateTypesFromConfig(config) {
  return moduleFor(config).stateTypesFromConfig(canonicalConfig(config));
}

// linear.js exports no `teamNotFoundMessage` of its own — that wording lives
// in watch.js today (see its own comment: one function so refreshLaunchPad
// and ensureLaunchPad can never drift apart) and design.md Decision 2 is
// explicit that linear.js stays UNCHANGED by this change. So the linear
// branch is inlined here, verbatim from watch.js's current string, rather
// than delegated — this resolver is the new home for "the string is
// dispatched with everything else", not linear.js.
//
// Every branch below is `linear`'s ADAPTATION plus a call through `mod` — never
// a hardcoded `local.*`. A third entry in MODULES would otherwise pass
// moduleFor() and then silently execute local's implementations against a
// config that asked for something else, which is the same silent-wrong-provider
// failure moduleFor()'s throw exists to prevent.
function teamNotFoundMessage(config, teamKey) {
  const mod = moduleFor(config);
  if (mod === linear) return 'no team with key "' + teamKey + '" — check ticketProvider.teamKey';
  return mod.teamNotFoundMessage(teamKey);
}

// `opts` is { root, apiKey, teamKey, stateTypes }. Linear ignores `root`;
// local ignores `apiKey`. Both branches are awaitable: linear.fetchTickets is
// already async, local.fetchTickets is synchronous so it is wrapped —
// watch.js's refreshLaunchPad awaits this unconditionally.
function fetchTickets(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.fetchTickets(opts);
  return Promise.resolve(mod.fetchTickets(opts));
}

function resolveTeam(config, opts) {
  const mod = moduleFor(config);
  const o = opts || {};
  if (mod === linear) return linear.resolveTeam(undefined, o.apiKey, o.teamKey);
  return mod.resolveTeam(o);
}

function createTicket(config, opts) {
  const mod = moduleFor(config);
  if (mod === linear) return linear.createTicket(opts);
  return mod.createTicket(opts);
}

module.exports = {
  moduleFor,
  kindFor,
  requiresTeamKey,
  launchPadStatus,
  teamKeyFromConfig,
  stateTypesFromConfig,
  teamNotFoundMessage,
  fetchTickets,
  resolveTeam,
  createTicket,
};
