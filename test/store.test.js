'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../lib/ui/store');

function tmpRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  for (const [ticket, lines] of Object.entries(files || {})) {
    const dir = path.join(root, '.concertino', 'runs', ticket);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines);
  }
  return root;
}

test('readEvents returns parsed events', () => {
  const root = tmpRoot({
    'HEL-1': '{"t":1,"kind":"run.start","ticket":"HEL-1"}\n{"t":2,"kind":"note","ticket":"HEL-1"}\n',
  });
  const { events, malformed } = store.readEvents(root, 'HEL-1');
  assert.equal(events.length, 2);
  assert.equal(malformed, 0);
  assert.equal(events[0].kind, 'run.start');
});

test('readEvents counts malformed lines instead of throwing', () => {
  const root = tmpRoot({
    'HEL-2': '{"t":1,"kind":"note","ticket":"HEL-2"}\nnot json\n{"broken\n{"t":3,"kind":"note","ticket":"HEL-2"}\n',
  });
  const { events, malformed } = store.readEvents(root, 'HEL-2');
  assert.equal(events.length, 2);
  assert.equal(malformed, 2);
});

test('readEvents rejects lines missing required fields', () => {
  const root = tmpRoot({ 'HEL-3': '{"kind":"note"}\n{"t":5}\n{"t":6,"kind":"note"}\n' });
  const { events, malformed } = store.readEvents(root, 'HEL-3');
  assert.equal(events.length, 1);
  assert.equal(malformed, 2);
});

test('readEvents on a missing log is empty, not an error', () => {
  const root = tmpRoot({});
  assert.deepEqual(store.readEvents(root, 'NOPE'), { events: [], malformed: 0 });
});

test('readEvents ignores blank lines', () => {
  const root = tmpRoot({ 'HEL-4': '\n{"t":1,"kind":"note","ticket":"HEL-4"}\n\n' });
  const { events, malformed } = store.readEvents(root, 'HEL-4');
  assert.equal(events.length, 1);
  assert.equal(malformed, 0);
});

test('listTickets lists run directories', () => {
  const root = tmpRoot({ 'HEL-1': '', 'HEL-2': '' });
  assert.deepEqual(store.listTickets(root).sort(), ['HEL-1', 'HEL-2']);
});

test('listTickets on a repo with no runs is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  assert.deepEqual(store.listTickets(root), []);
});

test('readAll returns a map keyed by ticket', () => {
  const root = tmpRoot({
    'HEL-1': '{"t":1,"kind":"note","ticket":"HEL-1"}\n',
    'HEL-2': '{"t":2,"kind":"note","ticket":"HEL-2"}\n',
  });
  const all = store.readAll(root);
  assert.equal(all.size, 2);
  assert.equal(all.get('HEL-1').events.length, 1);
});

// --- readAll(root, cache) — incremental, offset-cached reads ----------------
// The logs are append-only, so a cache-aware readAll should cost
// O(bytes appended since the last poll), not O(total log size). These tests
// exercise that contract directly rather than trusting the implementation.

test('readAll(root, cache): unchanged file returns the SAME events array on a second call (no re-parse)', () => {
  const root = tmpRoot({
    'HEL-50': '{"t":1,"kind":"note","ticket":"HEL-50"}\n{"t":2,"kind":"note","ticket":"HEL-50"}\n',
  });
  const cache = store.createEventsCache();

  const first = store.readAll(root, cache).get('HEL-50');
  const second = store.readAll(root, cache).get('HEL-50');

  assert.equal(first.events.length, 2);
  // Reference equality is the only way to prove nothing was re-parsed.
  assert.strictEqual(second.events, first.events);
});

test('readAll(root, cache): appended complete lines are picked up incrementally, in order, with correct malformed accounting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  const root = dir;
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-51');
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, 'events.jsonl');
  fs.writeFileSync(file, '{"t":1,"kind":"note","ticket":"HEL-51"}\nnot json\n');

  const cache = store.createEventsCache();
  const first = store.readAll(root, cache).get('HEL-51');
  assert.equal(first.events.length, 1);
  assert.equal(first.malformed, 1);

  fs.appendFileSync(file, '{"t":2,"kind":"note","ticket":"HEL-51"}\n{"t":3,"kind":"note","ticket":"HEL-51"}\n');
  const second = store.readAll(root, cache).get('HEL-51');

  assert.equal(second.events.length, 3);
  assert.equal(second.malformed, 1);
  assert.deepEqual(second.events.map((e) => e.t), [1, 2, 3]);
});

test('readAll(root, cache): a truncated/rewritten file is read fresh, without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  const root = dir;
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-52');
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, 'events.jsonl');
  fs.writeFileSync(file, '{"t":1,"kind":"note","ticket":"HEL-52"}\n{"t":2,"kind":"note","ticket":"HEL-52"}\n');

  const cache = store.createEventsCache();
  const first = store.readAll(root, cache).get('HEL-52');
  assert.equal(first.events.length, 2);

  // Rewrite with fewer bytes than before — a truncation/rewrite, which
  // should not happen to an append-only log but must not corrupt state.
  fs.writeFileSync(file, '{"t":9,"kind":"note","ticket":"HEL-52"}\n');

  assert.doesNotThrow(() => {
    const second = store.readAll(root, cache).get('HEL-52');
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0].t, 9);
  });
});

test('readAll(root, cache): a ticket removed from disk is absent from the next read and its cache entry is evicted', () => {
  const root = tmpRoot({
    'HEL-53': '{"t":1,"kind":"note","ticket":"HEL-53"}\n',
    'HEL-54': '{"t":1,"kind":"note","ticket":"HEL-54"}\n',
  });
  const cache = store.createEventsCache();

  const first = store.readAll(root, cache);
  assert.equal(first.size, 2);
  assert.equal(cache.size, 2);

  fs.rmSync(path.join(root, '.concertino', 'runs', 'HEL-53'), { recursive: true, force: true });

  const second = store.readAll(root, cache);
  assert.equal(second.has('HEL-53'), false);
  assert.equal(second.has('HEL-54'), true);
  // No unbounded growth: the evicted ticket's cache entry is gone too.
  assert.equal(cache.has('HEL-53'), false);
  assert.equal(cache.size, 1);
});

test('readAll(root) with no cache argument behaves exactly as it does today: a full read, no cross-call persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  const root = dir;
  const runDir = path.join(root, '.concertino', 'runs', 'HEL-55');
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, 'events.jsonl');
  fs.writeFileSync(file, '{"t":1,"kind":"note","ticket":"HEL-55"}\n');

  const first = store.readAll(root).get('HEL-55');
  fs.appendFileSync(file, '{"t":2,"kind":"note","ticket":"HEL-55"}\n');
  const second = store.readAll(root).get('HEL-55');

  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 2);
  // Uncached calls never persist anything across calls, so this is a fresh
  // array every time — never the same reference as a previous call.
  assert.notStrictEqual(second.events, first.events);
});

// --- writeAnswer: the control-plane write -----------------------------------
// O_EXCL is the whole safety property here: two dashboards racing to answer
// the same escalation must not both believe they succeeded.

test('writes the decision as { answer: <value> }', () => {
  const root = tmpRoot({ 'HEL-20': '' });
  const result = store.writeAnswer(root, 'HEL-20', 'approve');
  assert.equal(result.ok, true);
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-20'), 'utf8'));
  assert.deepEqual(written, { answer: 'approve' });
});

test('creates the run directory if it does not already exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-store-'));
  const result = store.writeAnswer(root, 'HEL-21', 'deny');
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(store.answerPath(root, 'HEL-21')), true);
});

test('a second write to an already-answered escalation is refused, not raced', () => {
  const root = tmpRoot({ 'HEL-22': '' });
  const first = store.writeAnswer(root, 'HEL-22', 'approve');
  assert.equal(first.ok, true);

  const second = store.writeAnswer(root, 'HEL-22', 'deny');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'answered');
  assert.match(second.error, /already answered/);

  // The first writer's decision survives — the second write must never have
  // touched the file's contents.
  const written = JSON.parse(fs.readFileSync(store.answerPath(root, 'HEL-22'), 'utf8'));
  assert.deepEqual(written, { answer: 'approve' });
});

test('a write failure is reported, not thrown', () => {
  if (process.getuid && process.getuid() === 0) return;  // root bypasses permission bits
  const root = tmpRoot({ 'HEL-23': '' });
  const dir = store.runDir(root, 'HEL-23');
  fs.chmodSync(dir, 0o500);   // read + execute, no write
  try {
    const result = store.writeAnswer(root, 'HEL-23', 'approve');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'error');
    assert.ok(result.error, 'expected a reported error message');
  } finally {
    fs.chmodSync(dir, 0o700);   // let the temp-dir cleanup remove it
  }
});
