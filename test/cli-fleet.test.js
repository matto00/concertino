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

test('enrichTickets: the first invocation error (429) stops further fetches and is reported on every requested run', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]); writeRun(root, 'CON-3', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-3'), 1));
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-1': new Error('linear: HTTP 429 — rate limited'), 'CON-2': detail('CON-2') }, calls), now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  const snap = await fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2', 'CON-3'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1']);                    // CON-2 and CON-3 were not fetched
  assert.equal(by['CON-1'].ticket_meta, null);
  assert.match(by['CON-1'].ticket_meta_error, /429/);
  assert.equal(by['CON-2'].ticket_meta, null);
  assert.match(by['CON-2'].ticket_meta_error, /429/);
  assert.equal(by['CON-3'].ticket_meta.fetchedAt, 1);    // stale cache still served
  assert.match(by['CON-3'].ticket_meta_error, /429/);
  // the 429 is stored with a retryUntil backoff
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1').retryUntil, 100 + 60_000);
  // within the backoff the ticket is not retried
  await fleet.buildSnapshot(root, { now: 30_000, tickets: ['CON-1'], deps: { ...deps, now: 30_000 } });
  assert.deepEqual(calls, ['CON-1']);
});

test('enrichTickets: not-found is per-ticket: it is negatively cached and the next ticket is still fetched', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]);
  const calls = [];
  const deps = { fetchDetail: fakeFetch({ 'CON-2': detail('CON-2') }, calls), now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  const snap = await fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1', 'CON-2']);
  assert.equal(by['CON-1'].ticket_meta, null);
  assert.match(by['CON-1'].ticket_meta_error, /was not found/);
  assert.equal(by['CON-2'].ticket_meta.description, 'Desc CON-2');
  assert.equal(by['CON-2'].ticket_meta_error, null);
  const stored = cacheMod.get(cacheMod.read(root), 'CON-1');
  assert.equal(stored.identifier, 'CON-1');
  assert.match(stored.error, /was not found/);
  // not refetched within the TTL; the failure still serves as the run's error
  const again = await fleet.buildSnapshot(root, { now: 5_000, tickets: ['CON-1', 'CON-2'], deps: { ...deps, now: 5_000 } });
  assert.deepEqual(calls, ['CON-1', 'CON-2']);
  assert.match(again.runs.find((r) => r.ticket === 'CON-1').ticket_meta_error, /was not found/);
  // after the TTL it is retried
  await fleet.buildSnapshot(root, { now: 40_000, tickets: ['CON-1'], deps: { ...deps, now: 40_000 } });
  assert.deepEqual(calls, ['CON-1', 'CON-2', 'CON-1']);
});

test('enrichTickets: a 429 on a ticket with a stale good entry keeps the detail and adds retryUntil', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1', { description: 'old' }), 1));
  const calls = [];
  const snap = await fleet.buildSnapshot(root, { now: 999_999, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': new Error('linear: HTTP 429 — rate limited') }, calls), now: 999_999, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG } });
  assert.equal(snap.runs[0].ticket_meta.description, 'old');
  assert.match(snap.runs[0].ticket_meta_error, /429/);
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-1').retryUntil, 999_999 + 60_000);
});

test('enrichTickets: an entry fetched under the canonical identifier is found by the requested id on the next poll', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'con-174', [START]);
  const calls = [];
  const deps = { fetchDetail: async ({ id }) => { calls.push(id); return detail('CON-174'); }, now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  await fleet.buildSnapshot(root, { now: 100, tickets: ['con-174'], deps });
  await fleet.buildSnapshot(root, { now: 5_000, tickets: ['con-174'], deps: { ...deps, now: 5_000 } });
  assert.deepEqual(calls, ['con-174']);
  assert.ok(cacheMod.get(cacheMod.read(root), 'CON-174'));
});

test('enrichTickets: the total Linear budget stops fetching, reports it, and the cache already holds the earlier fetches', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]); writeRun(root, 'CON-3', [START]);
  let t = 0;
  const calls = []; const timeouts = [];
  const deps = {
    fetchDetail: async ({ id, timeoutMs }) => { calls.push(id); timeouts.push(timeoutMs); t += 1500; return detail(id); },
    clock: () => t, now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG,
  };
  const snap = await fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2', 'CON-3'], deps });
  const by = Object.fromEntries(snap.runs.map((r) => [r.ticket, r]));
  assert.deepEqual(calls, ['CON-1', 'CON-2']);
  assert.deepEqual(timeouts, [fleet.FLEET_LINEAR_BUDGET_MS, fleet.FLEET_LINEAR_BUDGET_MS - 1500]);
  assert.match(by['CON-3'].ticket_meta_error, /budget/);
  assert.equal(by['CON-1'].ticket_meta.description, 'Desc CON-1');
  const onDisk = cacheMod.read(root);
  assert.ok(cacheMod.get(onDisk, 'CON-1') && cacheMod.get(onDisk, 'CON-2'));
  assert.equal(cacheMod.get(onDisk, 'CON-3'), null);
});

test('enrichTickets: the cache is written after every fetch, so a later failure keeps earlier ones', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]); writeRun(root, 'CON-2', [START]);
  const deps = { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1'), 'CON-2': new Error('linear: timed out after 900ms') }, []), now: 100, env: { LINEAR_API_KEY: 'k' }, config: LINEAR_CFG };
  const snap = await fleet.buildSnapshot(root, { now: 100, tickets: ['CON-1', 'CON-2'], deps });
  assert.match(snap.runs.find((r) => r.ticket === 'CON-2').ticket_meta_error, /timed out/);
  assert.ok(cacheMod.get(cacheMod.read(root), 'CON-1'));
  assert.equal(cacheMod.get(cacheMod.read(root), 'CON-2'), null);   // a timeout is not negatively cached
});

test('isInvocationError classifies invocation-wide failures only', () => {
  for (const m of ['linear: HTTP 429 — x', 'linear: LINEAR_API_KEY was rejected (HTTP 401)', 'linear: timed out after 5ms', 'getaddrinfo ENOTFOUND api.linear.app', 'ECONNRESET', 'getaddrinfo EAI_AGAIN', 'socket hang up', 'linear: time budget exhausted']) {
    assert.ok(fleet.isInvocationError(m), m);
  }
  assert.ok(!fleet.isInvocationError('linear: ticket "X" was not found'));
});

test('enrichTickets: non-linear provider is silent (no fetch, no error, cached meta served); a missing key in a linear repo reports', async () => {
  const root = mkTmpDir('concertino-fleet-');
  writeRun(root, 'CON-1', [START]);
  const calls = [];
  let snap = await fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: { LINEAR_API_KEY: 'k' }, config: { ticketProvider: { kind: 'local' } } } });
  assert.equal(snap.runs[0].ticket_meta, null);
  assert.equal(snap.runs[0].ticket_meta_error, null);
  cacheMod.write(root, cacheMod.put(cacheMod.read(root), detail('CON-1'), 1));
  snap = await fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({}, calls), now: 1, env: { LINEAR_API_KEY: 'k' }, config: { ticketProvider: { kind: 'local' } } } });
  assert.equal(snap.runs[0].ticket_meta.fetchedAt, 1);
  assert.equal(snap.runs[0].ticket_meta_error, null);
  snap = await fleet.buildSnapshot(root, { now: 1, tickets: ['CON-1'], deps: { fetchDetail: fakeFetch({ 'CON-1': detail('CON-1') }, calls), now: 1, env: {}, config: LINEAR_CFG } });
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

test('readConfig: --config wins; else the main checkout, then the cwd; bad JSON is {}', () => {
  const root = mkTmpDir('concertino-fleet-'); const dir = mkTmpDir('concertino-fleet-');
  assert.deepEqual(fleet.readConfig({}, dir, root), {});
  fs.writeFileSync(path.join(dir, 'concertino.config.json'), '{"a":1}');
  assert.deepEqual(fleet.readConfig({}, dir, root), { a: 1 });
  fs.writeFileSync(path.join(root, 'concertino.config.json'), '{"a":2}');
  assert.deepEqual(fleet.readConfig({}, dir, root), { a: 2 });
  const explicit = path.join(dir, 'x.json'); fs.writeFileSync(explicit, '{"a":3}');
  assert.deepEqual(fleet.readConfig({ config: explicit }, dir, root), { a: 3 });
  fs.writeFileSync(path.join(root, 'concertino.config.json'), '{nope');
  assert.deepEqual(fleet.readConfig({}, dir, root), {});
});

test('cmdFleet --tickets from a worktree reads concertino.config.json from the main checkout', () => {
  const root = mkTmpDir('concertino-fleet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const wt = path.join(root, '.concertino', 'worktrees', 'feature', 'thing', 'CON-1');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: root });
  fs.writeFileSync(path.join(root, 'concertino.config.json'), JSON.stringify(LINEAR_CFG));
  writeRun(root, 'CON-1', [START]);
  const env = { ...process.env }; delete env.LINEAR_API_KEY;
  const out = execFileSync('node', [BIN, 'fleet', '--tickets=CON-1', '--json'], { cwd: wt, encoding: 'utf8', env });
  const run = JSON.parse(out).runs[0];
  assert.match(run.ticket_meta_error, /LINEAR_API_KEY/);
  assert.doesNotMatch(run.ticket_meta_error, /ticketProvider/);
});
