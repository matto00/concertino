'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const fs = require('../lib/followup-survival');

// 1.1 — pure, dependency-free exports.
test('module exports are pure functions with no fs/https/lib-ui requires', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/followup-survival'), 'utf8');
  assert.ok(!/require\(['"]fs['"]\)/.test(src));
  assert.ok(!/require\(['"]https['"]\)/.test(src));
  assert.ok(!/require\(['"]\.\.\/lib\/ui/.test(src));
  for (const name of ['computeSurvival', 'segmentBy', 'bucketByWeek', 'median']) {
    assert.equal(typeof fs[name], 'function', name + ' should be a function export');
  }
});

// 1.2 — median edge cases.
test('median: odd-length returns the middle value', () => {
  assert.equal(fs.median([3, 1, 2]), 2);
});
test('median: even-length returns the mean of the two middle values', () => {
  assert.equal(fs.median([1, 2, 3, 4]), 2.5);
});
test('median: empty array returns null, never 0', () => {
  assert.equal(fs.median([]), null);
});

// 1.3 — computeSurvival.
test('computeSurvival: zero-row input yields total 0 and pct null', () => {
  const r = fs.computeSurvival([]);
  assert.equal(r.total, 0);
  assert.equal(r.pct, null);
});
test('computeSurvival: survives iff state type is exactly completed', () => {
  const rows = [
    { survived: true },
    { survived: false },
    { survived: false },
    { survived: false },
    { survived: false },
  ];
  const r = fs.computeSurvival(rows);
  assert.equal(r.surviving, 1);
  assert.equal(r.total, 5);
  assert.equal(r.pct, 20);
});

// 1.4 — bucketByWeek with an explicitly-empty middle week.
test('bucketByWeek: a fixture spanning three weeks with an empty middle week yields three buckets, the middle empty', () => {
  const week1 = Date.UTC(2026, 0, 5); // a Monday
  const week3 = week1 + 2 * 7 * 24 * 3600 * 1000;
  const rows = [
    { filedAt: week1, survived: true, ageMs: null },
    { filedAt: week3, survived: false, ageMs: 1000 },
  ];
  const buckets = fs.bucketByWeek(rows, 1);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[0].total, 1);
  assert.equal(buckets[1].total, 0);
  assert.equal(buckets[1].pct, null);
  assert.equal(buckets[2].total, 1);
});

// 1.5 — segmentBy conserves total across valid/absent/malformed triage.
test('segmentBy: valid, absent and malformed triage payloads conserve the total across buckets', () => {
  const rows = [
    { triage: { overlap: 'high' }, survived: true },
    { triage: { overlap: 'none' }, survived: false },
    { survived: false }, // absent triage
    { triage: {}, survived: true }, // malformed (no overlap key)
  ];
  const seg = fs.segmentBy(rows, 'triage.overlap');
  const totalAcrossBuckets = Object.values(seg.buckets).reduce((sum, b) => sum + b.total, 0);
  assert.equal(totalAcrossBuckets, rows.length);
  assert.ok(seg.buckets.unknown);
  assert.equal(seg.buckets.unknown.total, 2);
});

// 1.6a — small-n suppression.
test('small-n suppression: n=1 and n=4 suppress the percentage, n=5 reports one', () => {
  const rowsOf = (n, survivingCount) =>
    Array.from({ length: n }, (_, i) => ({ survived: i < survivingCount }));

  const r1 = fs.computeSurvival(rowsOf(1, 0));
  assert.equal(r1.suppressed, true);
  assert.equal(r1.pct, null);
  assert.equal(r1.total, 1);
  assert.equal(r1.surviving, 0);

  const r4 = fs.computeSurvival(rowsOf(4, 2));
  assert.equal(r4.suppressed, true);
  assert.equal(r4.pct, null);

  const r5 = fs.computeSurvival(rowsOf(5, 3));
  assert.equal(r5.suppressed, false);
  assert.equal(r5.pct, 60);
});
test('a suppressed result never yields a numeric pct', () => {
  const r = fs.computeSurvival([{ survived: false }, { survived: true }]);
  assert.equal(r.suppressed, true);
  assert.strictEqual(r.pct, null);
});

// 1.6 — singleValued annotation.
test('singleValued: a single-role fixture reports true, a two-role fixture reports false', () => {
  const single = fs.segmentBy([{ originRole: 'orchestrator' }, { originRole: 'orchestrator' }], 'originRole');
  assert.equal(single.singleValued, true);

  const multi = fs.segmentBy([{ originRole: 'orchestrator' }, { originRole: 'skeptic' }], 'originRole');
  assert.equal(multi.singleValued, false);
});

// ---------------------------------------------------------------------------
// Group 2 — falsifiability controls (design.md Decision 6). A metric that
// cannot be made to change by changing its input is measuring nothing.
// ---------------------------------------------------------------------------

// 2.1 — mutation-style control: flipping survivors must change pct.
test('falsifiability: flipping survivors to non-survivors changes pct', () => {
  const base = [
    { survived: true }, { survived: true }, { survived: false },
    { survived: false }, { survived: false },
  ];
  const flipped = base.map((r) => ({ survived: !r.survived }));
  const before = fs.computeSurvival(base).pct;
  const after = fs.computeSurvival(flipped).pct;
  assert.notEqual(before, after);
});

// 2.2 — differing suggested_by distributions produce different per-segment figures.
test('falsifiability: differing suggested_by distributions produce different per-segment figures', () => {
  const fixtureA = [
    { suggestedBy: 'agent', survived: true }, { suggestedBy: 'agent', survived: true },
    { suggestedBy: 'agent', survived: false }, { suggestedBy: 'agent', survived: false },
    { suggestedBy: 'agent', survived: false },
    { suggestedBy: 'human', survived: true }, { suggestedBy: 'human', survived: true },
    { suggestedBy: 'human', survived: true }, { suggestedBy: 'human', survived: true },
    { suggestedBy: 'human', survived: false },
  ];
  const fixtureB = fixtureA.map((r) =>
    r.suggestedBy === 'agent' ? Object.assign({}, r, { survived: false }) : r,
  );
  const segA = fs.segmentBy(fixtureA, 'suggestedBy').buckets;
  const segB = fs.segmentBy(fixtureB, 'suggestedBy').buckets;
  assert.notDeepEqual(segA, segB);
});

// 2.3 — pins both ends of the scale.
test('falsifiability: an all-surviving fixture yields pct 100, an all-failing fixture yields pct 0', () => {
  const allSurvive = Array.from({ length: 5 }, () => ({ survived: true }));
  const allFail = Array.from({ length: 5 }, () => ({ survived: false }));
  assert.equal(fs.computeSurvival(allSurvive).pct, 100);
  assert.equal(fs.computeSurvival(allFail).pct, 0);
});
