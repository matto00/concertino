'use strict';

// `concertino fleet` — a read-only snapshot of .concertino/runs for the Claude
// Code fleet pane (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
// Folds every run with lib/ui/reducer.js exactly as the dashboard does, but
// with NO tmux windows: liveness for driver-session lanes is the mod's job
// (it correlates runs with the session's own Agent calls), so a live run here
// reads `unknown` (or `needs-you` with an open escalation). Never writes.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('../ui/store');
const { reduce } = require('../ui/reducer');
const { hasHelpFlag, resolveOut, dim, yellow, red } = require('./shared');
const { printUsage } = require('./help');

const EXCERPT_MAX = 1024;
const TIMELINE_MAX = 20;
// Fields a timeline entry keeps besides {t, kind}: enough for the pane's
// TIMELINE block, nothing that can carry a large payload (context, first_error).
const TIMELINE_FIELDS = ['phase', 'cycle', 'agent', 'role', 'verdict', 'gate', 'status', 'url', 'label'];

// Mirrors emit-event.sh's main_checkout(): the directory holding the common
// git dir is the main checkout, so a worktree cwd still finds the shared
// `.concertino/runs`. Outside a repo (or without git) the directory is used
// as given — store.listTickets tolerates a missing runs dir.
function resolveRoot(dir, deps = {}) {
  const run = deps.execFileSync || execFileSync;
  try {
    let common = run('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!common) return dir;
    if (!path.isAbsolute(common)) common = path.resolve(dir, common);
    return path.dirname(common);
  } catch (e) {
    return dir;
  }
}

function readTicketDoc(root, ticket) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(store.runDir(root, ticket), 'evidence', 'ticket.md'), 'utf8');
  } catch (e) {
    return { title: null, excerpt: null };
  }
  const lines = raw.split('\n');
  const headingAt = lines.findIndex((l) => /^#\s+/.test(l));
  const title = headingAt >= 0 ? lines[headingAt].replace(/^#\s+/, '').trim() : null;
  const body = lines.slice(headingAt >= 0 ? headingAt + 1 : 0).join('\n').trim();
  return { title, excerpt: body ? body.slice(0, EXCERPT_MAX) : null };
}

function readPendingAnswer(root, ticket) {
  // readAnswerFileRaw is not exported; the same defensive read inline.
  try {
    return JSON.parse(fs.readFileSync(store.answerPath(root, ticket), 'utf8'));
  } catch (e) {
    return null;
  }
}

function timelineOf(events) {
  return events.slice(-TIMELINE_MAX).map((ev) => {
    const row = { t: ev.t, kind: ev.kind };
    for (const f of TIMELINE_FIELDS) if (ev[f] != null) row[f] = ev[f];
    return row;
  });
}

function currentAgentOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if ((ev.kind === 'agent.spawn' || ev.kind === 'agent.resume') && ev.agent) return ev.agent;
  }
  return null;
}

function buildSnapshot(root, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const runs = reduce(store.readAll(root), [], now)
    .filter((run) => opts.all || run.status !== 'done')
    .map((run) => {
      const events = run.events;
      // `events` is the full fold input and can be large; the snapshot ships
      // the bounded timeline instead.
      const { events: _dropped, ...rest } = run;
      return {
        ...rest,
        ticket_doc: readTicketDoc(root, run.ticket),
        pendingAnswer: readPendingAnswer(root, run.ticket),
        timeline: timelineOf(events),
        currentAgent: currentAgentOf(events),
      };
    });
  return { generatedAt: now, root, runs };
}

function fmtElapsed(ms) {
  if (ms == null) return '-';
  const m = Math.floor(ms / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

function renderTable(snapshot) {
  if (!snapshot.runs.length) return dim('no active runs under ' + store.runsDir(snapshot.root));
  const colour = (run, s) => run.status === 'needs-you' ? yellow(s) : run.status === 'failed' ? red(s) : s;
  return snapshot.runs.map((run) => {
    const passed = run.gates.filter((g) => g.status === 'pass').length;
    return colour(run, [
      run.ticket.padEnd(10),
      run.status.padEnd(10),
      (run.phase || '-').padEnd(11),
      ('c' + (run.cycle != null ? run.cycle : '-')).padEnd(4),
      (passed + '/' + run.gates.length).padEnd(6),
      fmtElapsed(run.elapsedMs).padEnd(6),
      run.currentAgent || '',
    ].join(' ').trimEnd());
  }).join('\n');
}

async function cmdFleet(args) {
  if (hasHelpFlag(args)) { printUsage('fleet'); return; }
  const root = resolveRoot(resolveOut(args));
  const snapshot = buildSnapshot(root, { all: !!args.all });
  if (args.json) {
    process.stdout.write(JSON.stringify(snapshot) + '\n');
    return;
  }
  console.log(renderTable(snapshot));
}

module.exports = { cmdFleet, buildSnapshot, resolveRoot, readTicketDoc, renderTable, EXCERPT_MAX, TIMELINE_MAX };
