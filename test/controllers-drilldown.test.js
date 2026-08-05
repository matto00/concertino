'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const drilldownCtl = require('../lib/ui/controllers/drilldown');
const icons = require('../lib/ui/icons');

// Drives the real controller against a minimal S, the same path the
// dashboard takes when 'open-evidence-doc' is dispatched (drilldown.js's
// handleKey, see test/drilldown.test.js:775-856, produces that action —
// this exercises what the controller's reducer then does with it).
//
// Design-gate round 5 change request (task 7.0): no existing test in the
// suite exercised controllers/drilldown.js's `S.docTitle` composition
// before this file — added here, against the CURRENT (pre-swap) inline
// `icons.evidence + ' ' + (action.label || action.ref || '(untitled)')`
// composition, so task 7.4's migration to `sectionHeader` has a real
// regression to hold against.
function session() {
  return { S: {} };
}

test('open-evidence-doc: S.docTitle uses action.label when present', () => {
  const ctx = session();
  drilldownCtl.handle({ type: 'open-evidence-doc', ref: '/tmp/does-not-exist.md', label: 'evidence-1.md' }, ctx);
  assert.equal(ctx.S.docTitle, icons.evidence + ' evidence-1.md');
});

test('open-evidence-doc: S.docTitle falls back to action.ref when label is absent', () => {
  const ctx = session();
  drilldownCtl.handle({ type: 'open-evidence-doc', ref: '/tmp/does-not-exist.md', label: null }, ctx);
  assert.equal(ctx.S.docTitle, icons.evidence + ' /tmp/does-not-exist.md');
});

test('open-evidence-doc: S.docTitle falls back to "(untitled)" when both label and ref are absent', () => {
  const ctx = session();
  drilldownCtl.handle({ type: 'open-evidence-doc', ref: null, label: null }, ctx);
  assert.equal(ctx.S.docTitle, icons.evidence + ' (untitled)');
});
