'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderLaunchPlan, handleKey, render, derivePorts, deriveTicketNum, cycleConcurrency,
  withAgentMergeFlag, withSpeedFlag,
} = require('../lib/ui/screens/launchplan');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function ticket(id, title) {
  return { identifier: id, title };
}

function plan(over) {
  return Object.assign({
    tickets: [ticket('CON-338', 'spec-delta-validation'), ticket('CON-341', 'csv-connector-retry'), ticket('CON-349', 'pipeline-shape-presets')],
    mode: 'parallel',
    concurrency: 2,
    harness: 'claude',
    harnesses: ['claude'],
    baseBranch: 'main',
    commitSha: '3b2023c',
    worktreeBase: '.concertino/worktrees',
    launchCommand: 'claude "/concertino-deliver {{TICKET}}"',
    portsCfg: { frontendBase: 5173, backendBase: 8080 },
  }, over);
}

const OPTS = { cols: 78 };

// --- ports shown pre-flight --------------------------------------------------

test('derivePorts mirrors setup-worktree.sh: base + ticket number', () => {
  assert.deepEqual(derivePorts('CON-338', { frontendBase: 5173, backendBase: 8080 }), { devPort: 5511, backendPort: 8418 });
});

test('derivePorts defaults the bases when portsCfg is absent', () => {
  assert.deepEqual(derivePorts('CON-1', null), { devPort: 5174, backendPort: 8081 });
});

test('derivePorts returns null for a ticket with no trailing number, same as setup-worktree.sh would FAIL', () => {
  assert.equal(derivePorts('adopted-window', {}), null);
});

test('deriveTicketNum reads the number after the final hyphen', () => {
  assert.equal(deriveTicketNum('CON-338'), 338);
  assert.equal(deriveTicketNum('HEL-9'), 9);
});

test('the plan renders each ticket\'s ports with no run started and no network', () => {
  const out = plain(renderLaunchPlan(plan({}), 0, OPTS));
  assert.match(out, /:5511 :8418/);
  assert.match(out, /:5514 :8421/);
  assert.match(out, /:5522 :8429/);
});

// --- concurrency: bounded, editable, never "parallel = all of them" --------

test('cycleConcurrency increments and wraps between 1 and 8', () => {
  assert.equal(cycleConcurrency(1), 2);
  assert.equal(cycleConcurrency(7), 8);
  assert.equal(cycleConcurrency(8), 1);
});

test('the plan shows the concurrency cap, not just "parallel"', () => {
  const out = plain(renderLaunchPlan(plan({ concurrency: 2 }), 0, OPTS));
  assert.match(out, /max 2 concurrent/);
});

test('c cycles the concurrency', () => {
  assert.deepEqual(handleKey('c', { plan: plan({}) }), { type: 'cycle-concurrency' });
});

// --- start now / queued, derived from the cap -------------------------------

test('sequential (concurrency 1): only the first ticket starts now, the rest are queued', () => {
  const out = plain(renderLaunchPlan(plan({ mode: 'sequential', concurrency: 1 }), 0, OPTS));
  // Anchored so this only picks up ticket ROWS, not the header line — the
  // header also contains "CON-338" (as "HEL-338 +2"-style summary text) and
  // an unanchored /CON-3/ matched that first, which was this test's own bug.
  // The ticket list now sits inside a box (design.md Decision 1), so a row
  // starts with the box's own left border character, not raw whitespace.
  const lines = out.split('\n').filter((l) => /^[│┃]\s+\d+\s+CON-3/.test(l));
  assert.match(lines[0], /start now/);
  assert.match(lines[1], /queued/);
  assert.match(lines[2], /queued/);
});

test('parallel with cap 2: the first two start now, the third is queued — the exact mockup numbers', () => {
  const out = plain(renderLaunchPlan(plan({ mode: 'parallel', concurrency: 2 }), 0, OPTS));
  // Anchored so this only picks up ticket ROWS, not the header line — the
  // header also contains "CON-338" (as "HEL-338 +2"-style summary text) and
  // an unanchored /CON-3/ matched that first, which was this test's own bug.
  // The ticket list now sits inside a box (design.md Decision 1), so a row
  // starts with the box's own left border character, not raw whitespace.
  const lines = out.split('\n').filter((l) => /^[│┃]\s+\d+\s+CON-3/.test(l));
  assert.match(lines[0], /start now/);
  assert.match(lines[1], /start now/);
  assert.match(lines[2], /queued/);
});

// --- the fleet-wide warning, not just this batch ----------------------------

test('no warning when nothing else is active', () => {
  const out = plain(renderLaunchPlan(plan({}), 0, OPTS));
  assert.doesNotMatch(out, /already active/);
});

test('warns using the WHOLE FLEET\'s active count, not this batch\'s own tickets', () => {
  // 2 already active elsewhere + this batch's own concurrency (2 starting
  // now) = 4 concurrent — the exact numbers from the design doc's mockup.
  const out = plain(renderLaunchPlan(plan({ concurrency: 2 }), 2, OPTS));
  assert.match(out, /2 runs already active/);
  assert.match(out, /fleet would be 4 concurrent/);
});

test('render(state, opts) derives activeCount from the live fleet, not a snapshot on the plan', () => {
  const state = {
    launchPlan: plan({ concurrency: 1 }),
    runs: [{ ticket: 'HEL-1', status: 'running' }, { ticket: 'HEL-2', status: 'done' }],
  };
  const out = plain(render(state, OPTS));
  // Only HEL-1 is live; HEL-2 (done) must not count.
  assert.match(out, /1 run already active/);
  assert.match(out, /fleet would be 2 concurrent/);
});

// --- harness / base ------------------------------------------------------------

test('shows harness and base branch @ commit', () => {
  const out = plain(renderLaunchPlan(plan({}), 0, OPTS));
  assert.match(out, /harness\s+claude/);
  assert.match(out, /base\s+main @ 3b2023c/);
});

test('h is not advertised (or bound) with only one harness configured', () => {
  const out = plain(renderLaunchPlan(plan({ harnesses: ['claude'] }), 0, OPTS));
  assert.doesNotMatch(out, /h harness/);
  assert.equal(handleKey('h', { plan: plan({ harnesses: ['claude'] }) }), null);
});

test('h cycles the harness when more than one is configured', () => {
  const out = plain(renderLaunchPlan(plan({ harnesses: ['claude', 'codex'] }), 0, OPTS));
  assert.match(out, /h harness/);
  assert.deepEqual(handleKey('h', { plan: plan({ harnesses: ['claude', 'codex'] }) }), { type: 'cycle-harness' });
});

// --- CON-24: agent-merge toggle, shown pre-flight like ports/harness --------

test('withAgentMergeFlag inserts --agent-merge immediately after {{TICKET}}, inside the quotes', () => {
  assert.equal(
    withAgentMergeFlag('claude "/concertino-deliver {{TICKET}}"', true),
    'claude "/concertino-deliver {{TICKET}} --agent-merge"',
  );
});

test('withAgentMergeFlag inserts --no-agent-merge when disabled', () => {
  assert.equal(
    withAgentMergeFlag('claude "/concertino-deliver {{TICKET}}"', false),
    'claude "/concertino-deliver {{TICKET}} --no-agent-merge"',
  );
});

test('withAgentMergeFlag replaces a previously-set flag rather than appending a second one', () => {
  const once = withAgentMergeFlag('claude "/concertino-deliver {{TICKET}}"', true);
  const twice = withAgentMergeFlag(once, false);
  assert.equal(twice, 'claude "/concertino-deliver {{TICKET}} --no-agent-merge"');
});

test('withAgentMergeFlag survives a harness change (re-applied, not dropped)', () => {
  const withFlag = withAgentMergeFlag('claude "/concertino-deliver {{TICKET}}"', true);
  const afterHarnessSwitch = withAgentMergeFlag('codex "/concertino-deliver {{TICKET}}"', true);
  assert.equal(afterHarnessSwitch, 'codex "/concertino-deliver {{TICKET}} --agent-merge"');
  assert.notEqual(withFlag, afterHarnessSwitch);
});

test('the plan shows the resolved agent-merge value pre-flight', () => {
  const outOn = plain(renderLaunchPlan(plan({ agentMerge: true, agentMergeEditable: true }), 0, OPTS));
  assert.match(outOn, /agent-merge\s+on/);
  const outOff = plain(renderLaunchPlan(plan({ agentMerge: false, agentMergeEditable: true }), 0, OPTS));
  assert.match(outOff, /agent-merge\s+off/);
});

test('m is not advertised (or bound) when a custom launchCommand override disables editing', () => {
  const out = plain(renderLaunchPlan(plan({ agentMergeEditable: false }), 0, OPTS));
  assert.doesNotMatch(out, /m agent-merge/);
  assert.equal(handleKey('m', { plan: plan({ agentMergeEditable: false }) }), null);
});

test('m cycles agent-merge when editable', () => {
  const out = plain(renderLaunchPlan(plan({ agentMergeEditable: true }), 0, OPTS));
  assert.match(out, /m agent-merge/);
  assert.deepEqual(handleKey('m', { plan: plan({ agentMergeEditable: true }) }), { type: 'cycle-agent-merge' });
});

// --- CON-22: speed shown pre-flight + resolved models preview ---------------

test('withSpeedFlag inserts a speed token immediately after {{TICKET}}, inside the quotes', () => {
  assert.equal(
    withSpeedFlag('claude "/concertino-deliver {{TICKET}}"', 'fast'),
    'claude "/concertino-deliver {{TICKET}} fast"',
  );
});

test('withSpeedFlag with "default" removes any existing speed token rather than writing the literal word', () => {
  const withFast = withSpeedFlag('claude "/concertino-deliver {{TICKET}}"', 'fast');
  assert.equal(withSpeedFlag(withFast, 'default'), 'claude "/concertino-deliver {{TICKET}}"');
});

test('withSpeedFlag replaces a previously-set speed rather than appending a second one', () => {
  const once = withSpeedFlag('claude "/concertino-deliver {{TICKET}}"', 'fast');
  const twice = withSpeedFlag(once, 'slow');
  assert.equal(twice, 'claude "/concertino-deliver {{TICKET}} slow"');
});

test('withSpeedFlag and withAgentMergeFlag compose without disturbing each other, agent-merge slot immediately after {{TICKET}}, speed after that', () => {
  let cmd = 'claude "/concertino-deliver {{TICKET}}"';
  cmd = withSpeedFlag(cmd, 'fast');
  cmd = withAgentMergeFlag(cmd, true);
  assert.equal(cmd, 'claude "/concertino-deliver {{TICKET}} --agent-merge fast"');
  // Cycling agent-merge again must not drop the speed token.
  cmd = withAgentMergeFlag(cmd, false);
  assert.equal(cmd, 'claude "/concertino-deliver {{TICKET}} --no-agent-merge fast"');
  // Cycling speed again must not drop the agent-merge flag.
  cmd = withSpeedFlag(cmd, 'slow');
  assert.equal(cmd, 'claude "/concertino-deliver {{TICKET}} --no-agent-merge slow"');
});

test('the plan shows the resolved speed pre-flight, defaulting to "default"', () => {
  const out = plain(renderLaunchPlan(plan({ speed: 'fast' }), 0, OPTS));
  assert.match(out, /speed\s+fast/);
  const outDefault = plain(renderLaunchPlan(plan({}), 0, OPTS));
  assert.match(outDefault, /speed\s+default/);
});

test('the plan shows the resolved per-role models when resolvedModels is present', () => {
  const out = plain(renderLaunchPlan(plan({
    speed: 'fast',
    resolvedModels: { models: { orchestrator: 'sonnet', executor: 'haiku', evaluator: 'haiku', skeptic: 'opus', auditor: 'sonnet' } },
  }), 0, OPTS));
  assert.match(out, /executor=haiku/);
  assert.match(out, /skeptic=opus/);
});

test('a null resolvedModels renders "models unknown" rather than throwing', () => {
  assert.doesNotThrow(() => renderLaunchPlan(plan({ resolvedModels: null }), 0, OPTS));
  const out = plain(renderLaunchPlan(plan({ resolvedModels: null }), 0, OPTS));
  assert.match(out, /models unknown/);
});

test('s is always advertised and bound, unlike h/m', () => {
  const out = plain(renderLaunchPlan(plan({ harnesses: ['claude'], agentMergeEditable: false }), 0, OPTS));
  assert.match(out, /s speed/);
  assert.deepEqual(handleKey('s', { plan: plan({}) }), { type: 'cycle-speed' });
});

// --- key handling ----------------------------------------------------------------

test('enter confirms and launches', () => {
  assert.deepEqual(handleKey('\r', { plan: plan({}) }), { type: 'confirm-launch' });
});

test('esc cancels back to the launch pad', () => {
  assert.deepEqual(handleKey('\x1b', { plan: plan({}) }), { type: 'cancel-launchplan' });
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', { plan: plan({}) }), null);
});

test('a missing plan renders "nothing selected" rather than throwing', () => {
  assert.doesNotThrow(() => renderLaunchPlan(null, 0, OPTS));
  assert.match(plain(renderLaunchPlan(null, 0, OPTS)), /nothing selected/);
});

// --- width discipline --------------------------------------------------------------

test('no rendered line exceeds opts.cols across widths', () => {
  const { visibleLength } = require('../lib/ui/format');
  const wide = plan({
    tickets: [ticket('CON-999999', 'an-extremely-long-ticket-title-that-will-not-fit-anywhere-at-all')],
  });
  for (const cols of [60, 78, 100, 120]) {
    const out = renderLaunchPlan(wide, 5, { cols });
    for (const line of out.split('\n')) {
      assert.ok(visibleLength(line) <= cols, `cols:${cols} line is ${visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }
});
