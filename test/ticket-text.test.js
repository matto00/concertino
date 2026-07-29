'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolve } = require('../lib/ui/ticket-text');

// Builds a fresh temp "main checkout" root and writes a persisted ticket.md
// at the exact deterministic path persist-evidence.sh uses:
//   <root>/.concertino/runs/<ticket>/evidence/ticket.md
function withPersisted(ticket, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-ticket-text-'));
  const dir = path.join(root, '.concertino', 'runs', ticket, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ticket.md'), content, 'utf8');
  return root;
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-ticket-text-'));
}

function cacheWith(tickets) {
  return { fetchedAt: Date.now(), tickets, epics: [] };
}

// --- source preference: persisted file first, cache second, null last -----

test('the persisted ticket.md is preferred over a matching cache entry', () => {
  const root = withPersisted('CON-1', [
    '# CON-1: Persisted title',
    '',
    '## Description',
    '',
    'Persisted description body.',
  ].join('\n'));
  const cache = cacheWith([{ identifier: 'CON-1', title: 'Cache title', description: 'Cache description' }]);
  const result = resolve(root, 'CON-1', cache);
  assert.deepEqual(result, { title: 'Persisted title', description: 'Persisted description body.' });
});

test('the cache is used when no persisted file exists', () => {
  const root = tmpRoot();
  const cache = cacheWith([{ identifier: 'CON-2', title: 'Cache-only title', description: 'Cache-only description' }]);
  const result = resolve(root, 'CON-2', cache);
  assert.deepEqual(result, { title: 'Cache-only title', description: 'Cache-only description' });
});

test('returns null when neither the persisted file nor the cache has the ticket', () => {
  const root = tmpRoot();
  const result = resolve(root, 'CON-3', cacheWith([]));
  assert.equal(result, null);
});

test('never throws even with a missing/empty cache argument', () => {
  const root = tmpRoot();
  assert.doesNotThrow(() => resolve(root, 'CON-4', null));
  assert.equal(resolve(root, 'CON-4', null), null);
  assert.doesNotThrow(() => resolve(root, 'CON-4', {}));
});

// --- title parsing ----------------------------------------------------------

test('parses a well-formed "# CON-1: Some Title" first line', () => {
  const root = withPersisted('CON-5', '# CON-5: Some Title\n\n## Description\n\nbody\n');
  const result = resolve(root, 'CON-5', cacheWith([]));
  assert.equal(result.title, 'Some Title');
});

test('a first line that does not match the # heading shape at all uses the raw line as title, not the cache', () => {
  const root = withPersisted('CON-6', 'Not a heading at all\n\n## Description\n\nbody\n');
  const cache = cacheWith([{ identifier: 'CON-6', title: 'Cache title (should not win)', description: 'x' }]);
  const result = resolve(root, 'CON-6', cache);
  assert.equal(result.title, 'Not a heading at all');
});

test('an unreadable/missing ticket.md falls back to the cache', () => {
  // withPersisted() creates the evidence DIRECTORY but no ticket.md inside it
  // for a different ticket, so CON-7's own file is simply absent.
  const root = tmpRoot();
  const cache = cacheWith([{ identifier: 'CON-7', title: 'From cache', description: 'From cache body' }]);
  const result = resolve(root, 'CON-7', cache);
  assert.deepEqual(result, { title: 'From cache', description: 'From cache body' });
});

// --- description scoping -----------------------------------------------------

test('description is scoped to ## Description, excluding later sections', () => {
  const content = [
    '# CON-8: A ticket with many sections',
    '',
    '## Description',
    '',
    'This is the real description.',
    'It spans multiple lines.',
    '',
    '## Acceptance Criteria',
    '',
    '* first criterion',
    '* second criterion',
    '',
    '## Metadata',
    '',
    '- Priority: High',
    '- URL: https://example.com',
  ].join('\n');
  const root = withPersisted('CON-8', content);
  const result = resolve(root, 'CON-8', cacheWith([]));
  assert.match(result.description, /This is the real description\./);
  assert.match(result.description, /It spans multiple lines\./);
  assert.doesNotMatch(result.description, /Acceptance Criteria/);
  assert.doesNotMatch(result.description, /Priority: High/);
  assert.doesNotMatch(result.description, /Metadata/);
});

test('description falls back to pre-first-heading prose when there is no ## Description heading', () => {
  const content = [
    '# CON-9: An old-convention ticket',
    '',
    'Some intro prose written before the Description convention existed.',
    '',
    '## Acceptance Criteria',
    '',
    '* something',
  ].join('\n');
  const root = withPersisted('CON-9', content);
  const result = resolve(root, 'CON-9', cacheWith([]));
  assert.match(result.description, /Some intro prose written before/);
  assert.doesNotMatch(result.description, /Acceptance Criteria/);
});

test('description falls back to the whole remainder when there are no ## headings at all', () => {
  const content = '# CON-10: No sections here\n\nJust one paragraph, nothing else.';
  const root = withPersisted('CON-10', content);
  const result = resolve(root, 'CON-10', cacheWith([]));
  assert.match(result.description, /Just one paragraph, nothing else\./);
});

// --- blank-title degradation --------------------------------------------------

test('an empty/whitespace-only persisted file falls back to the cache rather than an empty title', () => {
  const root = withPersisted('CON-11', '   \n\n  \n');
  const cache = cacheWith([{ identifier: 'CON-11', title: 'Cache saves the day', description: 'cache body' }]);
  const result = resolve(root, 'CON-11', cache);
  assert.deepEqual(result, { title: 'Cache saves the day', description: 'cache body' });
});

test('an empty persisted file with no cache entry either returns null', () => {
  const root = withPersisted('CON-12', '\n\n');
  const result = resolve(root, 'CON-12', cacheWith([]));
  assert.equal(result, null);
});
