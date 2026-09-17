'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./support/tmp');

const report = require('../lib/cli/report');

const BIN = path.resolve(__dirname, '..', 'bin', 'concertino');

function writeEvents(root, ticket, events) {
  const dir = path.join(root, '.concertino', 'runs', ticket);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function ticketFiledEvent(over) {
  return Object.assign(
    {
      t: 1789700000000,
      kind: 'ticket.filed',
      ticket: 'CON-192',
      role: 'script',
      ticket_id: 'CON-213',
      origin_ticket: 'CON-192',
      origin_repo: 'concertino',
      origin_role: 'skeptic',
      origin_phase: 'planning',
      origin_kind: 'followup',
      suggested_by: 'agent',
      triage: JSON.stringify({ overlap: 'none' }),
    },
    over,
  );
}

function ticket(over) {
  return Object.assign(
    {
      id: 'uuid-1',
      identifier: 'CON-213',
      title: 'a follow-up',
      description: '',
      state: { name: 'Backlog', type: 'backlog' },
      createdAt: 1789700000000,
      completedAt: null,
    },
    over,
  );
}

// --- 4.1 — unknown report name -----------------------------------------

test('4.1: an unknown report name exits non-zero and names the valid options', () => {
  try {
    execFileSync('node', [BIN, 'report', 'not-a-real-report'], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match(e.stderr, /unknown report/);
    assert.match(e.stderr, /followup-survival/);
  }
});

// --- 4.2 — reading provenance rows from a temp event-store fixture ------

test('4.2: readProvenanceEvents filters to origin_kind=followup across a mix of event kinds', () => {
  const root = mkTmpDir('concertino-report-');
  writeEvents(root, 'CON-192', [
    ticketFiledEvent(),
    { t: 1, kind: 'phase.enter', ticket: 'CON-192', role: 'orchestrator', phase: 'setup' },
    ticketFiledEvent({ ticket_id: 'CON-999', origin_kind: 'roadmap' }),
  ]);
  const rows = report.readProvenanceEvents(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticket_id, 'CON-213');
});

// --- 4.3 / 4.3a — convention needle: positive control ---------------------

test('4.3a: the real backticked rendering matches; the strict form does not', () => {
  const realRendering = '* `origin_kind`: followup\n* `origin_ticket`: CON-192';
  assert.ok(report.matchConvention(realRendering), 'formatting-tolerant needle must match the real rendering');
  assert.ok(!/origin_kind:\s*followup/i.test(realRendering), 'the strict form must NOT match this fixture');
});

test('4.3: prose marker matches the weaker heuristic, distinctly from convention', () => {
  assert.ok(report.matchProse('This is a follow-up from CON-100.'));
  assert.ok(!report.matchProse('no follow-ups needed here'));
});

// --- 4.3b — convention rows get unknown overlap/origin_ticket ------------

test('4.3b: a convention-recovered row mirroring CON-209 gets overlap unknown and no origin_ticket', () => {
  const desc = '* `origin_kind`: followup\n* `origin_repo`: concertino\n* `origin_role`: orchestrator\n' +
    '* `origin_phase`: setup\n* `suggested_by`: agent\n* `origin_ticket`: [CON-190](https://linear.app/x/issue/CON-190)';
  const { rows } = report.buildRecoveredRows([ticket({ description: desc })], new Set(), Date.now());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overlap, 'unknown');
  assert.equal(rows[0].originTicket, 'unknown');
  assert.equal(rows[0].marker, 'convention');
});

// --- 4.4 — fetchTickets called with completed in stateTypes --------------

test('4.4: the report requests completed states and uses fetchTickets, never fetchOneTicket', () => {
  assert.ok(report.ALL_STATE_TYPES.includes('completed'));
  const src = fs.readFileSync(require.resolve('../lib/cli/report'), 'utf8');
  assert.ok(!/fetchOneTicket/.test(src), 'report.js must never call fetchOneTicket (C2)');
  assert.match(src, /fetchTickets/);
});

test('4.4: cmdReport passes stateTypes including completed to the injected transport', async () => {
  const root = mkTmpDir('concertino-report-');
  const calls = [];
  const transport = (req) => {
    calls.push(JSON.parse(req.body));
    return Promise.resolve({
      status: 200,
      body: JSON.stringify({ data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }),
    });
  };
  const origExit = process.exit;
  process.exit = () => {};
  const origEnv = process.env.LINEAR_API_KEY;
  const origTeam = process.env.LINEAR_TEAM_KEY;
  process.env.LINEAR_API_KEY = 'test-key';
  process.env.LINEAR_TEAM_KEY = 'CON';
  try {
    await report.cmdReport({ _: ['report', 'followup-survival'], out: root, __transport: transport, config: path.join(root, 'nonexistent.json') });
  } finally {
    process.exit = origExit;
    process.env.LINEAR_API_KEY = origEnv;
    process.env.LINEAR_TEAM_KEY = origTeam;
  }
  assert.ok(calls.length >= 1);
  assert.ok(calls[0].variables.states.includes('completed'), 'requested states must include completed');
});

// --- 4.4a — dedupe: a ticket with BOTH provenance and matching text ------

test('4.4a: a ticket with both a ticket.filed event and convention text is provenance-only, and removing the dedupe changes the recovered total', () => {
  const now = Date.now();
  const events = [ticketFiledEvent({ ticket_id: 'CON-213' })];
  const t = ticket({ identifier: 'CON-213', description: '* `origin_kind`: followup' });
  const model = report.buildModel({ provenanceEvents: events, tickets: [t], now });

  assert.equal(model.provenanceRows.length, 1);
  assert.equal(model.provenanceRows[0].id, 'CON-213');
  assert.equal(model.recoveredRows.find((r) => r.id === 'CON-213'), undefined);
  assert.equal(model.excludedCount, 1);

  // The control: without dedupe (empty provenance-id set), the recovered
  // total for the SAME ticket set is different — proving this is a real
  // control, not a presence check.
  const { rows: withoutDedupe } = report.buildRecoveredRows([t], new Set(), now);
  assert.notEqual(withoutDedupe.length, model.recoveredRows.length);
});

// --- 4.4b — disjoint populations for a mixed fixture ---------------------

test('4.4b: provenance and recovered populations are disjoint by ticket id', () => {
  const now = Date.now();
  const events = [ticketFiledEvent({ ticket_id: 'CON-213' })];
  const tickets = [
    ticket({ identifier: 'CON-213', description: '* `origin_kind`: followup' }),
    ticket({ identifier: 'CON-209', description: '* `origin_kind`: followup' }),
  ];
  const model = report.buildModel({ provenanceEvents: events, tickets, now });
  const provIds = new Set(model.provenanceRows.map((r) => r.id));
  const recIds = new Set(model.recoveredRows.map((r) => r.id));
  const intersection = [...provIds].filter((id) => recIds.has(id));
  assert.deepEqual(intersection, []);
  assert.ok(recIds.has('CON-209'));
});

// --- 4.4c — dedupe applies to breakdowns, not only the top-line total ----

test('4.4c: a period/segment breakdown excludes a provenance-bearing ticket, not just the overall total', () => {
  const now = Date.now();
  const filedAt = 1789700000000;
  const events = [ticketFiledEvent({ ticket_id: 'CON-213', origin_role: 'skeptic' })];
  const tickets = [
    ticket({ identifier: 'CON-213', description: '* `origin_kind`: followup', createdAt: filedAt }),
  ];
  const model = report.buildModel({ provenanceEvents: events, tickets, now });
  // The recovered tier has zero rows because its one candidate is deduped —
  // so no period bucket and no segment bucket for origin_role can contain it.
  const { computeSurvival, bucketByWeek, segmentBy } = require('../lib/followup-survival');
  const periods = bucketByWeek(model.recoveredRows, 1);
  assert.equal(periods.length, 0, 'no recovered rows means no period buckets at all');
  const segs = segmentBy(model.recoveredRows, 'originRole', 1);
  assert.deepEqual(segs.buckets, {});
});

// --- 4.5 — no combined total ----------------------------------------------

test('4.5: rendered output labels both tiers and never sums them', () => {
  const model = report.buildModel({ provenanceEvents: [], tickets: [], now: Date.now() });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.match(text, /PROVENANCE tier/);
  assert.match(text, /RECOVERED-HEURISTIC tier/);
  assert.ok(!/combined/i.test(text));
});

// --- 4.6 — explicitly-empty provenance result -----------------------------

test('4.6: zero ticket.filed rows renders an explicitly-empty provenance result with no percentage', () => {
  const model = report.buildModel({ provenanceEvents: [], tickets: [], now: Date.now() });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  const provenanceSection = text.split('RECOVERED-HEURISTIC')[0];
  assert.match(provenanceSection, /No follow-up provenance has been recorded yet/);
  assert.ok(!/%/.test(provenanceSection));
});

// Task 7.1 (final-gate skeptic, round 2): the empty-provenance branch fires
// ONLY when total === 0, so a present-tense "this run's own filing is the
// exception" claim can never be true when this text renders — no such
// exception exists in an empty-total render, and "see below" points at
// nothing in the output. Reachable every time the branch fires, not
// hypothetical.
test('7.1: the empty-provenance message does not claim a same-run exception that cannot exist', () => {
  const model = report.buildModel({ provenanceEvents: [], tickets: [], now: Date.now() });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.equal(model.provenanceOverall.total, 0);
  assert.ok(!/this run's own filing is the exception/.test(text), 'must not claim a same-run exception when total is 0');
  assert.ok(!/see below/.test(text), 'must not reference a nonexistent forward pointer');
});

test('4.6: CLI subprocess with an empty event store and a real (network-free via missing key) exits appropriately', () => {
  // Exercises the CLI's credential-refusal path end to end as a subprocess
  // (task 4.7) — a real empty-provenance run additionally needs network
  // access, which is out of scope for a subprocess test; that path is
  // covered in-process above (4.6) and via 6.2a.
  const root = mkTmpDir('concertino-report-');
  try {
    execFileSync('node', [BIN, 'report', 'followup-survival', '--out=' + root], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { LINEAR_API_KEY: '' }),
    });
    assert.fail('expected non-zero exit with no LINEAR_API_KEY');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match(e.stderr, /LINEAR_API_KEY/);
  }
});

// --- 4.7 — missing credentials exits non-zero with explicit message ------

test('4.7: LINEAR_API_KEY unset exits non-zero with an explicit message', () => {
  const root = mkTmpDir('concertino-report-');
  try {
    execFileSync('node', [BIN, 'report', 'followup-survival', '--out=' + root], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { LINEAR_API_KEY: '' }),
    });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match(e.stderr, /LINEAR_API_KEY is not set/);
  }
});

// --- 4.8 — per-period table has volume and survival columns --------------

test('4.8: the per-period table shows both filed-volume and survival', () => {
  const filedAt1 = Date.UTC(2026, 0, 5);
  const events = [
    ticketFiledEvent({ ticket_id: 'CON-1' }),
    ticketFiledEvent({ ticket_id: 'CON-2' }),
    ticketFiledEvent({ ticket_id: 'CON-3' }),
    ticketFiledEvent({ ticket_id: 'CON-4' }),
    ticketFiledEvent({ ticket_id: 'CON-5' }),
  ];
  const tickets = ['CON-1', 'CON-2', 'CON-3', 'CON-4', 'CON-5'].map((id) =>
    ticket({ identifier: id, createdAt: filedAt1, state: { name: 'Done', type: 'completed' } }),
  );
  const model = report.buildModel({ provenanceEvents: events, tickets, now: Date.now() });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.match(text, /filed=5/);
  assert.match(text, /survival=/);
});

// --- 4.9 — escalation boundary stated, no pre/post rate -------------------

test('4.9: escalation section states the boundary and both populations, never a pre/post rate', () => {
  const model = report.buildModel({ provenanceEvents: [], tickets: [], now: Date.now() });
  const text = report.renderReport(model, { pre: 377, post: 1 }, 5);
  assert.match(text, new RegExp(String(report.CON188_BOUNDARY_MS)));
  assert.match(text, /pre-boundary escalation\.raised events: 377/);
  assert.match(text, /post-boundary escalation\.raised events: 1/);
  assert.ok(!/rate/i.test(text.split('Escalation context')[1]));
});

test('4.9: readEscalationBoundaryCounts segments at the CON-188 boundary', () => {
  const root = mkTmpDir('concertino-report-');
  writeEvents(root, 'CON-188', [
    { t: report.CON188_BOUNDARY_MS - 1000, kind: 'escalation.raised', ticket: 'CON-188', role: 'orchestrator', question: 'q', options: 'a,b' },
    { t: report.CON188_BOUNDARY_MS + 1000, kind: 'escalation.raised', ticket: 'CON-188', role: 'orchestrator', question: 'q', options: 'a,b' },
  ]);
  const counts = report.readEscalationBoundaryCounts(root);
  assert.equal(counts.pre, 1);
  assert.equal(counts.post, 1);
});

// --- 4.10 — origin_role single-valued annotation --------------------------

test('4.10: single-valued origin_role is annotated; a multi-role fixture is not', () => {
  const now = Date.now();
  const singleEvents = [
    ticketFiledEvent({ ticket_id: 'CON-1', origin_role: 'orchestrator' }),
    ticketFiledEvent({ ticket_id: 'CON-2', origin_role: 'orchestrator' }),
  ];
  const singleTickets = [ticket({ identifier: 'CON-1' }), ticket({ identifier: 'CON-2' })];
  const singleModel = report.buildModel({ provenanceEvents: singleEvents, tickets: singleTickets, now });
  const singleText = report.renderReport(singleModel, { pre: 0, post: 0 }, 5);
  assert.match(singleText, /SINGLE-VALUED/);

  const multiEvents = [
    ticketFiledEvent({ ticket_id: 'CON-1', origin_role: 'orchestrator' }),
    ticketFiledEvent({ ticket_id: 'CON-2', origin_role: 'skeptic' }),
  ];
  const multiModel = report.buildModel({ provenanceEvents: multiEvents, tickets: singleTickets, now });
  const multiText = report.renderReport(multiModel, { pre: 0, post: 0 }, 5);
  assert.ok(!/SINGLE-VALUED/.test(multiText));
});

// --- C5 (final-gate skeptic, round 1): the SINGLE-VALUED origin_role
// explanation must be guarded on the VALUE actually observed, not merely on
// singleValued+provenance-tier. Reachable with the corpus as it exists today
// (the live corpus's one ticket.filed event carries origin_role=skeptic).
test('C5: a single-valued origin_role of "skeptic" (n=1) does NOT claim orchestrator-hardcoding, and names the real value', () => {
  const now = Date.now();
  const events = [ticketFiledEvent({ ticket_id: 'CON-213', origin_role: 'skeptic' })];
  const tickets = [ticket({ identifier: 'CON-213' })];
  const model = report.buildModel({ provenanceEvents: events, tickets, now });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);

  assert.ok(!/hardcodes\s+origin_role=orchestrator/.test(text), 'must not claim orchestrator-hardcoding for a skeptic-only corpus');
  assert.match(text, /only one origin_role value observed in this corpus \(skeptic\)/, 'must name the actually-observed value');
  // The false claim from the pre-fix code, reproduced by the final-gate
  // skeptic, read exactly this way — pin it as an explicit non-match too.
  assert.ok(!text.includes('the emitting path (standaloneTicket template) hardcodes origin_role=orchestrator'));
});

// --- Change Request 2 (non-blocking): no doubled separator in marker lines.
test('CR2: a recovered-tier marker line has no doubled ": :" separator', () => {
  const now = Date.now();
  const t = ticket({ identifier: 'CON-9', description: 'This is a follow-up from CON-1.' });
  const model = report.buildModel({ provenanceEvents: [], tickets: [t], now });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.match(text, /marker=prose: \d+\/\d+/);
  assert.ok(!text.includes(': :'), 'marker line must not contain a doubled separator');
});

// --- 4.11 — migration caveat when both tiers have data --------------------

test('4.11: the migration caveat appears when both tiers have data in at least one period', () => {
  const now = Date.now();
  const filedAt = Date.UTC(2026, 0, 5);
  const events = [ticketFiledEvent({ ticket_id: 'CON-1' })];
  const provTicket = ticket({ identifier: 'CON-1', createdAt: filedAt });
  const recoveredTicket = ticket({ identifier: 'CON-9', description: '* `origin_kind`: followup', createdAt: filedAt });
  const model = report.buildModel({ provenanceEvents: events, tickets: [provTicket, recoveredTicket], now });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.match(text, /Migration caveat/);
});

test('4.11: the migration caveat is absent when only one tier has data', () => {
  const now = Date.now();
  const events = [];
  const recoveredTicket = ticket({ identifier: 'CON-9', description: '* `origin_kind`: followup' });
  const model = report.buildModel({ provenanceEvents: events, tickets: [recoveredTicket], now });
  const text = report.renderReport(model, { pre: 0, post: 0 }, 5);
  assert.ok(!/Migration caveat/.test(text));
});

// --- 5.2 — help block ------------------------------------------------------

test('5.1/5.2: concertino report --help prints the report usage block and exits 0', () => {
  const out = execFileSync('node', [BIN, 'report', '--help'], { encoding: 'utf8' });
  assert.match(out, /concertino report <name>/);
});

test('5.1: concertino report with no name prints usage guidance and exits non-zero', () => {
  try {
    execFileSync('node', [BIN, 'report'], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match(e.stderr, /usage: concertino report/);
  }
});

test('help lists report and its usage block is present', () => {
  const out = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
  assert.match(out, /concertino report <name>/);
});

// --- 6.2a — simultaneous empty-provenance + populated-recovered ----------

test('6.2a: empty provenance + populated recovered renders both correctly with exit 0 and no combined total', async () => {
  const root = mkTmpDir('concertino-report-');
  const recoveredTicket = ticket({ identifier: 'CON-9', description: '* `origin_kind`: followup' });
  const calls = [];
  const transport = (req) => {
    calls.push(JSON.parse(req.body));
    return Promise.resolve({
      status: 200,
      body: JSON.stringify({
        data: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: recoveredTicket.id,
                identifier: recoveredTicket.identifier,
                title: recoveredTicket.title,
                description: recoveredTicket.description,
                state: recoveredTicket.state,
                createdAt: '2026-06-01T00:00:00.000Z',
                completedAt: null,
              },
            ],
          },
        },
      }),
    });
  };
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (c) => { exitCode = c == null ? 0 : c; };
  const origEnv = process.env.LINEAR_API_KEY;
  const origTeam = process.env.LINEAR_TEAM_KEY;
  process.env.LINEAR_API_KEY = 'test-key';
  process.env.LINEAR_TEAM_KEY = 'CON';
  const origLog = console.log;
  let printed = '';
  console.log = (s) => { printed += s + '\n'; };
  try {
    await report.cmdReport({ _: ['report', 'followup-survival'], out: root, __transport: transport, config: path.join(root, 'nonexistent.json') });
  } finally {
    process.exit = origExit;
    process.env.LINEAR_API_KEY = origEnv;
    process.env.LINEAR_TEAM_KEY = origTeam;
    console.log = origLog;
  }
  assert.equal(exitCode, 0);
  assert.match(printed, /No follow-up provenance has been recorded yet/);
  assert.match(printed, /RECOVERED-HEURISTIC tier/);
  assert.ok(!/combined/i.test(printed));
});
