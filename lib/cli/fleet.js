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
const linear = require('../ui/linear');
const ticketCache = require('../ui/fleet-ticket-cache');
const { kindFor } = require('../ui/ticket-provider');
const { hasHelpFlag, resolveOut, resolveConfigPath, exists, read, dim, yellow, red } = require('./shared');
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

// v1.1: `--tickets=A,B` — the pane's shown lanes, whose Linear detail is kept
// fresh through the per-ticket cache (fleet-ticket-cache.js)
// (docs/superpowers/specs/2026-10-06-fleet-pane-design.md).
function parseTickets(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Launch-pad fields the pane does not need.
const META_DROP = ['epicId', 'epicName', 'number', 'updatedAt', 'createdAt', 'completedAt', 'commentCount'];
function toMeta(entry) {
  if (!entry) return null;
  const meta = Object.assign({}, entry);
  for (const k of META_DROP) delete meta[k];
  return meta;
}

function linearGate(config, env) {
  const kind = kindFor(config);
  if (kind !== 'linear') return 'ticket detail needs ticketProvider.kind "linear" (got ticketProvider.kind ' + JSON.stringify(kind == null ? null : kind) + ')';
  if (!env.LINEAR_API_KEY) return 'LINEAR_API_KEY is not set \u2014 ticket detail is unavailable';
  return null;
}

// Requested tickets (in the pane's shown-lane order): served from cache while
// fresh, otherwise fetched and cached. Unrequested runs: cache only. The first
// failure (incl. HTTP 429) stops further fetches this invocation and is
// reported on every requested run. The snapshot never fails because of Linear.
// A requested ticket with no run directory is still fetched and cached.
async function enrichTickets(root, runs, requested, deps) {
  const env = deps.env || process.env;
  const now = deps.now != null ? deps.now : Date.now();
  const want = new Set(requested.map((t) => t.toUpperCase()));
  let cache = deps.cache || ticketCache.read(root);
  let error = null;
  let dirty = false;

  if (requested.length) {
    error = linearGate(deps.config || {}, env);
    if (!error) {
      const fetchDetail = deps.fetchDetail || ((opts) => linear.fetchTicketDetail(Object.assign({ apiKey: env.LINEAR_API_KEY }, opts)));
      const ttl = ticketCache.ttlFromEnv(env);
      for (const id of requested) {
        if (error) break;
        if (ticketCache.isFresh(ticketCache.get(cache, id), now, ttl)) continue;
        try {
          cache = ticketCache.put(cache, await fetchDetail({ id }), now);
          dirty = true;
        } catch (e) {
          error = String((e && e.message) || e);
        }
      }
    }
  }

  for (const run of runs) {
    run.ticket_meta = toMeta(ticketCache.get(cache, run.ticket));
    run.ticket_meta_error = want.has(run.ticket.toUpperCase()) ? error : null;
  }
  if (dirty) {
    try { ticketCache.write(root, cache); } catch (e) { /* a cache write failure is not a snapshot failure */ }
  }
  return runs;
}

async function buildSnapshot(root, opts = {}) {
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
  await enrichTickets(root, runs, opts.tickets || [], opts.deps || {});
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
  const dir = resolveOut(args);
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch (e) { /* reported below */ }
  if (!isDir) throw new Error(dir + ' is not a directory');
  const root = resolveRoot(dir);
  const config = (() => { const p = resolveConfigPath(args, dir); try { return exists(p) ? JSON.parse(read(p)) : {}; } catch (e) { return {}; } })();
  const snapshot = await buildSnapshot(root, { all: !!args.all, tickets: parseTickets(args.tickets), deps: { config } });
  if (args.json) {
    process.stdout.write(JSON.stringify(snapshot) + '\n');
    return;
  }
  console.log(renderTable(snapshot));
}

module.exports = { cmdFleet, buildSnapshot, parseTickets, enrichTickets, resolveRoot, readTicketDoc, renderTable, EXCERPT_MAX, TIMELINE_MAX };
