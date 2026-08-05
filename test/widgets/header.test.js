'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../../lib/ui/format');
const icons = require('../../lib/ui/icons');
const { sectionHeader } = require('../../lib/ui/widgets/header');

test('sectionHeader composes an existing icon with its label', () => {
  assert.equal(
    sectionHeader({ icon: icons.description, label: 'DESCRIPTION' }),
    icons.description + ' ' + 'DESCRIPTION'
  );
});

test('omitting the icon returns the label unchanged', () => {
  assert.equal(sectionHeader({ label: 'SETTINGS' }), 'SETTINGS');
});

test('a colour wraps the composed icon+label text', () => {
  assert.equal(
    sectionHeader({ icon: icons.metrics, label: 'METRICS', colour: f.bold }),
    f.bold(icons.metrics + ' ' + 'METRICS')
  );
});

test('a colour still wraps the label when no icon is given', () => {
  assert.equal(sectionHeader({ label: 'SECTIONS', colour: f.bold }), f.bold('SECTIONS'));
});
