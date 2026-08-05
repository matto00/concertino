'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../../lib/ui/format');
const { inputLines } = require('../../lib/ui/widgets/textinput');

test('inputLines with no error renders exactly one line', () => {
  const lines = inputLines({ label: 'new run', value: 'CON-1', cols: 80 });
  assert.equal(lines.length, 1);
});

test('inputLines with a truthy error renders exactly two lines', () => {
  const lines = inputLines({ label: 'reply', value: 'x', cols: 80, error: 'bad input' });
  assert.equal(lines.length, 2);
});

test('the input line matches the shared shape: two-space indent, bold label, dim separator, truncated value, cursor', () => {
  const [line] = inputLines({ label: 'reply', value: 'hello', cols: 80 });
  const expected = '  ' + f.bold('reply') + f.dim(' › ') + f.truncate('hello', 80 - 14) + '▏';
  assert.equal(line, expected);
});

test('the input line truncates the value to cols - 14 visible columns', () => {
  const long = 'x'.repeat(200);
  const [line] = inputLines({ label: 'new run', value: long, cols: 40 });
  const expected = '  ' + f.bold('new run') + f.dim(' › ') + f.truncate(long, 40 - 14) + '▏';
  assert.equal(line, expected);
});

test('the error line is two-space indented and red, truncated to cols - 4', () => {
  const [, errorLine] = inputLines({ label: 'reply', value: '', cols: 50, error: 'a'.repeat(100) });
  const expected = '  ' + f.red(f.truncate('a'.repeat(100), 50 - 4));
  assert.equal(errorLine, expected);
});

test('a falsy error renders no error line', () => {
  const lines = inputLines({ label: 'reply', value: 'x', cols: 80, error: '' });
  assert.equal(lines.length, 1);
});
