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
// from a crashed emitter must not take the whole dashboard down.
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

function readAll(root) {
  const out = new Map();
  for (const ticket of listTickets(root)) out.set(ticket, readEvents(root, ticket));
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

module.exports = {
  runsDir, runDir, eventsPath, answerPath, listTickets, readEvents, readAll, writeAnswer,
};
