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
