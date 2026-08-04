'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const queueCache = require('../lib/ui/queue-cache');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-queue-cache-'));
}

function seed(root, raw) {
  const dir = path.join(root, '.concertino', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'queue.json'), raw);
  return root;
}

function sampleQueue() {
  return {
    pending: ['CON-2', 'CON-3'],
    inFlight: new Set(['CON-1']),
    maxConcurrent: 1,
    launchCommand: 'claude "/concertino-deliver {{TICKET}}"',
  };
}

// --- path --------------------------------------------------------------

test('the queue cache lives at .concertino/cache/queue.json', () => {
  assert.equal(queueCache.queueCachePath('/repo'), path.join('/repo', '.concertino', 'cache', 'queue.json'));
});

// --- write / read round trip --------------------------------------------

test('write then read round-trips the record', () => {
  const root = tmpRoot();
  queueCache.write(root, sampleQueue(), 'session-1', 1000);
  const record = queueCache.read(root);
  assert.equal(record.sessionId, 'session-1');
  assert.equal(record.writtenAt, 1000);
  assert.equal(record.maxConcurrent, 1);
  assert.equal(record.launchCommand, 'claude "/concertino-deliver {{TICKET}}"');
  assert.deepEqual(record.pending, ['CON-2', 'CON-3']);
  assert.deepEqual(record.inFlight, ['CON-1']);
});

test('write creates the cache directory and leaves no temp files behind', () => {
  const root = tmpRoot();
  queueCache.write(root, sampleQueue(), 'session-1', 1000);
  assert.ok(fs.existsSync(queueCache.queueCachePath(root)));
  assert.deepEqual(fs.readdirSync(path.join(root, '.concertino', 'cache')), ['queue.json']);
});

test('a second write replaces the first', () => {
  const root = tmpRoot();
  queueCache.write(root, sampleQueue(), 'session-1', 1000);
  queueCache.write(root, { pending: [], inFlight: new Set(), maxConcurrent: 2 }, 'session-2', 2000);
  const record = queueCache.read(root);
  assert.equal(record.sessionId, 'session-2');
  assert.deepEqual(record.pending, []);
});

// --- cold reads are never errors ----------------------------------------

test('a missing file reads as no queue (null), not an error', () => {
  assert.equal(queueCache.read(tmpRoot()), null);
});

test('malformed JSON reads as no queue', () => {
  const root = seed(tmpRoot(), '{"pending": [');
  assert.equal(queueCache.read(root), null);
});

test('a truncated write reads as no queue', () => {
  const full = JSON.stringify(queueCache.write(tmpRoot(), sampleQueue(), 'session-1', 1000));
  const root = seed(tmpRoot(), full.slice(0, Math.floor(full.length / 2)));
  assert.equal(queueCache.read(root), null);
});

test('an empty file reads as no queue', () => {
  assert.equal(queueCache.read(seed(tmpRoot(), '')), null);
});

test('a JSON array instead of an object reads as no queue', () => {
  assert.equal(queueCache.read(seed(tmpRoot(), '[1,2,3]')), null);
});

test('JSON null reads as no queue', () => {
  assert.equal(queueCache.read(seed(tmpRoot(), 'null')), null);
});

// --- shape validation (tasks.md 1.2) ------------------------------------

test('a record missing `pending` reads as no queue', () => {
  const root = seed(tmpRoot(), JSON.stringify({ maxConcurrent: 1, writtenAt: 1 }));
  assert.equal(queueCache.read(root), null);
});

test('a record whose `pending` is not an array of strings reads as no queue', () => {
  const root = seed(tmpRoot(), JSON.stringify({ pending: [1, 2], maxConcurrent: 1, writtenAt: 1 }));
  assert.equal(queueCache.read(root), null);
});

test('a record missing `maxConcurrent` reads as no queue', () => {
  const root = seed(tmpRoot(), JSON.stringify({ pending: ['CON-1'], writtenAt: 1 }));
  assert.equal(queueCache.read(root), null);
});

test('a record missing `writtenAt` reads as no queue', () => {
  const root = seed(tmpRoot(), JSON.stringify({ pending: ['CON-1'], maxConcurrent: 1 }));
  assert.equal(queueCache.read(root), null);
});

test('a record with a malformed `inFlight` degrades to an empty array without losing `pending`', () => {
  const root = seed(tmpRoot(), JSON.stringify({
    pending: ['CON-1'], maxConcurrent: 1, writtenAt: 1, inFlight: 'not-an-array',
  }));
  const record = queueCache.read(root);
  assert.deepEqual(record.pending, ['CON-1']);
  assert.deepEqual(record.inFlight, []);
});

// --- isStale -------------------------------------------------------------

test('a fresh record is not stale', () => {
  const record = { writtenAt: 1000 };
  assert.equal(queueCache.isStale(record, 1000 + 60000), false);
});

test('a record older than the default 24h bound is stale', () => {
  const record = { writtenAt: 1000 };
  const now = 1000 + queueCache.DEFAULT_STALE_MS + 1;
  assert.equal(queueCache.isStale(record, now), true);
});

test('a record exactly at the bound is not yet stale, one ms past it is', () => {
  const record = { writtenAt: 1000 };
  assert.equal(queueCache.isStale(record, 1000 + queueCache.DEFAULT_STALE_MS), false);
  assert.equal(queueCache.isStale(record, 1000 + queueCache.DEFAULT_STALE_MS + 1), true);
});

test('a custom staleness bound is respected', () => {
  const record = { writtenAt: 1000 };
  assert.equal(queueCache.isStale(record, 1000 + 5000, 10000), false);
  assert.equal(queueCache.isStale(record, 1000 + 15000, 10000), true);
});

test('a missing/null record is always stale', () => {
  assert.equal(queueCache.isStale(null, Date.now()), true);
  assert.equal(queueCache.isStale(undefined, Date.now()), true);
});

// --- clear -----------------------------------------------------------------

test('clear removes the file and clearing twice is fine', () => {
  const root = tmpRoot();
  queueCache.write(root, sampleQueue(), 'session-1', 1000);
  queueCache.clear(root);
  queueCache.clear(root);
  assert.equal(queueCache.read(root), null);
});

// --- 5.3: the persisted record never carries ticket bodies -----------------

test('a written record contains only ticket ids and queue metadata — no titles or descriptions', () => {
  const root = tmpRoot();
  const queueWithRichTickets = {
    pending: ['CON-2', 'CON-3'],
    inFlight: new Set(['CON-1']),
    maxConcurrent: 1,
    launchCommand: 'claude "/concertino-deliver {{TICKET}}"',
    // Not a real queue.js shape, but proves write() only ever reads the
    // fields it is documented to read — nothing else leaks through even if
    // a caller accidentally attached richer data to the queue object.
    title: 'Gate events carry no duration',
    description: 'sensitive ticket body text',
  };
  queueCache.write(root, queueWithRichTickets, 'session-1', 1000);
  const raw = fs.readFileSync(queueCache.queueCachePath(root), 'utf8');
  assert.doesNotMatch(raw, /Gate events carry no duration/);
  assert.doesNotMatch(raw, /sensitive ticket body text/);
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed).sort(),
    ['inFlight', 'launchCommand', 'maxConcurrent', 'pending', 'perTicket', 'sessionId', 'writtenAt']);
});
