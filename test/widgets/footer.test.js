'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../../lib/ui/format');
const { footer } = require('../../lib/ui/widgets/footer');

test('rows equals the returned lines array length', () => {
  const { lines, rows } = footer({ hints: ['esc back', 'q quit'], cols: 80 });
  assert.equal(rows, lines.length);
});

test('rows equals the returned lines array length when hints wrap onto multiple lines', () => {
  const hints = ['↵ attach', 'l details', 't ticket', 'j/k move', '1-9 jump', 'f force-start', 'x clear queue', 'n new run', 'N launch pad', 's settings', 'q quit'];
  const { lines, rows } = footer({ hints, cols: 40 });
  assert.ok(lines.length > 1, 'expected the hints to wrap onto more than one line at 40 cols');
  assert.equal(rows, lines.length);
});

test('footer delegates to f.hintLines unchanged', () => {
  const hints = ['esc back'];
  const { lines } = footer({ hints, cols: 80 });
  assert.deepEqual(lines, f.hintLines(hints, 80));
});
