'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// sync-provenance-diff-preview (CON-128), tasks.md 4.2/4.4: `cmdDiff` now
// covers every file `sync` writes, not just the subset it covered before —
// the concrete fix for the gap CON-133 was filed about (a local fix to a
// copied script/law/workflow-state-template file, silently clobbered by
// `sync` with no warning from `diff`). Exercised as real subprocesses
// against the real `bin/concertino sync`/`diff`, never a reimplementation
// of `diffFile`/`cmdDiff` — a local edit is made to the REAL rendered
// target file, and the REAL CLI's diff output is asserted against.
//
// SAFETY: every invocation renders only into throwaway `--out=` dirs.

const REPO = path.resolve(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'concertino');
const EXAMPLE_CONFIG = path.resolve(REPO, 'config', 'examples', 'generic.json');

function run(args) {
  const r = spawnSync('node', [BIN].concat(args), { encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
}

function newSyncedTarget(configOverrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-diffcov-'));
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG, 'utf8'));
  Object.assign(cfg, configOverrides || {});
  fs.writeFileSync(path.join(dir, 'concertino.config.json'), JSON.stringify(cfg, null, 2));
  const r = run(['sync', '--out=' + dir]);
  assert.equal(r.status, 0, 'fixture sync must succeed: ' + r.err);
  return dir;
}

test('a fresh sync reports everything unchanged on the very next diff', () => {
  const target = newSyncedTarget();
  try {
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to a copied script is reported as changed by diff (was invisible before this change)', () => {
  const target = newSyncedTarget();
  try {
    const scriptPath = path.join(target, 'scripts', 'concertino', 'cleanup.sh');
    fs.appendFileSync(scriptPath, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /cleanup\.sh/);
    assert.match(r.out, /-.*LOCAL-EDIT-MARKER|LOCAL-EDIT-MARKER/);
    assert.doesNotMatch(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to a nested core/scripts/lib/* file is reported as changed', () => {
  const target = newSyncedTarget();
  try {
    const nestedPath = path.join(target, 'scripts', 'concertino', 'lib', 'git-child-env.sh');
    assert.ok(fs.existsSync(nestedPath), 'fixture must have rendered the nested lib script');
    fs.appendFileSync(nestedPath, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /lib\/git-child-env\.sh|lib\\git-child-env\.sh/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to a law file is reported as changed by diff', () => {
  const target = newSyncedTarget();
  try {
    const lawPath = path.join(target, '.concertino', 'laws', 'systematic-debugging.md');
    fs.appendFileSync(lawPath, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /systematic-debugging\.md/);
    assert.doesNotMatch(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to the workflow-state template is reported as changed by diff', () => {
  const target = newSyncedTarget();
  try {
    const templatePath = path.join(target, '.concertino', 'workflow-state.template.md');
    fs.appendFileSync(templatePath, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /workflow-state\.template\.md/);
    assert.doesNotMatch(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to .claude/commands/concertino-address-failure.md is reported as changed', () => {
  const target = newSyncedTarget();
  try {
    const p = path.join(target, '.claude', 'commands', 'concertino-address-failure.md');
    fs.appendFileSync(p, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /concertino-address-failure\.md/);
    assert.doesNotMatch(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('.claude/settings.json is diffed against the MERGED result, not the raw block, when agentMerge is enabled', () => {
  const target = newSyncedTarget({ agentMerge: { enabled: true, mergeMethod: 'squash' } });
  try {
    const settingsPath = path.join(target, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(Array.isArray(settings.permissions.allow) && settings.permissions.allow.length > 0);
    // A clean sync's settings.json is byte-identical to what diff computes.
    const clean = run(['diff', '--out=' + target]);
    assert.equal(clean.status, 0, clean.err);
    assert.match(clean.out, /0 changed/);
    assert.match(clean.out, /unchanged {2}.*settings\.json/);

    // Removing an entry the merger would re-add shows as changed — proving
    // the diff reflects the MERGED outcome (re-adds the rule) rather than
    // a byte-for-byte compare against a raw unmerged block.
    settings.permissions.allow.pop();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    const dirty = run(['diff', '--out=' + target]);
    assert.equal(dirty.status, 0, dirty.err);
    assert.doesNotMatch(dirty.out, /0 changed/);
    assert.match(dirty.out, /^(?!.*unchanged).*settings\.json/m);
    assert.doesNotMatch(dirty.out, /unchanged {2}.*settings\.json/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('settings.json is NOT diffed at all when neither agentMerge nor costTracking is enabled (sync writes nothing there)', () => {
  const target = newSyncedTarget();
  try {
    assert.equal(fs.existsSync(path.join(target, '.claude', 'settings.json')), false);
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.out, /settings\.json/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to a codex role file is reported as changed', () => {
  const target = newSyncedTarget({ harnesses: ['claude-code', 'codex'] });
  try {
    const p = path.join(target, '.codex', 'roles', 'concertino-executor.md');
    fs.appendFileSync(p, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /concertino-executor\.md/);
    assert.doesNotMatch(r.out, /0 changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a drifted CONCERTINO-managed region in AGENTS.md is reported as changed, hand-authored content untouched', () => {
  const target = newSyncedTarget({ harnesses: ['claude-code', 'codex'] });
  try {
    const p = path.join(target, 'AGENTS.md');
    const original = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, '# My hand-authored project notes\n\nDo not clobber this.\n\n' + original);
    const clean = run(['diff', '--out=' + target]);
    assert.equal(clean.status, 0, clean.err);
    assert.match(clean.out, /unchanged {2}.*AGENTS\.md/);

    const withMarkerDrift = fs.readFileSync(p, 'utf8').replace('CONCERTINO:END', 'STALE-DRIFT\nCONCERTINO:END');
    fs.writeFileSync(p, withMarkerDrift);
    const dirty = run(['diff', '--out=' + target]);
    assert.equal(dirty.status, 0, dirty.err);
    assert.match(dirty.out, /^(?!.*unchanged).*AGENTS\.md/m);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a local edit to .codex/prompts/concertino-deliver.md is reported as changed', () => {
  const target = newSyncedTarget({ harnesses: ['claude-code', 'codex'] });
  try {
    const p = path.join(target, '.codex', 'prompts', 'concertino-deliver.md');
    fs.appendFileSync(p, '\n# LOCAL-EDIT-MARKER\n');
    const r = run(['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /concertino-deliver\.md/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('sync --dry-run writes nothing to the target directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-diffcov-dryrun-'));
  fs.copyFileSync(EXAMPLE_CONFIG, path.join(dir, 'concertino.config.json'));
  try {
    const r = run(['sync', '--out=' + dir, '--dry-run']);
    assert.equal(r.status, 0, r.err);
    assert.equal(fs.existsSync(path.join(dir, 'scripts', 'concertino')), false);
    assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
    assert.equal(fs.existsSync(path.join(dir, '.concertino', 'laws')), false);
    assert.match(r.out, /diff.*for a content-level preview|content-level preview/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
