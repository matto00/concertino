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
