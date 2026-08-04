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
const { classifyHarnessOverride, classifyProviderOverride } = require('../config');
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

// The canonical harness a launch command string will start — the first
// word, mapped through canonicalHarness(). null for an operator-custom
// command whose binary is none of the implemented CLIs (provider dispatch
// then refuses to decorate a command it does not understand).
function harnessOfCommand(command) {
  const bin = String(command || '').trim().split(/\s+/)[0];
  return LAUNCH_TEMPLATES[canonicalHarness(bin)] ? canonicalHarness(bin) : null;
}

// --- CON-65: per-ticket provider routing (`provider:<value>` label) --------
//
// The provider a ticket's labels pick for it — 'ollama' | 'default' — or
// null when the spawn should not be decorated at all. Like
// resolveTicketHarness above, null deliberately covers every case where
// dispatch could promise something the run can't deliver:
//
//   - no `provider:` label, or an invalid/ambiguous one (same reasoning as
//     the harness label: guessing is worse than the batch default);
//   - no `providers.ollama` config at all — there is no local endpoint to
//     route to, whichever way the label points;
//   - `provider:ollama` on a claude-code launch with no
//     `providers.ollama.gateway` — Claude Code reaches Ollama only through
//     an Anthropic-compatible gateway (see lib/cli/render.js's
//     ANTHROPIC_BASE_URL comment); without one the env this function's
//     caller would inject cannot actually route the endpoint, and a spawn
//     that resolves Ollama *models* against a subscription *endpoint* is
//     strictly worse than ignoring the label;
//   - `provider:default` on a harness the project does not route to Ollama
//     anyway — a no-op; leaving the spawn undecorated keeps "no override"
//     and "override that changes nothing" indistinguishable downstream,
//     which is exactly how the harness label already behaves.
function resolveTicketProvider(labels, config, harness) {
  const cls = classifyProviderOverride(labels || []);
  if (cls.kind !== 'valid') return null;
  const ollama = config && config.providers && config.providers.ollama;
  if (!ollama) return null;
  const h = canonicalHarness(harness);
  const projectRouted = (ollama.harnesses || []).includes(h);
  if (cls.value === 'ollama') {
    if (h === 'claude-code' && !(ollama.gateway && ollama.gateway.baseUrl)) return null;
    return 'ollama';
  }
  // 'default'
  return projectRouted ? 'default' : null;
}

// The per-window environment that makes the provider choice real at spawn
// time (injected by session.spawn's env support — see lib/ui/session.js):
//
//   CONCERTINO_PROVIDER  read by resolve-speed.sh to pick the role models
//                        (providers.ollama.models vs. the subscription
//                        models/tiers) — an explicit value always beats the
//                        project-level `providers.ollama.harnesses` routing.
//   ANTHROPIC_BASE_URL   claude-code only: the gateway endpoint for
//                        'ollama', or explicitly EMPTIED for 'default' on a
//                        project whose rendered .concertino.env/operator
//                        shell would otherwise point every claude at the
//                        gateway (Claude Code treats an empty value as
//                        unset — `process.env.X || default` — so emptying
//                        is the per-window "route back to subscription").
function providerSpawnEnv(provider, config, harness) {
  if (!provider) return null;
  const env = { CONCERTINO_PROVIDER: provider };
  const ollama = (config && config.providers && config.providers.ollama) || {};
  if (canonicalHarness(harness) === 'claude-code' && ollama.gateway && ollama.gateway.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider === 'ollama' ? ollama.gateway.baseUrl : '';
  }
  return env;
}

// Codex reads its provider from config (.codex/config.toml +
// .codex/agents/*.toml), not from env — but its CLI accepts `-c key=value`
// config overrides, so the per-ticket flip rides the command line instead.
// Caveat, documented rather than hidden: a project whose sync rendered
// per-agent `model_provider = "ollama"` lines may let the agent-level value
// win over this global override for provider:default — the model choice
// (CONCERTINO_PROVIDER) still applies either way.
function providerCommandFlags(provider, harness) {
  if (!provider || canonicalHarness(harness) !== 'codex') return '';
  return provider === 'ollama' ? '-c model_provider=ollama' : '-c model_provider=openai';
}

// The one spawn-decision entry point: per-ticket harness swap (CON-62) plus
// per-ticket provider routing (CON-65), resolved together so the provider's
// env/flags always match the harness that will ACTUALLY launch — a ticket
// labelled both `harness:codex` and `provider:ollama` gets codex's flag
// form, not the batch harness's env form. Returns `{ command, env }`; `env`
// is null when the spawn needs no decoration (the overwhelmingly common
// case, and byte-identical behavior to before this seam existed).
function launchSpecForTicket(labels, batchCommand, config) {
  const configuredHarnesses = (config && Array.isArray(config.harnesses)) ? config.harnesses : [];
  const command = commandForTicket(labels, batchCommand, configuredHarnesses);
  const harness = harnessOfCommand(command);
  if (!harness) return { command, env: null };
  const provider = resolveTicketProvider(labels, config, harness);
  if (!provider) return { command, env: null };
  const flags = providerCommandFlags(provider, harness);
  const decorated = flags
    ? command.replace(/^(\S+)\s/, '$1 ' + flags + ' ')
    : command;
  return { command: decorated, env: providerSpawnEnv(provider, config, harness) };
}

module.exports = {
  LAUNCH_TEMPLATES,
  canonicalHarness, cliLabel, launchTemplate, defaultLaunchCommand,
  resolveTicketHarness, commandForTicket,
  harnessOfCommand, resolveTicketProvider, providerSpawnEnv, providerCommandFlags,
  launchSpecForTicket,
};
