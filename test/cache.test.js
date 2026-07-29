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
  assert.deepEqual(cache.read(seed(tmpRoot(), '{"schemaVersion":2,"fetchedAt":1}')), { fetchedAt: null, tickets: [], epics: [] });
});

test('a non-numeric fetchedAt degrades to null rather than rendering NaN', () => {
  const root = seed(tmpRoot(), '{"schemaVersion":2,"fetchedAt":"2026-07-27T00:00:00Z","tickets":[]}');
  assert.equal(cache.read(root).fetchedAt, null);
});

test('a missing epics array degrades to empty without losing the tickets', () => {
  const root = seed(tmpRoot(), '{"schemaVersion":2,"fetchedAt":5,"tickets":[{"identifier":"CON-1"}]}');
  const c = cache.read(root);
  assert.equal(c.tickets.length, 1);
  assert.deepEqual(c.epics, []);
});

test('the empty value is a fresh object each time, not shared state', () => {
  const a = cache.empty();
  a.tickets.push('x');
  assert.deepEqual(cache.empty().tickets, []);
});

// --- schema versioning -------------------------------------------------------
// CON-35: a cache written before `priority` existed must never be misread as
// if every ticket's priority were 0/None. See design.md Decision 1.

test('a cache file with no schemaVersion field reads as empty (stale-shape, not partially-priority-less)', () => {
  const root = seed(tmpRoot(), JSON.stringify(SAMPLE));
  assert.deepEqual(cache.read(root), { fetchedAt: null, tickets: [], epics: [] });
});

test('a cache file with an older schemaVersion reads as empty', () => {
  const root = seed(tmpRoot(), JSON.stringify(Object.assign({ schemaVersion: 1 }, SAMPLE)));
  assert.deepEqual(cache.read(root), { fetchedAt: null, tickets: [], epics: [] });
});

test('a cache file with the current schemaVersion reads normally', () => {
  const root = seed(tmpRoot(), JSON.stringify(Object.assign({ schemaVersion: cache.CACHE_SCHEMA_VERSION, fetchedAt: 1 }, SAMPLE)));
  const c = cache.read(root);
  assert.equal(c.tickets.length, 1);
  assert.equal(c.tickets[0].identifier, 'CON-1');
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

test('write stamps the current schemaVersion, and read round-trips priority unaltered', () => {
  const root = tmpRoot();
  const withPriority = Object.assign({}, SAMPLE, {
    tickets: [
      { identifier: 'CON-1', title: 'x', priority: 0 },
      { identifier: 'CON-2', title: 'y', priority: 1 },
      { identifier: 'CON-3', title: 'z', priority: null },
    ],
  });
  cache.write(root, withPriority, 1);
  const c = cache.read(root);
  assert.strictEqual(c.tickets[0].priority, 0);
  assert.strictEqual(c.tickets[1].priority, 1);
  assert.strictEqual(c.tickets[2].priority, null);

  const raw = JSON.parse(fs.readFileSync(cache.cachePath(root), 'utf8'));
  assert.equal(raw.schemaVersion, cache.CACHE_SCHEMA_VERSION);
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
  assert.deepEqual(cache.read(root), { fetchedAt: 9, tickets: [], epics: [], teamKey: null, truncated: false });
});

// --- truncated ---------------------------------------------------------------
// design.md Decision 4: no schema version bump — a cache written before
// `truncated` existed was, in fact, not truncated by MAX_TICKETS (the concept
// didn't exist yet), so defaulting a missing value to `false` is simply true.

test('write then read round-trips truncated: true', () => {
  const root = tmpRoot();
  cache.write(root, Object.assign({}, SAMPLE, { truncated: true }), 1);
  assert.equal(cache.read(root).truncated, true);
});

test('write then read round-trips truncated: false', () => {
  const root = tmpRoot();
  cache.write(root, Object.assign({}, SAMPLE, { truncated: false }), 1);
  assert.equal(cache.read(root).truncated, false);
});

test('a pre-existing cache file with no truncated field reads as false', () => {
  const root = seed(
    tmpRoot(),
    JSON.stringify(Object.assign({ schemaVersion: cache.CACHE_SCHEMA_VERSION, fetchedAt: 1 }, SAMPLE)),
  );
  assert.equal(cache.read(root).truncated, false);
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
