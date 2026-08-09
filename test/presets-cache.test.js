'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const presetsCache = require('../lib/ui/presets-cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-presets-cache-'));
}

function seed(root, raw) {
  const dir = path.join(root, '.concertino', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'presets.json'), raw);
  return root;
}

function samplePreset(over) {
  return Object.assign({
    id: 'preset-1',
    name: 'fast local',
    harness: 'claude-code',
    speed: 'fast',
    provider: 'ollama',
    agentMerge: true,
    createdAt: 1000,
    updatedAt: 1000,
  }, over);
}

// --- path --------------------------------------------------------------

test('the presets cache lives at .concertino/cache/presets.json', () => {
  assert.equal(presetsCache.presetsCachePath('/repo'), path.join('/repo', '.concertino', 'cache', 'presets.json'));
});

// --- write / read round trip --------------------------------------------

test('write then read round-trips the list', () => {
  const root = tmpRoot();
  presetsCache.write(root, [samplePreset()]);
  const { presets } = presetsCache.read(root);
  assert.equal(presets.length, 1);
  assert.deepEqual(presets[0], samplePreset());
});

test('write creates the cache directory and leaves no temp files behind', () => {
  const root = tmpRoot();
  presetsCache.write(root, [samplePreset()]);
  assert.ok(fs.existsSync(presetsCache.presetsCachePath(root)));
  assert.deepEqual(fs.readdirSync(path.join(root, '.concertino', 'cache')), ['presets.json']);
});

test('a second write replaces the first', () => {
  const root = tmpRoot();
  presetsCache.write(root, [samplePreset()]);
  presetsCache.write(root, []);
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('null/undefined harness and provider round-trip unchanged', () => {
  const root = tmpRoot();
  presetsCache.write(root, [samplePreset({ harness: null, provider: null })]);
  const { presets } = presetsCache.read(root);
  assert.equal(presets[0].harness, null);
  assert.equal(presets[0].provider, null);
});

// --- cold reads are never errors ----------------------------------------

test('a missing file reads as an empty preset list, not an error', () => {
  assert.deepEqual(presetsCache.read(tmpRoot()), { presets: [] });
});

test('malformed JSON reads as an empty preset list', () => {
  const root = seed(tmpRoot(), '{"presets": [');
  assert.deepEqual(presetsCache.read(root), { presets: [] });
});

test('an empty file reads as an empty preset list', () => {
  assert.deepEqual(presetsCache.read(seed(tmpRoot(), '')), { presets: [] });
});

test('a JSON array instead of an object reads as an empty preset list', () => {
  assert.deepEqual(presetsCache.read(seed(tmpRoot(), '[1,2,3]')), { presets: [] });
});

test('JSON null reads as an empty preset list', () => {
  assert.deepEqual(presetsCache.read(seed(tmpRoot(), 'null')), { presets: [] });
});

test('a non-array `presets` field reads as an empty preset list', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: 'nope' }));
  assert.deepEqual(presetsCache.read(root), { presets: [] });
});

// --- per-entry shape validation (tasks.md 1.2) --------------------------

test('one malformed entry among valid ones is dropped, not the whole list', () => {
  const root = seed(tmpRoot(), JSON.stringify({
    presets: [samplePreset({ id: 'good-1' }), { id: 'bad', name: '' }, samplePreset({ id: 'good-2' })],
  }));
  const { presets } = presetsCache.read(root);
  assert.deepEqual(presets.map((p) => p.id), ['good-1', 'good-2']);
});

test('an entry with an invalid harness is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: [samplePreset({ harness: 'gpt' })] }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('an entry with an invalid speed is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: [samplePreset({ speed: 'ludicrous' })] }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('an entry with an invalid provider is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: [samplePreset({ provider: 'openai' })] }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('an entry with a non-boolean agentMerge is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: [samplePreset({ agentMerge: 'yes' })] }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('an entry missing id/name is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({
    presets: [samplePreset({ id: '' }), samplePreset({ name: '' })],
  }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

test('an entry with non-numeric createdAt/updatedAt is dropped', () => {
  const root = seed(tmpRoot(), JSON.stringify({ presets: [samplePreset({ createdAt: 'now' })] }));
  assert.deepEqual(presetsCache.read(root).presets, []);
});

// --- temp-file-and-rename write behavior --------------------------------

test('a truncated write reads as an empty preset list', () => {
  const full = JSON.stringify({ presets: [samplePreset()] });
  const root = seed(tmpRoot(), full.slice(0, Math.floor(full.length / 2)));
  assert.deepEqual(presetsCache.read(root).presets, []);
});
