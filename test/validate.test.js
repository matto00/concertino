'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// CON-20: `concertino validate` warns when a launch-pad-enabled project has
// no explicit ticketProvider.teamKey — the derived fallback
// (teamKeyFromConfig's idExample-derived last resort) is exactly the trap
// that shipped this project's own "ABC" placeholder against a real "CON"
// team. This exercises `bin/concertino validate` as a real subprocess (the
// same way a user runs it), not by reaching into cmdValidate directly —
// there is no exported unit-testable seam for it.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');

// The minimal set cmdValidate's own REQUIRED array checks for, plus one
// `gates` entry so that section doesn't fail either — failures would exit
// non-zero and short-circuit before this test's own warning-vs-no-warning
// question is even reached.
function baseConfig(over) {
  return Object.assign(
    {
      harnesses: ['claude-code'],
      project: { name: 'fixture-project', baseBranch: 'main' },
      ticketProvider: { kind: 'linear', idExample: 'ABC-123' },
      specProvider: { kind: 'none' },
      worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
      gates: [{ name: 'test', when: 'always', command: 'true' }],
    },
    over,
  );
}

function runValidate(config, extraArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-validate-'));
  const cfgPath = path.join(dir, 'concertino.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  try {
    const args = [BIN, 'validate', '--config=' + cfgPath, '--out=' + dir].concat(extraArgs || []);
    const out = execFileSync('node', args, { encoding: 'utf8' });
    return { out, status: 0 };
  } catch (e) {
    // cmdValidate only process.exit(1)s on an ERROR-level failure — this
    // fixture is never expected to hit one, but capture status/stdout
    // either way so a future regression fails loudly with the real output
    // rather than an opaque execFileSync throw.
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('launch pad enabled, teamKey absent — validate warns and names ticketProvider.teamKey', () => {
  const { out, status } = runValidate(baseConfig({
    dashboard: { launchPad: { enabled: true } },
  }));
  assert.equal(status, 0, 'a missing teamKey is a warning, not a validation failure:\n' + out);
  assert.match(out, /ticketProvider\.teamKey/);
  assert.match(out, /idExample/);
});

test('launch pad enabled, teamKey present — validate does not warn', () => {
  const { out, status } = runValidate(baseConfig({
    dashboard: { launchPad: { enabled: true } },
    ticketProvider: { kind: 'linear', idExample: 'ABC-123', teamKey: 'CON' },
  }));
  assert.equal(status, 0);
  assert.doesNotMatch(out, /ticketProvider\.teamKey not set/);
});

test('launch pad disabled (absent), teamKey absent — validate does not warn (the fetch path is unreachable)', () => {
  const { out, status } = runValidate(baseConfig({}));
  assert.equal(status, 0);
  assert.doesNotMatch(out, /ticketProvider\.teamKey not set/);
});

test('launch pad explicitly disabled, teamKey absent — validate does not warn', () => {
  const { out, status } = runValidate(baseConfig({
    dashboard: { launchPad: { enabled: false } },
  }));
  assert.equal(status, 0);
  assert.doesNotMatch(out, /ticketProvider\.teamKey not set/);
});

// CON-75: claude-code Ollama-routed with NO gateway configured is now the
// **direct** route — Ollama serves a native Anthropic-compatible endpoint,
// so this is no longer a validation failure (it was, pre-CON-75, per CON-63's
// design.md Decision 4). An incomplete `gateway` (present but no `baseUrl`)
// remains the one failure state, on either route — exercised here as a real
// subprocess so the printed output (not just the underlying
// collectConfigIssues() array) is covered, matching this file's own
// existing convention.

test('providers.ollama.harnesses includes claude-code with no gateway at all — validate passes (CON-75 direct route)', () => {
  const { out, status } = runValidate(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['claude-code'] } },
  }));
  assert.equal(status, 0, 'expected the direct route to validate cleanly:\n' + out);
  assert.doesNotMatch(out, /providers\.ollama\.gateway\.baseUrl.*missing or empty/i);
});

test('providers.ollama.gateway configured but incomplete (no baseUrl) — validate fails and names providers.ollama.gateway.baseUrl', () => {
  const { out, status } = runValidate(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['claude-code'], gateway: {} } },
  }));
  assert.equal(status, 1, 'expected a validation failure exit code:\n' + out);
  assert.match(out, /providers\.ollama\.gateway\.baseUrl/);
});

test('providers.ollama.harnesses includes claude-code WITH a configured gateway — validate passes', () => {
  const { out, status } = runValidate(baseConfig({
    harnesses: ['claude-code'],
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434',
        harnesses: ['claude-code'],
        gateway: { baseUrl: 'http://localhost:4000', apiKeyEnv: 'LITELLM_API_KEY' },
      },
    },
  }));
  assert.equal(status, 0, 'expected validation to pass once a gateway is configured:\n' + out);
  assert.doesNotMatch(out, /gateway\.baseUrl.*missing or empty/i);
});

// --- CON-62: `--ticket <ID>` (tasks.md 4.5, 7.1) ----------------------------
// The valid/invalid/ambiguous/no-override classification itself is unit-
// tested directly against lib/config.js's pure `classifyHarnessOverride`
// (test/config.test.js) and its rendering into collectConfigIssues' emitted
// lines (also test/config.test.js) — those never touch the network. These
// two subprocess-level cases below are the ones reachable WITHOUT a live
// Linear fetch: a non-linear ticketProvider (no fetch attempted at all) and
// a linear provider with no LINEAR_API_KEY (fetchOneTicket's own early
// error, before any network call).

test('omitting --ticket is a complete no-op — no "ticket harness" line at all', () => {
  const { out, status } = runValidate(baseConfig({}));
  assert.equal(status, 0);
  assert.doesNotMatch(out, /ticket harness/i);
});

test('--ticket against a non-linear ticketProvider prints an informational note, never crashes', () => {
  const { out, status } = runValidate(
    baseConfig({ ticketProvider: { kind: 'manual', idExample: 'ABC-123' } }),
    ['--ticket=CON-1'],
  );
  assert.equal(status, 0, out);
  assert.match(out, /--ticket live-checking is only implemented for ticketProvider\.kind "linear"/);
  assert.match(out, /"manual"/);
});

// --- CON-88: agent-merge-permission-preflight -------------------------------
// tasks.md 3.3: confirm the pre-existing byte-identical-output contract this
// file already checks (teamKey/gateway/ticket sections above) still holds
// for the default config (agentMerge.enabled: false, via withDefaults()) —
// the new "Agent-merge" section must add nothing to that output.

test('agentMerge.enabled defaults to false — validate prints no "Agent-merge" section at all', () => {
  const { out, status } = runValidate(baseConfig({}));
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /Agent-merge/);
  assert.doesNotMatch(out, /agentMerge\.permissions/);
});

test('--ticket against a linear provider with no LINEAR_API_KEY fails clearly, before any network call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-validate-'));
  const cfgPath = path.join(dir, 'concertino.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(baseConfig({})));
  try {
    const env = Object.assign({}, process.env);
    delete env.LINEAR_API_KEY;
    execFileSync('node', [BIN, 'validate', '--config=' + cfgPath, '--out=' + dir, '--ticket=CON-1'], {
      encoding: 'utf8', env,
    });
    assert.fail('expected a non-zero exit');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match((e.stdout || '') + (e.stderr || ''), /LINEAR_API_KEY is not set/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- CON-44: local ticket provider — accepted, manual deprecated -----------
test('ticketProvider.kind local is accepted', () => {
  const { out } = runValidate(baseConfig({ ticketProvider: { kind: 'local', idExample: 'CON-1' } }));
  assert.match(out, /ticketProvider/);
  assert.doesNotMatch(out, /must be linear\|github\|local/);
});

test('ticketProvider.kind manual is accepted but warns that it is deprecated', () => {
  const { out } = runValidate(baseConfig({ ticketProvider: { kind: 'manual', idExample: 'ABC-123' } }));
  assert.match(out, /deprecated/);
  assert.match(out, /local/);
});
