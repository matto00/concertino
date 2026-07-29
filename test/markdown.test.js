'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { toPlainText } = require('../lib/ui/markdown');

test('strips heading markers', () => {
  assert.equal(toPlainText('# Heading one'), 'Heading one');
  assert.equal(toPlainText('### Heading three'), 'Heading three');
});

test('strips blockquote markers', () => {
  assert.equal(toPlainText('> quoted text'), 'quoted text');
  assert.equal(toPlainText('>> nested quote'), 'nested quote');
});

test('converts bullet markers to a plain bullet glyph', () => {
  assert.equal(toPlainText('- item one'), '• item one');
  assert.equal(toPlainText('* item two'), '• item two');
  assert.equal(toPlainText('+ item three'), '• item three');
});

test('strips ordered-list numbering', () => {
  assert.equal(toPlainText('1. first'), 'first');
  assert.equal(toPlainText('2) second'), 'second');
});

test('strips inline code backticks, keeping the code text', () => {
  assert.equal(toPlainText('run `npm test` first'), 'run npm test first');
});

test('strips bold markers (** and __)', () => {
  assert.equal(toPlainText('this is **bold** text'), 'this is bold text');
  assert.equal(toPlainText('this is __also bold__ text'), 'this is also bold text');
});

test('strips italic markers (* and _)', () => {
  assert.equal(toPlainText('this is *italic* text'), 'this is italic text');
  assert.equal(toPlainText('this is _also italic_ text'), 'this is also italic text');
});

test('strips link syntax, keeping the link text and dropping the url', () => {
  assert.equal(toPlainText('see [the docs](https://example.com/docs) for more'),
    'see the docs for more');
});

test('strips fenced code block fences, keeping the code text unmodified', () => {
  const md = 'before\n```js\nconst x = 1;\n```\nafter';
  const out = toPlainText(md);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /const x = 1;/);
  assert.match(out, /before/);
  assert.match(out, /after/);
});

test('a fenced code block\'s content is not further stripped for emphasis-like syntax', () => {
  const md = '```\nconst a = *not italic*;\n```';
  const out = toPlainText(md);
  assert.match(out, /\*not italic\*/);
});

test('a mix of several markdown constructs strips cleanly in one pass', () => {
  const md = [
    '# Title',
    '',
    'Some **bold** and *italic* and `code` and a [link](https://x.example).',
    '',
    '- one',
    '- two',
    '',
    '> a quote',
  ].join('\n');
  const out = toPlainText(md);
  assert.doesNotMatch(out, /[#*_`[\]()>]/);
  assert.match(out, /Title/);
  assert.match(out, /Some bold and italic and code and a link\./);
  assert.match(out, /• one/);
  assert.match(out, /• two/);
  assert.match(out, /a quote/);
});

test('plain text with no markdown syntax passes through unchanged', () => {
  assert.equal(toPlainText('just plain prose, nothing to strip'), 'just plain prose, nothing to strip');
});

test('null/undefined/empty input degrades to an empty string, never throws', () => {
  assert.equal(toPlainText(null), '');
  assert.equal(toPlainText(undefined), '');
  assert.equal(toPlainText(''), '');
});
