'use strict';

// The harness -> launch-command seam: the one place that knows how to start
// each implemented harness's CLI with the /concertino-deliver command as its
// initial prompt. Pulled out of watch.js so the per-ticket dispatch below is
// unit-testable without a tty, and so the command shapes live in exactly one
// file — before this module, watch.js built them in three separate places
// (defaultLaunchCommand, open-launchplan, cycle-harness) that could drift.
//
// This module is also what makes a ticket's `harness:<value>` Linear label
// (CON-62) actually pick the binary that runs. CON-62 deliberately shipped
// the label as identity/telemetry only — its design.md notes "there is no
// dispatcher anywhere in this codebase that launches a different CLI process
// per ticket". commandForTicket() below is that dispatcher: watch.js calls
// it at every spawn site, so a labelled ticket launches under its own
// harness while the rest of the batch keeps the batch's command.
const { classifyHarnessOverride } = require('../config');
const { parseLaunchCommand, withAgentMergeFlag, withSpeedFlag } = require('./screens/launchplan');

// Verified invocation shapes, per CLI:
//   claude/codex  take the initial prompt as a bare positional argument.
//   opencode      does NOT — its positional arg is a project directory
//                 (opencode.ai/docs/cli: `opencode [project]`); the initial
//                 prompt goes through `--prompt`. `opencode "/concertino-…"`
//                 would try to open a directory literally named
//                 "/concertino-deliver CON-1".
const LAUNCH_TEMPLATES = {
  'claude-code': 'claude "/concertino-deliver {{TICKET}}"',
  codex: 'codex "/concertino-deliver {{TICKET}}"',
  opencode: 'opencode --prompt "/concertino-deliver {{TICKET}}"',
};

// CLI-binary label <-> canonical harness id. Only claude has a split
// ('claude' the binary vs 'claude-code' the harness id the config/scripts
// use); codex and opencode are their own binary names.
function canonicalHarness(h) {
  return h === 'claude' ? 'claude-code' : h;
}

function cliLabel(h) {
  return h === 'claude-code' ? 'claude' : h;
}

// Accepts either the canonical id or the CLI label; null for anything
// unimplemented rather than guessing a binary that may not exist.
function launchTemplate(harness) {
  return LAUNCH_TEMPLATES[canonicalHarness(harness)] || null;
}

// What `n` runs when dashboard.launchCommand is not set. Follows the harness
// the project is already rendered for, so a fresh project needs no dashboard
// config at all: claude-code wins when configured (the richest adapter —
// real multi-agent dispatch), otherwise the first configured harness.
function defaultLaunchCommand(config) {
  const harnesses = Array.isArray(config.harnesses) ? config.harnesses : [];
  const preferred = harnesses.includes('claude-code')
    ? 'claude-code'
    : (harnesses.find((h) => launchTemplate(h)) || 'claude-code');
  return launchTemplate(preferred);
}

// The harness a ticket's labels pick for it, or null when the batch command
// should be used unchanged. null covers four distinct cases on purpose:
//
//   - no `harness:` label at all — the common case;
//   - an invalid or ambiguous label — launching a *guessed* harness would be
//     worse than letting the batch harness's own orchestrator hard-stop on
//     the same label (core/roles/orchestrator.md Setup step 1 already
//     refuses it before any worktree exists, and surfaces it to the human);
//   - a valid label for a harness this project has not rendered adapters
//     for (`configuredHarnesses`) — spawning that CLI would start a session
//     with no .{claude,codex,opencode} concertino files to drive it.
function resolveTicketHarness(labels, configuredHarnesses) {
  const cls = classifyHarnessOverride(labels || []);
  if (cls.kind !== 'valid') return null;
  if (Array.isArray(configuredHarnesses) && configuredHarnesses.length
    && !configuredHarnesses.includes(cls.value)) return null;
  return cls.value;
}

// The per-ticket dispatch: batchCommand's binary is swapped for the labelled
// harness's own template, while the batch's agent-merge/speed tokens are
// re-applied so a labelled ticket still runs at the speed the operator chose
// for the batch. Falls back to batchCommand untouched in every case
// resolveTicketHarness() returns null for — including a label that simply
// matches the batch harness already.
function commandForTicket(labels, batchCommand, configuredHarnesses) {
  const h = resolveTicketHarness(labels, configuredHarnesses);
  if (!h) return batchCommand;
  const tmpl = launchTemplate(h);
  if (!tmpl) return batchCommand;
  const parsed = parseLaunchCommand(batchCommand || '');
  let cmd = tmpl;
  if (parsed.agentMerge != null) cmd = withAgentMergeFlag(cmd, parsed.agentMerge);
  cmd = withSpeedFlag(cmd, parsed.speed);
  return cmd;
}

module.exports = {
  LAUNCH_TEMPLATES,
  canonicalHarness, cliLabel, launchTemplate, defaultLaunchCommand,
  resolveTicketHarness, commandForTicket,
};
