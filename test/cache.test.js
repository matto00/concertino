'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cache = require('../lib/ui/cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-cache-'));
}

function seed(root, raw) {
  const dir = path.join(root, '.concertino', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'linear.json'), raw);
  return root;
}

const SAMPLE = {
  teamKey: 'CON',
  tickets: [{ identifier: 'CON-1', title: 'Gate events carry no duration', state: { type: 'started' } }],
  epics: [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }],
};

// --- path ------------------------------------------------------------------

test('the cache lives at .concertino/cache/linear.json', () => {
  assert.equal(cache.cachePath('/repo'), path.join('/repo', '.concertino', 'cache', 'linear.json'));
});

// --- cold reads are never errors -------------------------------------------

test('a missing cache reads as empty, not an error', () => {
  assert.deepEqual(cache.read(tmpRoot()), { fetchedAt: null, tickets: [], epics: [] });
});

test('malformed JSON reads as empty, exactly like a malformed event log', () => {
  const root = seed(tmpRoot(), '{"fetchedAt": 1, "tickets": [');
  assert.deepEqual(cache.read(root), { fetchedAt: null, tickets: [], epics: [] });
});

test('a truncated write reads as empty', () => {
  const full = JSON.stringify(cache.write(tmpRoot(), SAMPLE, 1000));
  const root = seed(tmpRoot(), full.slice(0, Math.floor(full.length / 2)));
  assert.equal(cache.read(root).tickets.length, 0);
});

test('an empty file reads as empty', () => {
  assert.deepEqual(cache.read(seed(tmpRoot(), '')), { fetchedAt: null, tickets: [], epics: [] });
});

test('a JSON array instead of an object reads as empty', () => {
  assert.deepEqual(cache.read(seed(tmpRoot(), '[1,2,3]')), { fetchedAt: null, tickets: [], epics: [] });
});

test('JSON null reads as empty', () => {
  assert.deepEqual(cache.read(seed(tmpRoot(), 'null')), { fetchedAt: null, tickets: [], epics: [] });
});

test('a cache with no tickets array reads as empty', () => {
  assert.deepEqual(cache.read(seed(tmpRoot(), '{"fetchedAt":1}')), { fetchedAt: null, tickets: [], epics: [] });
});

test('a non-numeric fetchedAt degrades to null rather than rendering NaN', () => {
  const root = seed(tmpRoot(), '{"fetchedAt":"2026-07-27T00:00:00Z","tickets":[]}');
  assert.equal(cache.read(root).fetchedAt, null);
});

test('a missing epics array degrades to empty without losing the tickets', () => {
  const root = seed(tmpRoot(), '{"fetchedAt":5,"tickets":[{"identifier":"CON-1"}]}');
  const c = cache.read(root);
  assert.equal(c.tickets.length, 1);
  assert.deepEqual(c.epics, []);
});

test('the empty value is a fresh object each time, not shared state', () => {
  const a = cache.empty();
  a.tickets.push('x');
  assert.deepEqual(cache.empty().tickets, []);
});

// --- write / round-trip ----------------------------------------------------

test('write then read round-trips the model', () => {
  const root = tmpRoot();
  cache.write(root, SAMPLE, 1234);
  const c = cache.read(root);
  assert.equal(c.fetchedAt, 1234);
  assert.equal(c.teamKey, 'CON');
  assert.equal(c.tickets[0].identifier, 'CON-1');
  assert.equal(c.epics[0].openCount, 1);
});

test('write stamps fetchedAt itself', () => {
  const root = tmpRoot();
  const before = Date.now();
  cache.write(root, SAMPLE);
  const at = cache.read(root).fetchedAt;
  assert.ok(typeof at === 'number' && at >= before);
});

test('write creates the cache directory', () => {
  const root = tmpRoot();
  cache.write(root, SAMPLE, 1);
  assert.ok(fs.existsSync(cache.cachePath(root)));
});

test('write leaves no temp files behind', () => {
  const root = tmpRoot();
  cache.write(root, SAMPLE, 1);
  assert.deepEqual(fs.readdirSync(cache.cacheDir(root)), ['linear.json']);
});

test('a second write replaces the first', () => {
  const root = tmpRoot();
  cache.write(root, SAMPLE, 1);
  cache.write(root, { teamKey: 'CON', tickets: [], epics: [] }, 2);
  const c = cache.read(root);
  assert.equal(c.fetchedAt, 2);
  assert.equal(c.tickets.length, 0);
});

test('write of an empty result is legal — a team can have no open tickets', () => {
  const root = tmpRoot();
  cache.write(root, {}, 9);
  assert.deepEqual(cache.read(root), { fetchedAt: 9, tickets: [], epics: [], teamKey: null });
});

// --- age -------------------------------------------------------------------

test('age is milliseconds since the fetch', () => {
  assert.equal(cache.age({ fetchedAt: 1000 }, 1000 + 12 * 60 * 1000), 12 * 60 * 1000);
});

test('age of a never-fetched cache is null, not zero', () => {
  assert.equal(cache.age(cache.empty(), 5000), null);
  assert.equal(cache.age(null, 5000), null);
});

test('a clock that went backwards clamps to zero rather than a negative age', () => {
  assert.equal(cache.age({ fetchedAt: 5000 }, 1000), 0);
});

// --- isCold ----------------------------------------------------------------

test('a never-fetched cache is cold', () => {
  assert.equal(cache.isCold(cache.empty()), true);
  assert.equal(cache.isCold(null), true);
});

test('a fetched cache with tickets is not cold', () => {
  assert.equal(cache.isCold({ fetchedAt: 1, tickets: [{ identifier: 'CON-1' }] }), false);
});

test('a fetched but empty cache is cold — same hint, one predicate', () => {
  assert.equal(cache.isCold({ fetchedAt: 1, tickets: [] }), true);
});

// --- clear -----------------------------------------------------------------

test('clear removes the cache and clearing twice is fine', () => {
  const root = tmpRoot();
  cache.write(root, SAMPLE, 1);
  cache.clear(root);
  cache.clear(root);
  assert.equal(cache.isCold(cache.read(root)), true);
});
