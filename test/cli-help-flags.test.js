'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// CON-85 per-subcommand-help-flags: every `concertino <subcommand>` accepts
// `--help`/`-h`, printing that subcommand's own usage block (sourced from
// the same lib/cli/help.js lookup `concertino help` itself renders from) and
// exiting 0 — taking precedence over the subcommand's own argument
// validation/side effects. Exercised as real subprocesses (mirrors
// test/answer.test.js's/test/completion.test.js's own rationale): several
// of the 14 `cmd*` functions call `process.exit()` on other paths, which
// would kill the test runner's own process if invoked in-process.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const REAL_EMIT_EVENT = path.resolve(__dirname, '..', 'core', 'scripts', 'emit-event.sh');

function run(args) {
  try {
    const out = execFileSync('node', [BIN].concat(args), { encoding: 'utf8' });
    return { out, status: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  }
}

function newOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-help-flags-'));
}

// A throwaway project root usable by `concertino answer`, same shape as
// test/answer.test.js's newRoot() — a real git repo with a copy of the real
// emit-event.sh under scripts/concertino/.
function newAnswerRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-help-flags-answer-'));
  const scriptsDir = path.join(dir, 'scripts', 'concertino');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(REAL_EMIT_EVENT, path.join(scriptsDir, 'emit-event.sh'));
  fs.chmodSync(path.join(scriptsDir, 'emit-event.sh'), 0o755);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------------------
// 6.1 — representative command from each argument-shape family: sync
// (flag-only), update (positional key=value), answer (raw-argv).
// ---------------------------------------------------------------------------

test('sync --help prints sync\'s own usage, exits 0, performs no sync', () => {
  const out = newOut();
  try {
    const { out: text, status } = run(['sync', '--help', '--out=' + out]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino sync \[--config=PATH\]/);
    assert.match(text, /Render the harness files/);
    assert.ok(!fs.existsSync(path.join(out, 'scripts', 'concertino', '.concertino.env')),
      '--help must not perform the sync side effect');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('sync -h behaves identically to --help', () => {
  const out = newOut();
  try {
    const { out: text, status } = run(['sync', '-h', '--out=' + out]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino sync \[--config=PATH\]/);
    assert.ok(!fs.existsSync(path.join(out, 'scripts', 'concertino', '.concertino.env')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('update --help prints update\'s own usage instead of the key=value validation error, exits 0, writes nothing', () => {
  const out = newOut();
  try {
    const { out: text, status } = run(['update', '--help', '--out=' + out]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino update <key=value>/);
    assert.doesNotMatch(text, /usage: concertino update <key=value>/,
      'must print the usage BLOCK, not the positional-argument validation error');
    assert.ok(!fs.existsSync(path.join(out, 'concertino.config.json')), '--help must not write a config');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('update -h takes precedence over the missing key=value positional error', () => {
  const out = newOut();
  try {
    const { out: text, status } = run(['update', '-h', '--out=' + out]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino update <key=value>/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('answer --help prints answer\'s own usage instead of the ticket/value validation error, exits 0, records no escalation', () => {
  const root = newAnswerRoot();
  try {
    const { out: text, status } = run(['answer', '--help', '--out=' + root]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino answer <ticket> <value>/);
    assert.doesNotMatch(text, /usage: concertino answer <ticket> <value>/,
      'must print the usage BLOCK, not the positional-argument validation error');
    assert.ok(!fs.existsSync(path.join(root, '.concertino', 'runs')), '--help must write no run state');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('answer -h behaves identically to --help', () => {
  const root = newAnswerRoot();
  try {
    const { out: text, status } = run(['answer', '-h', '--out=' + root]);
    assert.equal(status, 0, text);
    assert.match(text, /concertino answer <ticket> <value>/);
    assert.ok(!fs.existsSync(path.join(root, '.concertino', 'runs')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6.2 — normal invocation (no --help/-h) is unaffected.
// ---------------------------------------------------------------------------

test('a normal `gates --run=<gate>` invocation still executes the gate (unaffected by the --help check)', () => {
  const out = newOut();
  try {
    fs.writeFileSync(path.join(out, 'concertino.config.json'), JSON.stringify({
      gates: [{ name: 'ok', when: 'always', command: 'echo hello-from-gate' }],
    }));
    const { out: text, status } = run(['gates', '--run=ok', '--out=' + out]);
    assert.equal(status, 0, text);
    assert.match(text, /hello-from-gate/);
    assert.match(text, /ok passed/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a normal `update <key=value>` invocation still writes the config (unaffected by the --help check)', () => {
  const out = newOut();
  const EXAMPLE_CONFIG = path.resolve(__dirname, '..', 'config', 'examples', 'generic.json');
  try {
    fs.copyFileSync(EXAMPLE_CONFIG, path.join(out, 'concertino.config.json'));
    // --dry-run avoids needing a real render target for this fixture; the
    // config write itself happens before cmdSync is invoked either way.
    const { out: text, status } = run(['update', 'project.name=demo', '--out=' + out, '--dry-run']);
    assert.equal(status, 0, text);
    const cfg = JSON.parse(fs.readFileSync(path.join(out, 'concertino.config.json'), 'utf8'));
    assert.equal(cfg.project.name, 'demo');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6.3 — concertino help's aggregate output is unchanged after the help.js
// refactor: every one of the 14 subcommands' sections is still present, in
// the same relative order, followed by --version/help/Docs.
// ---------------------------------------------------------------------------

test('concertino help still lists all 14 subcommands, in the original order, with the Docs footer last', () => {
  const { out: text, status } = run(['help']);
  assert.equal(status, 0, text);
  const order = ['init', 'sync', 'update', 'validate', 'diff', 'doctor', 'watch', 'prune',
    'upgrade', 'gates', 'eject', 'migrate', 'answer', 'completion'];
  // Search forward from the previous match — the intro paragraph above
  // init's own section already mentions "concertino watch" once in passing
  // ("same as concertino watch below"), so a plain indexOf() would find
  // that earlier mention instead of watch's own section header.
  let lastIndex = -1;
  for (const name of order) {
    const idx = text.indexOf('concertino ' + name, lastIndex + 1);
    assert.ok(idx > lastIndex, `expected "concertino ${name}" to appear after the previous command's section`);
    lastIndex = idx;
  }
  const versionIdx = text.indexOf('concertino --version', lastIndex + 1);
  const helpIdx = text.indexOf('concertino help', versionIdx + 1);
  const docsIdx = text.indexOf('Docs:', helpIdx + 1);
  assert.ok(versionIdx > lastIndex, '--version must come after the last subcommand section');
  assert.ok(helpIdx > versionIdx, 'help must come after --version');
  assert.ok(docsIdx > helpIdx, 'Docs footer must come last');
});

// ---------------------------------------------------------------------------
// 6.4 — bare `concertino --help` / bare `concertino -h` (no subcommand
// token): both print the same aggregate help output, exit 0, and never
// launch the dashboard.
// ---------------------------------------------------------------------------

test('bare `concertino --help` prints the same aggregate output as `concertino help` and exits 0', () => {
  const bare = run(['--help']);
  const aggregate = run(['help']);
  assert.equal(bare.status, 0, bare.out);
  assert.equal(bare.out, aggregate.out);
});

test('bare `concertino -h` prints the same aggregate output as `concertino help` and exits 0', () => {
  const bare = run(['-h']);
  const aggregate = run(['help']);
  assert.equal(bare.status, 0, bare.out);
  assert.equal(bare.out, aggregate.out);
});

// ---------------------------------------------------------------------------
// 6.5 — explicit `concertino watch --help` prints watch's own single-command
// usage, not the aggregate `concertino help` listing.
// ---------------------------------------------------------------------------

test('explicit `concertino watch --help` prints watch\'s own usage, not the aggregate help listing', () => {
  const { out: text, status } = run(['watch', '--help']);
  assert.equal(status, 0, text);
  assert.match(text, /concertino watch \[--config=PATH\]/);
  assert.match(text, /Live fleet dashboard/);
  // The aggregate listing's other sections and Docs footer must be absent —
  // this is watch's single-command block only.
  assert.doesNotMatch(text, /concertino init /);
  assert.doesNotMatch(text, /Docs:/);
});

test('explicit `concertino watch -h` behaves identically', () => {
  const { out: text, status } = run(['watch', '-h']);
  assert.equal(status, 0, text);
  assert.match(text, /concertino watch \[--config=PATH\]/);
  assert.doesNotMatch(text, /Docs:/);
});

// ---------------------------------------------------------------------------
// 6.6 — bare `concertino` with no flags at all still launches the dashboard,
// unaffected by the bare-invocation --help/-h carve-out. Exercised in-process
// against lib/cli/watch.js directly (not a bin/concertino subprocess,
// mirroring test/watch.test.js's own mocking approach) since the real
// dashboard blocks on tmux/stdin and would hang the test runner.
// ---------------------------------------------------------------------------

test('cmdWatch with no --help/-h flag still dispatches into the real dashboard (lib/ui/watch)', () => {
  const watchModulePath = require.resolve('../lib/ui/watch');
  let calledWith = null;
  require.cache[watchModulePath] = {
    id: watchModulePath, filename: watchModulePath, loaded: true,
    exports: { watch: (opts) => { calledWith = opts; return Promise.resolve(); } },
  };
  const cliWatchPath = require.resolve('../lib/cli/watch');
  delete require.cache[cliWatchPath];
  try {
    const { cmdWatch } = require('../lib/cli/watch');
    const out = newOut();
    try {
      const result = cmdWatch({ _: [], out });
      assert.ok(calledWith, 'the real lib/ui/watch#watch() must be invoked for a bare/no-flag call');
      assert.equal(calledWith.root, path.resolve(out));
      return result;
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  } finally {
    delete require.cache[watchModulePath];
    delete require.cache[cliWatchPath];
  }
});

test('cmdWatch with --help does NOT dispatch into lib/ui/watch', () => {
  const watchModulePath = require.resolve('../lib/ui/watch');
  let called = false;
  require.cache[watchModulePath] = {
    id: watchModulePath, filename: watchModulePath, loaded: true,
    exports: { watch: () => { called = true; return Promise.resolve(); } },
  };
  const cliWatchPath = require.resolve('../lib/cli/watch');
  delete require.cache[cliWatchPath];
  try {
    const { cmdWatch } = require('../lib/cli/watch');
    cmdWatch({ _: [], help: true });
    assert.equal(called, false, '--help must short-circuit before the real dashboard is ever reached');
  } finally {
    delete require.cache[watchModulePath];
    delete require.cache[cliWatchPath];
  }
});
