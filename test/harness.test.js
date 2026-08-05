'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  LAUNCH_TEMPLATES, canonicalHarness, cliLabel, launchTemplate,
  defaultLaunchCommand, resolveTicketHarness, commandForTicket,
} = require('../lib/ui/harness');

const ALL = ['claude-code', 'codex', 'opencode'];

// ---------------------------------------------------------------------------
// launch templates — the CLI invocation shapes themselves

test('claude-code and codex take the prompt as a positional argument', () => {
  assert.equal(LAUNCH_TEMPLATES['claude-code'], 'claude "/concertino-deliver {{TICKET}}"');
  assert.equal(LAUNCH_TEMPLATES.codex, 'codex "/concertino-deliver {{TICKET}}"');
});

// opencode's positional argument is a PROJECT DIRECTORY (opencode.ai/docs/cli:
// `opencode [project]`) — the prompt must go through --prompt or the CLI
// tries to open a directory literally named "/concertino-deliver CON-1".
test('opencode passes the prompt via --prompt, never positionally', () => {
  assert.equal(LAUNCH_TEMPLATES.opencode, 'opencode --prompt "/concertino-deliver {{TICKET}}"');
});

test('launchTemplate accepts both the canonical id and the CLI label', () => {
  assert.equal(launchTemplate('claude-code'), LAUNCH_TEMPLATES['claude-code']);
  assert.equal(launchTemplate('claude'), LAUNCH_TEMPLATES['claude-code']);
  assert.equal(launchTemplate('opencode'), LAUNCH_TEMPLATES.opencode);
  assert.equal(launchTemplate('local-llm'), null);
});

test('canonicalHarness/cliLabel round-trip every implemented harness', () => {
  for (const h of ALL) {
    assert.equal(canonicalHarness(cliLabel(h)), h);
  }
  assert.equal(cliLabel('claude-code'), 'claude');
  assert.equal(cliLabel('codex'), 'codex');
  assert.equal(cliLabel('opencode'), 'opencode');
});

// ---------------------------------------------------------------------------
// defaultLaunchCommand — what `n` runs with no dashboard.launchCommand

test('claude-code wins the default whenever it is configured', () => {
  assert.equal(defaultLaunchCommand({ harnesses: ['claude-code', 'codex'] }), LAUNCH_TEMPLATES['claude-code']);
  assert.equal(defaultLaunchCommand({ harnesses: ['opencode', 'claude-code'] }), LAUNCH_TEMPLATES['claude-code']);
});

test('a codex-only project defaults to the codex CLI', () => {
  assert.equal(defaultLaunchCommand({ harnesses: ['codex'] }), LAUNCH_TEMPLATES.codex);
});

// Regression: the old watch.js inline copy only knew codex-vs-claude, so an
// opencode-only project got `claude "/concertino-deliver ..."`.
test('an opencode-only project defaults to the opencode CLI', () => {
  assert.equal(defaultLaunchCommand({ harnesses: ['opencode'] }), LAUNCH_TEMPLATES.opencode);
});

test('no/empty harnesses degrades to claude-code', () => {
  assert.equal(defaultLaunchCommand({}), LAUNCH_TEMPLATES['claude-code']);
  assert.equal(defaultLaunchCommand({ harnesses: [] }), LAUNCH_TEMPLATES['claude-code']);
});

// ---------------------------------------------------------------------------
// resolveTicketHarness — which labels actually re-dispatch a ticket

test('a single valid, configured harness label resolves', () => {
  assert.equal(resolveTicketHarness(['bug', 'harness:opencode'], ALL), 'opencode');
});

test('no harness label resolves to null', () => {
  assert.equal(resolveTicketHarness(['bug', 'p1'], ALL), null);
  assert.equal(resolveTicketHarness([], ALL), null);
  assert.equal(resolveTicketHarness(null, ALL), null);
});

test('an unimplemented harness label resolves to null (orchestrator hard-stops it, not us)', () => {
  assert.equal(resolveTicketHarness(['harness:local-llm'], ALL), null);
});

test('an ambiguous pair of harness labels resolves to null', () => {
  assert.equal(resolveTicketHarness(['harness:codex', 'harness:opencode'], ALL), null);
});

// A valid label for a harness the project has NOT rendered adapters for must
// not spawn that CLI — it would start a session with no concertino files.
test('a valid but unconfigured harness label resolves to null', () => {
  assert.equal(resolveTicketHarness(['harness:opencode'], ['claude-code']), null);
});

test('an empty configured list means "all implemented" (no filtering)', () => {
  assert.equal(resolveTicketHarness(['harness:codex'], []), 'codex');
});

// ---------------------------------------------------------------------------
// commandForTicket — the per-ticket dispatch itself

const CLAUDE_BATCH = 'claude "/concertino-deliver {{TICKET}}"';

test('a labelled ticket swaps the batch binary for its own harness', () => {
  assert.equal(
    commandForTicket(['harness:codex'], CLAUDE_BATCH, ALL),
    'codex "/concertino-deliver {{TICKET}}"');
  assert.equal(
    commandForTicket(['harness:opencode'], CLAUDE_BATCH, ALL),
    'opencode --prompt "/concertino-deliver {{TICKET}}"');
});

test('an unlabelled ticket keeps the batch command byte-identical', () => {
  assert.equal(commandForTicket(['bug'], CLAUDE_BATCH, ALL), CLAUDE_BATCH);
});

test('invalid/ambiguous/unconfigured labels keep the batch command', () => {
  assert.equal(commandForTicket(['harness:local-llm'], CLAUDE_BATCH, ALL), CLAUDE_BATCH);
  assert.equal(commandForTicket(['harness:codex', 'harness:opencode'], CLAUDE_BATCH, ALL), CLAUDE_BATCH);
  assert.equal(commandForTicket(['harness:opencode'], CLAUDE_BATCH, ['claude-code']), CLAUDE_BATCH);
});

// The batch's agent-merge/speed choices must survive the binary swap — a
// labelled ticket still runs at the speed the operator picked for the batch.
test('batch agent-merge and speed tokens carry over onto the swapped command', () => {
  assert.equal(
    commandForTicket(['harness:codex'], 'claude "/concertino-deliver {{TICKET}} --agent-merge fast"', ALL),
    'codex "/concertino-deliver {{TICKET}} --agent-merge fast"');
  assert.equal(
    commandForTicket(['harness:opencode'], 'claude "/concertino-deliver {{TICKET}} slow"', ALL),
    'opencode --prompt "/concertino-deliver {{TICKET}} slow"');
});

test('a "default" speed batch command swaps with no speed token added', () => {
  assert.equal(
    commandForTicket(['harness:codex'], 'claude "/concertino-deliver {{TICKET}} --no-agent-merge"', ALL),
    'codex "/concertino-deliver {{TICKET}} --no-agent-merge"');
});

test('a label matching the batch harness reproduces an equivalent command', () => {
  assert.equal(commandForTicket(['harness:claude-code'], CLAUDE_BATCH, ALL), CLAUDE_BATCH);
});

// ---------------------------------------------------------------------------
// CON-65: per-ticket provider routing (`provider:<value>` label)

const {
  harnessOfCommand, resolveTicketProvider, providerSpawnEnv, providerCommandFlags,
  launchSpecForTicket,
} = require('../lib/ui/harness');

const OLLAMA_CFG = {
  harnesses: ALL,
  providers: { ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    harnesses: ['codex'],
    // orchestrator is what the codex --oss launch passes to -m (the
    // top-level session plays that role); executor proves the map is
    // per-role, not a single id.
    models: { orchestrator: 'gpt-oss:latest', executor: 'llama3.1:70b' },
  } },
};
const GATEWAY_CFG = JSON.parse(JSON.stringify(OLLAMA_CFG));
GATEWAY_CFG.providers.ollama.gateway = { baseUrl: 'http://127.0.0.1:4000' };
GATEWAY_CFG.providers.ollama.harnesses = ['claude-code', 'codex'];

test('harnessOfCommand maps a command back to its canonical harness', () => {
  assert.equal(harnessOfCommand('claude "/concertino-deliver {{TICKET}}"'), 'claude-code');
  assert.equal(harnessOfCommand('codex -c model_provider=ollama "x"'), 'codex');
  assert.equal(harnessOfCommand('opencode --prompt "x"'), 'opencode');
  assert.equal(harnessOfCommand('my-custom-wrapper --flag'), null);
});

test('provider label aliases fold to the two canonical values', () => {
  assert.equal(resolveTicketProvider(['provider:ollama'], OLLAMA_CFG, 'opencode'), 'ollama');
  assert.equal(resolveTicketProvider(['provider:local'], OLLAMA_CFG, 'opencode'), 'ollama');
  assert.equal(resolveTicketProvider(['provider:subscription'], OLLAMA_CFG, 'codex'), 'default');
  assert.equal(resolveTicketProvider(['provider:cloud'], OLLAMA_CFG, 'codex'), 'default');
});

test('provider label is refused without providers.ollama config', () => {
  assert.equal(resolveTicketProvider(['provider:ollama'], { harnesses: ALL }, 'codex'), null);
});

test('provider:ollama on claude-code requires a configured gateway', () => {
  assert.equal(resolveTicketProvider(['provider:ollama'], OLLAMA_CFG, 'claude-code'), null);
  assert.equal(resolveTicketProvider(['provider:ollama'], GATEWAY_CFG, 'claude-code'), 'ollama');
});

test('provider:default is a no-op (null) on a harness the project does not route', () => {
  assert.equal(resolveTicketProvider(['provider:default'], OLLAMA_CFG, 'opencode'), null);
  assert.equal(resolveTicketProvider(['provider:default'], OLLAMA_CFG, 'codex'), 'default');
});

test('invalid or ambiguous provider labels resolve to null', () => {
  assert.equal(resolveTicketProvider(['provider:together'], OLLAMA_CFG, 'codex'), null);
  assert.equal(resolveTicketProvider(['provider:ollama', 'provider:default'], OLLAMA_CFG, 'codex'), null);
});

test('providerSpawnEnv always carries CONCERTINO_PROVIDER', () => {
  assert.deepEqual(providerSpawnEnv('ollama', OLLAMA_CFG, 'opencode'), { CONCERTINO_PROVIDER: 'ollama' });
  assert.deepEqual(providerSpawnEnv('default', OLLAMA_CFG, 'codex'), { CONCERTINO_PROVIDER: 'default' });
});

test('providerSpawnEnv sets/empties ANTHROPIC_BASE_URL for gateway claude-code', () => {
  assert.deepEqual(providerSpawnEnv('ollama', GATEWAY_CFG, 'claude-code'),
    { CONCERTINO_PROVIDER: 'ollama', ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' });
  assert.deepEqual(providerSpawnEnv('default', GATEWAY_CFG, 'claude-code'),
    { CONCERTINO_PROVIDER: 'default', ANTHROPIC_BASE_URL: '' });
});

// Codex ignores `model_providers` in a project-local config.toml, so the
// original `-c model_provider=ollama` named a provider it could not resolve
// and killed the run with `unknown input item type: "additional_tools"`.
// The supported route is the --oss flag pair, with -m passed explicitly so a
// spawned window never blocks on Codex's interactive model picker.
test('providerCommandFlags emits codex\'s supported --oss flags, and only for codex', () => {
  assert.equal(providerCommandFlags('ollama', 'codex', OLLAMA_CFG),
    '--oss --local-provider ollama -m gpt-oss:latest');
  // Nothing for the hosted default — naming a provider is what broke before.
  assert.equal(providerCommandFlags('default', 'codex', OLLAMA_CFG), '');
  assert.equal(providerCommandFlags('ollama', 'claude-code', OLLAMA_CFG), '');
  assert.equal(providerCommandFlags('ollama', 'opencode', OLLAMA_CFG), '');
});

test('providerCommandFlags omits -m when no orchestrator model is configured', () => {
  const noModel = { providers: { ollama: { baseUrl: 'http://x', harnesses: [], models: {} } } };
  assert.equal(providerCommandFlags('ollama', 'codex', noModel), '--oss --local-provider ollama');
});

test('launchSpecForTicket: unlabelled ticket is byte-identical, env null', () => {
  const spec = launchSpecForTicket(['bug'], CLAUDE_BATCH, OLLAMA_CFG);
  assert.equal(spec.command, CLAUDE_BATCH);
  assert.equal(spec.env, null);
});

test('launchSpecForTicket: provider:ollama on an opencode batch injects env only', () => {
  const spec = launchSpecForTicket(['provider:ollama'],
    'opencode --prompt "/concertino-deliver {{TICKET}}"', OLLAMA_CFG);
  assert.equal(spec.command, 'opencode --prompt "/concertino-deliver {{TICKET}}"');
  assert.deepEqual(spec.env, { CONCERTINO_PROVIDER: 'ollama' });
});

test('launchSpecForTicket: provider:ollama on codex injects the --oss flags after the binary', () => {
  const spec = launchSpecForTicket(['provider:ollama'],
    'codex "/concertino-deliver {{TICKET}}"', OLLAMA_CFG);
  assert.equal(spec.command,
    'codex --oss --local-provider ollama -m gpt-oss:latest "/concertino-deliver {{TICKET}}"');
  assert.deepEqual(spec.env, { CONCERTINO_PROVIDER: 'ollama' });
});

test('launchSpecForTicket: harness + provider labels compose against the ACTUAL harness', () => {
  // Batch is claude, label swaps to codex — the provider decoration must be
  // codex's flag form, not claude-code's gateway env form.
  const spec = launchSpecForTicket(['harness:codex', 'provider:ollama'], CLAUDE_BATCH, GATEWAY_CFG);
  assert.equal(spec.command,
    'codex --oss --local-provider ollama -m gpt-oss:latest "/concertino-deliver {{TICKET}}"');
  assert.deepEqual(spec.env, { CONCERTINO_PROVIDER: 'ollama' });
});

test('launchSpecForTicket: claude-code gateway flip rides env, command untouched', () => {
  const spec = launchSpecForTicket(['provider:ollama'], CLAUDE_BATCH, GATEWAY_CFG);
  assert.equal(spec.command, CLAUDE_BATCH);
  assert.deepEqual(spec.env,
    { CONCERTINO_PROVIDER: 'ollama', ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' });
});

test('launchSpecForTicket: custom (unrecognised) commands are never decorated', () => {
  const spec = launchSpecForTicket(['provider:ollama'], 'my-wrapper {{TICKET}}', OLLAMA_CFG);
  assert.equal(spec.command, 'my-wrapper {{TICKET}}');
  assert.equal(spec.env, null);
});

// ---------------------------------------------------------------------------
// CON-69: per-row choice helpers

const { providerChoices, launchSpecForChoices } = require('../lib/ui/harness');

test('providerChoices: null-only without config; validity mirrors the label rules', () => {
  assert.deepEqual(providerChoices({}, 'codex'), [null]);
  assert.deepEqual(providerChoices(OLLAMA_CFG, 'codex'), [null, 'ollama', 'default']);
  assert.deepEqual(providerChoices(OLLAMA_CFG, 'opencode'), [null, 'ollama']);
  // claude-code without a gateway cannot flip to ollama at all
  assert.deepEqual(providerChoices(OLLAMA_CFG, 'claude-code'), [null]);
  assert.deepEqual(providerChoices(GATEWAY_CFG, 'claude'), [null, 'ollama', 'default']);
});

test('launchSpecForChoices builds the batch-shaped command for explicit choices', () => {
  const spec = launchSpecForChoices({ harness: 'codex', speed: 'fast', agentMerge: false }, OLLAMA_CFG);
  assert.equal(spec.command, 'codex "/concertino-deliver {{TICKET}} --no-agent-merge fast"');
  assert.equal(spec.env, null);
});

test('launchSpecForChoices decorates provider exactly like the label path', () => {
  const spec = launchSpecForChoices(
    { harness: 'codex', speed: 'default', agentMerge: true, provider: 'ollama' }, OLLAMA_CFG);
  assert.match(spec.command, /^codex --oss --local-provider ollama -m /);
  assert.deepEqual(spec.env, { CONCERTINO_PROVIDER: 'ollama' });
});

test('launchSpecForChoices returns null for an unimplemented harness', () => {
  assert.equal(launchSpecForChoices({ harness: 'local-llm', speed: 'fast' }, OLLAMA_CFG), null);
});

// --- the models preview must follow the provider (CON-65 follow-up) ---------

test('resolveModelsForPlan passes the provider through as CONCERTINO_PROVIDER', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { resolveModelsForPlan } = require('../lib/ui/launcher');
  // A stub resolve-speed.sh that simply echoes what it was given, so this
  // pins the SEAM (env reaches the script) without depending on jq or on a
  // rendered speeds.json.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-rsp-'));
  const dir = path.join(root, 'scripts', 'concertino');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'resolve-speed.sh');
  fs.writeFileSync(script,
    '#!/usr/bin/env bash\nprintf \'{"speed":"%s","harness":"%s","provider":"%s"}\' "$1" "$2" "${CONCERTINO_PROVIDER:-unset}"\n');
  fs.chmodSync(script, 0o755);

  assert.deepEqual(resolveModelsForPlan(root, 'fast', 'codex', 'ollama'),
    { speed: 'fast', harness: 'codex', provider: 'ollama' });
  // Omitted -> the script sees no override and falls back to project routing.
  assert.deepEqual(resolveModelsForPlan(root, 'fast', 'codex'),
    { speed: 'fast', harness: 'codex', provider: 'unset' });
  fs.rmSync(root, { recursive: true, force: true });
});

// --- session naming: make a fleet legible in Remote Control ----------------
// With Remote Control on for all sessions, every spawned run registers with
// claude.ai under its own name. Unnamed, they arrive as
// `<hostname>-graceful-unicorn` or a summary of the first prompt, which is
// unreadable on a phone — the surface RC exists to serve.

const { sessionNameFor, withSessionName, SESSION_NAME_MAX } = require('../lib/ui/harness');

test('sessionNameFor combines the ticket id and title', () => {
  assert.equal(sessionNameFor('CON-79', 'Codex prompt not expanded'),
    'CON-79 Codex prompt not expanded');
});

test('sessionNameFor falls back to the bare id when no title is known', () => {
  assert.equal(sessionNameFor('CON-79', null), 'CON-79');
  assert.equal(sessionNameFor('CON-79', '   '), 'CON-79');
});

test('sessionNameFor strips what would break a quoted shell word, keeping ordinary punctuation', () => {
  const n = sessionNameFor('CON-1', 'He said "hi" `rm -rf` $HOME \\ done');
  assert.doesNotMatch(n, /["`$\\]/);
  assert.match(n, /^CON-1 /);
  // Hyphens/parens/slashes are ordinary title text and must survive.
  assert.equal(sessionNameFor('CON-62', 'Per-ticket harness (claude-code / codex)'),
    'CON-62 Per-ticket harness (claude-code / codex)');
});

test('sessionNameFor flattens control characters and collapses whitespace', () => {
  assert.equal(sessionNameFor('CON-1', 'tab\there\nand   spaces'), 'CON-1 tab here and spaces');
});

test('sessionNameFor truncates long titles with an ellipsis', () => {
  const n = sessionNameFor('CON-1', 'x'.repeat(200));
  assert.ok(n.length <= SESSION_NAME_MAX, `got ${n.length}`);
  assert.match(n, /…$/);
});

test('withSessionName inserts -n immediately after the claude binary', () => {
  assert.equal(
    withSessionName('claude "/concertino-deliver {{TICKET}}"', 'CON-79 title'),
    'claude -n "CON-79 title" "/concertino-deliver {{TICKET}}"');
});

test('withSessionName leaves the {{TICKET}} placeholder intact for submitTicket', () => {
  const out = withSessionName('claude "/concertino-deliver {{TICKET}} --agent-merge"', 'CON-1 t');
  assert.match(out, /\{\{TICKET\}\}/);
});

test('withSessionName is a no-op for harnesses that cannot be named at launch', () => {
  // codex exposes --name only for `codex remote-control` server mode;
  // opencode has no equivalent. Guessing a flag would break the spawn.
  const codex = 'codex "/concertino-deliver {{TICKET}}"';
  const oc = 'opencode --prompt "/concertino-deliver {{TICKET}}"';
  assert.equal(withSessionName(codex, 'CON-1 t'), codex);
  assert.equal(withSessionName(oc, 'CON-1 t'), oc);
});

test('withSessionName defers to a name the operator already set', () => {
  const named = 'claude -n "mine" "/concertino-deliver {{TICKET}}"';
  assert.equal(withSessionName(named, 'CON-1 t'), named);
  const long = 'claude --name mine "/concertino-deliver {{TICKET}}"';
  assert.equal(withSessionName(long, 'CON-1 t'), long);
});

test('withSessionName is a no-op with no name, and on an unrecognised binary', () => {
  const c = 'claude "/concertino-deliver {{TICKET}}"';
  assert.equal(withSessionName(c, ''), c);
  assert.equal(withSessionName('my-wrapper {{TICKET}}', 'CON-1 t'), 'my-wrapper {{TICKET}}');
});
