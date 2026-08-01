'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDetailLines, wrap } = require('../lib/ui/ticketDetail');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function ticket(over) {
  return Object.assign({
    identifier: 'CON-9', title: 'The cache never trims descriptions',
    description: 'Descriptions are 79% of the cache; comments are 0.6%.',
    comments: [], commentCount: 0, commentsTruncated: false,
  }, over);
}

// CON-35: this is the one shared renderer both ticketview.js (full-screen)
// and launchpad.js's inline detail pane call — see design.md Decision 2.

test('empty description renders an explicit "(no description)" message, not a blank region', () => {
  const lines = buildDetailLines(ticket({ description: '' }), 70).map(plain);
  assert.ok(lines.some((l) => /\(no description\)/.test(l)));
});

test('a whitespace-only description is treated as empty', () => {
  const lines = buildDetailLines(ticket({ description: '   \n  ' }), 70).map(plain);
  assert.ok(lines.some((l) => /\(no description\)/.test(l)));
});

test('a real description is wrapped into the content lines', () => {
  const lines = buildDetailLines(ticket({}), 70).map(plain);
  assert.ok(lines.some((l) => /Descriptions are 79% of the cache/.test(l)));
});

test('no comments renders "(no comments)"', () => {
  const lines = buildDetailLines(ticket({ comments: [], commentCount: 0 }), 70).map(plain);
  assert.ok(lines.some((l) => /\(no comments\)/.test(l)));
});

test('normal comments render author and body', () => {
  const lines = buildDetailLines(ticket({
    comments: [{ author: 'matt', body: 'PR opened', createdAt: 1000 }],
    commentCount: 1,
  }), 70).map(plain);
  assert.ok(lines.some((l) => /matt/.test(l)));
  assert.ok(lines.some((l) => /PR opened/.test(l)));
});

test('a truncated comment thread stays visible, not silently shortened', () => {
  const lines = buildDetailLines(ticket({
    comments: [{ author: 'matt', body: 'first of many', createdAt: 1000 }],
    commentCount: 214,
    commentsTruncated: true,
  }), 70).map(plain);
  assert.ok(lines.some((l) => /showing 1 of 214/.test(l)));
});

test('an untruncated thread carries no "showing N of M" hint', () => {
  const lines = buildDetailLines(ticket({
    comments: [{ author: 'matt', body: 'only one', createdAt: 1000 }],
    commentCount: 1,
    commentsTruncated: false,
  }), 70).map(plain);
  assert.ok(!lines.some((l) => /showing/.test(l)));
});

test('a missing ticket does not throw', () => {
  assert.doesNotThrow(() => buildDetailLines(null, 70));
});

test('wrap keeps lines within budget', () => {
  const lines = wrap('one two three four five six seven eight nine ten', 20);
  for (const l of lines) assert.ok(l.length <= 20);
});

// --- CON-42: icon vocabulary ------------------------------------------------

test('the DESCRIPTION header is prefixed with the description icon', () => {
  const icons = require('../lib/ui/icons');
  const lines = buildDetailLines(ticket({}), 70).map(plain);
  assert.ok(lines.some((l) => l === icons.description + ' DESCRIPTION'));
});

test('the COMMENTS header, including its (N) count suffix, is prefixed with the comments icon', () => {
  const icons = require('../lib/ui/icons');
  const lines = buildDetailLines(ticket({
    comments: [{ author: 'matt', body: 'PR opened', createdAt: 1000 }],
    commentCount: 3,
  }), 70).map(plain);
  assert.ok(lines.some((l) => l === icons.comments + ' COMMENTS  (3)'));
});

test('a zero-comment COMMENTS header (no count suffix) still carries the comments icon', () => {
  const icons = require('../lib/ui/icons');
  const lines = buildDetailLines(ticket({ comments: [], commentCount: 0 }), 70).map(plain);
  assert.ok(lines.some((l) => l === icons.comments + ' COMMENTS'));
});
