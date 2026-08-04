'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const watchLock = require('../lib/ui/watch-lock');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-lock-'));
}

test('acquire on a clean repo succeeds and writes the lock', () => {
  const root = tmpRoot();
  const r = watchLock.acquire(root, process.pid, 1000);
  assert.equal(r.ok, true);
  const lock = watchLock.readLock(root);
  assert.equal(lock.pid, process.pid);
  assert.equal(lock.startedAt, 1000);
  assert.equal(lock.heartbeatAt, 1000);
});

test('acquire against a LIVE holder refuses and names it', () => {
  const root = tmpRoot();
  // process.pid is definitionally alive; pretend it is another dashboard.
  watchLock.acquire(root, process.pid, 1000);
  const r = watchLock.acquire(root, process.pid + 1000000, 2000); // caller pid differs
  // holder (process.pid) is alive -> refused
  assert.equal(r.ok, false);
  assert.equal(r.holder.pid, process.pid);
});

test('acquire over a DEAD holder takes the lock (crash recovery)', () => {
  const root = tmpRoot();
  // A real pid that is guaranteed dead: spawn a no-op child and wait for it.
  const child = spawnSync('true');
  assert.equal(watchLock.pidAlive(child.pid), false);
  fs.mkdirSync(path.dirname(watchLock.lockPath(root)), { recursive: true });
  fs.writeFileSync(watchLock.lockPath(root), JSON.stringify({ pid: child.pid, startedAt: 1, heartbeatAt: 1 }));
  const r = watchLock.acquire(root, process.pid, 5000);
  assert.equal(r.ok, true);
  assert.equal(watchLock.readLock(root).pid, process.pid);
});

test('a torn lock file is treated as absent, never a wedge', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(watchLock.lockPath(root)), { recursive: true });
  fs.writeFileSync(watchLock.lockPath(root), '{"pid": 12');
  const r = watchLock.acquire(root, process.pid, 1000);
  assert.equal(r.ok, true);
});

test('heartbeat refreshes heartbeatAt but preserves startedAt', () => {
  const root = tmpRoot();
  watchLock.acquire(root, process.pid, 1000);
  watchLock.heartbeat(root, process.pid, 9000);
  const lock = watchLock.readLock(root);
  assert.equal(lock.startedAt, 1000);
  assert.equal(lock.heartbeatAt, 9000);
});

test('release removes only a lock we still own', () => {
  const root = tmpRoot();
  watchLock.acquire(root, process.pid, 1000);
  watchLock.release(root, process.pid);
  assert.equal(watchLock.readLock(root), null);
  // Someone else's lock survives our release.
  fs.writeFileSync(watchLock.lockPath(root), JSON.stringify({ pid: 999999999, startedAt: 1, heartbeatAt: 1 }));
  watchLock.release(root, process.pid);
  assert.notEqual(watchLock.readLock(root), null);
});

test('re-acquire by the SAME pid is idempotent (restart within one process)', () => {
  const root = tmpRoot();
  watchLock.acquire(root, process.pid, 1000);
  const r = watchLock.acquire(root, process.pid, 2000);
  assert.equal(r.ok, true);
});
