'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderDrillDown, handleKey, render, isLive, fmtGateDuration, phasePipeline,
} = require('../lib/ui/screens/drilldown');

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
  assert.doesNotMatch(out, /└/);
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
  for (const cols of [50, 60, 78, 100]) {
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
  for (const cols of [50, 60, 78]) {
    const out = renderDrillDown(wide, { cols, now: 5000 });
    for (const line of out.split('\n')) {
      assert.ok(visibleLength(line) <= cols,
        `cols:${cols} line is ${visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }
});
