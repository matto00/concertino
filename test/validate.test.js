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

function runValidate(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-validate-'));
  const cfgPath = path.join(dir, 'concertino.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  try {
    const out = execFileSync('node', [BIN, 'validate', '--config=' + cfgPath, '--out=' + dir], {
      encoding: 'utf8',
    });
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
