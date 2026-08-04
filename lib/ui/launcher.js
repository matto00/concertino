'use strict';

// The launch pipeline: everything between "start ticket X" and the actual
// tmux spawn lives behind this one seam. Every spawn site in the dashboard —
// the queue tick, force-start, the `n` prompt, draft-then-launch and restart
// — routes through a launcher instance, so per-ticket dispatch decisions
// (harness today; provider/model routing next — CON-65) can never apply on
// one path and not another.
//
// The tests' require-cache fakes flow through here naturally: the `session`
// object is created by watch.js (from whichever ./session module is in the
// require cache when watch.js is loaded) and passed in, never re-required.

const path = require('path');
const { execFileSync } = require('child_process');
const cache = require('./cache');
const harnessCmd = require('./harness');
const { submitTicket } = require('./prompt');

// Resolves the (speed, harness) -> budgets/models/flags preview via
// resolve-speed.sh, synchronously, following the exact one-time,
// plan-creation-time child-process precedent `commitSha` set in watch.js's
// `open-launchplan` handler (same `stdio: ['ignore','pipe','ignore']`
// discipline — never leak the child's stderr onto a screen that is
// otherwise pure). Returns the parsed JSON, or `null` on ANY error (missing
// script, bad harness/tier, a project predating this feature) — never
// thrown up to the human as a crash; `launchplan.js` renders `null` as
// "models unknown". `harness` here must already be canonical (call
// `harnessCmd.canonicalHarness()` first) — this function does not do that
// translation itself, so it stays a thin, testable wrapper around the one
// child-process call.
function resolveModelsForPlan(rootDir, speed, harness) {
  try {
    const script = path.join(rootDir, 'scripts', 'concertino', 'resolve-speed.sh');
    const out = execFileSync(script, [speed || 'default', harness],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch (e) { return null; }
}

// One launcher per dashboard process, built once in watch() alongside the
// session. `launchCommand` is the resolved process-wide default ("what `n`
// runs"): config wins; otherwise it follows the harness the project is
// already rendered for (harness.js's defaultLaunchCommand), so a fresh
// project needs no dashboard config at all.
function createLauncher({ root, session, cfg, config }) {
  const dashCfg = cfg || {};
  const fullConfig = config || {};
  const launchCommand = dashCfg.launchCommand || harnessCmd.defaultLaunchCommand(fullConfig);

  // Per-ticket harness dispatch (the launch-side half CON-62 left open): a
  // ticket whose cached Linear labels carry a valid `harness:<value>` for a
  // harness this project has rendered launches under THAT harness's CLI,
  // batch flags (agent-merge/speed) carried over; every other ticket keeps
  // `baseCommand` untouched. A custom dashboard.launchCommand pins the
  // command outright (same rule as the launch plan's own 'h'/'m' gating: an
  // operator override has no slots to safely rewrite). Reads the ticket
  // cache fresh per spawn, mirroring quickStartEligible()'s own "cheap
  // enough to recompute" precedent — a spawn is far rarer than a frame.
  //
  // Canonical harness ids, straight from config — deliberately NOT the
  // CLI-label-space list the launch plan derives for its own display (that
  // one maps claude-code -> claude).
  const projectHarnesses = Array.isArray(fullConfig.harnesses) ? fullConfig.harnesses : [];

  function commandFor(ticketId, baseCommand) {
    if (dashCfg.launchCommand) return baseCommand;
    const t = (cache.read(root).tickets || []).find((x) => x.identifier === ticketId);
    return harnessCmd.commandForTicket(t && t.labels, baseCommand, projectHarnesses);
  }

  // The one spawn entry point. `ticketInput` may be a bare id or the `n`
  // prompt's full typed value (id plus a trailing agent-merge/speed token
  // submitTicket itself parses) — commandFor() always gets the BARE id; an
  // unparseable value degrades to the base command and is then rejected by
  // submitTicket exactly as before. `baseCommand` defaults to the
  // process-wide launch command.
  function launch(ticketInput, baseCommand) {
    const typedId = String(ticketInput || '').trim().split(/\s+/)[0];
    return submitTicket(ticketInput, commandFor(typedId, baseCommand || launchCommand), session);
  }

  return { launchCommand, projectHarnesses, commandFor, launch };
}

module.exports = { createLauncher, resolveModelsForPlan };
