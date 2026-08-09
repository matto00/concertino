'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { emitClaude, emitCodex, emitOpencode } = require('../lib/cli/emit');
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
