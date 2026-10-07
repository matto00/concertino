'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./support/tmp');
const fleet = require('../lib/cli/fleet');

// `concertino fleet` (docs/superpowers/specs/2026-10-06-fleet-pane-design.md):
// a read-only JSON snapshot of .concertino/runs for the Claude Code fleet
// pane. buildSnapshot is the pure-ish core (fs reads, no writes); the CLI
// wrapper is exercised once as a subprocess at the bottom of this file.

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');
const T0 = 1_700_000_000_000;

function writeRun(root, ticket, events, extra = {}) {
  const dir = path.join(root, '.concertino', 'runs', ticket);
  fs.mkdirSync(dir, { recursive: true });
  const lines = events.map((e, i) => JSON.stringify({
    t: T0 + i * 1000, project: 'p', ticket, role: 'script', ...e,
  }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n') + '\n');
  if (extra.ticketMd != null) {
    fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'ticket.md'), extra.ticketMd);
  }
  if (extra.answer != null) {
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(extra.answer));
  }
  return dir;
}

const START = { kind: 'run.start', branch: 'feature/thing/CON-1', worktree: '/w/CON-1', harness: 'claude-code' };

test('buildSnapshot: live run carries reducer fields plus ticket_doc, pendingAnswer, timeline, currentAgent', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [
    START,
    { kind: 'phase.enter', phase: 'Execution', cycle: 1 },
    { kind: 'agent.spawn', agent: 'executor', cycle: 1 },
    { kind: 'gate.result', gate: 'phase:setup', status: 'pass', duration_ms: 10 },
  ], { ticketMd: '# Add the thing\n\nBody line one.\nBody line two.\n' });

  const snap = (await fleet.buildSnapshot(root, { now: T0 + 60_000 }));
  assert.equal(snap.root, root);
  assert.equal(typeof snap.generatedAt, 'number');
  assert.equal(snap.runs.length, 1);
  const run = snap.runs[0];
  assert.equal(run.ticket, 'CON-1');
  assert.equal(run.phase, 'Execution');
  assert.equal(run.cycle, 1);
  assert.equal(run.changeName, 'thing');
  assert.equal(run.status, 'unknown');            // no tmux windows: liveness is the mod's job
  assert.deepEqual(run.ticket_doc, { title: 'Add the thing', excerpt: 'Body line one.\nBody line two.' });
  assert.equal(run.pendingAnswer, null);
  assert.equal(run.currentAgent, 'executor');
  assert.equal(run.timeline.length, 4);
  assert.deepEqual(run.timeline[1], { t: T0 + 1000, kind: 'phase.enter', phase: 'Execution', cycle: 1, role: 'script' });
  assert.deepEqual(run.timeline[3], { t: T0 + 3000, kind: 'gate.result', gate: 'phase:setup', status: 'pass', role: 'script' });
});

test('buildSnapshot: ticket_doc is null fields when evidence/ticket.md is missing; excerpt is capped at 1024 chars', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  writeRun(root, 'CON-2', [START], { ticketMd: '# Big\n' + 'x'.repeat(5000) });
  const byTicket = Object.fromEntries((await fleet.buildSnapshot(root, { now: T0 })).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].ticket_doc, { title: null, excerpt: null });
  assert.equal(byTicket['CON-2'].ticket_doc.title, 'Big');
  assert.equal(byTicket['CON-2'].ticket_doc.excerpt.length, 1024);
});

test('buildSnapshot: pendingAnswer passes answer.json through, single and multi-part', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START], { answer: { answer: 'b' } });
  writeRun(root, 'CON-2', [START], { answer: { subAnswers: ['a', null], total: 2, complete: false } });
  const byTicket = Object.fromEntries((await fleet.buildSnapshot(root, { now: T0 })).runs.map((r) => [r.ticket, r]));
  assert.deepEqual(byTicket['CON-1'].pendingAnswer, { answer: 'b' });
  assert.deepEqual(byTicket['CON-2'].pendingAnswer, { subAnswers: ['a', null], total: 2, complete: false });
});

test('buildSnapshot: timeline keeps the last 20 events and only whitelisted fields', async () => {
  const root = mkTmpDir('concertino-fleet-');
  const events = [START];
  for (let i = 0; i < 30; i++) events.push({ kind: 'gate.result', gate: 'g' + i, status: 'pass', first_error: 'noise' });
  writeRun(root, 'CON-1', events);
  const [run] = (await fleet.buildSnapshot(root, { now: T0 })).runs;
  assert.equal(run.timeline.length, 20);
  assert.equal(run.timeline[19].gate, 'g29');
  assert.equal(run.timeline[19].first_error, undefined);
});

test('buildSnapshot: done runs are excluded by default and included with all:true', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'delivered' }]);
  writeRun(root, 'CON-2', [START]);
  assert.deepEqual((await fleet.buildSnapshot(root, { now: T0 })).runs.map((r) => r.ticket), ['CON-2']);
  assert.deepEqual(
    (await fleet.buildSnapshot(root, { now: T0, all: true })).runs.map((r) => r.ticket).sort(),
    ['CON-1', 'CON-2'],
  );
});

test('buildSnapshot: a failed run (run.end status != delivered) stays in the default view', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'run.end', status: 'abandoned-stale' }]);
  const [run] = (await fleet.buildSnapshot(root, { now: T0 })).runs;
  assert.equal(run.status, 'failed');
});

test('buildSnapshot: no .concertino/runs directory yields runs: []', async () => {
  const root = mkTmpDir('concertino-fleet-');
  assert.deepEqual((await fleet.buildSnapshot(root, { now: T0 })).runs, []);
});

test('buildSnapshot: a malformed events.jsonl line is skipped, not thrown', async () => {
  const root = mkTmpDir('concertino-fleet-');
  const dir = writeRun(root, 'CON-1', [START]);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{not json\n');
  const [run] = (await fleet.buildSnapshot(root, { now: T0 })).runs;
  assert.equal(run.malformed, 1);
});

test('resolveRoot: resolves the main checkout from a worktree', () => {
  const root = mkTmpDir('concertino-fleet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const wt = path.join(root, '.concertino', 'worktrees', 'feature', 'thing', 'CON-1');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: root });
  assert.equal(fs.realpathSync(fleet.resolveRoot(wt)), fs.realpathSync(root));
});

test('resolveRoot: outside a git repo returns the directory itself', () => {
  const dir = mkTmpDir('concertino-fleet-');
  assert.equal(fleet.resolveRoot(dir), dir);
});

function runFleet(cwd, args) {
  try {
    const out = execFileSync('node', [BIN, 'fleet'].concat(args), { cwd, encoding: 'utf8' });
    return { out, status: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), status: e.status };
  }
}

test('cmdFleet --json: prints the snapshot for the cwd root and exits 0', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START, { kind: 'phase.enter', phase: 'Planning', cycle: 1 }]);
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  const snap = JSON.parse(out);
  assert.equal(snap.runs[0].ticket, 'CON-1');
  assert.equal(snap.runs[0].phase, 'Planning');
});

test('cmdFleet --json: empty root prints runs: [] and exits 0', () => {
  const root = mkTmpDir('concertino-fleet-');
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(out).runs, []);
});

test('cmdFleet (table): one line per run with ticket, status, phase, cycle, gates', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [
    START,
    { kind: 'phase.enter', phase: 'Execution', cycle: 2 },
    { kind: 'gate.result', gate: 'a', status: 'pass' },
    { kind: 'gate.result', gate: 'b', status: 'fail' },
  ]);
  const { out, status } = runFleet(root, []);
  assert.equal(status, 0);
  assert.match(out, /CON-1\s+unknown\s+Execution\s+c2\s+1\/2/);
});

test('cmdFleet: --out=DIR overrides the cwd', () => {
  const root = mkTmpDir('concertino-fleet-');
  const elsewhere = mkTmpDir('concertino-fleet-cwd-');
  writeRun(root, 'CON-9', [START]);
  const { out } = runFleet(elsewhere, ['--json', '--out=' + root]);
  assert.equal(JSON.parse(out).runs[0].ticket, 'CON-9');
});

test('cmdFleet --help prints the usage block', () => {
  const { out, status } = runFleet(process.cwd(), ['--help']);
  assert.equal(status, 0);
  assert.match(out, /concertino fleet/);
  assert.match(out, /--json/);
});

test('cmdFleet: a root that is not a directory exits 1 naming the path', () => {
  const { out, status } = runFleet(process.cwd(), ['--out=/nonexistent/dir', '--json']);
  assert.notEqual(status, 0);
  assert.match(out, /\/nonexistent\/dir is not a directory/);
});

// --- v1.1: --tickets enrichment -------------------------------------------------------------------
const cacheMod = require('../lib/ui/fleet-ticket-cache');

const LINEAR_CFG = { ticketProvider: { kind: 'linear' } };
const detail = (ident, over = {}) => ({ id: 'u-' + ident, identifier: ident, number: 1, title: 'T ' + ident, description: 'Desc ' + ident, url: 'https://l/' + ident,
  state: { name: 'In Progress', type: 'started' }, estimate: 3, priority: 2, assignee: 'Matt', labels: ['x'], epicId: null, epicName: null,
  updatedAt: 1, createdAt: 1, completedAt: null, comments: [{ id: 'c1', author: 'Matt', body: 'hi', createdAt: 5 }], commentCount: 1, commentsTruncated: false, ...over });

function fakeFetch(map, calls) {
  return async ({ id }) => {
    calls.push(id);
    if (map[id] instanceof Error) throw map[id];
    if (!map[id]) throw new Error('linear: ticket "' + id + '" was not found');
    return map[id];
  };
}

test('parseTickets tolerates empty and trailing comma', () => {
  assert.deepEqual(fleet.parseTickets(undefined), []);
  assert.deepEqual(fleet.parseTickets(''), []);
  assert.deepEqual(fleet.parseTickets('CON-1,'), ['CON-1']);
  assert.deepEqual(fleet.parseTickets(' CON-1 , con-2 '), ['CON-1', 'con-2']);
});

test('enrichTickets: requested tickets are fetched once, cached, and served from cache within the TTL', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]);
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 10_000, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  let snap = await fleet.buildSnapshot(root, { now: 10_000, tickets: ['CON-1'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1']);
  assert.equal(by['CON-1'].ticket_meta.description, 'Desc CON-1');
  assert.equal(by['CON-1'].ticket_meta.fetchedAt, 10_000);
  assert.equal(by['CON-1'].ticket_meta.epicId, undefined);
  assert.equal(by['CON-1'].ticket_meta_error, null);
  assert.equal(by['CON-2'].ticket_meta, null);          // not requested, nothing cached
  assert.equal(by['CON-2'].ticket_meta_error, null);
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1').fetchedAt, 10_000);
  // 15 s later: still fresh, no fetch
  snap = await fleet.buildSnapshot(root, { now: 25_000, tickets: ['CON-1'], deps: { ...deps, now: 25_000 } });
  assert.deepEqual(calls, ['CON-1']);
  // 21 s later: stale, refetched
  snap = await fleet.buildSnapshot(root, { now: 31_000, tickets: ['CON-1'], deps: { ...deps, now: 31_000 } });
  assert.deepEqual(calls, ['CON-1', 'CON-1']);
  assert.equal(snap.runs.find((r) => r.ticket === 'CON-1').ticket_meta.fetchedAt, 31_000);
});

test('enrichTickets: an unrequested ticket is served from cache when present, never fetched', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1'), 1));
  const calls = [];
  const snap = await fleet.buildSnapshot(root, { now: 999_999, tickets: [], deps: { fetchDetail: fakeFetch({}, calls), now: 999_999, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG } });
  assert.deepEqual(calls, []);
  assert.equal(snap.runs[0].ticket_meta.fetchedAt, 1);
});

test('enrichTickets: a not-found ticket sets ticket_meta_error and leaves others cached; the first failure stops further fetches', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]); writeRun(root, 'CON-3', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-3'), 1));
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-2': detail('CON-2') }, calls), now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  const snap = await fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2', 'CON-3'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1']);                    // CON-1 failed first; CON-2 and CON-3 were not fetched
  assert.equal(by['CON-1'].ticket_meta, null);
  assert.match(by['CON-1'].ticket_meta_error, /was not found/);
  assert.equal(by['CON-2'].ticket_meta, null);
  assert.match(by['CON-2'].ticket_meta_error, /was not found/); // the invocation's error is reported on every requested-but-unfetched run
  assert.equal(by['CON-3'].ticket_meta.fetchedAt, 1);    // stale cache still served
  assert.match(by['CON-3'].ticket_meta_error, /was not found/);
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1'), null);
});

test('enrichTickets: a 429 keeps the stale entry and reports it', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1', { description: 'old' }), 1));
  const calls = [];
  const snap = await fleet.buildSnapshot(root, { now: 999_999, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': new Error('linear: HTTP 429 — rate limited') }, calls), now: 999_999, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG } });
  assert.equal(snap.runs[0].ticket_meta.description, 'old');
  assert.match(snap.runs[0].ticket_meta_error, /429/);
});

test('enrichTickets: non-linear provider or missing key → null meta with a one-line error, no fetch', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const calls = [];
  let snap = await fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: { LINEAR_API_KEY: 'k' }, config: { ticketProvider: { kind: 'local' } } } });
  assert.equal(snap.runs[0].ticket_meta, null);
  assert.match(snap.runs[0].ticket_meta_error, /ticketProvider\.kind "local"/);
  snap = await fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: {}, config: LINEAR_CFG } });
  assert.equal(snap.runs[0].ticket_meta, null);
  assert.match(snap.runs[0].ticket_meta_error, /LINEAR_API_KEY/);
  assert.deepEqual(calls, []);
});

test('enrichTickets: the TTL env override is honoured', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const calls = [];
  const env = { LINEAR_API_KEY: 'k', CONCERTINO_FLEET_TICKET_TTL_MS: '1000' };
  await fleet.buildSnapshot(root, { now: 0, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 0, env, config: LINEAR_CFG } });
  await fleet.buildSnapshot(root, { now: 1500, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1500, env, config: LINEAR_CFG } });
  assert.deepEqual(calls, ['CON-1', 'CON-1']);
});

test('cmdFleet --json without --tickets adds ticket_meta: null to every run and never touches Linear', () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const { out, status } = runFleet(root, ['--json']);
  assert.equal(status, 0);
  const run = JSON.parse(out).runs[0];
  assert.equal(run.ticket_meta, null);
  assert.equal(run.ticket_meta_error, null);
});
