'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const presetsCtl = require('../lib/ui/controllers/presets');
const presetsCache = require('../lib/ui/presets-cache');

// Drives the real controller against a minimal ctx, mirroring
// test/controllers-sessions.test.js's own precedent — the real
// presets-cache module (a small, synchronous fs read/write, same reasoning
// test/queue-cache.test.js already applies directly) against a throwaway
// tmp root, rather than a fake.

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-presets-ctl-'));
}

function ctx(over) {
  const S = { mode: 'settings', presets: null };
  return Object.assign({
    S,
    root: tmpRoot(),
    config: { harnesses: ['claude-code', 'codex'], agentMerge: { enabled: true } },
    deps: { presetsCache },
  }, over);
}

const apply = (c, action) => presetsCtl.handle(action, c);

function seedOnDisk(root, presets) {
  presetsCache.write(root, presets);
}

function samplePreset(over) {
  return Object.assign({
    id: 'p1', name: 'fast local', harness: 'claude-code', speed: 'fast',
    provider: 'ollama', agentMerge: true, createdAt: 1000, updatedAt: 1000,
  }, over);
}

// --- open-presets --------------------------------------------------------

test('open-presets reads the on-disk list into a staged working copy and sets mode', () => {
  const c = ctx();
  seedOnDisk(c.root, [samplePreset()]);
  presetsCtl.openPresets(c);
  assert.equal(c.S.mode, 'presets');
  assert.equal(c.S.presets.presets.length, 1);
  assert.equal(c.S.presets.presets[0].name, 'fast local');
  assert.equal(c.S.presets.rowIndex, 0);
  assert.equal(c.S.presets.prompt, null);
  assert.equal(c.S.presets.deleteConfirm, null);
  assert.equal(c.S.presets.saveError, null);
});

test('open-presets computes providerConfigured from ctx.config', () => {
  const withOllama = ctx({ config: { harnesses: [], providers: { ollama: { baseUrl: 'x' } } } });
  presetsCtl.openPresets(withOllama);
  assert.equal(withOllama.S.presets.providerConfigured, true);

  const without = ctx({ config: { harnesses: [] } });
  presetsCtl.openPresets(without);
  assert.equal(without.S.presets.providerConfigured, false);
});

test('open-presets\'s staged copy is independent of the on-disk snapshot (edits do not mutate it)', () => {
  const c = ctx();
  seedOnDisk(c.root, [samplePreset()]);
  presetsCtl.openPresets(c);
  c.S.presets.presets[0].name = 'renamed in memory only';
  const stillOnDisk = presetsCache.read(c.root).presets;
  assert.equal(stillOnDisk[0].name, 'fast local');
});

// controllers/index.js's own stated invariant: "Action-type sets are
// disjoint across controllers." 'open-presets' is owned EXCLUSIVELY by
// controllers/settings.js (which calls presetsCtl.openPresets(ctx) directly
// — see the two tests above) — this controller's own `handle` must return
// `false` for it, not silently duplicate settings.js's case.
test('handle does not own "open-presets" — that belongs to controllers/settings.js', () => {
  const c = ctx();
  assert.equal(apply(c, { type: 'open-presets' }), false);
  assert.equal(c.S.presets, null); // nothing happened
});

// End-to-end proof of the disjointness above, through the REAL dispatch
// path watch.js actually uses (controllers/index.js's applyAction,
// first-match-wins over CONTROLLERS) — not just this file's own `handle`.
test('through the real applyAction dispatch, settings.js\'s case is the one that opens PRESETS', () => {
  const { applyAction } = require('../lib/ui/controllers/index');
  const c = ctx();
  assert.equal(applyAction({ type: 'open-presets' }, c), true);
  assert.equal(c.S.mode, 'presets');
  assert.deepEqual(c.S.presets.presets, []);
});

// --- row navigation --------------------------------------------------------

test('presets-move-row clamps within [0, length - 1]', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ id: 'a' }), samplePreset({ id: 'b' })];
  c.S.presets.rowIndex = 0;
  apply(c, { type: 'presets-move-row', delta: 1 });
  assert.equal(c.S.presets.rowIndex, 1);
  apply(c, { type: 'presets-move-row', delta: 1 });
  assert.equal(c.S.presets.rowIndex, 1); // clamped
  apply(c, { type: 'presets-move-row', delta: -5 });
  assert.equal(c.S.presets.rowIndex, 0); // clamped
});

// --- create ------------------------------------------------------------

test('n (presets-new) opens an empty prompt; committing a name appends a preset with project defaults', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  apply(c, { type: 'presets-new' });
  assert.deepEqual(c.S.presets.prompt, { mode: 'new', value: '', error: null });

  apply(c, { type: 'presets-prompt-type', char: 'n' });
  apply(c, { type: 'presets-prompt-type', char: 'i' });
  apply(c, { type: 'presets-prompt-type', char: 'g' });
  apply(c, { type: 'presets-prompt-type', char: 'h' });
  apply(c, { type: 'presets-prompt-type', char: 't' });
  apply(c, { type: 'presets-commit-prompt' });

  assert.equal(c.S.presets.prompt, null);
  assert.equal(c.S.presets.presets.length, 1);
  const p = c.S.presets.presets[0];
  assert.equal(p.name, 'night');
  assert.equal(p.harness, 'claude-code'); // first configured harness, canonical
  assert.equal(p.speed, 'default');
  assert.equal(p.provider, null);
  assert.equal(p.agentMerge, true); // from ctx.config.agentMerge.enabled
  assert.ok(p.id);
  assert.equal(typeof p.createdAt, 'number');
  assert.equal(c.S.presets.rowIndex, 0); // moved to the new row
});

test('a fresh preset defaults harness to null when the project has no configured harnesses', () => {
  const c = ctx({ config: { harnesses: [] } });
  presetsCtl.openPresets(c);
  apply(c, { type: 'presets-new' });
  apply(c, { type: 'presets-prompt-type', char: 'x' });
  apply(c, { type: 'presets-commit-prompt' });
  assert.equal(c.S.presets.presets[0].harness, null);
});

test('committing an empty (or whitespace-only) name cancels rather than creating a preset', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  apply(c, { type: 'presets-new' });
  apply(c, { type: 'presets-prompt-type', char: ' ' });
  apply(c, { type: 'presets-commit-prompt' });
  assert.equal(c.S.presets.prompt, null);
  assert.deepEqual(c.S.presets.presets, []);
});

test('presets-cancel-prompt discards the in-progress prompt without creating anything', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  apply(c, { type: 'presets-new' });
  apply(c, { type: 'presets-prompt-type', char: 'x' });
  apply(c, { type: 'presets-cancel-prompt' });
  assert.equal(c.S.presets.prompt, null);
  assert.deepEqual(c.S.presets.presets, []);
});

test('presets-prompt-backspace removes the last typed character', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  apply(c, { type: 'presets-new' });
  apply(c, { type: 'presets-prompt-type', char: 'a' });
  apply(c, { type: 'presets-prompt-type', char: 'b' });
  apply(c, { type: 'presets-prompt-backspace' });
  assert.equal(c.S.presets.prompt.value, 'a');
});

// --- rename --------------------------------------------------------------

test('r (presets-rename) opens the prompt seeded with the current name; committing updates it', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset()];
  apply(c, { type: 'presets-rename' });
  assert.deepEqual(c.S.presets.prompt, { mode: 'rename', value: 'fast local', error: null });

  // Clear and retype.
  for (let i = 0; i < 'fast local'.length; i++) apply(c, { type: 'presets-prompt-backspace' });
  for (const ch of 'renamed') apply(c, { type: 'presets-prompt-type', char: ch });
  const before = c.S.presets.presets[0].id;
  const beforeUpdatedAt = c.S.presets.presets[0].updatedAt;
  apply(c, { type: 'presets-commit-prompt' });

  assert.equal(c.S.presets.presets[0].name, 'renamed');
  assert.equal(c.S.presets.presets[0].id, before); // id unchanged
  assert.ok(c.S.presets.presets[0].updatedAt >= beforeUpdatedAt);
});

// --- delete ----------------------------------------------------------------

test('d (presets-open-delete-confirm) captures the selected row; y removes it, anything else cancels', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ id: 'a' }), samplePreset({ id: 'b' })];
  c.S.presets.rowIndex = 1;
  apply(c, { type: 'presets-open-delete-confirm' });
  assert.deepEqual(c.S.presets.deleteConfirm, { index: 1 });

  apply(c, { type: 'presets-cancel-delete' });
  assert.equal(c.S.presets.deleteConfirm, null);
  assert.equal(c.S.presets.presets.length, 2);

  apply(c, { type: 'presets-open-delete-confirm' });
  apply(c, { type: 'presets-confirm-delete' });
  assert.equal(c.S.presets.deleteConfirm, null);
  assert.equal(c.S.presets.presets.length, 1);
  assert.equal(c.S.presets.presets[0].id, 'a');
});

test('deleting does not touch the on-disk file until presets-save', () => {
  const c = ctx();
  seedOnDisk(c.root, [samplePreset({ id: 'a' }), samplePreset({ id: 'b' })]);
  presetsCtl.openPresets(c);
  c.S.presets.rowIndex = 0;
  apply(c, { type: 'presets-open-delete-confirm' });
  apply(c, { type: 'presets-confirm-delete' });
  assert.equal(presetsCache.read(c.root).presets.length, 2); // unchanged on disk
});

// --- field cycling (design.md Decision 4) -----------------------------------

test('h cycles the selected row\'s harness through null + configured harnesses (canonical), wrapping', () => {
  const c = ctx({ config: { harnesses: ['claude-code', 'codex'] } });
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ harness: null })];
  apply(c, { type: 'presets-cycle-harness' });
  assert.equal(c.S.presets.presets[0].harness, 'claude-code');
  apply(c, { type: 'presets-cycle-harness' });
  assert.equal(c.S.presets.presets[0].harness, 'codex');
  apply(c, { type: 'presets-cycle-harness' });
  assert.equal(c.S.presets.presets[0].harness, null); // wraps
});

test('h falls back to [null, claude-code] when the project configures no harnesses', () => {
  const c = ctx({ config: { harnesses: [] } });
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ harness: null })];
  apply(c, { type: 'presets-cycle-harness' });
  assert.equal(c.S.presets.presets[0].harness, 'claude-code');
});

test('s cycles the selected row\'s speed default -> fast -> slow -> default', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ speed: 'default' })];
  apply(c, { type: 'presets-cycle-speed' });
  assert.equal(c.S.presets.presets[0].speed, 'fast');
  apply(c, { type: 'presets-cycle-speed' });
  assert.equal(c.S.presets.presets[0].speed, 'slow');
  apply(c, { type: 'presets-cycle-speed' });
  assert.equal(c.S.presets.presets[0].speed, 'default');
});

test('m toggles the selected row\'s agentMerge', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ agentMerge: false })];
  apply(c, { type: 'presets-toggle-agent-merge' });
  assert.equal(c.S.presets.presets[0].agentMerge, true);
  apply(c, { type: 'presets-toggle-agent-merge' });
  assert.equal(c.S.presets.presets[0].agentMerge, false);
});

test('p cycles the provider only when providers.ollama is configured, and is a no-op otherwise', () => {
  const withOllama = ctx({ config: { harnesses: ['claude-code'], providers: { ollama: { harnesses: ['claude-code'] } } } });
  presetsCtl.openPresets(withOllama);
  withOllama.S.presets.presets = [samplePreset({ harness: 'claude-code', provider: null })];
  apply(withOllama, { type: 'presets-cycle-provider' });
  assert.notEqual(withOllama.S.presets.presets[0].provider, null);

  const without = ctx({ config: { harnesses: ['claude-code'] } });
  presetsCtl.openPresets(without);
  without.S.presets.presets = [samplePreset({ harness: 'claude-code', provider: null })];
  apply(without, { type: 'presets-cycle-provider' });
  assert.equal(without.S.presets.presets[0].provider, null); // unchanged — no-op
});

// --- save (design.md Decision 5) --------------------------------------------

test('presets-save writes a valid staged list to disk and returns to settings', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ id: 'a', name: 'one' }), samplePreset({ id: 'b', name: 'two' })];
  apply(c, { type: 'presets-save' });
  assert.equal(c.S.presets, null);
  assert.equal(c.S.mode, 'settings');
  const onDisk = presetsCache.read(c.root).presets;
  assert.equal(onDisk.length, 2);
  assert.deepEqual(onDisk.map((p) => p.name).sort(), ['one', 'two']);
});

test('presets-save rejects a duplicate name and writes nothing', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ id: 'a', name: 'dup' }), samplePreset({ id: 'b', name: 'dup' })];
  apply(c, { type: 'presets-save' });
  assert.equal(c.S.mode, 'presets'); // stays open
  assert.ok(c.S.presets); // staged state is still there, unwritten
  assert.match(c.S.presets.saveError.join(' '), /duplicate/);
  assert.deepEqual(presetsCache.read(c.root).presets, []); // nothing written
});

test('presets-save rejects an empty name and writes nothing', () => {
  const c = ctx();
  presetsCtl.openPresets(c);
  c.S.presets.presets = [samplePreset({ name: '' })];
  apply(c, { type: 'presets-save' });
  assert.equal(c.S.mode, 'presets');
  assert.match(c.S.presets.saveError.join(' '), /non-empty name/);
  assert.deepEqual(presetsCache.read(c.root).presets, []);
});

// --- Escape (discard) -------------------------------------------------------

test('back-to-settings-from-presets discards every staged change and returns to settings', () => {
  const c = ctx();
  seedOnDisk(c.root, [samplePreset()]);
  presetsCtl.openPresets(c);
  c.S.presets.presets.push(samplePreset({ id: 'new-one', name: 'unsaved' }));
  apply(c, { type: 'back-to-settings-from-presets' });
  assert.equal(c.S.presets, null);
  assert.equal(c.S.mode, 'settings');
  assert.equal(presetsCache.read(c.root).presets.length, 1); // nothing written
});

// --- disjointness from other controllers ------------------------------------

test('handle returns false for an action it does not own', () => {
  const c = ctx();
  assert.equal(presetsCtl.handle({ type: 'not-a-real-action' }, c), false);
});
