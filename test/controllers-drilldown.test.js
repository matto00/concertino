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

// --- CON-104: move-drill-changes ---------------------------------------

test('move-drill-changes: clamps S.drillChangesIndex against the current diffStat\'s own file list length', () => {
  const ctx = { S: { drillChangesIndex: 0, drillDiffStat: { stat: [{ path: 'a.js', line: 'a.js | 1 +' }, { path: 'b.js', line: 'b.js | 1 +' }], error: null } } };
  drilldownCtl.handle({ type: 'move-drill-changes', delta: 1 }, ctx);
  assert.equal(ctx.S.drillChangesIndex, 1);
  // Already at the last file — another +1 clamps rather than running off
  // the end of the list.
  drilldownCtl.handle({ type: 'move-drill-changes', delta: 1 }, ctx);
  assert.equal(ctx.S.drillChangesIndex, 1);
  drilldownCtl.handle({ type: 'move-drill-changes', delta: -1 }, ctx);
  assert.equal(ctx.S.drillChangesIndex, 0);
});

test('move-drill-changes: clamps to 0 when the diffStat has no files (worktree gone, or an empty diff)', () => {
  const ctx = { S: { drillChangesIndex: 3, drillDiffStat: null } };
  drilldownCtl.handle({ type: 'move-drill-changes', delta: -1 }, ctx);
  assert.equal(ctx.S.drillChangesIndex, 0);
});

// --- CON-104: open-diff-doc — shells `git diff -- <file>` and opens docview

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-ctl-drilldown-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

test('open-diff-doc: transitions to docview with the file\'s real diff as S.docBody, and an icons.changes-prefixed title', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\nline two\n');

  const ctx = session();
  drilldownCtl.handle({ type: 'open-diff-doc', worktree: dir, file: 'a.txt', label: 'a.txt' }, ctx);

  assert.equal(ctx.S.mode, 'docview');
  assert.equal(ctx.S.docTitle, icons.changes + ' a.txt');
  assert.equal(ctx.S.docScroll, 0);
  assert.ok(Array.isArray(ctx.S.docBody));
  assert.ok(ctx.S.docBody.some((l) => l.includes('+line two')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('open-diff-doc: S.docTitle falls back to action.file, then "(untitled)", the same way open-evidence-doc falls back', () => {
  const dir = tmpRepo();
  const ctx1 = session();
  drilldownCtl.handle({ type: 'open-diff-doc', worktree: dir, file: 'missing.txt', label: null }, ctx1);
  assert.equal(ctx1.S.docTitle, icons.changes + ' missing.txt');

  const ctx2 = session();
  drilldownCtl.handle({ type: 'open-diff-doc', worktree: dir, file: null, label: null }, ctx2);
  assert.equal(ctx2.S.docTitle, icons.changes + ' (untitled)');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('open-diff-doc: a failing git call degrades to a visible "diff unavailable" body, still transitioning to docview', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-ctl-drilldown-norepo-'));
  const ctx = session();
  drilldownCtl.handle({ type: 'open-diff-doc', worktree: dir, file: 'whatever.txt', label: 'whatever.txt' }, ctx);
  assert.equal(ctx.S.mode, 'docview');
  assert.equal(ctx.S.docBody.length, 1);
  assert.match(ctx.S.docBody[0], /diff unavailable/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- CON-104 (task 4.3): esc from the diff reader restores CHANGES focus/selection ---
// 'back-to-drilldown-from-doc' needs no CHANGES-specific handler at all —
// verified here directly, since nothing else in the suite exercises this
// action against a CHANGES-focused/selected state.

test('back-to-drilldown-from-doc: drillFocus/drillChangesIndex survive the round trip through open-diff-doc, unlike docTitle/docBody/docScroll', () => {
  const ctx = {
    S: {
      drillFocus: 'changes', drillChangesIndex: 2, mode: 'drilldown',
      docTitle: null, docBody: null, docScroll: 0,
    },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-ctl-drilldown-roundtrip-'));
  drilldownCtl.handle({ type: 'open-diff-doc', worktree: dir, file: 'x.txt', label: 'x.txt' }, ctx);
  assert.equal(ctx.S.mode, 'docview');
  assert.ok(ctx.S.docTitle);

  drilldownCtl.handle({ type: 'back-to-drilldown-from-doc' }, ctx);
  assert.equal(ctx.S.mode, 'drilldown');
  assert.equal(ctx.S.docTitle, null);
  assert.equal(ctx.S.docBody, null);
  assert.equal(ctx.S.docScroll, 0);
  // The whole point of this test: CHANGES' own focus/selection is untouched.
  assert.equal(ctx.S.drillFocus, 'changes');
  assert.equal(ctx.S.drillChangesIndex, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});
