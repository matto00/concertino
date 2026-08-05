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
// `provider` (optional) is passed to the script exactly the way a spawned run
// passes it — as CONCERTINO_PROVIDER in the environment — so the preview
// resolves the SAME per-role models the run itself will, local ids included.
// Without it a plan set to route locally still previewed hosted models,
// which is precisely the number an operator checks before launching.
function resolveModelsForPlan(rootDir, speed, harness, provider) {
  try {
    const script = path.join(rootDir, 'scripts', 'concertino', 'resolve-speed.sh');
    const env = provider
      ? Object.assign({}, process.env, { CONCERTINO_PROVIDER: provider })
      : process.env;
    const out = execFileSync(script, [speed || 'default', harness],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
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

  // The full per-ticket spawn decision (CON-65): the command after any
  // `harness:<value>` swap, plus the per-window env any `provider:<value>`
  // label calls for — resolved together in harness.js's launchSpecForTicket
  // so the env always matches the harness that will actually launch. An
  // operator launchCommand override pins the command outright AND suppresses
  // provider decoration (same rule as harness dispatch: an override has no
  // slots this layer can safely rewrite).
  function specFor(ticketId, baseCommand) {
    if (dashCfg.launchCommand) return { command: baseCommand, env: null };
    const t = (cache.read(root).tickets || []).find((x) => x.identifier === ticketId);
    return harnessCmd.launchSpecForTicket(t && t.labels, baseCommand, fullConfig);
  }

  function commandFor(ticketId, baseCommand) {
    return specFor(ticketId, baseCommand).command;
  }

  // The one spawn entry point. `ticketInput` may be a bare id or the `n`
  // prompt's full typed value (id plus a trailing agent-merge/speed token
  // submitTicket itself parses) — specFor() always gets the BARE id; an
  // unparseable value degrades to the base command and is then rejected by
  // submitTicket exactly as before. `baseCommand` defaults to the
  // process-wide launch command.
  function launch(ticketInput, baseCommand) {
    const typedId = String(ticketInput || '').trim().split(/\s+/)[0];
    const spec = specFor(typedId, baseCommand || launchCommand);
    return submitTicket(ticketInput, spec.command, session, spec.env);
  }

  // CON-69: spawns a queue record's pre-baked per-row spec verbatim — the
  // launch plan's confirm already resolved harness/speed/provider for this
  // ticket, so no label dispatch runs on top (the row choice, made looking
  // at the annotated row, IS the decision).
  function launchSpec(ticketInput, spec) {
    return submitTicket(ticketInput, spec.command, session, spec.env || null);
  }

  return { launchCommand, projectHarnesses, commandFor, specFor, launch, launchSpec };
}

module.exports = { createLauncher, resolveModelsForPlan };
