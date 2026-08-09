'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const launchpadCtl = require('../lib/ui/controllers/launchpad');
const presetsCache = require('../lib/ui/presets-cache');

// Drives the real controller against a minimal ctx, mirroring
// test/controllers-presets.test.js's own precedent — the real
// presets-cache module against a throwaway tmp root, and a fake
// ctx.resolveModels/ctx.launcher (no real child process / resolve-speed.sh
// invocation).

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-launchpad-ctl-'));
}

function ticket(id, title, over) {
  return Object.assign({ identifier: id, title, labels: [] }, over);
}

function ctx(over) {
  const S = { runs: [], queueState: null, launchPad: null, launchPlan: null };
  return Object.assign({
    S,
    root: tmpRoot(),
    cfg: {},
    config: { harnesses: ['claude-code', 'codex'] },
    launcher: {
      launchCommand: 'claude "/concertino-deliver {{TICKET}}"',
      projectHarnesses: ['claude-code', 'codex'],
    },
    deps: { queue: {}, queueCache: {}, presetsCache },
    resolveModels: () => ({ models: { orchestrator: 'stub-model' } }),
    backToLaunchPad: () => { S.mode = 'launchpad'; S.launchPlan = null; },
    backToFleet: () => { S.mode = 'fleet'; },
  }, over);
}

const apply = (c, action) => launchpadCtl.handle(action, c);

function samplePreset(over) {
  return Object.assign({
    id: 'p1', name: 'fast local', harness: 'codex', speed: 'fast',
    provider: null, agentMerge: true, createdAt: 1000, updatedAt: 1000,
  }, over);
}

function openLaunchPlan(c, tickets) {
  c.S.launchPad = {
    selected: new Set(tickets.map((t) => t.identifier)),
    cache: { tickets },
    mode: 'parallel',
  };
  apply(c, { type: 'open-launchplan' });
  return c.S.launchPlan;
}

// --- 6.1: open-launchplan seeds plan.presets/presetIndex --------------------

test('open-launchplan seeds plan.presets from the on-disk store and plan.presetIndex to null', () => {
  const c = ctx();
  presetsCache.write(c.root, [samplePreset()]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  assert.equal(plan.presets.length, 1);
  assert.equal(plan.presets[0].name, 'fast local');
  assert.equal(plan.presetIndex, null);
});

test('open-launchplan seeds plan.presets as [] when nothing is saved', () => {
  const c = ctx();
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  assert.deepEqual(plan.presets, []);
});

// --- 6.3: apply-preset ------------------------------------------------------

test('apply-preset sets every reachable dimension at once', () => {
  const c = ctx({ config: { harnesses: ['claude-code', 'codex'], providers: { ollama: { harnesses: ['codex'], baseUrl: 'http://x' } } } });
  presetsCache.write(c.root, [samplePreset({ harness: 'codex', speed: 'fast', provider: null, agentMerge: true })]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  const beforeCommand = plan.launchCommand;

  apply(c, { type: 'apply-preset' });

  assert.equal(plan.harness, 'codex'); // CLI label === canonical for codex
  assert.equal(plan.speed, 'fast');
  assert.equal(plan.agentMerge, true);
  assert.equal(plan.presetIndex, 0);
  assert.notEqual(plan.launchCommand, beforeCommand);
  assert.match(plan.launchCommand, /^codex /);
  assert.match(plan.launchCommand, / fast"?$/);
});

test('apply-preset converts claude-code (canonical) to the claude CLI label before matching plan.harnesses', () => {
  const c = ctx({ config: { harnesses: ['claude-code'] } });
  presetsCache.write(c.root, [samplePreset({ harness: 'claude-code' })]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  apply(c, { type: 'apply-preset' });
  assert.equal(plan.harness, 'claude');
});

test('an unreachable harness is left unchanged; every other reachable dimension still applies', () => {
  const c = ctx({ config: { harnesses: ['claude-code'] } }); // codex not configured
  presetsCache.write(c.root, [samplePreset({ harness: 'codex', speed: 'fast', agentMerge: true })]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  const beforeHarness = plan.harness;

  apply(c, { type: 'apply-preset' });

  assert.equal(plan.harness, beforeHarness); // unchanged — codex not in plan.harnesses
  assert.equal(plan.speed, 'fast'); // still applied
  assert.equal(plan.agentMerge, true); // still applied
});

test('provider is left unchanged when providers.ollama is not configured for the project', () => {
  const c = ctx({ config: { harnesses: ['claude-code'] } }); // no providers.ollama
  presetsCache.write(c.root, [samplePreset({ harness: 'claude-code', provider: 'ollama' })]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  apply(c, { type: 'apply-preset' });
  assert.equal(plan.provider, null); // unchanged
});

test('provider is left unchanged under a dashboard.launchCommand override (perRowEditable is false)', () => {
  const c = ctx({
    cfg: { launchCommand: 'claude "/concertino-deliver {{TICKET}}"' },
    config: { harnesses: ['claude-code'], providers: { ollama: { harnesses: ['claude-code'], baseUrl: 'http://x' } } },
  });
  presetsCache.write(c.root, [samplePreset({ harness: 'claude-code', provider: 'ollama', agentMerge: true, speed: 'fast' })]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  assert.equal(plan.perRowEditable, false);
  assert.equal(plan.agentMergeEditable, false);
  const pinnedCommand = plan.launchCommand;

  apply(c, { type: 'apply-preset' });

  assert.equal(plan.provider, null); // unchanged — perRowEditable is false
  assert.equal(plan.agentMerge, false); // unchanged — agentMergeEditable is false
  assert.equal(plan.speed, 'fast'); // speed always applies
  // The pinned override's own binary/flags must survive untouched — only the
  // speed token may have been rewritten (see the controller's own comment on
  // why applyBatchProviderFlags is never called under an override).
  assert.equal(plan.launchCommand, pinnedCommand.replace('{{TICKET}}', '{{TICKET}} fast'));
});

test('repeated presses cycle through every saved preset, wrapping', () => {
  const c = ctx({ config: { harnesses: ['claude-code', 'codex'] } });
  presetsCache.write(c.root, [
    samplePreset({ id: 'a', name: 'one', harness: 'claude-code', speed: 'fast' }),
    samplePreset({ id: 'b', name: 'two', harness: 'codex', speed: 'slow' }),
  ]);
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);

  apply(c, { type: 'apply-preset' });
  assert.equal(plan.presetIndex, 0);
  assert.equal(plan.harness, 'claude');
  assert.equal(plan.speed, 'fast');

  apply(c, { type: 'apply-preset' });
  assert.equal(plan.presetIndex, 1);
  assert.equal(plan.harness, 'codex');
  assert.equal(plan.speed, 'slow');

  apply(c, { type: 'apply-preset' }); // wraps back to the first
  assert.equal(plan.presetIndex, 0);
  assert.equal(plan.harness, 'claude');
  assert.equal(plan.speed, 'fast');
});

test('apply-preset is a no-op when no presets exist', () => {
  const c = ctx();
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  const before = JSON.stringify(plan);
  apply(c, { type: 'apply-preset' });
  assert.equal(JSON.stringify(plan), before);
});

// --- 6.2: refactored cycle-* handlers keep their existing behaviour --------

test('cycle-harness still cycles harness and rebuilds the command/models preview', () => {
  const c = ctx({ config: { harnesses: ['claude-code', 'codex'] } });
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  apply(c, { type: 'cycle-harness' });
  assert.equal(plan.harness, 'codex'); // cycled to the next configured harness
  assert.match(plan.launchCommand, /^codex /);
});

test('cycle-harness still drops an explicit "default" provider the new harness cannot route to', () => {
  // providers.ollama.harnesses only routes claude-code by default — 'default'
  // (meaning "the project's own routing") is only a legal choice ON a
  // routed harness (harnessCmd.providerChoices); cycling to codex, which is
  // NOT in that list, must drop it rather than carry a choice codex cannot
  // honour (CON-75's own precedent — see applyHarness).
  const c = ctx({ config: { harnesses: ['claude-code', 'codex'], providers: { ollama: { harnesses: ['claude-code'], baseUrl: 'http://x' } } } });
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  plan.provider = 'default'; // only reachable while routed to claude-code
  apply(c, { type: 'cycle-harness' });
  assert.equal(plan.harness, 'codex');
  assert.equal(plan.provider, null); // dropped
});

test('cycle-agent-merge still toggles and re-applies the flag onto the existing command', () => {
  const c = ctx();
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  plan.agentMergeEditable = true;
  const before = plan.agentMerge;
  apply(c, { type: 'cycle-agent-merge' });
  assert.equal(plan.agentMerge, !before);
  assert.match(plan.launchCommand, plan.agentMerge ? /--agent-merge/ : /--no-agent-merge/);
});

test('cycle-speed still cycles default -> fast -> slow -> default', () => {
  const c = ctx();
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  assert.equal(plan.speed, 'default');
  apply(c, { type: 'cycle-speed' });
  assert.equal(plan.speed, 'fast');
  apply(c, { type: 'cycle-speed' });
  assert.equal(plan.speed, 'slow');
  apply(c, { type: 'cycle-speed' });
  assert.equal(plan.speed, 'default');
});

test('cycle-provider still cycles through providerChoices and rebuilds the command', () => {
  const c = ctx({ config: { harnesses: ['claude-code'], providers: { ollama: { harnesses: ['claude-code'], baseUrl: 'http://x' } } } });
  const plan = openLaunchPlan(c, [ticket('CON-1', 'first')]);
  assert.equal(plan.provider, null);
  apply(c, { type: 'cycle-provider' });
  assert.equal(plan.provider, 'ollama');
});
