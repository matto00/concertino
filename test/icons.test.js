'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const icons = require('../lib/ui/icons');
const { visibleLength } = require('../lib/ui/format');

test('every exported icon glyph measures as exactly one visible column', () => {
  for (const [name, glyph] of Object.entries(icons)) {
    assert.equal(
      visibleLength(glyph),
      1,
      `icons.${name} (${JSON.stringify(glyph)}) should be exactly 1 visible column`
    );
  }
});

test('every exported icon glyph is a bare string with no colour/SGR escape', () => {
  for (const [name, glyph] of Object.entries(icons)) {
    assert.ok(
      !glyph.includes('\x1b'),
      `icons.${name} should not carry any ANSI escape of its own`
    );
  }
});
