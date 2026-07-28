'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderLaunchPlan, handleKey, render, derivePorts, deriveTicketNum, cycleConcurrency,
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
  const lines = out.split('\n').filter((l) => /^\s+\d+\s+CON-3/.test(l));
  assert.match(lines[0], /start now/);
  assert.match(lines[1], /queued/);
  assert.match(lines[2], /queued/);
});

test('parallel with cap 2: the first two start now, the third is queued — the exact mockup numbers', () => {
  const out = plain(renderLaunchPlan(plan({ mode: 'parallel', concurrency: 2 }), 0, OPTS));
  // Anchored so this only picks up ticket ROWS, not the header line — the
  // header also contains "CON-338" (as "HEL-338 +2"-style summary text) and
  // an unanchored /CON-3/ matched that first, which was this test's own bug.
  const lines = out.split('\n').filter((l) => /^\s+\d+\s+CON-3/.test(l));
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
