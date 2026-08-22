'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// sync-provenance-diff-preview (CON-128), tasks.md 4.1: the CLI's printed
// provenance report distinguishes a "linked global" (a symlink resolving
// into a git working tree — e.g. `npm link`) from a "plain install" (a
// symlink, or the file itself, with no git ancestry). Exercised as real
// subprocesses invoking the real `bin/concertino diff` through fixture
// symlinks/checkouts — never a reimplementation of the classification logic
// under test (verification standard: couple every assertion to the real
// artifact).
//
// SAFETY: every invocation below runs `bin/concertino` against a throwaway
// fixture directory via `--out=`, never against this repo's own root.

const REPO = path.resolve(__dirname, '..');
const EXAMPLE_CONFIG = path.resolve(REPO, 'config', 'examples', 'generic.json');

function run(binPath, args) {
  const r = spawnSync('node', [binPath].concat(args), { encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
}

function newTarget() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-target-'));
  fs.copyFileSync(EXAMPLE_CONFIG, path.join(dir, 'concertino.config.json'));
  return dir;
}

// A throwaway "installed package" checkout — bin/+lib/+adapters/+core/+config/
// copied fresh from this project, git-initialized so it's a bona fide git
// working-tree root (plays the "dev checkout" role a linked global points
// into). Mirrors test/scripts/sync-core-resolution.test.sh's new_main().
function newDevCheckout() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-devcheckout-'));
  for (const sub of ['bin', 'lib', 'adapters', 'core', 'config']) {
    fs.cpSync(path.join(REPO, sub), path.join(d, sub), { recursive: true });
  }
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(d, 'package.json'));
  spawnSync('git', ['init', '-q'], { cwd: d });
  spawnSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'add', '-A'], { cwd: d });
  spawnSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: d });
  return d;
}

// A throwaway "installed package" checkout with NO git ancestry at all —
// plays the "plain global install" role.
function newPlainCheckout() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-plaincheckout-'));
  for (const sub of ['bin', 'lib', 'adapters', 'core', 'config']) {
    fs.cpSync(path.join(REPO, sub), path.join(d, sub), { recursive: true });
  }
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(d, 'package.json'));
  return d;
}

test('diff prints a linked-global provenance line for a symlink resolving into a git checkout', () => {
  const devCheckout = newDevCheckout();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-link-'));
  const linkedBin = path.join(linkDir, 'concertino');
  fs.symlinkSync(path.join(devCheckout, 'bin', 'concertino'), linkedBin);
  const target = newTarget();
  try {
    const r = run(linkedBin, ['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /symlink →/);
    assert.match(r.out, /install:\s*linked global/);
    assert.match(r.out, new RegExp('dev checkout at ' + devCheckout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(devCheckout, { recursive: true, force: true });
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('diff prints a plain-install provenance line for a symlink resolving outside any git checkout', () => {
  const plainCheckout = newPlainCheckout();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-link-'));
  const linkedBin = path.join(linkDir, 'concertino');
  fs.symlinkSync(path.join(plainCheckout, 'bin', 'concertino'), linkedBin);
  const target = newTarget();
  try {
    const r = run(linkedBin, ['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /symlink →/);
    assert.match(r.out, /install:\s*plain install/);
    assert.doesNotMatch(r.out, /linked global/);
  } finally {
    fs.rmSync(plainCheckout, { recursive: true, force: true });
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('diff classifies a multi-hop symlink chain against its FINAL target, not the first hop', () => {
  const devCheckout = newDevCheckout();
  const hop1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-hop1-'));
  const hop2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-hop2-'));
  const hop1 = path.join(hop1Dir, 'concertino');
  const hop2 = path.join(hop2Dir, 'concertino');
  fs.symlinkSync(path.join(devCheckout, 'bin', 'concertino'), hop1);
  fs.symlinkSync(hop1, hop2);
  const target = newTarget();
  try {
    const r = run(hop2, ['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    // Reports the FINAL realpath target, not the intermediate hop1 symlink.
    assert.match(r.out, new RegExp('symlink →.*' + path.join(devCheckout, 'bin', 'concertino').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(r.out, new RegExp('symlink →.*' + hop1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n'));
    assert.match(r.out, /install:\s*linked global/);
  } finally {
    fs.rmSync(devCheckout, { recursive: true, force: true });
    fs.rmSync(hop1Dir, { recursive: true, force: true });
    fs.rmSync(hop2Dir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('diff prints a plain-install provenance line for a real-file binary invoked directly (no symlink)', () => {
  const plainCheckout = newPlainCheckout();
  const target = newTarget();
  try {
    const realBin = path.join(plainCheckout, 'bin', 'concertino');
    assert.equal(fs.lstatSync(realBin).isSymbolicLink(), false);
    const r = run(realBin, ['diff', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /install:\s*plain install/);
    assert.doesNotMatch(r.out, /symlink →/);
    assert.doesNotMatch(r.out, /linked global/);
  } finally {
    fs.rmSync(plainCheckout, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('sync prints the same provenance report as diff, before any write', () => {
  const target = newTarget();
  try {
    const r = run(path.join(REPO, 'bin', 'concertino'), ['sync', '--out=' + target]);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /binary: /);
    assert.match(r.out, /core:   /);
    // provenance line appears before the first "wrote"/"refreshed" line.
    const provenanceIdx = r.out.indexOf('binary: ');
    const firstWriteIdx = r.out.search(/wrote |refreshed /);
    assert.ok(provenanceIdx >= 0 && firstWriteIdx >= 0 && provenanceIdx < firstWriteIdx);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('a git failure during the linked-global check falls back to plain install rather than throwing', () => {
  // Symlink resolves to a target whose directory has no git ancestry AND
  // whose PATH has no `git` binary at all — exercises gitRun's try/catch
  // fallback (design.md Risks/Trade-offs, tasks.md 1.2).
  const plainCheckout = newPlainCheckout();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-provenance-link-'));
  const linkedBin = path.join(linkDir, 'concertino');
  fs.symlinkSync(path.join(plainCheckout, 'bin', 'concertino'), linkedBin);
  const target = newTarget();
  try {
    const r = spawnSync(process.execPath, [linkedBin, 'diff', '--out=' + target], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PATH: '/nonexistent-bin-dir-for-test' }),
    });
    // No crash: exits successfully (or at least doesn't die on the git
    // check itself) and reports a plain install, never throws.
    assert.match(r.stdout || '', /install:\s*plain install/);
  } finally {
    fs.rmSync(plainCheckout, { recursive: true, force: true });
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
