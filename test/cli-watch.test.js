'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// CON-92: lib/cli/watch.js's cmdWatch normalises a successfully-parsed
// config via lib/config.js's withDefaults before handing it to
// lib/ui/watch.js's watch(), falling back to the raw parsed object (or
// `{}`) when normalisation isn't safely possible (design.md Decision 1).
// These tests stub out lib/ui/watch.js's `watch()` (which would otherwise
// put the real terminal into raw mode / the alternate screen buffer, and
// never resolve) to capture exactly the `config` object cmdWatch
// constructs — they exercise cmdWatch's own config-loading logic, not the
// dashboard it hands off to.

function newRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-cli-watch-'));
}

// Replaces lib/ui/watch.js's module.exports with a fake `watch()` that
// captures its `opts` argument and resolves immediately, then calls
// `cmdWatch(args)` and hands the caller both the fake's capture and
// cmdWatch's own return value. Restores the real module afterward so other
// test files (which require the real lib/ui/watch.js) are unaffected.
async function runCmdWatchCapturingConfig(args) {
  const watchPath = require.resolve('../lib/ui/watch');
  const hadCache = Object.prototype.hasOwnProperty.call(require.cache, watchPath);
  const prevEntry = require.cache[watchPath];
  let captured;
  require.cache[watchPath] = {
    id: watchPath,
    filename: watchPath,
    loaded: true,
    exports: {
      watch(opts) { captured = opts; return Promise.resolve(); },
    },
  };
  try {
    delete require.cache[require.resolve('../lib/cli/watch')];
    const { cmdWatch } = require('../lib/cli/watch');
    await cmdWatch(args);
    return captured;
  } finally {
    if (hadCache) require.cache[watchPath] = prevEntry;
    else delete require.cache[watchPath];
    delete require.cache[require.resolve('../lib/cli/watch')];
  }
}

// --- 3.1: spec.md "cmdWatch normalises a parsed config before constructing
// the dashboard" -------------------------------------------------------------

test('a config with the deprecated "manual" kind and a project object is normalised before reaching watch()', async () => {
  const root = newRoot();
  try {
    fs.writeFileSync(path.join(root, 'concertino.config.json'), JSON.stringify({
      project: { name: 'demo' },
      ticketProvider: { kind: 'manual' },
      worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
    }));
    const captured = await runCmdWatchCapturingConfig({ out: root, _: [] });
    assert.equal(captured.root, root);
    assert.equal(captured.config.ticketProvider.kind, 'local', 'the deprecated alias must resolve to "local"');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('other withDefaults() defaults are applied before reaching watch()', async () => {
  const root = newRoot();
  try {
    fs.writeFileSync(path.join(root, 'concertino.config.json'), JSON.stringify({
      project: { name: 'demo' },
      ticketProvider: { kind: 'local' },
      worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
    }));
    const captured = await runCmdWatchCapturingConfig({ out: root, _: [] });
    assert.equal(captured.config.worktree.base, '.concertino/worktrees');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 3.2: spec.md "A missing or malformed config does not prevent
// `concertino watch` from starting" -----------------------------------------

test('no config file at all: watch() still starts, receiving config: {}', async () => {
  const root = newRoot();
  try {
    assert.ok(!fs.existsSync(path.join(root, 'concertino.config.json')));
    const captured = await runCmdWatchCapturingConfig({ out: root, _: [] });
    assert.deepEqual(captured.config, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('config file is not valid JSON: watch() still starts, receiving config: {}', async () => {
  const root = newRoot();
  try {
    fs.writeFileSync(path.join(root, 'concertino.config.json'), '{ not valid json');
    const captured = await runCmdWatchCapturingConfig({ out: root, _: [] });
    assert.deepEqual(captured.config, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('config file is valid JSON but missing project/ticketProvider: watch() still starts, receiving the raw parsed object', async () => {
  const root = newRoot();
  try {
    const raw = { dashboard: { launchPad: { enabled: true } } };
    fs.writeFileSync(path.join(root, 'concertino.config.json'), JSON.stringify(raw));
    const captured = await runCmdWatchCapturingConfig({ out: root, _: [] });
    assert.deepEqual(captured.config, raw, 'must fall back to the raw parsed object, not {}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
