'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const provider = require('../lib/ui/ticket-provider');
const linear = require('../lib/ui/linear');
const local = require('../lib/ui/tickets/local');

const LINEAR_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'linear', teamKey: 'CON' } };
const LOCAL_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local', teamKey: 'CON' } };

test('launchPadStatus dispatches to linear', () => {
  assert.deepEqual(
    provider.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' }),
    linear.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' })
  );
});

test('launchPadStatus dispatches to local, which needs no api key', () => {
  assert.equal(provider.launchPadStatus(LOCAL_CFG, {}).enabled, true);
});

test('teamKeyFromConfig honours LINEAR_TEAM_KEY under linear but not under local', () => {
  assert.equal(provider.teamKeyFromConfig(LINEAR_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'ZZZ');
  assert.equal(provider.teamKeyFromConfig(LOCAL_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'CON');
});

test('teamNotFoundMessage dispatches on kind', () => {
  assert.match(provider.teamNotFoundMessage(LINEAR_CFG, 'CON'), /teamKey/);
  assert.match(provider.teamNotFoundMessage(LOCAL_CFG, 'CON'), /tickets\//);
});

test('stateTypesFromConfig is shared — the backlog dial means the same thing', () => {
  const off = { ticketProvider: { kind: 'local' }, dashboard: { launchPad: { enabled: true, backlog: false } } };
  assert.deepEqual(provider.stateTypesFromConfig(off), ['unstarted', 'started']);
});

test('resolveTeam takes an object arg and reaches local', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-tp-'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: false });
  fs.mkdirSync(path.join(root, 'tickets'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: true });
});

test('createTicket under local rejects rather than throwing a TypeError', async () => {
  await assert.rejects(() => provider.createTicket(LOCAL_CFG, { title: 'x' }), /not supported/);
});

test('an unknown kind fails loudly rather than silently behaving like linear', () => {
  assert.throws(
    () => provider.launchPadStatus({ ticketProvider: { kind: 'jira' } }, {}),
    /launch pad needs ticketProvider\.kind "linear" or "local"/
  );
});

// The throw is what watch.js's ensureLaunchPad renders verbatim as the launch
// pad's gate text, and `github` is `concertino init`'s DEFAULT kind (shipped
// in config/examples/generic.json and opencode-ollama.json) — so the commonest
// way to reach it is a valid project with no dashboard provider. It must read
// as a provider gate naming the offending kind, never as an internal error.
test('the unresolvable-kind message reads as a provider gate and names the configured kind', () => {
  assert.throws(
    () => provider.launchPadStatus({ ticketProvider: { kind: 'github' } }, {}),
    /^Error: launch pad needs ticketProvider\.kind "linear" or "local" — not "github"$/
  );
  assert.throws(() => provider.launchPadStatus({}, {}), /— none is set$/);
});

// launchpad.js truncates the gate message to one line via
// `f.truncate(msg, cols - 4)` (screens/launchpad.js's own gate-message
// render, `cols` defaulting to 80 — see renderLaunchPad's own
// `Math.max(50, (opts && opts.cols) || 80)`), so a message longer than that
// real budget hides the very kind it exists to name. Short kinds (typos,
// real provider names) fit comfortably and render whole; a kind longer than
// ~11 characters does not — 80 - 4 (the real budget) minus the fixed
// wording around `not "<kind>"` leaves roughly that much room for the kind
// itself, so this also exercises a kind past that length to prove the
// truncation is real, not just assert a budget nothing here ever approaches.
test('the gate message fits the launch pad\'s own truncation budget for a short kind, and is actually truncated for a long one', () => {
  const { truncate } = require('../lib/ui/format');
  // screens/launchpad.js's own `cols - 4`, with `cols` at its 80-column
  // default — the SAME expression the renderer truncates against, not a
  // second, independently-maintained magic number.
  const GATE_MESSAGE_BUDGET = 80 - 4;

  for (const kind of ['github', 'jira', undefined]) {
    try {
      provider.launchPadStatus(kind ? { ticketProvider: { kind } } : {}, {});
      assert.fail('expected a throw for kind ' + kind);
    } catch (e) {
      assert.equal(truncate(e.message, GATE_MESSAGE_BUDGET), e.message,
        'a short kind must render whole, not truncated: ' + e.message);
    }
  }

  // Long enough (> ~11 characters) to overflow GATE_MESSAGE_BUDGET once the
  // fixed `launch pad needs ticketProvider.kind "linear" or "local" — not
  // "…"` wording is accounted for.
  const longKind = 'kubernetes-provider';
  try {
    provider.launchPadStatus({ ticketProvider: { kind: longKind } }, {});
    assert.fail('expected a throw for kind ' + longKind);
  } catch (e) {
    assert.ok(e.message.length > GATE_MESSAGE_BUDGET,
      'test kind must actually exceed the budget to prove anything: ' + e.message.length);
    assert.notEqual(truncate(e.message, GATE_MESSAGE_BUDGET), e.message,
      'a long kind IS truncated by the launch pad\'s single-line render — this is the regression a hardcoded, ' +
      'never-exercised budget would miss');
  }
});

test('local.fetchTickets is what the resolver reaches for under local', () => {
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'local' } }), local);
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'linear' } }), linear);
});

// CON-95 switched MODULES/ALIASES from `{}` to `Object.create(null)` so a
// hand-written `kind` of `constructor`/`toString`/`hasOwnProperty` misses the
// table and falls through to moduleFor()'s loud throw instead of silently
// resolving to an inherited Object.prototype member/function (e.g.
// ALIASES.constructor would otherwise be the Object constructor itself, and
// MODULES.toString would be Object.prototype.toString). Both the evaluator
// and the final-gate skeptic live-probed this manually during CON-95's
// review, but no automated test asserted it — this closes that gap. `{}` and
// `Object.create(null)` behave identically for every OTHER kind, so this is
// the only case that would catch a future "simplification" back to `{}`
// reopening the hazard.
test('kindFor and moduleFor treat prototype-chain kinds as unknown, never as inherited Object.prototype members', () => {
  for (const kind of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const cfg = { ticketProvider: { kind } };

    // kindFor: no alias applies, so the raw value comes back unresolved —
    // never an inherited function/object from ALIASES' prototype chain.
    assert.equal(provider.kindFor(cfg), kind,
      'kindFor must return the raw kind "' + kind + '" unresolved, not an inherited ALIASES member');

    // moduleFor: MODULES misses too, so this must hit the same loud gate
    // every other unknown kind hits — never return an inherited
    // Object.prototype member/function as though it were a provider module.
    assert.throws(
      () => provider.moduleFor(cfg),
      new RegExp('launch pad needs ticketProvider\\.kind "linear" or "local" — not "' + kind + '"$'),
      'moduleFor must throw the unknown-kind gate for "' + kind + '", not resolve an inherited member'
    );
  }
});

// CON-44: `manual` is the pre-local name for the same provider, and
// `concertino validate` tells the user it "reads as local". lib/config.js's
// withDefaults rewrites it, and lib/cli/watch.js's cmdWatch now calls
// withDefaults on its common path (CON-92) — but cmdWatch falls back to the
// raw, un-normalised parsed object when there's no config file, the JSON
// fails to parse, or withDefaults itself throws — so the alias still has to
// resolve HERE for that promise to be true of the dashboard on every path,
// not just the normalised one.
test('a raw, un-normalised "manual" config resolves to the local module', () => {
  const raw = { ticketProvider: { kind: 'manual' } };
  assert.equal(provider.moduleFor(raw), local);
  assert.equal(provider.kindFor(raw), 'local');
});

test('a raw "manual" config passes local\'s own launch pad gate', () => {
  const raw = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'manual' } };
  assert.deepEqual(provider.launchPadStatus(raw, {}), { enabled: true, reason: null, message: null });
  // …and the caller's own config object is never mutated on the way through.
  assert.equal(raw.ticketProvider.kind, 'manual');
});

// teamKey is the Linear query itself; for local it is inert — fetchTickets
// scans tickets/ and only echoes the key back — so the minimal schema-valid
// local config must not be treated as misconfigured.
test('teamKey is required only where it is load-bearing', () => {
  assert.equal(provider.requiresTeamKey({ ticketProvider: { kind: 'linear' } }), true);
  assert.equal(provider.requiresTeamKey({ ticketProvider: { kind: 'local' } }), false);
  assert.equal(provider.requiresTeamKey({ ticketProvider: { kind: 'manual' } }), false);
  assert.equal(provider.requiresTeamKey({}), false);
});

// M-2: every dispatching function's non-linear branch must call through the
// module moduleFor() resolved, never a hardcoded `local.*`. A third entry in
// MODULES would otherwise pass moduleFor() and then silently execute LOCAL's
// implementations against a config that asked for something else — the same
// silent-wrong-provider failure moduleFor()'s throw exists to prevent.
//
// Asserted against the source because `local` is currently the ONLY non-linear
// module, so `local.X` and `mod.X` are behaviourally identical today: no
// runtime test can tell them apart until the third provider exists, which is
// exactly when the bug would ship. Same reasoning as
// test/scripts/ticket-pattern.test.sh's literal-source drift check.
test('the resolver dispatches through the resolved module, never a hardcoded local.*', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/ui/ticket-provider'), 'utf8');
  const body = src.slice(src.indexOf('function launchPadStatus'), src.indexOf('module.exports'));
  const hardcoded = body.split('\n').filter((l) => /(?:^|[^A-Za-z0-9_.])local\.[a-zA-Z]/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(hardcoded, [], 'dispatch bodies must call mod.X, not local.X');
  // The linear ADAPTATIONS are load-bearing and must survive: its positional
  // resolveTeam signature, and the Promise.resolve that makes both
  // fetchTickets branches awaitable for watch.js's unconditional await.
  assert.match(body, /linear\.resolveTeam\(undefined, o\.apiKey, o\.teamKey\)/);
  assert.match(body, /Promise\.resolve\(mod\.fetchTickets\(opts\)\)/);
});

test('both fetchTickets branches are awaitable, including the synchronous local one', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-tp-fetch-'));
  fs.mkdirSync(path.join(root, 'tickets'));
  fs.writeFileSync(path.join(root, 'tickets', 'CON-1.md'), '---\ntitle: One\nstate: backlog\n---\n\nb\n');
  const r = await provider.fetchTickets(LOCAL_CFG, { root, teamKey: 'CON' });
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-1']);
});
