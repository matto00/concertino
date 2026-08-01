'use strict';

// Filesystem access for the run event logs. Everything that touches disk lives
// here so the reducer and renderer can stay pure.

const fs = require('fs');
const path = require('path');

function runsDir(root) {
  return path.join(root, '.concertino', 'runs');
}

function runDir(root, ticket) {
  return path.join(runsDir(root), ticket);
}

function eventsPath(root, ticket) {
  return path.join(runDir(root, ticket), 'events.jsonl');
}

function answerPath(root, ticket) {
  return path.join(runDir(root, ticket), 'answer.json');
}

// Where a reaped run's full pre-kill scrollback lands (lib/ui/reap.js). Lives
// in the same per-ticket run directory as events.jsonl/answer.json, so it is
// discovered, gitignored and pruned alongside them for free (retention.js's
// prune() already removes the whole runDir, not just events.jsonl).
function scrollbackPath(root, ticket) {
  return path.join(runDir(root, ticket), 'session-scrollback.txt');
}

function listTickets(root) {
  let entries;
  try {
    entries = fs.readdirSync(runsDir(root), { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// A malformed line is skipped and counted, never thrown. A half-written line
// from a crashed emitter must not take the whole dashboard down. This is one
// of two ways a run's `malformed` count grows — the other is a fully-parsed
// event whose reducer.js rejects a field's value (e.g. an unrecognised
// `phase.enter` phase); that event still reaches `run.events`, unlike the
// lines counted here, which never become events at all.
function readEvents(root, ticket) {
  let raw;
  try {
    raw = fs.readFileSync(eventsPath(root, ticket), 'utf8');
  } catch (e) {
    return { events: [], malformed: 0 };
  }

  const events = [];
  let malformed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (e) {
      malformed++;
      continue;
    }
    if (ev && typeof ev.t === 'number' && typeof ev.kind === 'string') events.push(ev);
    else malformed++;
  }

  return { events, malformed };
}

// A fresh cache instance for readAll's optional second argument. The caller
// owns the lifetime — lib/ui/watch.js creates one before its poll loop and
// reuses it for the life of the dashboard process; a caller that never
// creates one (every pre-existing call site, including readAll(root) with
// one argument) gets the old always-reparse behaviour unchanged.
function createEventsCache() {
  return new Map();
}

// Reads only the bytes appended to `ticket`'s log since `cache`'s last read
// of it, parses just the newly-complete lines, and appends them to the
// cached accumulators. Unchanged size+mtime short-circuits to the cached
// `events` array itself (not a copy) — see test/store.test.js, which checks
// this by reference equality, the only way to prove no re-parse happened.
//
// A trailing partial line (the writer mid-write) is deliberately left
// unconsumed: `offset` only advances past the last '\n' actually seen, so
// the half-line is re-read whole once its newline lands on a later poll.
//
// Truncation or a rewrite from underneath us (file size shrinks, or mtime
// moves backward — should never happen to an append-only log, but must not
// wedge this if it does) discards the cache entry and re-reads from byte 0,
// identical to a cold start.
function readIncremental(root, ticket, cache) {
  const p = eventsPath(root, ticket);
  let stat;
  try {
    stat = fs.statSync(p);
  } catch (e) {
    cache.delete(ticket);
    return { events: [], malformed: 0 };
  }

  let entry = cache.get(ticket);
  if (entry && (stat.size < entry.size || stat.mtimeMs < entry.mtimeMs)) entry = null;

  if (entry && stat.size === entry.size && stat.mtimeMs === entry.mtimeMs) {
    return { events: entry.events, malformed: entry.malformed };
  }

  const offset = entry ? entry.offset : 0;
  const events = entry ? entry.events : [];
  let malformed = entry ? entry.malformed : 0;

  const length = stat.size - offset;
  let raw = '';
  if (length > 0) {
    let fd;
    try {
      fd = fs.openSync(p, 'r');
    } catch (e) {
      cache.delete(ticket);
      return { events: [], malformed: 0 };
    }
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, offset);
      raw = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  let consumed = 0;
  if (raw) {
    const lastNewline = raw.lastIndexOf('\n');
    if (lastNewline !== -1) {
      const complete = raw.slice(0, lastNewline + 1);
      consumed = Buffer.byteLength(complete, 'utf8');
      for (const line of complete.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch (e) {
          malformed++;
          continue;
        }
        if (ev && typeof ev.t === 'number' && typeof ev.kind === 'string') events.push(ev);
        else malformed++;
      }
    }
  }

  cache.set(ticket, {
    offset: offset + consumed,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    events,
    malformed,
  });

  return { events, malformed };
}

// `cache`, when passed, is a Map created by createEventsCache() and owned by
// the caller across many calls — this is what lets the per-second poll loop
// in lib/ui/watch.js cost O(bytes appended) instead of O(total log size).
// Omitted (the original, single-argument signature), this behaves exactly as
// it always has: a full read and re-parse of every ticket's log, with
// nothing persisted between calls — every pre-existing call site keeps
// working unmodified.
//
// Either way, every call evicts cache entries for tickets no longer present
// on disk, so a long-lived dashboard process's cache is bounded by the
// current on-disk ticket count, not by every ticket it has ever seen.
function readAll(root, cache) {
  const out = new Map();
  const tickets = listTickets(root);

  if (cache) {
    const present = new Set(tickets);
    for (const ticket of Array.from(cache.keys())) {
      if (!present.has(ticket)) cache.delete(ticket);
    }
  }

  for (const ticket of tickets) {
    out.set(ticket, cache ? readIncremental(root, ticket, cache) : readEvents(root, ticket));
  }
  return out;
}

// The control-plane write. `O_EXCL` ('wx') makes this atomic: the first writer
// wins outright, at the filesystem level, so two dashboards answering the same
// escalation at once can never both believe they succeeded — the loser gets
// EEXIST, not a silent overwrite. `emit-event.sh --await`, blocked in its poll
// loop, is the reader; it records `escalation.answered` itself once it picks
// the file up, so this function does not also emit that event — doing both
// would double it in the log (see the writer's tests and the slice2a report
// for why that split was chosen).
//
// Never throws. A permissions problem or a missing run directory is exactly
// as reportable as "already answered" — the caller (the escalation screen)
// surfaces `error` on screen rather than letting either crash the dashboard.
function writeAnswer(root, ticket, answer) {
  const dir = runDir(root, ticket);
  const target = answerPath(root, ticket);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ answer }), { flag: 'wx' });
    return { ok: true };
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      return { ok: false, reason: 'answered', error: 'already answered' };
    }
    return {
      ok: false,
      reason: 'error',
      error: 'could not write answer: ' + String((e && e.message) || e).split('\n')[0],
    };
  }
}

// Best-effort, defensive read of `answer.json` — shared by writeSubAnswer
// (to read the current state before a read-modify-write) and readSubAnswers
// (to hand the same state back to a caller). Never throws: a missing file or
// a torn/malformed one both simply mean "nothing recorded yet" to a caller.
function readAnswerFileRaw(root, ticket) {
  try {
    return JSON.parse(fs.readFileSync(answerPath(root, ticket), 'utf8'));
  } catch (e) {
    return null;
  }
}

// The multi-part control-plane write (CON-46). Unlike writeAnswer's single
// create-once `O_EXCL`, this file legitimately gets several updates — one per
// sub-question answered — so atomicity here comes from write-temp-then-
// `renameSync` (design.md Decision 3): `--await`'s single reader never
// observes a torn/partial write, since a rename within one directory is
// atomic on the filesystems Concertino targets. This is a weaker guarantee
// than O_EXCL's "first writer wins outright" for two dashboards racing the
// SAME sub-question index — accepted, documented risk (Decision 3) — but a
// reopen of the SAME index that has already recorded an answer (the file, as
// last read, already has a non-null slot at `index`) is refused exactly like
// `writeAnswer`'s "already answered" race, so a stale wizard step can never
// silently clobber a decision that already reached disk.
//
// Never throws — an error is exactly as reportable as "already answered";
// the caller (the escalation screen, via watch.js) surfaces `error` on
// screen rather than letting either crash the dashboard.
function writeSubAnswer(root, ticket, index, value, total) {
  const dir = runDir(root, ticket);
  const target = answerPath(root, ticket);
  try {
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total) {
      return {
        ok: false,
        reason: 'error',
        error: 'sub-question index out of range: ' + index + ' of ' + total,
      };
    }

    fs.mkdirSync(dir, { recursive: true });

    const existing = readAnswerFileRaw(root, ticket);
    const subAnswers = (existing && Array.isArray(existing.subAnswers) && existing.subAnswers.length === total)
      ? existing.subAnswers.slice()
      : new Array(total).fill(null);

    if (subAnswers[index] != null) {
      return { ok: false, reason: 'answered', error: 'already answered' };
    }

    subAnswers[index] = value;
    const complete = subAnswers.length === total && subAnswers.every((a) => a != null);
    const payload = { subAnswers, total, complete };

    const tmp = target + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, target);
    return { ok: true, complete };
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      error: 'could not write sub-answer: ' + String((e && e.message) || e).split('\n')[0],
    };
  }
}

// Safely reads `answer.json`'s multi-part shape back — used by watch.js's
// `open-escalation` handling (design.md Decision 7) to resume the wizard at
// the first unanswered step rather than defaulting to step 0 unconditionally.
// `null` on any missing file, parse failure, or a shape that doesn't look
// like a multi-part answer (e.g. the single-question `{answer: "..."}`
// shape) — never throws, and never returns a half-valid result a caller
// might mistake for real state.
function readSubAnswers(root, ticket) {
  const parsed = readAnswerFileRaw(root, ticket);
  if (!parsed || !Array.isArray(parsed.subAnswers) || typeof parsed.total !== 'number') return null;
  return {
    subAnswers: parsed.subAnswers,
    total: parsed.total,
    complete: !!parsed.complete,
  };
}

module.exports = {
  runsDir, runDir, eventsPath, answerPath, scrollbackPath, listTickets, readEvents, readAll,
  writeAnswer, writeSubAnswer, readSubAnswers, createEventsCache,
};
