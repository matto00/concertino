'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const retention = require('../lib/ui/retention');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-28T00:00:00Z');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-retention-'));
}

// Writes a run's log with the given lines, then backdates the file's mtime
// (and access time) to `ageDays` days before NOW — retention is judged on
// file mtime, not on write order, so tests need to control it directly.
function writeRun(root, ticket, lines, ageDays) {
  const dir = path.join(root, '.concertino', 'runs', ticket);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, lines);
  const mtime = new Date(NOW - ageDays * DAY_MS);
  fs.utimesSync(file, mtime, mtime);
  return dir;
}

const RUN_END = '{"t":1,"kind":"run.end","ticket":"X"}\n';
const RUN_START_ONLY = '{"t":1,"kind":"run.start","ticket":"X"}\n';
// CON-77: a window the dashboard just spawned, before the agent has reached
// run.start, let alone run.end.
const RUN_SPAWN_ONLY = '{"t":1,"kind":"run.spawn","ticket":"X"}\n';

// --- eligibility predicate ---------------------------------------------------

test('isEligible: no run.end is never eligible, regardless of mtime age', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-1', RUN_START_ONLY, 9999); // absurdly old
  const eligible = retention.isEligible(root, 'HEL-1', { retentionDays: 30, now: NOW });
  assert.equal(eligible, false);
});

test('isEligible: run.end present and old mtime is eligible', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-2', RUN_END, 45);
  const eligible = retention.isEligible(root, 'HEL-2', { retentionDays: 30, now: NOW });
  assert.equal(eligible, true);
});

test('isEligible: run.end present but within the window is not eligible', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-3', RUN_END, 5);
  const eligible = retention.isEligible(root, 'HEL-3', { retentionDays: 30, now: NOW });
  assert.equal(eligible, false);
});

test('isEligible: a run.spawn-only log is never eligible, regardless of mtime age', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-1b', RUN_SPAWN_ONLY, 9999); // absurdly old
  const eligible = retention.isEligible(root, 'HEL-1b', { retentionDays: 30, now: NOW });
  assert.equal(eligible, false);
});

// --- prune() ------------------------------------------------------------------

test('prune() removes the whole run directory for eligible tickets, leaves ineligible ones untouched', () => {
  const root = tmpRoot();
  const oldTerminal = writeRun(root, 'HEL-10', RUN_END, 45);
  const activeOld = writeRun(root, 'HEL-11', RUN_START_ONLY, 9999);
  const recentTerminal = writeRun(root, 'HEL-12', RUN_END, 1);

  const report = retention.prune(root, { retentionDays: 30, now: NOW });

  assert.deepEqual(report.removed.sort(), ['HEL-10']);
  assert.deepEqual(report.keptActive.sort(), ['HEL-11', 'HEL-12']);

  assert.equal(fs.existsSync(oldTerminal), false);
  assert.equal(fs.existsSync(activeOld), true);
  assert.equal(fs.existsSync(recentTerminal), true);
});

test('dryRun: true reports the same eligible set but performs no filesystem changes', () => {
  const root = tmpRoot();
  const oldTerminal = writeRun(root, 'HEL-20', RUN_END, 45);
  writeRun(root, 'HEL-21', RUN_START_ONLY, 9999);

  const report = retention.prune(root, { retentionDays: 30, now: NOW, dryRun: true });

  assert.deepEqual(report.removed, ['HEL-20']);
  // Nothing on disk actually changed.
  assert.equal(fs.existsSync(oldTerminal), true);
  assert.equal(fs.existsSync(path.join(oldTerminal, 'events.jsonl')), true);
});

test('default retention (30 days) applies when retentionDays is not passed/configured', () => {
  const root = tmpRoot();
  const justOutside = writeRun(root, 'HEL-30', RUN_END, 31);
  const justInside = writeRun(root, 'HEL-31', RUN_END, 29);

  const report = retention.prune(root, { now: NOW });

  assert.deepEqual(report.removed, ['HEL-30']);
  assert.deepEqual(report.keptActive, ['HEL-31']);
  assert.equal(fs.existsSync(justOutside), false);
  assert.equal(fs.existsSync(justInside), true);
});

test('default retention also applies when opts is a full config object with no dashboard.retentionDays set', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-40', RUN_END, 45);
  const eligible = retention.isEligible(root, 'HEL-40', { now: NOW, dashboard: {} });
  assert.equal(eligible, true);
  assert.equal(retention.resolveRetentionDays({ dashboard: {} }), retention.DEFAULT_RETENTION_DAYS);
});

test('a resolved config-shaped opts (dashboard.retentionDays) overrides the default', () => {
  const root = tmpRoot();
  writeRun(root, 'HEL-41', RUN_END, 10);
  const eligible = retention.isEligible(root, 'HEL-41', { now: NOW, dashboard: { retentionDays: 5 } });
  assert.equal(eligible, true);
});
