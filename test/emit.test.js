'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { emitClaude, emitCodex, emitOpencode, copyAssets, mergeCostHookSettings } = require('../lib/cli/emit');
const { withDefaults } = require('../lib/config');

// CON-98, design.md Decision 4/6, tasks.md 7.4: `concertino-address-failure.md`
// is written for claude-code and NOT for codex/opencode — the equivalent unit
// test called for in place of a full `concertino sync` shell test, following
// the same fixture (config/examples/generic.json) sync-core-resolution.test.sh
// uses for its own throwaway "project" runs.

const REPO = path.resolve(__dirname, '..');
const CORE = path.join(REPO, 'core');

function baseConfig(over) {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'examples', 'generic.json'), 'utf8'));
  return withDefaults(Object.assign({}, raw, over));
}

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-emit-'));
}

// write() (lib/cli/shared.js) logs every file it writes to console — silence
// it for the duration of the emit call so this test's own output stays
// readable, restoring unconditionally afterward.
function silently(fn) {
  const orig = console.log;
  console.log = () => {};
  try { fn(); } finally { console.log = orig; }
}

test('emitClaude writes .claude/commands/concertino-address-failure.md, resolving {{project}}/{{idExample}}', () => {
  const out = tmpOut();
  const c = baseConfig({ harnesses: ['claude-code'], project: { name: 'acme', baseBranch: 'main' }, ticketProvider: { kind: 'github', idExample: '#42' } });
  silently(() => emitClaude(c, out, CORE, false));

  const p = path.join(out, '.claude', 'commands', 'concertino-address-failure.md');
  assert.ok(fs.existsSync(p), 'concertino-address-failure.md should be written');
  const body = fs.readFileSync(p, 'utf8');
  assert.match(body, /acme/, '{{project}} should be resolved');
  assert.match(body, /#42/, '{{idExample}} should be resolved');
  assert.doesNotMatch(body, /\{\{project\}\}|\{\{idExample\}\}/, 'no unresolved template tokens should remain');

  // The ordinary /concertino-deliver command must still be written unchanged
  // — this is additive, not a replacement.
  assert.ok(fs.existsSync(path.join(out, '.claude', 'commands', 'concertino-deliver.md')));
});

test('emitCodex writes no equivalent address-failure prompt file', () => {
  const out = tmpOut();
  const c = baseConfig({ harnesses: ['codex'] });
  silently(() => emitCodex(c, out, CORE, false));

  assert.ok(fs.existsSync(path.join(out, '.codex', 'prompts', 'concertino-deliver.md')),
    'the ordinary codex prompt should still be written');
  assert.equal(fs.existsSync(path.join(out, '.codex', 'prompts', 'concertino-address-failure.md')), false);
  // Defensive: no address-failure anything anywhere under .codex/.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const codexFiles = fs.existsSync(path.join(out, '.codex')) ? walk(path.join(out, '.codex')) : [];
  assert.ok(!codexFiles.some((f) => f.includes('address-failure')));
});

test('emitOpencode writes no equivalent address-failure prompt file', () => {
  const out = tmpOut();
  const c = baseConfig({ harnesses: ['opencode'] });
  silently(() => emitOpencode(c, out, CORE, false));

  assert.ok(fs.existsSync(path.join(out, '.opencode', 'commands', 'concertino-deliver.md')),
    'the ordinary opencode command should still be written');
  assert.equal(fs.existsSync(path.join(out, '.opencode', 'commands', 'concertino-address-failure.md')), false);
});

// track-per-run-cost-spend, tasks.md 1.3: copyAssets() (lib/cli/emit.js)
// already copies EVERY file in core/scripts/ into scripts/concertino/,
// chmod +x only the `.sh` ones — never a per-file allowlist. This is what
// lets `core/scripts/report-cost.sh` and `core/scripts/pricing-table.json`
// reach a rendered project with no code change to this function. Asserted
// generically (every core/scripts/ entry has a same-named counterpart in
// scripts/concertino/) rather than by name, so this test also protects
// whichever NEXT new file core/scripts/ gains.
test('copyAssets copies every core/scripts/ file into scripts/concertino/, chmod +x only .sh', () => {
  const out = tmpOut();
  silently(() => copyAssets(out, CORE, false, true));

  const coreScripts = fs.readdirSync(path.join(CORE, 'scripts'));
  assert.ok(coreScripts.length > 0, 'sanity: core/scripts/ should not be empty');
  for (const f of coreScripts) {
    const dest = path.join(out, 'scripts', 'concertino', f);
    assert.ok(fs.existsSync(dest), `scripts/concertino/${f} should exist after copyAssets`);
    if (f.endsWith('.sh')) {
      const mode = fs.statSync(dest).mode;
      assert.ok(mode & 0o111, `scripts/concertino/${f} should be executable`);
    }
  }
  // The two new files this change adds, named explicitly so a future rename
  // of either still fails loudly here rather than only in the generic loop
  // above.
  assert.ok(fs.existsSync(path.join(out, 'scripts', 'concertino', 'report-cost.sh')));
  assert.ok(fs.existsSync(path.join(out, 'scripts', 'concertino', 'pricing-table.json')));
});

// track-per-run-cost-spend, tasks.md 2.2/design.md Decision 1/3:
// mergeCostHookSettings wires report-cost.sh into BOTH SessionEnd and
// SubagentStop — SessionEnd alone only ever reports the orchestrator role.
function readSettings(out) {
  return JSON.parse(fs.readFileSync(path.join(out, '.claude', 'settings.json'), 'utf8'));
}

test('mergeCostHookSettings: disabled (default) never creates .claude/settings.json', () => {
  const out = tmpOut();
  mergeCostHookSettings(withDefaults(baseConfig({})), out, false);
  assert.equal(fs.existsSync(path.join(out, '.claude', 'settings.json')), false);
});

test('mergeCostHookSettings: enabled on a fresh sync writes both SessionEnd and SubagentStop hook entries', () => {
  const out = tmpOut();
  mergeCostHookSettings(withDefaults(baseConfig({ costTracking: { enabled: true } })), out, false);
  const settings = readSettings(out);
  for (const eventName of ['SessionEnd', 'SubagentStop']) {
    assert.ok(Array.isArray(settings.hooks[eventName]), `${eventName} should be an array`);
    const hasEntry = settings.hooks[eventName].some((e) =>
      e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh'));
    assert.ok(hasEntry, `${eventName} should carry the report-cost.sh command`);
  }
});

test('mergeCostHookSettings: preserves pre-existing unrelated settings and hooks', () => {
  const out = tmpOut();
  fs.mkdirSync(path.join(out, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(out, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(git *)'] },
    hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'some-other-hook.sh' }] }] },
  }));
  mergeCostHookSettings(withDefaults(baseConfig({ costTracking: { enabled: true } })), out, false);
  const settings = readSettings(out);
  assert.deepEqual(settings.permissions.allow, ['Bash(git *)']);
  assert.ok(settings.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === 'some-other-hook.sh')));
  assert.ok(settings.hooks.SessionEnd.some((e) => e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh')));
  assert.ok(settings.hooks.SubagentStop.some((e) => e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh')));
});

test('mergeCostHookSettings: re-running does not duplicate the hook entry', () => {
  const out = tmpOut();
  const c = withDefaults(baseConfig({ costTracking: { enabled: true } }));
  mergeCostHookSettings(c, out, false);
  mergeCostHookSettings(c, out, false);
  const settings = readSettings(out);
  for (const eventName of ['SessionEnd', 'SubagentStop']) {
    const matches = settings.hooks[eventName].filter((e) =>
      e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh'));
    assert.equal(matches.length, 1, `${eventName} should carry exactly one report-cost.sh entry after two syncs`);
  }
});

test('emitClaude wires both mergeAgentMergeSettings and mergeCostHookSettings into the same settings.json', () => {
  const out = tmpOut();
  const c = baseConfig({
    harnesses: ['claude-code'],
    agentMerge: { enabled: true, mergeMethod: 'squash' },
    costTracking: { enabled: true },
  });
  silently(() => emitClaude(c, out, CORE, false));
  const settings = readSettings(out);
  assert.ok(settings.permissions.allow.includes('Bash(gh pr merge:*)'));
  assert.ok(settings.hooks.SessionEnd.some((e) => e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh')));
  assert.ok(settings.hooks.SubagentStop.some((e) => e.hooks.some((h) => h.command === 'scripts/concertino/report-cost.sh')));
});
