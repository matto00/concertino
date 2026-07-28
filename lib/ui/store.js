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

module.exports = { runsDir, runDir, eventsPath, answerPath, listTickets, readEvents, readAll };
