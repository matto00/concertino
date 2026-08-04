'use strict';

// CON-68: the dashboard's single-writer guard. Everything the dashboard
// persists per repo (`.concertino/cache/queue.json` above all) is written
// single-writer-by-assumption — two `concertino watch` processes on the same
// repo (a forgotten tmux session plus a fresh one) would silently clobber
// each other's queue state on every tick. This module makes the assumption
// explicit: a pidfile at `.concertino/cache/watch.lock` that a starting
// dashboard must acquire before it touches anything.
//
// Ownership is decided by PID LIVENESS, not heartbeat freshness: a live pid
// (signal-0 succeeds, or fails with EPERM — "exists, not ours") refuses the
// acquire outright, because a dashboard blocked inside `tmux attach`
// (spawnSync blocks the whole event loop, so heartbeats stall for as long
// as the operator stays attached) is still very much the owner. The
// heartbeat exists for the refusal MESSAGE (how stale is the holder?) and
// for post-mortems, never as the takeover criterion. The residual risk —
// the holder died and its pid was recycled by an unrelated long-lived
// process — is accepted (the ticket's own "smallest useful shape"); the
// error message tells the operator exactly which pid to check.
//
// Same temp-file+rename write discipline as queue-cache.js: a crash
// mid-write leaves the previous lock intact, never a torn file. A torn or
// unreadable lock is treated as absent — refusing to start over a file
// nobody can prove ownership of would wedge the dashboard behind garbage.

const fs = require('fs');
const path = require('path');
const cache = require('./cache');

function lockPath(root) {
  return path.join(cache.cacheDir(root), 'watch.lock');
}

function readLock(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath(root), 'utf8'));
    if (parsed && typeof parsed.pid === 'number') return parsed;
  } catch (e) { /* absent or torn — treated as no lock */ }
  return null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the pid exists but belongs to another user — alive for
    // our purposes. ESRCH (and anything else) means no such process.
    return e && e.code === 'EPERM';
  }
}

function writeLock(root, pid, now) {
  const dir = cache.cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = lockPath(root) + '.' + pid + '.tmp';
  const existing = readLock(root);
  const startedAt = (existing && existing.pid === pid && typeof existing.startedAt === 'number')
    ? existing.startedAt : now;
  fs.writeFileSync(tmp, JSON.stringify({ pid, startedAt, heartbeatAt: now }), 'utf8');
  fs.renameSync(tmp, lockPath(root));
}

// { ok: true } and the lock is ours, or { ok: false, holder } naming the
// live owner. A dead holder's lock is simply overwritten — that is the
// crash-recovery path, no separate "stale cleanup" step to forget.
function acquire(root, pid, now) {
  const existing = readLock(root);
  if (existing && existing.pid !== pid && pidAlive(existing.pid)) {
    return { ok: false, holder: existing };
  }
  writeLock(root, pid, now);
  return { ok: true };
}

// Refreshed once per poll from watch.js's timer. Cheap (one small file) and
// deliberately unconditional — checking ownership first would cost the same
// read this write costs, and after a successful acquire() the only writer
// left is us.
function heartbeat(root, pid, now) {
  try {
    writeLock(root, pid, now);
  } catch (e) { /* diagnostics only — a failed heartbeat must never kill the dashboard */ }
}

// Removed only when still ours — quit() must not delete a lock a newer
// dashboard legitimately took over after this process's pid was declared
// dead (e.g. a wedged process finally exiting).
function release(root, pid) {
  try {
    const existing = readLock(root);
    if (existing && existing.pid === pid) fs.unlinkSync(lockPath(root));
  } catch (e) { /* best effort */ }
}

module.exports = { lockPath, readLock, pidAlive, acquire, heartbeat, release };
