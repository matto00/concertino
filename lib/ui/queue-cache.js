'use strict';

// On-disk store for the launch pad's queue tail (CON-29) — the fix for
// queueState (lib/ui/watch.js) being in-memory only. Sibling to cache.js,
// not folded into it (design.md Decision 1): the exact same temp-file +
// rename write and "cold or malformed reads as empty" contract, but its own
// path and record shape — cache.js's `{ fetchedAt, tickets, epics }` shape
// is specific to the Linear ticket fetch.
//
//   .concertino/cache/queue.json   { sessionId, writtenAt, maxConcurrent,
//                                     launchCommand, pending, inFlight }
//
// Deliberately minimal: ticket ids and queue metadata only, NEVER a ticket
// title, description, or other Linear payload — restoring re-resolves
// display titles from cache.js's own linear.json exactly as the live queue
// already does (watch.js's `queuedTitles` lookup). `.concertino/` is fully
// gitignored, but this file is still not a place for sensitive content to
// accumulate.
//
// The contract, mirroring cache.js exactly: a missing file, malformed JSON,
// or a record failing shape validation is not an error — it is "no queue",
// same as a cold linear.json is "needs fetching". Every caller (watch.js's
// startup restore) treats that uniformly; read() never throws.

const fs = require('fs');
const path = require('path');
const cache = require('./cache');

// 24h: generous enough to cover an overnight batch discovered the next
// morning, tight enough that a three-day-old file is never sprung back to
// life — the ticket's own explicit staleness requirement (design.md
// Decision 4). Age, not `sessionId`, is the actual staleness gate;
// `sessionId` exists purely so a future diagnostic has something to key on.
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

function queueCachePath(root) {
  return path.join(cache.cacheDir(root), 'queue.json');
}

// null means "no queue" — a missing file, malformed JSON, or a record
// failing shape validation are all the same case to every caller, so they
// collapse to the same return value rather than three different sentinels.
function read(root) {
  let raw;
  try {
    raw = fs.readFileSync(queueCachePath(root), 'utf8');
  } catch (e) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  // Required shape (tasks.md 1.2): pending: string[], maxConcurrent: number,
  // writtenAt: number. Anything short of that is not a record this module
  // trusts enough to hand to queue.js's reconciliation — degrade to "no
  // queue" rather than pass a half-shaped object further down the chain.
  if (!Array.isArray(parsed.pending) || !parsed.pending.every((t) => typeof t === 'string')) return null;
  if (typeof parsed.maxConcurrent !== 'number') return null;
  if (typeof parsed.writtenAt !== 'number') return null;

  return {
    sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
    writtenAt: parsed.writtenAt,
    maxConcurrent: parsed.maxConcurrent,
    launchCommand: typeof parsed.launchCommand === 'string' ? parsed.launchCommand : null,
    pending: parsed.pending,
    // `inFlight` degrades to empty rather than failing the whole record —
    // losing in-flight occupancy on a malformed sub-field is safer (a
    // restored ticket the fleet snapshot ALSO shows live is simply not
    // re-offered as pending either, so nothing double-launches) than
    // discarding an otherwise-good pending list over it.
    inFlight: Array.isArray(parsed.inFlight) ? parsed.inFlight.filter((t) => typeof t === 'string') : [],
  };
}

// Written via a temp file and rename so a crash mid-write leaves the
// previous file intact rather than a half-file — identical pattern to
// cache.js's own write. `queue` is a lib/ui/queue.js queue object (pending
// array + inFlight Set); `sessionId` is minted once by watch.js when the
// queue is first created (or carried over from a restored record) and
// threaded through on every write, not regenerated here.
function write(root, queue, sessionId, now) {
  const payload = {
    sessionId: sessionId || null,
    writtenAt: typeof now === 'number' ? now : Date.now(),
    maxConcurrent: (queue && queue.maxConcurrent) || 1,
    launchCommand: (queue && queue.launchCommand) || null,
    pending: (queue && Array.isArray(queue.pending)) ? queue.pending.slice() : [],
    inFlight: (queue && queue.inFlight) ? Array.from(queue.inFlight) : [],
  };

  const dir = cache.cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(dir, 'queue.json.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  try {
    fs.renameSync(tmp, queueCachePath(root));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (e2) {
      /* the temp file is not worth failing a tick over */
    }
    throw e;
  }

  return payload;
}

function clear(root) {
  try {
    fs.unlinkSync(queueCachePath(root));
  } catch (e) {
    /* already gone is the desired state */
  }
}

// A restore is only attempted within this bound (default DEFAULT_STALE_MS).
// `record` missing/null is stale by definition, so callers can pass read()'s
// result straight through with no separate null check.
function isStale(record, now, boundMs) {
  if (!record || typeof record.writtenAt !== 'number') return true;
  const bound = typeof boundMs === 'number' ? boundMs : DEFAULT_STALE_MS;
  const t = typeof now === 'number' ? now : Date.now();
  return (t - record.writtenAt) > bound;
}

module.exports = { queueCachePath, read, write, clear, isStale, DEFAULT_STALE_MS };
