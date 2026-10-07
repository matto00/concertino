'use strict';

// Per-ticket Linear detail cache for `concertino fleet --tickets=…` (v1.1,
// docs/superpowers/specs/2026-10-06-fleet-pane-design.md). Separate from
// cache.js's whole-team `tickets.json` on purpose: that file has a single
// fetchedAt and a manual refresh; the pane needs a 20 s TTL per ticket.
// Never throws on read: anything that is not a well-formed cache is empty.

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_MS = 20000;
const ENV_TTL = 'CONCERTINO_FLEET_TICKET_TTL_MS';

function cachePath(root) {
  return path.join(root, '.concertino', 'cache', 'fleet-tickets.json');
}

function empty() {
  return { schemaVersion: SCHEMA_VERSION, tickets: {} };
}

function read(root) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath(root), 'utf8'));
  } catch (e) {
    return empty();
  }
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.tickets || typeof parsed.tickets !== 'object') return empty();
  return { schemaVersion: SCHEMA_VERSION, tickets: parsed.tickets };
}

// Temp file + rename, as cache.js does, so a reader never sees a torn file.
function write(root, cache) {
  const target = cachePath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, tickets: cache.tickets }), 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* not worth failing over */ }
    throw e;
  }
}

const keyOf = (ident) => String(ident).toUpperCase();

function get(cache, ident) {
  return (cache && cache.tickets && cache.tickets[keyOf(ident)]) || null;
}

function put(cache, entry, now, key) {
  const tickets = Object.assign({}, cache.tickets, { [keyOf(key != null ? key : entry.identifier)]: Object.assign({}, entry, { fetchedAt: now }) });
  return { schemaVersion: SCHEMA_VERSION, tickets };
}

// A negative entry: the ticket could not be fetched. Skipped until the fresh
// TTL expires (isFresh) or, with retryUntil (HTTP 429), until that time.
// With retryUntil and an existing good entry, the good entry is kept (stale
// detail beats none) and only gains retryUntil.
function putFailure(cache, requestedId, message, now, retryUntil) {
  const key = keyOf(requestedId);
  const existing = cache.tickets[key];
  const entry = retryUntil != null && existing && !existing.error
    ? Object.assign({}, existing, { retryUntil })
    : { identifier: key, error: message, fetchedAt: now, retryUntil };
  return { schemaVersion: SCHEMA_VERSION, tickets: Object.assign({}, cache.tickets, { [key]: entry }) };
}

function isBlocked(entry, now) {
  return !!entry && entry.retryUntil != null && now < entry.retryUntil;
}

function isFresh(entry, now, ttlMs) {
  return !!entry && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttlMs;
}

function ttlFromEnv(env) {
  const raw = env && env[ENV_TTL];
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

module.exports = { SCHEMA_VERSION, DEFAULT_TTL_MS, ENV_TTL, cachePath, read, write, get, put, putFailure, isBlocked, isFresh, ttlFromEnv };
