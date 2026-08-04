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
    models: { executor: 'llama3.1:70b' },
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

test('providerCommandFlags decorates only codex', () => {
  assert.equal(providerCommandFlags('ollama', 'codex'), '-c model_provider=ollama');
  assert.equal(providerCommandFlags('default', 'codex'), '-c model_provider=openai');
  assert.equal(providerCommandFlags('ollama', 'claude-code'), '');
  assert.equal(providerCommandFlags('ollama', 'opencode'), '');
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

test('launchSpecForTicket: provider:ollama on codex injects the -c flag after the binary', () => {
  const spec = launchSpecForTicket(['provider:ollama'],
    'codex "/concertino-deliver {{TICKET}}"', OLLAMA_CFG);
  assert.equal(spec.command, 'codex -c model_provider=ollama "/concertino-deliver {{TICKET}}"');
  assert.deepEqual(spec.env, { CONCERTINO_PROVIDER: 'ollama' });
});

test('launchSpecForTicket: harness + provider labels compose against the ACTUAL harness', () => {
  // Batch is claude, label swaps to codex — the provider decoration must be
  // codex's flag form, not claude-code's gateway env form.
  const spec = launchSpecForTicket(['harness:codex', 'provider:ollama'], CLAUDE_BATCH, GATEWAY_CFG);
  assert.equal(spec.command, 'codex -c model_provider=ollama "/concertino-deliver {{TICKET}}"');
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
