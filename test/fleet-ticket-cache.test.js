'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./support/tmp');
const cache = require('../lib/ui/fleet-ticket-cache');

const entry = (ident, over = {}) => ({ identifier: ident, title: 't', description: 'd', url: 'u', state: { name: 'Todo', type: 'unstarted' },
  assignee: null, priority: 0, estimate: null, labels: [], comments: [], commentCount: 0, commentsTruncated: false, ...over });

test('read: missing file, bad JSON and a schemaVersion mismatch all read as empty', () => {
  const root = mkTmpDir('fleet-cache-');
  assert.deepEqual(cache.read(root), { schemaVersion: 1, tickets: {} });
  fs.mkdirSync(path.join(root, '.concertino', 'cache'), { recursive: true });
  fs.writeFileSync(cache.cachePath(root), '{not json');
  assert.deepEqual(cache.read(root), { schemaVersion: 1, tickets: {} });
  fs.writeFileSync(cache.cachePath(root), JSON.stringify({ schemaVersion: 2, tickets: { 'CON-1': entry('CON-1') } }));
  assert.deepEqual(cache.read(root).tickets, {});
});

test('put/get/write/read round-trip; get is case-insensitive on the identifier', () => {
  const root = mkTmpDir('fleet-cache-');
  let c = cache.read(root);
  c = cache.put(c, entry('CON-1'), 1000);
  assert.equal(cache.get(c, 'con-1').fetchedAt, 1000);
  cache.write(root, c);
  const back = cache.read(root);
  assert.equal(back.tickets['CON-1'].fetchedAt, 1000);
  assert.equal(cache.get(back, 'CON-1').title, 't');
  assert.equal(cache.get(back, 'CON-2'), null);
});

test('isFresh: younger than ttl is fresh, equal or older is not; no fetchedAt is stale', () => {
  assert.equal(cache.isFresh({ fetchedAt: 1000 }, 20999, 20000), true);
  assert.equal(cache.isFresh({ fetchedAt: 1000 }, 21000, 20000), false);
  assert.equal(cache.isFresh({}, 0, 20000), false);
  assert.equal(cache.isFresh(null, 0, 20000), false);
});

test('ttlFromEnv: positive integer wins, anything else is the default', () => {
  assert.equal(cache.ttlFromEnv({}), 20000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: '5000' }), 5000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: '0' }), 20000);
  assert.equal(cache.ttlFromEnv({ CONCERTINO_FLEET_TICKET_TTL_MS: 'soon' }), 20000);
});

test('write is atomic (temp file then rename; no partial JSON visible) and creates the cache dir', () => {
  const root = mkTmpDir('fleet-cache-');
  const c = cache.put(cache.read(root), entry('CON-1'), 1);
  const renames = [];
  const realRename = fs.renameSync;
  fs.renameSync = (a, b) => { renames.push([a, b]); return realRename(a, b); };
  try { cache.write(root, c); } finally { fs.renameSync = realRename; }
  assert.equal(renames.length, 1);
  assert.match(renames[0][0], /fleet-tickets\.json\.\d+\.tmp$/);
  assert.equal(renames[0][1], cache.cachePath(root));
  assert.deepEqual(fs.readdirSync(path.dirname(cache.cachePath(root))).filter((f) => f.endsWith('.tmp')), []);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cache.cachePath(root), 'utf8')));
});

test('putFailure stores a negative entry under the requested id; isBlocked honours retryUntil', () => {
  const c = cache.putFailure({ schemaVersion: 1, tickets: {} }, 'con-9', 'linear: HTTP 429', 100, 160);
  const e = cache.get(c, 'CON-9');
  assert.deepEqual(e, { identifier: 'CON-9', error: 'linear: HTTP 429', fetchedAt: 100, retryUntil: 160 });
  assert.equal(cache.isBlocked(e, 159), true);
  assert.equal(cache.isBlocked(e, 160), false);
  assert.equal(cache.isBlocked(null, 0), false);
  const k = cache.put({ schemaVersion: 1, tickets: {} }, entry('CON-1'), 5, 'con-2');
  assert.ok(cache.get(k, 'CON-2'));
});
