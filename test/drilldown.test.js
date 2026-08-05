'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderDrillDown, handleKey, render, isLive, fmtGateDuration, phasePipeline,
  ticketPanelLines, evidenceItems, evidenceLines, EVIDENCE_MAX_VISIBLE, describeEvent,
} = require('../lib/ui/screens/drilldown');
const icons = require('../lib/ui/icons');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({
    ticket: 'HEL-334', project: 'helio', changeName: 'panel-resize-handles',
    branch: 'feature/panel-resize-handles/HEL-334',
    worktree: '.concertino/worktrees/HEL-334', devPort: 5334, backendPort: 8334,
    harness: 'claude', model: 'opus-5',
    phase: 'Evaluation', cycle: 2,
    gates: [
      { name: 'typecheck', status: 'pass', durationMs: 4000, firstError: null },
      { name: 'build', status: 'fail', durationMs: 8000, firstError: 'TS2345 Panel.tsx:88' },
    ],
    lastVerdict: { role: 'evaluator', verdict: 'FAIL', ref: null },
    escalation: null, escalationStale: false,
    events: [
      { t: 1000, kind: 'run.start', role: 'script', harness: 'claude', model: 'opus-5' },
      { t: 2000, kind: 'phase.enter', role: 'orchestrator', phase: 'Execution' },
      { t: 3000, kind: 'agent.spawn', role: 'executor' },
      { t: 4000, kind: 'verdict', role: 'evaluator', verdict: 'FAIL', ref: 'eval-report-c1.md' },
    ],
    startedAt: 1000, endedAt: null, endStatus: null, elapsedMs: 23 * 60000,
    window: { alive: true, idleMs: 0 }, status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

const OPTS = { cols: 78, now: 5000 };

// --- mockup structure --------------------------------------------------

test('renders the header: ticket, change name, branch, worktree, ports, harness/model', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /HEL-334/);
  assert.match(out, /panel-resize-handles/);
  assert.match(out, /feature\/panel-resize-handles\/HEL-334/);
  assert.match(out, /\.concertino\/worktrees\/HEL-334/);
  assert.match(out, /:5334/);
  assert.match(out, /:8334/);
  assert.match(out, /claude/);
  assert.match(out, /opus-5/);
});

// --- CON-22: resolved speed + per-role models, auditable after the fact ----

test('renders the resolved speed and per-role models when present', () => {
  const out = plain(renderDrillDown(run({
    speed: 'fast',
    models: { orchestrator: 'sonnet', executor: 'haiku', evaluator: 'haiku', skeptic: 'opus', auditor: 'sonnet' },
  }), OPTS));
  assert.match(out, /fast/);
  assert.match(out, /executor=haiku/);
  assert.match(out, /skeptic=opus/);
});

test('a run predating this feature (no speed/models) renders absence gracefully, not as malformed', () => {
  const out = plain(renderDrillDown(run({ speed: null, models: null }), OPTS));
  assert.match(out, /speed unknown/);
  assert.doesNotMatch(out, /undefined/);
});

test('renders the phase pipeline with the current phase marked', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /Setup ✓/);
  assert.match(out, /Evaluation ●/);
  assert.match(out, /Cleanup ○/);
});

test('phasePipeline returns null when the phase is unrecognised or absent', () => {
  assert.equal(phasePipeline(run({ phase: null })), null);
  assert.equal(phasePipeline(run({ phase: 'not-a-real-phase' })), null);
});

test('renders TIMELINE, GATES and EVIDENCE section headers', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /TIMELINE/);
  assert.match(out, /GATES/);
  assert.match(out, /EVIDENCE/);
});

// --- CON-42: icon vocabulary ------------------------------------------------

test('the branch row is prefixed with the branch icon, and the branch text is unchanged', () => {
  const out = plain(renderDrillDown(run({ branch: 'feature/panel-resize-handles/HEL-334' }), OPTS));
  assert.match(out, new RegExp(icons.branch + ' feature/panel-resize-handles/HEL-334'));
});

test('a run with no branch still renders its "(no branch yet)" fallback, prefixed with the branch icon', () => {
  const out = plain(renderDrillDown(run({ branch: null }), OPTS));
  assert.match(out, new RegExp(icons.branch + ' \\(no branch yet\\)'));
});

test('the TICKET/TIMELINE/GATES/EVIDENCE panel titles are each prefixed with their own icon', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, new RegExp(icons.ticket + ' \\[1\\] TICKET'));
  assert.match(out, new RegExp(icons.timeline + ' \\[2\\] TIMELINE'));
  assert.match(out, new RegExp(icons.gates + ' \\[3\\] GATES'));
  assert.match(out, new RegExp(icons.evidence + ' \\[4\\] EVIDENCE'));
});

test('no rendered line exceeds cols even with the new icon prefixes', () => {
  const out = plain(renderDrillDown(run({}), OPTS)).split('\n');
  const f = require('../lib/ui/format');
  for (const line of out) assert.ok(f.visibleLength(line) <= OPTS.cols, `line exceeds cols: ${JSON.stringify(line)}`);
});

test('the gate-status and phase-pipeline markers stay untouched — no new icon added to them', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  // gateLine's ✓/✗/○ and the phase pipeline's ✓/●/○ are pre-existing,
  // STATUS_COLOUR-governed markers this change deliberately does not touch
  // (design.md Decision 4) — spot-check the phase pipeline is exactly as
  // before, with no new glyph inserted next to it.
  assert.match(out, /Setup ✓─ Planning ✓─ Execution ✓─ Evaluation ●─ Delivery ○─ Cleanup ○/);
});

// --- slice-2b Important 3: this run's own malformed events must be visible ---
// reducer.js already counts, per run, a `malformed` total covering both a
// dropped/corrupted event-log line and an event that WAS recorded but had a
// field the reducer rejected (e.g. an unrecognised `phase.enter` value —
// see CON-3); fleet.js sums it fleet-wide with no per-run attribution, and
// until now the drill-down never read it at all — a run with corrupted or
// rejected-field events in its own log rendered as a clean, merely-short
// history with nothing saying part of it is missing.

test('a run with malformed events surfaces its own count near the timeline', () => {
  const out = plain(renderDrillDown(run({ malformed: 3 }), OPTS));
  assert.match(out, /TIMELINE.*▲ 3 malformed/);
});

test('a run with no malformed events shows no malformed marker at all', () => {
  const out = plain(renderDrillDown(run({ malformed: 0 }), OPTS));
  assert.doesNotMatch(out, /malformed/);
});

// --- role gutter ---------------------------------------------------------
// Forced isTTY, same technique as format-colour.test.js: colour is decided
// once at require time based on isTTY, so it must be true before requiring.

test('the role gutter colours each event\'s agent name per role', () => {
  process.stdout.isTTY = true;
  for (const m of ['../lib/ui/format', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
  const f = require('../lib/ui/format');
  const { renderDrillDown: renderColoured } = require('../lib/ui/screens/drilldown');

  const coloured = run({
    events: [
      { t: 1000, kind: 'agent.spawn', role: 'executor' },
      { t: 2000, kind: 'verdict', role: 'evaluator', verdict: 'FAIL' },
      { t: 3000, kind: 'verdict', role: 'skeptic', verdict: 'REFUTE' },
      { t: 4000, kind: 'note', role: 'orchestrator', msg: 'hi' },
    ],
  });
  const out = renderColoured(coloured, OPTS);
  assert.match(out, new RegExp(f.ROLE_COLOUR.executor('executor').replace(/[[\]()]/g, '\\$&')));
  assert.match(out, new RegExp(f.ROLE_COLOUR.evaluator('evaluator').replace(/[[\]()]/g, '\\$&')));
  assert.match(out, new RegExp(f.ROLE_COLOUR.skeptic('skeptic').replace(/[[\]()]/g, '\\$&')));
  assert.match(out, new RegExp(f.ROLE_COLOUR.orchestrator('orchestrator').replace(/[[\]()]/g, '\\$&')));

  process.stdout.isTTY = false;
  for (const m of ['../lib/ui/format', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
});

// --- status colour: consistent with the fleet view's FAILED heading --------
// spec.md's "Status colour is consistent across screens" requirement, own
// scenario: "the fleet view's FAILED section heading and the drill-down's
// header both render that status with the same colour." Forced isTTY, same
// technique as the role-gutter test above and format-colour.test.js.

test('a failed run\'s drill-down header status is coloured the same red the fleet view\'s FAILED heading uses', () => {
  process.stdout.isTTY = true;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
  const f = require('../lib/ui/format');
  const { renderDrillDown: renderColoured } = require('../lib/ui/screens/drilldown');
  const { renderFleet } = require('../lib/ui/screens/fleet');

  const failedRun = run({ status: 'failed', endStatus: 'escalated', endedAt: 100 });
  const drillOut = renderColoured(failedRun, OPTS);
  const escapedFailedStatus = f.STATUS_COLOUR.failed('escalated').replace(/[[\]()]/g, '\\$&');
  assert.match(drillOut, new RegExp(escapedFailedStatus),
    'the drill-down header should wrap the failed run\'s endStatus in STATUS_COLOUR.failed');

  // Same colour the fleet view's FAILED section heading uses, for the exact
  // same run's status — this is the "same colour everywhere" scenario, not
  // just "some colour appears somewhere." The heading now carries a
  // lazygit-layout digit-jump number ("[1] FAILED" — fleet-metrics-grid:
  // FAILED renders right after NEEDS YOU in canonical order, so it claims
  // [1] here since NEEDS YOU/RUNNING are both empty; QUICK START (CON-56:
  // always on screen) renders after RUNNING, claiming [2] instead) as the
  // single, sole populated section this fixture renders — the numbering is
  // inside the same colour wrap, not a separate un-coloured prefix.
  const fleetOut = renderFleet([failedRun], { cols: 78, selected: 0 });
  const escapedFailedHeading = f.STATUS_COLOUR.failed('[1] FAILED').replace(/[[\]()]/g, '\\$&');
  assert.match(fleetOut, new RegExp(escapedFailedHeading));

  // A dead window with no endStatus ("window exited") is also a failed-run
  // signal and must carry the same colour, not just the endStatus branch.
  const deadWindow = run({ status: 'failed', endStatus: null, endedAt: null, window: { alive: false, idleMs: null } });
  const deadOut = renderColoured(deadWindow, OPTS);
  const escapedWindowExited = f.STATUS_COLOUR.failed('window exited').replace(/[[\]()]/g, '\\$&');
  assert.match(deadOut, new RegExp(escapedWindowExited));

  process.stdout.isTTY = false;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
});

// --- gates: duration and first_error ------------------------------------

test('gates render their duration', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /typecheck\s+4s/);
});

test('a failing gate renders its first_error on a nested line', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /TS2345 Panel\.tsx:88/);
});

test('a gate with no first_error shows no nested line, rather than inventing one', () => {
  const out = plain(renderDrillDown(run({
    gates: [{ name: 'lint', status: 'fail', durationMs: 500, firstError: null }],
  }), OPTS));
  // Every box now draws its own bottom border with a '└' corner, so bare
  // '└' is no longer a safe signal on its own (the GATES/EVIDENCE boxes'
  // borders use it constantly). The nested first_error marker is distinct
  // in shape from a border corner: it sits inside a content row, indented
  // past the box's own left border and padding ('│   └ ...'), where a
  // border row's '└' is either the very first character of the line or
  // immediately follows the one-column hsplit() gap — never preceded by
  // '│' and further padding.
  assert.doesNotMatch(out, /│ {3}└/);
});

test('CON-7: a sub-second gate reports 0ms honestly rather than hiding it', () => {
  assert.equal(fmtGateDuration(0), '0ms');
  const out = plain(renderDrillDown(run({
    gates: [{ name: 'fast-gate', status: 'pass', durationMs: 0, firstError: null }],
  }), OPTS));
  assert.match(out, /fast-gate\s+0ms/);
});

test('fmtGateDuration keeps sub-minute precision above 60s', () => {
  assert.equal(fmtGateDuration(72000), '1m12s');
});

// --- degradation: absent data must never render as healthy ---------------

test('no timeline: says so, distinctly, rather than an empty panel', () => {
  const out = plain(renderDrillDown(run({ events: [] }), OPTS));
  assert.match(out, /no events recorded/);
});

test('no gates: says so', () => {
  const out = plain(renderDrillDown(run({ gates: [] }), OPTS));
  assert.match(out, /no gate results recorded/);
});

test('no evidence: says so (this is also the common case today — nothing emits evidence yet)', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /no evidence recorded/);
});

test('evidence events render as evidence lines when present', () => {
  const out = plain(renderDrillDown(run({
    events: [{ t: 1000, kind: 'evidence', role: 'evaluator', label: 'eval-report-c1.md' }],
  }), OPTS));
  assert.match(out, /eval-report-c1\.md/);
  assert.doesNotMatch(out, /no evidence recorded/);
});

test('no telemetry at all: the header says so and the pipeline refuses to guess', () => {
  const out = plain(renderDrillDown(run({
    telemetry: 'none', phase: null, cycle: null, gates: [], events: [],
    branch: null, changeName: null, worktree: null, devPort: null, backendPort: null,
    harness: null, model: null, startedAt: null,
  }), OPTS));
  assert.match(out, /no telemetry/);
  assert.match(out, /phase pipeline unavailable/);
  assert.match(out, /no events recorded/);
  assert.match(out, /no gate results recorded/);
  assert.match(out, /no evidence recorded/);
});

// --- CON-77: spawn visibility -----------------------------------------------

test('a live, spawned-but-not-started run\'s header reads "starting…", not "no telemetry"', () => {
  const out = plain(renderDrillDown(run({
    telemetry: 'none', phase: null, cycle: null, gates: [], events: [],
    branch: null, changeName: null, worktree: null, devPort: null, backendPort: null,
    harness: null, model: null, startedAt: null, status: 'running',
    spawnedAt: 3000, startingMs: 2000,
    window: { alive: true, idleMs: 0 },
  }), OPTS));
  // headerLines()'s own phaseRight text, on the header's first row — must
  // read "starting…", not "no telemetry" (the phase-pipeline fallback
  // below it, which this proposal deliberately leaves unchanged — see
  // tasks.md §4 — legitimately still says "no telemetry" of its own).
  const headerRow1 = out.split('\n')[0];
  assert.match(headerRow1, /starting…/);
  assert.doesNotMatch(headerRow1, /no telemetry/);
  // elapsedText()'s own "starting · <dur>" text, in the header's third row.
  assert.match(out, /starting · /);
});

test('a run predating this feature (no spawnedAt) still renders today\'s "no telemetry" wording', () => {
  const out = plain(renderDrillDown(run({
    telemetry: 'none', phase: null, cycle: null, gates: [], events: [],
    branch: null, changeName: null, worktree: null, devPort: null, backendPort: null,
    harness: null, model: null, startedAt: null, status: 'running',
    window: { alive: true, idleMs: 0 },
  }), OPTS));
  assert.match(out, /no telemetry/);
  assert.doesNotMatch(out, /starting/);
});

test('a dead run that never emitted run.start reads "failed to start", not "window exited"', () => {
  const out = plain(renderDrillDown(run({
    telemetry: 'none', phase: null, cycle: null, gates: [], events: [],
    startedAt: null, status: 'failed', endedAt: null, endStatus: null,
    spawnedAt: 1, startingMs: null,
    window: { alive: false, idleMs: null },
  }), OPTS));
  assert.match(out, /failed to start/);
  assert.doesNotMatch(out, /window exited/);
});

test('a missing run renders safely rather than throwing', () => {
  assert.doesNotThrow(() => renderDrillDown(null, OPTS));
  assert.match(plain(renderDrillDown(null, OPTS)), /no longer available/);
});

// --- kill / restart: only meaningful on a live run ------------------------

test('isLive is true for anything but done/failed', () => {
  assert.equal(isLive(run({ status: 'running' })), true);
  assert.equal(isLive(run({ status: 'needs-you' })), true);
  assert.equal(isLive(run({ status: 'unknown' })), true);
  assert.equal(isLive(run({ status: 'done' })), false);
  assert.equal(isLive(run({ status: 'failed' })), false);
});

test('k on a live run opens the kill confirmation', () => {
  assert.deepEqual(handleKey('k', { run: run({ status: 'running' }) }),
    { type: 'confirm-action', action: 'kill' });
});

test('r on a live run opens the restart confirmation', () => {
  assert.deepEqual(handleKey('r', { run: run({ status: 'running' }) }),
    { type: 'confirm-action', action: 'restart' });
});

test('k/r stay reachable regardless of TICKET/TIMELINE/GATES focus — only EVIDENCE focus blocks them', () => {
  // lazygit-layout pass: TICKET/TIMELINE/GATES scroll via arrow/page keys
  // only, deliberately never bare j/k, so k kill/r restart are never
  // shadowed by scroll the way they would be if those panels also claimed
  // j/k the way EVIDENCE does.
  for (const focus of ['ticket', 'timeline', 'gates']) {
    const r = run({ status: 'running' });
    assert.deepEqual(handleKey('k', { run: r, drillFocus: focus }), { type: 'confirm-action', action: 'kill' });
    assert.deepEqual(handleKey('r', { run: r, drillFocus: focus }), { type: 'confirm-action', action: 'restart' });
  }
});

test('k on a finished run is refused outright, not just unadvertised', () => {
  assert.equal(handleKey('k', { run: run({ status: 'done' }) }), null);
  assert.equal(handleKey('k', { run: run({ status: 'failed' }) }), null);
});

test('r on a finished run is refused outright', () => {
  assert.equal(handleKey('r', { run: run({ status: 'done' }) }), null);
  assert.equal(handleKey('r', { run: run({ status: 'failed' }) }), null);
});

test('the footer omits k/r hints for a finished run — the other half of the refusal', () => {
  const out = plain(renderDrillDown(run({ status: 'done', endStatus: 'delivered' }), OPTS));
  assert.doesNotMatch(out, /k kill/);
  assert.doesNotMatch(out, /r restart/);
  assert.match(out, /esc back/);
});

test('the footer offers k/r on a live run', () => {
  const out = plain(renderDrillDown(run({ status: 'running' }), OPTS));
  assert.match(out, /k kill/);
  assert.match(out, /r restart/);
});

test('y confirms a pending kill', () => {
  assert.deepEqual(handleKey('y', { run: run({}), confirm: 'kill' }),
    { type: 'kill-confirmed', ticket: 'HEL-334' });
});

test('y confirms a pending restart', () => {
  assert.deepEqual(handleKey('y', { run: run({}), confirm: 'restart' }),
    { type: 'restart-confirmed', ticket: 'HEL-334' });
});

test('any other key cancels a pending confirmation, including esc', () => {
  assert.deepEqual(handleKey('x', { run: run({}), confirm: 'kill' }), { type: 'cancel-confirm' });
  assert.deepEqual(handleKey('\x1b', { run: run({}), confirm: 'kill' }), { type: 'cancel-confirm' });
});

// slice-2b Important 2: the confirm banner can sit on screen across many
// one-second poll cycles while a human reads the warning. `run` here is
// always the freshest one routeHandleKey could find (never a snapshot from
// when the confirmation opened), so 'y' must re-check liveness at the
// moment it fires, not just trust that it was live when 'k'/'r' was first
// pressed — otherwise it silently relaunches an already-delivered ticket, or
// kills a run that already finished.
test('y on a confirmation whose run has since finished is refused — treated like any other key', () => {
  assert.deepEqual(handleKey('y', { run: run({ status: 'done', endStatus: 'delivered' }), confirm: 'kill' }),
    { type: 'cancel-confirm' });
  assert.deepEqual(handleKey('y', { run: run({ status: 'failed' }), confirm: 'restart' }),
    { type: 'cancel-confirm' });
});

test('a pending confirmation is rendered with its warning', () => {
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, { confirm: 'kill' })));
  assert.match(out, /kill HEL-334\?/i);
  assert.match(out, /ends the agent mid-run/);
  assert.match(out, /y confirm/);
});

test('a restart-failure notice is surfaced on screen', () => {
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, { notice: 'could not start HEL-334: tmux exited 1' })));
  assert.match(out, /could not start HEL-334/);
});

// --- attach and back, unconditionally -------------------------------------

test('enter attaches regardless of live/finished', () => {
  assert.deepEqual(handleKey('\r', { run: run({ status: 'running' }) }), { type: 'attach', ticket: 'HEL-334' });
  assert.deepEqual(handleKey('\r', { run: run({ status: 'done' }) }), { type: 'attach', ticket: 'HEL-334' });
});

test('escape backs out to the fleet', () => {
  assert.deepEqual(handleKey('\x1b', { run: run({}) }), { type: 'back' });
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', { run: run({}) }), null);
});

// --- router seam -----------------------------------------------------------

test('render(state, opts) picks the run out by ticket', () => {
  const state = { runs: [run({ ticket: 'HEL-1' }), run({ ticket: 'HEL-2' })], drillTicket: 'HEL-2' };
  const out = plain(render(state, OPTS));
  assert.match(out, /HEL-2/);
});

// --- width discipline -------------------------------------------------------

test('no rendered line exceeds opts.cols, including the coloured role gutter', () => {
  process.stdout.isTTY = true;
  for (const m of ['../lib/ui/format', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
  const f = require('../lib/ui/format');
  const { renderDrillDown: renderColoured } = require('../lib/ui/screens/drilldown');

  const wide = run({
    changeName: 'an-extremely-long-change-name-that-will-not-fit-anywhere-at-all',
    branch: 'feature/an-extremely-long-branch-name-that-also-will-not-fit/HEL-334',
    worktree: '.concertino/worktrees/a-very-long-worktree-path-indeed/HEL-334',
    events: [
      { t: 1000, kind: 'note', role: 'orchestrator', msg: 'a very long note message that should be truncated to fit the terminal width comfortably' },
      { t: 2000, kind: 'evidence', role: 'evaluator', label: 'a-very-long-evidence-filename-that-should-be-truncated-too.md' },
    ],
  });
  for (const cols of [50, 60, 78, 100, 120]) {
    const out = renderColoured(wide, { cols, now: 5000 });
    for (const line of out.split('\n')) {
      assert.ok(f.visibleLength(line) <= cols,
        `cols:${cols} line is ${f.visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }

  process.stdout.isTTY = false;
  for (const m of ['../lib/ui/format', '../lib/ui/screens/fleet', '../lib/ui/screens/drilldown']) {
    delete require.cache[require.resolve(m)];
  }
});

test('a wide (CJK) character in the change name and an evidence label stays inside the terminal width', () => {
  const wide = run({
    changeName: '日本語のブランチ名前がとても長い場合のテスト',
    events: [
      { t: 1000, kind: 'evidence', role: 'evaluator', label: 'とても長いエビデンスファイル名のテスト.md' },
      { t: 2000, kind: 'note', role: 'orchestrator', msg: 'これは非常に長いノートメッセージのテストです' },
    ],
  });
  const { visibleLength } = require('../lib/ui/format');
  for (const cols of [50, 60, 78, 120]) {
    const out = renderDrillDown(wide, { cols, now: 5000 });
    for (const line of out.split('\n')) {
      assert.ok(visibleLength(line) <= cols,
        `cols:${cols} line is ${visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }
});

// --- slice-2b Important 4: size the gates column to its content -------------
// Gate names are short and known at render time; TIMELINE's content is not
// (harness/model names, verdict refs, evidence labels are all open-ended).
// A fixed 55/45 split wasted width padding short gate names while truncating
// real timeline information away. These are the exact two examples from the
// review, now at 84 columns rather than 78: bordering TIMELINE/GATES/EVIDENCE
// (design.md Decision 1/3) costs each box 2 columns of border plus 2 of
// default padding, plus a 1-column gap between the two panes — 9 columns of
// pure framing overhead that did not exist when this test was written
// against the old ` │ `-divided twoCol() layout. The two example strings
// still fit in full once the terminal is wide enough to absorb that
// overhead; the trade-off itself (bordering costs columns) is accepted by
// design.md's own risk log.

test('at 84 cols, the harness/model on run started is no longer truncated away', () => {
  const out = plain(renderDrillDown(run({}), { cols: 84, now: 5000 }));
  assert.match(out, /run started {2}claude · opus-5/);
  assert.doesNotMatch(out, /run started.*claude…/);
});

test('at 84 cols, a verdict\'s report reference is no longer truncated away', () => {
  const out = plain(renderDrillDown(run({}), { cols: 84, now: 5000 }));
  assert.match(out, /verdict FAIL {2}eval-report-c1\.md/);
});

// Finds the row carrying both box titles (TIMELINE's and GATES') — i.e. the
// top border row — and returns the column where the right pane's own box
// begins (its top-left corner, the second '┌' on that row: the first is
// TIMELINE's own corner at column 0).
function rightPaneStartColumn(out) {
  const row = out.split('\n').find((l) => l.includes('TIMELINE') && l.includes('GATES'));
  return row.indexOf('┌', row.indexOf('┌') + 1);
}

test('the gates column is sized to its content, not a fixed 45% fraction, at 70/90/130 cols', () => {
  // Same two-gate, no-evidence fixture at every width: the content the right
  // column needs (longest of a gate line, its first_error, or the
  // "no evidence recorded" fallback) does not grow with the terminal, so the
  // pane stays the same width at every size tested — all the extra room at a
  // wider terminal must go to TIMELINE, not sit padding gate names. (Widths
  // bumped up from the pre-border 60/78/120 by the same border+padding+gap
  // overhead as the two tests above, so TIMELINE still has room to widen.)
  const widths = [70, 90, 130].map((cols) => {
    const out = renderDrillDown(run({}), { cols, now: 5000 });
    return rightPaneStartColumn(out); // == leftPaneWidth + 1 (the hsplit gap)
  });
  const [sepAt70, sepAt90, sepAt130] = widths;
  // TIMELINE's pane (everything left of the gap) must grow with the terminal...
  assert.ok(sepAt90 > sepAt70, `TIMELINE should widen from 70 to 90 cols: ${sepAt70} -> ${sepAt90}`);
  assert.ok(sepAt130 > sepAt90, `TIMELINE should widen from 90 to 130 cols: ${sepAt90} -> ${sepAt130}`);
  // ...while the gates/evidence pane itself (cols minus TIMELINE's pane and
  // the gap) stays pinned to what its content needs, not a fraction of a
  // much wider terminal — the whole point of sizing it to content.
  const rightWidthAt70 = 70 - sepAt70;
  const rightWidthAt130 = 130 - sepAt130;
  assert.equal(rightWidthAt70, rightWidthAt130,
    `gates/evidence pane width should be content-driven and constant: ${rightWidthAt70} at 70 cols vs ${rightWidthAt130} at 130 cols`);
});

// --- CON-18: TICKET panel and header title row --------------------------

test('header shows the resolved ticket title', () => {
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, {
    ticketText: { title: 'Drill-down should show the ticket title and description', description: 'body' },
  })));
  assert.match(out, /Drill-down should show the ticket title and description/);
});

test('header shows the "ticket text unavailable" fallback when opts.ticketText is absent', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  assert.match(out, /ticket text unavailable/);
});

test('the TICKET panel renders markdown-stripped plain text', () => {
  const ticketText = {
    title: 'Some title',
    description: '# Heading\n\nSome **bold** and `code` and a [link](https://example.com) here.',
  };
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, { ticketText })));
  assert.match(out, /TICKET/);
  assert.match(out, /Heading/);
  assert.match(out, /Some bold and code and a link here\./);
  // Scoped to the TICKET panel's own content specifically (via the exported
  // ticketPanelLines(), not the whole screen's text) — CON-22 added a fourth
  // header row with its own legitimate parens (the "(speed unknown)"
  // fallback when a run predates the speed feature), so asserting against
  // the full `out` string would fail on content that has nothing to do with
  // whether the TICKET panel itself strips markdown syntax.
  const panelText = plain(ticketPanelLines(ticketText, OPTS.cols - 4).join('\n'));
  assert.doesNotMatch(panelText, /[#*`[\]()]/);
});

test('a description longer than the viewport scrolls (docview windowing) instead of hard-truncating', () => {
  const longDescription = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, {
    ticketText: { title: 'Long ticket', description: longDescription },
  })));
  // TICKET_VIEWPORT_ROWS is 5 — one row is windowBody's own position
  // indicator, leaving 4 content rows visible before scrolling.
  assert.match(out, /line 0/);
  assert.match(out, /line 3/);
  assert.doesNotMatch(out, /line 4\b/);
  assert.match(out, /showing 1-4 of 20/);
});

test('scrolling the TICKET panel (drillTicketScroll/opts.ticketScroll) reveals later lines', () => {
  const longDescription = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, {
    ticketText: { title: 'Long ticket', description: longDescription },
    ticketScroll: 10,
  })));
  assert.match(out, /line 10/);
  assert.doesNotMatch(out, /line 0\b/);
});

test('scrolling the TIMELINE panel (drillTimelineScroll/opts.timelineScroll) reaches earlier events, no longer an unreachable "… N earlier events" dead end', () => {
  const manyEvents = Array.from({ length: 30 }, (_, i) => ({ t: i, kind: 'note', msg: 'event-' + i, role: 'script' }));
  const withoutScroll = plain(renderDrillDown(run({ events: manyEvents }), OPTS));
  assert.doesNotMatch(withoutScroll, /event-0\b/, 'the oldest event is scrolled out of the initial viewport');
  const withScroll = plain(renderDrillDown(run({ events: manyEvents }),
    Object.assign({}, OPTS, { timelineScroll: 20 })));
  assert.match(withScroll, /event-0\b/, 'scrolling back should reach the oldest event — no longer a dead end');
});

// --- lazygit-layout pass: GATES defensive scroll; TIMELINE outer flex -----

test('a GATES panel with many gates scrolls (capped at GATES_VIEWPORT_ROWS) rather than growing the box to fit every gate', () => {
  const manyGates = Array.from({ length: 20 }, (_, i) => ({ name: 'gate-' + i, status: 'pass', durationMs: 100 }));
  const r = run({ status: 'running', gates: manyGates });
  // Even unbounded (rows: 0/absent) — the GATES box itself is capped to its
  // own fixed viewport now, unlike before this task (where it grew tall
  // enough to show all 20 gates at once, unbounded).
  const out = plain(renderDrillDown(r, Object.assign({}, OPTS, { cols: 100, drillFocus: 'gates' })));
  assert.doesNotMatch(out, /gate-19\b/, 'the 20th gate must not be visible without scrolling');
  assert.match(out, /showing 1-9 of 20/);
});

test('scrolling GATES (drillGatesScroll/opts.gatesScroll) reaches later gates', () => {
  const manyGates = Array.from({ length: 20 }, (_, i) => ({ name: 'gate-' + i, status: 'pass', durationMs: 100 }));
  const r = run({ status: 'running', gates: manyGates });
  const withoutScroll = plain(renderDrillDown(r, Object.assign({}, OPTS, { cols: 100 })));
  assert.doesNotMatch(withoutScroll, /gate-19\b/);
  const withScroll = plain(renderDrillDown(r, Object.assign({}, OPTS, { cols: 100, gatesScroll: 15 })));
  assert.match(withScroll, /gate-19\b/);
});

test('with vertical space to spare, TIMELINE/GATES/EVIDENCE grow to push the footer to the last row', () => {
  const r = run({ status: 'running', gates: [{ name: 'test', status: 'pass', durationMs: 100 }] });
  const out = renderDrillDown(r, Object.assign({}, OPTS, { cols: 100, rows: 35 }));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /attach|jump/);
  assert.ok(lines.length <= 35, `expected at most 35 lines, got ${lines.length}`);
});

test('with no rows budget given, TIMELINE/GATES/EVIDENCE stay tight to content exactly as before this change', () => {
  const r = run({ status: 'running', gates: [{ name: 'test', status: 'pass', durationMs: 100 }] });
  const out = renderDrillDown(r, Object.assign({}, OPTS, { cols: 100 }));
  const lines = out.split('\n');
  assert.ok(lines.length < 25, 'unbounded render must stay tight to content, not pad out to some default height');
});

test('a short description renders in full with no truncation row', () => {
  const out = plain(renderDrillDown(run({}), Object.assign({}, OPTS, {
    ticketText: { title: 'Short ticket', description: 'just one short line' },
  })));
  assert.match(out, /just one short line/);
  assert.doesNotMatch(out, /more lines/);
});

test('a run with no ticket text shows the fallback in the TICKET panel too', () => {
  const out = plain(renderDrillDown(run({}), OPTS));
  const ticketPanelIdx = out.indexOf('TICKET');
  assert.ok(ticketPanelIdx >= 0);
  // "ticket text unavailable" appears at least twice: once in the header,
  // once inside the TICKET panel.
  const occurrences = out.split('ticket text unavailable').length - 1;
  assert.ok(occurrences >= 2, `expected at least 2 occurrences, got ${occurrences}`);
});

test('TIMELINE/GATES/EVIDENCE panel dimensions are unchanged whether or not there is a long ticket description', () => {
  const longDescription = Array.from({ length: 40 }, (_, i) => 'a much longer line of prose number ' + i).join('\n');
  const withLongDescription = renderDrillDown(run({}), Object.assign({}, OPTS, {
    ticketText: { title: 'x', description: longDescription },
  }));
  const withNone = renderDrillDown(run({}), OPTS);

  function timelineGatesEvidenceBoxLines(out) {
    return out.split('\n').filter((l) =>
      l.includes('TIMELINE') || l.includes('GATES') || l.includes('EVIDENCE') ||
      /^[│┌└].*[│┐┘]$/.test(plain(l)));
  }
  // Compare the width of the row carrying both TIMELINE's and GATES' box
  // titles — this is exactly rightPaneStartColumn()'s own row-finder, reused
  // here to prove the TIMELINE/GATES split point does not move.
  const rowWithBoth = (out) => plain(out).split('\n').find((l) => l.includes('TIMELINE') && l.includes('GATES'));
  assert.equal(
    plain(rowWithBoth(withLongDescription)).length,
    plain(rowWithBoth(withNone)).length,
    'the TIMELINE/GATES top-border row width must be unaffected by ticket description length',
  );
  // Cross-check via timelineGatesEvidenceBoxLines just to ensure both renders
  // actually still contain the three panels' boxes at all.
  assert.ok(timelineGatesEvidenceBoxLines(plain(withLongDescription)).length > 0);
  assert.ok(timelineGatesEvidenceBoxLines(plain(withNone)).length > 0);
});

test('a pathologically long first_error still caps the gates column rather than crushing the timeline', () => {
  const { visibleLength } = require('../lib/ui/format');
  const out = plain(renderDrillDown(run({
    gates: [{
      name: 'lint', status: 'fail', durationMs: 500,
      firstError: 'a'.repeat(200),
    }],
  }), OPTS));
  for (const line of out.split('\n')) {
    assert.ok(visibleLength(line) <= 78, `line exceeds cols: ${JSON.stringify(line)}`);
  }
});

// --- CON-19: EVIDENCE panel focus, selection, open, and its cap/scroll -----

function evidenceEvents(n) {
  return Array.from({ length: n }, (_, i) => ({
    t: 1000 + i, kind: 'evidence', role: 'evaluator', label: 'evidence-' + i + '.md', ref: '/tmp/evidence-' + i + '.md',
  }));
}

test('evidenceItems returns only evidence-kind events', () => {
  const items = evidenceItems(run({ events: [
    { t: 1, kind: 'run.start' },
    { t: 2, kind: 'evidence', label: 'a.md' },
    { t: 3, kind: 'evidence', label: 'b.md' },
  ] }));
  assert.equal(items.length, 2);
});

// --- lazygit-layout pass: four-panel focus (digit jump + tab cycle) --------

test('drillFocus defaults to ticket, the first panel, not evidence', () => {
  const out = plain(renderDrillDown(run({ status: 'running' }), OPTS));
  assert.match(out, /\[1\] TICKET/);
});

test('digit 1-4 jump directly to each panel', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(handleKey('1', { run: r, drillFocus: 'evidence' }), { type: 'switch-drill-focus', focus: 'ticket' });
  assert.deepEqual(handleKey('2', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'timeline' });
  assert.deepEqual(handleKey('3', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'gates' });
  assert.deepEqual(handleKey('4', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'evidence' });
});

test('tab cycles ticket -> timeline -> gates -> evidence -> ticket', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'ticket' }), { type: 'switch-drill-focus', focus: 'timeline' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'timeline' }), { type: 'switch-drill-focus', focus: 'gates' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'gates' }), { type: 'switch-drill-focus', focus: 'evidence' });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'evidence' }), { type: 'switch-drill-focus', focus: 'ticket' });
});

test('tab cycles through an empty EVIDENCE panel too — every panel is a legitimate focus target now', () => {
  const r = run({ events: [] });
  assert.deepEqual(handleKey('\t', { run: r, drillFocus: 'gates' }), { type: 'switch-drill-focus', focus: 'evidence' });
});

// --- footer hints per focus state -------------------------------------------

test('default focus (no EVIDENCE focus): ↵ attach / k kill / r restart are advertised, evidence keys are not', () => {
  const out = plain(renderDrillDown(run({ status: 'running', events: evidenceEvents(3) }), OPTS));
  assert.match(out, /↵ attach/);
  assert.match(out, /k kill/);
  assert.match(out, /r restart/);
  assert.doesNotMatch(out, /↵ open/);
});

test('EVIDENCE focused: selection/open keys are advertised, attach/kill/restart are not', () => {
  const out = plain(renderDrillDown(run({ status: 'running', events: evidenceEvents(3) }),
    Object.assign({}, OPTS, { drillFocus: 'evidence', drillEvidenceIndex: 0 })));
  assert.match(out, /↵ open/);
  assert.doesNotMatch(out, /↵ attach/);
  assert.doesNotMatch(out, /k kill/);
  assert.doesNotMatch(out, /r restart/);
  assert.match(out, /esc back/);
});

// --- key handling while EVIDENCE is focused ---------------------------------

test('j/k move the evidence selection while focused, clamped to the list\'s bounds', () => {
  const state = { run: run({ events: evidenceEvents(3) }), drillFocus: 'evidence', drillEvidenceIndex: 0 };
  assert.deepEqual(handleKey('j', state), { type: 'move-drill-evidence', delta: 1 });
  assert.deepEqual(handleKey('k', state), { type: 'move-drill-evidence', delta: -1 });
});

test('r is inert (not "restart") while EVIDENCE is focused — only j/k/↵ are bound there', () => {
  const state = { run: run({ status: 'running', events: evidenceEvents(3) }), drillFocus: 'evidence', drillEvidenceIndex: 0 };
  assert.equal(handleKey('r', state), null);
  // 'k' is bound while EVIDENCE is focused too — but to move-drill-evidence
  // (selection up), never to 'confirm-action: kill' (see the test above).
  assert.equal(handleKey('k', state).type, 'move-drill-evidence');
});

test('↵ opens the selected entry rather than attaching while EVIDENCE is focused', () => {
  const state = { run: run({ status: 'running', events: evidenceEvents(3) }), drillFocus: 'evidence', drillEvidenceIndex: 0 };
  const action = handleKey('\r', state);
  assert.equal(action.type, 'open-evidence-doc');
});

test('↵ while EVIDENCE is focused with a selected entry opens it via open-evidence-doc', () => {
  const r = run({ events: evidenceEvents(3) });
  const action = handleKey('\r', { run: r, drillFocus: 'evidence', drillEvidenceIndex: 1 });
  assert.deepEqual(action, {
    type: 'open-evidence-doc', ticket: r.ticket, ref: '/tmp/evidence-1.md', label: 'evidence-1.md',
  });
});

test('↵ while EVIDENCE is focused with no entries (defensive) is a no-op', () => {
  const r = run({ events: evidenceEvents(1) });
  assert.equal(handleKey('\r', { run: r, drillFocus: 'evidence', drillEvidenceIndex: 5 }), null);
});

// --- CON-55: PR artifact type in the EVIDENCE panel -------------------------

function prEvent(over) {
  return Object.assign({ t: 5000, kind: 'pr', role: 'orchestrator', url: 'https://github.com/example/repo/pull/9', label: 'PR: add widget' }, over);
}

test('evidenceItems includes both evidence-kind and pr-kind events, in event order', () => {
  const items = evidenceItems(run({ events: [
    { t: 1, kind: 'run.start' },
    { t: 2, kind: 'evidence', label: 'a.md' },
    prEvent({ t: 3 }),
    { t: 4, kind: 'evidence', label: 'b.md' },
  ] }));
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((ev) => ev.kind), ['evidence', 'pr', 'evidence']);
});

test('evidenceItems shows only file-based evidence when no pr event has been emitted', () => {
  const items = evidenceItems(run({ events: [
    { t: 1, kind: 'evidence', label: 'a.md' },
    { t: 2, kind: 'evidence', label: 'b.md' },
  ] }));
  assert.equal(items.length, 2);
  assert.ok(items.every((ev) => ev.kind === 'evidence'));
});

test('evidenceLines prefixes a pr-kind entry with the pr icon, not the plain selection marker', () => {
  const r = run({ events: [{ t: 1, kind: 'evidence', label: 'a.md', ref: '/tmp/a.md' }, prEvent()] });
  const lines = evidenceLines(r, 60, { focused: false });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^ {2}a\.md/, 'file entry keeps the plain unselected prefix');
  assert.ok(plain(lines[1]).startsWith(icons.pr + ' '), 'pr entry is prefixed with the pr icon');
  assert.match(plain(lines[1]), /PR: add widget/);
});

test('evidenceLines: a pr entry is visibly distinguishable from a file entry', () => {
  const r = run({ events: [{ t: 1, kind: 'evidence', label: 'a.md', ref: '/tmp/a.md' }, prEvent()] });
  const lines = evidenceLines(r, 60, { focused: false });
  assert.notEqual(plain(lines[0])[0], plain(lines[1])[0]);
});

test('describeEvent has a friendly case for pr events (TIMELINE rendering)', () => {
  const { label, detail } = describeEvent(prEvent());
  assert.equal(label, 'PR opened');
  assert.equal(detail, 'https://github.com/example/repo/pull/9');
});

test('↵ on a selected pr entry dispatches open-external-url, not open-evidence-doc', () => {
  const r = run({ events: [{ t: 1, kind: 'evidence', label: 'a.md', ref: '/tmp/a.md' }, prEvent()] });
  const action = handleKey('\r', { run: r, drillFocus: 'evidence', drillEvidenceIndex: 1 });
  assert.deepEqual(action, {
    type: 'open-external-url', ticket: r.ticket,
    url: 'https://github.com/example/repo/pull/9', label: 'PR: add widget',
  });
});

test('↵ on a selected file-based entry is unaffected by a pr entry also being present', () => {
  const r = run({ events: [{ t: 1, kind: 'evidence', label: 'a.md', ref: '/tmp/a.md' }, prEvent()] });
  const action = handleKey('\r', { run: r, drillFocus: 'evidence', drillEvidenceIndex: 0 });
  assert.deepEqual(action, {
    type: 'open-evidence-doc', ticket: r.ticket, ref: '/tmp/a.md', label: 'a.md',
  });
});

// --- EVIDENCE cap and scroll-follows-selection ------------------------------

test('an EVIDENCE list within the cap needs no windowing', () => {
  const lines = evidenceLines(run({ events: evidenceEvents(EVIDENCE_MAX_VISIBLE) }), 40, { focused: false });
  assert.equal(lines.length, EVIDENCE_MAX_VISIBLE);
  assert.doesNotMatch(plain(lines.join('\n')), /more/);
});

test('an unfocused, over-cap EVIDENCE list shows only the leading entries plus a truncation count', () => {
  const total = EVIDENCE_MAX_VISIBLE + 5;
  const lines = evidenceLines(run({ events: evidenceEvents(total) }), 40, { focused: false, selectedIndex: 0 });
  assert.equal(lines.length, EVIDENCE_MAX_VISIBLE + 1);
  assert.match(plain(lines.join('\n')), /… 5 more/);
  assert.match(plain(lines.join('\n')), /evidence-0\.md/);
  assert.doesNotMatch(plain(lines.join('\n')), new RegExp('evidence-' + (EVIDENCE_MAX_VISIBLE) + '\\.md'));
});

test('moving the selection past the visible window scrolls it into view while focused', () => {
  const total = EVIDENCE_MAX_VISIBLE + 5;
  const r = run({ events: evidenceEvents(total) });
  const farIndex = total - 1;
  const lines = evidenceLines(r, 40, { focused: true, selectedIndex: farIndex });
  const text = plain(lines.join('\n'));
  assert.match(text, new RegExp('evidence-' + farIndex + '\\.md'));
});

test('the selected entry is visually marked while EVIDENCE is focused', () => {
  const r = run({ events: evidenceEvents(3) });
  const lines = evidenceLines(r, 40, { focused: true, selectedIndex: 1 });
  assert.match(lines[1], /▸/);
  assert.doesNotMatch(lines[0], /▸/);
});

test('the EVIDENCE panel renders with the focused border style when drillFocus is evidence, and only EVIDENCE', () => {
  const out = renderDrillDown(run({ events: evidenceEvents(3) }),
    Object.assign({}, OPTS, { drillFocus: 'evidence', drillEvidenceIndex: 0 }));
  const lines = out.split('\n');
  const evidenceTitleLine = lines.find((l) => l.includes('EVIDENCE'));
  assert.match(evidenceTitleLine, /[┏┓┃]/);
  const ticketTitleLine = lines.find((l) => l.includes('TICKET'));
  const timelineTitleLine = lines.find((l) => l.includes('TIMELINE'));
  const gatesTitleLine = lines.find((l) => l.includes('GATES'));
  assert.doesNotMatch(ticketTitleLine, /[┏┓┃]/);
  assert.doesNotMatch(timelineTitleLine, /[┏┓┃]/);
  assert.doesNotMatch(gatesTitleLine, /[┏┓┃]/);
});

test('each of the four panels renders with the heavy border only when it individually holds focus', () => {
  const r = run({ events: evidenceEvents(3) });
  for (const [focus, titleFragment] of [['ticket', 'TICKET'], ['timeline', 'TIMELINE'], ['gates', 'GATES'], ['evidence', 'EVIDENCE']]) {
    const out = renderDrillDown(r, Object.assign({}, OPTS, { drillFocus: focus }));
    const lines = out.split('\n');
    const focusedLine = lines.find((l) => l.includes(titleFragment));
    assert.match(focusedLine, /[┏┓┃]/, `${focus} should be focused`);
  }
});

test('arrow up/down emit drill-panel-scroll for whichever of TICKET/TIMELINE/GATES holds focus', () => {
  const r = run({ status: 'running' });
  for (const panel of ['ticket', 'timeline', 'gates']) {
    assert.deepEqual(handleKey('\x1b[B', { run: r, drillFocus: panel }), { type: 'drill-panel-scroll', panel, delta: 1 });
    assert.deepEqual(handleKey('\x1b[A', { run: r, drillFocus: panel }), { type: 'drill-panel-scroll', panel, delta: -1 });
  }
});

test('page up/down emit a 5-line drill-panel-scroll jump', () => {
  const r = run({ status: 'running' });
  assert.deepEqual(handleKey('\x1b[5~', { run: r, drillFocus: 'timeline' }), { type: 'drill-panel-scroll', panel: 'timeline', delta: -5 });
  assert.deepEqual(handleKey('\x1b[6~', { run: r, drillFocus: 'timeline' }), { type: 'drill-panel-scroll', panel: 'timeline', delta: 5 });
});

test('bare j/k are inert (not scroll) on TICKET/TIMELINE/GATES — reserved for kill/restart', () => {
  const r = run({ status: 'done' }); // finished, so k/r's own kill/restart branch also declines — isolates this check
  for (const panel of ['ticket', 'timeline', 'gates']) {
    assert.equal(handleKey('j', { run: r, drillFocus: panel }), null);
  }
});

// --- router seam -------------------------------------------------------

test('render(state, opts) threads drillFocus/drillEvidenceIndex through to renderDrillDown', () => {
  const state = {
    runs: [run({ ticket: 'HEL-1', events: evidenceEvents(3) })], drillTicket: 'HEL-1',
    drillFocus: 'evidence', drillEvidenceIndex: 1,
  };
  const out = plain(render(state, OPTS));
  assert.match(out, /↵ open/);
});
