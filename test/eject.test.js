'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// CON-84 unify-harness-flag-semantics — eject's --harness now accepts (and
// meaningfully acts on) a comma-separated list, identical in parsing to
// sync/diff's own --harness (design.md, spec.md). Exercised as real
// subprocesses (pattern: test/cli-help-flags.test.js's execFileSync against
// bin/concertino) since cmdEject/cmdSync/cmdDiff call process.exit() on
// several paths, which would kill the test runner's own process if invoked
// in-process.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const EXAMPLE_CONFIG = path.resolve(__dirname, '..', 'config', 'examples', 'generic.json');

// spawnSync (not execFileSync) so stderr is captured on both success and
// failure — execFileSync only exposes stderr via the thrown error on a
// non-zero exit, but several scenarios here need stderr text *and* a zero
// exit in the same assertion (e.g. the codex-skip-but-overall-success case).
function run(args) {
  const r = spawnSync('node', [BIN].concat(args), { encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
}

function newRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-eject-'));
  fs.copyFileSync(EXAMPLE_CONFIG, path.join(dir, 'concertino.config.json'));
  return dir;
}

// ---------------------------------------------------------------------------
// 5.2 — default/single-value --harness path is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

test('eject --role=executor with no --harness and with --harness=claude-code produce identical stdout', () => {
  const root = newRoot();
  try {
    const bare = run(['eject', '--role=executor', '--out=' + root]);
    const explicit = run(['eject', '--role=executor', '--harness=claude-code', '--out=' + root]);
    assert.equal(bare.status, 0, bare.err);
    assert.equal(explicit.status, 0, explicit.err);
    assert.equal(bare.out, explicit.out);
    // Single-harness output carries no multi-harness section header.
    assert.doesNotMatch(bare.out, /# ---- harness:/);
    assert.match(bare.out, /^---\n# concertino:sync v/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5.3 — a valid multi-harness list renders every harness's section, headered.
// ---------------------------------------------------------------------------

test('eject --harness=claude-code,opencode renders two headered sections in list order', () => {
  const root = newRoot();
  try {
    const { out, status, err } = run(['eject', '--role=executor', '--harness=claude-code,opencode', '--out=' + root]);
    assert.equal(status, 0, err);
    const claudeIdx = out.indexOf('# ---- harness: claude-code ----');
    const opencodeIdx = out.indexOf('# ---- harness: opencode ----');
    assert.ok(claudeIdx === 0, 'claude-code section header must come first');
    assert.ok(opencodeIdx > claudeIdx, 'opencode section header must follow claude-code\'s');
    // claude-code's own rendered-file marker appears within its section.
    assert.match(out.slice(claudeIdx, opencodeIdx), /# concertino:sync v/);
    assert.match(out.slice(opencodeIdx), /mode: subagent/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5.4 — an unsupported role for one harness in a valid list is skipped with a
// stderr note, not fatal, when at least one other harness in the list works.
// ---------------------------------------------------------------------------

test('eject --role=skeptic --harness=codex,claude-code skips codex, renders only claude-code (headered), exits 0', () => {
  const root = newRoot();
  try {
    const { out, err, status } = run(['eject', '--role=skeptic', '--harness=codex,claude-code', '--out=' + root]);
    assert.equal(status, 0, err);
    assert.match(err, /codex harness only has executor, evaluator, and auditor/);
    assert.doesNotMatch(out, /# ---- harness: codex ----/);
    assert.match(out, /# ---- harness: claude-code ----/);
    assert.match(out, /name: concertino-skeptic/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5.4a / 5.4b — a globally-invalid role (not a codex-specific restriction)
// fails once, upfront, regardless of how many harnesses were named.
// ---------------------------------------------------------------------------

test('eject --role=bogus --harness=claude-code,opencode prints exactly one "unknown role" error, no stdout, exits non-zero', () => {
  const root = newRoot();
  try {
    const { out, err, status } = run(['eject', '--role=bogus', '--harness=claude-code,opencode', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.equal(out, '');
    const matches = err.match(/unknown role/g) || [];
    assert.equal(matches.length, 1, 'expected exactly one "unknown role" error, got:\n' + err);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('eject --role=bogus --harness=codex produces the same single "unknown role" shape as the multi-harness case', () => {
  const root = newRoot();
  try {
    const { out, err, status } = run(['eject', '--role=bogus', '--harness=codex', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.equal(out, '');
    const matches = err.match(/unknown role/g) || [];
    assert.equal(matches.length, 1, 'expected exactly one "unknown role" error, got:\n' + err);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5.5 — a codex-specific unsupported role with only codex named is fatal,
// unchanged from today's single-harness behavior.
// ---------------------------------------------------------------------------

test('eject --role=skeptic --harness=codex (single, unsupported) exits non-zero with no stdout', () => {
  const root = newRoot();
  try {
    const { out, err, status } = run(['eject', '--role=skeptic', '--harness=codex', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.equal(out, '');
    assert.match(err, /codex harness only has executor, evaluator, and auditor/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5.6 — an unrecognized --harness value is rejected identically by eject,
// sync, and diff, naming the bad value and the valid set, exiting non-zero.
// ---------------------------------------------------------------------------

test('eject --harness=bogus rejects with the bad value and valid set named, exits non-zero, prints no rendered output', () => {
  const root = newRoot();
  try {
    const { out, err, status } = run(['eject', '--role=executor', '--harness=bogus', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.equal(out, '');
    assert.match(err, /unknown harness "bogus"/);
    assert.match(err, /valid: claude-code, codex, opencode/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sync --harness=bogus rejects, exits non-zero, and writes no rendered files', () => {
  const root = newRoot();
  try {
    const { err, status } = run(['sync', '--harness=bogus', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.match(err, /unknown harness "bogus"/);
    assert.match(err, /valid: claude-code, codex, opencode/);
    assert.ok(!fs.existsSync(path.join(root, 'scripts', 'concertino', '.concertino.env')),
      'a rejected --harness must produce no sync side effect');
    assert.ok(!fs.existsSync(path.join(root, '.claude')), 'no harness output directory should be written');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diff --harness=bogus rejects, exits non-zero, and names the bad value plus the valid set', () => {
  const root = newRoot();
  try {
    const { err, status } = run(['diff', '--harness=bogus', '--out=' + root]);
    assert.notEqual(status, 0);
    assert.match(err, /unknown harness "bogus"/);
    assert.match(err, /valid: claude-code, codex, opencode/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
