'use strict';

// On-disk store for the launch pad's bulk ticket fetch.
//
//   .concertino/cache/linear.json   { fetchedAt, tickets: [...], epics: [...] }
//
// The contract, and the reason this file is separate from linear.js: **a cold
// or unreadable cache is not an error.** Missing file, malformed JSON, a write
// truncated by a crash — all degrade to "empty, needs fetching", exactly as
// lib/ui/store.js treats a malformed event log. The launch pad opens with an
// empty list and a `press r to fetch` hint; it never throws and never blocks on
// the network at startup.
//
// The cache is also never the source of truth for whether a ticket is already
// being worked on. That comes from the live event log and tmux, which is why
// the inline status column can say `▲ running` against a cache fetched an hour
// ago.

const fs = require('fs');
const path = require('path');

const EMPTY = Object.freeze({ fetchedAt: null, tickets: [], epics: [] });

// Bumped whenever the on-disk shape gains a field a stale cache cannot
// possibly have (e.g. `priority` — see linear.js). The pre-this-change shape
// carried no `schemaVersion` at all, so it is implicitly version 1; this is
// the first real bump. `read()` treats a missing/mismatched version exactly
// like a malformed file — see its own comment for why that is safer than
// trying to render a partially-stale ticket.
const CACHE_SCHEMA_VERSION = 2;

function cacheDir(root) {
  return path.join(root, '.concertino', 'cache');
}

function cachePath(root) {
  return path.join(cacheDir(root), 'linear.json');
}

function empty() {
  return { fetchedAt: null, tickets: [], epics: [] };
}

// Anything that is not a well-formed cache is an empty one. There is no error
// channel on purpose: every caller would handle the error by showing the empty
// state, so the empty state is what they get.
function read(root) {
  let raw;
  try {
    raw = fs.readFileSync(cachePath(root), 'utf8');
  } catch (e) {
    return empty();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return empty();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();

  // A cache written before this field existed (or by an older schema) is
  // never read as if its tickets carry a real `priority` — that would render
  // every stale-cache ticket as priority 0/None, exactly the "absent data as
  // healthy data" defect this project treats as a wall. Checked before any
  // other field is read from `parsed`, per design.md Decision 1.
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return empty();

  if (!Array.isArray(parsed.tickets)) return empty();

  return {
    // A cache written by a broken emitter with a string timestamp is as good as
    // no timestamp — the header would render "fetched NaNm ago".
    fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : null,
    tickets: parsed.tickets,
    epics: Array.isArray(parsed.epics) ? parsed.epics : [],
    teamKey: typeof parsed.teamKey === 'string' ? parsed.teamKey : null,
  };
}

// Written via a temp file and rename so a crash mid-write leaves the previous
// cache intact rather than a half-file. `read` tolerates a truncated file
// anyway; this just means you keep the good one.
function write(root, data, now) {
  const payload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fetchedAt: typeof now === 'number' ? now : Date.now(),
    teamKey: (data && data.teamKey) || null,
    tickets: (data && data.tickets) || [],
    epics: (data && data.epics) || [],
  };

  const dir = cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(dir, 'linear.json.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  try {
    fs.renameSync(tmp, cachePath(root));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (e2) {
      /* the temp file is not worth failing a fetch over */
    }
    throw e;
  }

  return payload;
}

// Milliseconds since the fetch, for the `fetched 12m ago` header. null when
// there is nothing to be stale — the header says `never fetched`, not `0m ago`.
function age(cache, now) {
  if (!cache || typeof cache.fetchedAt !== 'number') return null;
  const t = typeof now === 'number' ? now : Date.now();
  const delta = t - cache.fetchedAt;
  return delta < 0 ? 0 : delta;
}

// A cache with no timestamp or no tickets needs a fetch before the launch pad
// is useful. Both cases render the same hint, so they are one predicate.
function isCold(cache) {
  if (!cache || typeof cache.fetchedAt !== 'number') return true;
  return !Array.isArray(cache.tickets) || cache.tickets.length === 0;
}

function clear(root) {
  try {
    fs.unlinkSync(cachePath(root));
  } catch (e) {
    /* already gone is the desired state */
  }
}

module.exports = { EMPTY, CACHE_SCHEMA_VERSION, cacheDir, cachePath, empty, read, write, age, isCold, clear };
