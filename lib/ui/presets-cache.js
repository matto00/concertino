'use strict';

// On-disk store for the launch plan's named batch-level presets (CON-111).
// Sibling to queue-cache.js — same temp-file + rename write, same "cold or
// malformed reads as empty" contract, its own path and record shape
// (design.md Decision 1). NOT folded into queue-cache.js/cache.js: a preset
// record has a different shape and lifecycle (created/renamed/deleted from
// the PRESETS screen, never written by the poll loop), so a shared module
// would need a discriminator threaded through every call site for no
// benefit — see design.md Decision 1's "Alternative considered".
//
//   .concertino/cache/presets.json   { presets: [ { id, name, harness, speed,
//                                        provider, agentMerge, createdAt,
//                                        updatedAt } ] }
//
// `read(root)` validates each entry's shape PER ENTRY (tasks.md 1.2) — one
// malformed preset among otherwise-valid ones is dropped, not the whole
// list, mirroring queue-cache.js's own "degrade the one bad field, not the
// whole record" discipline for `perTicket`.

const fs = require('fs');
const path = require('path');
const cache = require('./cache');

const VALID_HARNESS = new Set(['claude-code', 'codex', 'opencode']);
const VALID_SPEED = new Set(['default', 'fast', 'slow']);
const VALID_PROVIDER = new Set(['ollama', 'default']);

function presetsCachePath(root) {
  return path.join(cache.cacheDir(root), 'presets.json');
}

// One entry's shape (design.md Decision 1 / tasks.md 1.2): `id`/`name`
// non-empty strings, `harness` null or one of the three canonical ids,
// `speed` one of the three speeds, `provider` null or 'ollama'/'default',
// `agentMerge` boolean, `createdAt`/`updatedAt` numbers. Anything short of
// this is not a record the PRESETS screen or the launch plan's `w` key
// trusts enough to act on — dropped rather than passed through half-shaped.
function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || !entry.id) return false;
  if (typeof entry.name !== 'string' || !entry.name) return false;
  if (entry.harness !== null && !VALID_HARNESS.has(entry.harness)) return false;
  if (!VALID_SPEED.has(entry.speed)) return false;
  if (entry.provider !== null && !VALID_PROVIDER.has(entry.provider)) return false;
  if (typeof entry.agentMerge !== 'boolean') return false;
  if (typeof entry.createdAt !== 'number') return false;
  if (typeof entry.updatedAt !== 'number') return false;
  return true;
}

// A missing file, malformed JSON, or a non-array `presets` field all
// degrade to `{ presets: [] }` — never an error, never a throw (same
// contract queue-cache.js's own read() follows). An individual entry
// failing shape validation is dropped from the list; the rest still loads.
function read(root) {
  let raw;
  try {
    raw = fs.readFileSync(presetsCachePath(root), 'utf8');
  } catch (e) {
    return { presets: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { presets: [] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.presets)) {
    return { presets: [] };
  }

  return { presets: parsed.presets.filter(isValidEntry) };
}

// Written via a temp file and rename so a crash mid-write leaves the
// previous file intact rather than a half-file — identical pattern to
// queue-cache.js's own write. `presets` is the plain array (never wrapped)
// — the wrapping `{ presets: [...] }` object is this module's own on-disk
// envelope, applied here.
function write(root, presets) {
  const payload = { presets: Array.isArray(presets) ? presets : [] };

  const dir = cache.cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(dir, 'presets.json.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  try {
    fs.renameSync(tmp, presetsCachePath(root));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (e2) {
      /* the temp file is not worth failing a save over */
    }
    throw e;
  }

  return payload;
}

module.exports = { presetsCachePath, read, write, isValidEntry };
