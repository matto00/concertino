'use strict';

// Harness emitters — the per-harness file writers (Claude Code, Codex,
// OpenCode) plus the shared-asset copier. Extracted from bin/concertino
// verbatim; shared by sync, diff, and eject.

const fs = require('fs');
const path = require('path');

const { resolveModel, isOllamaRouted, agentMergePermissionRules } = require('../config');
const {
  ADAPTERS, VERSION, green,
  read, exists, write, copy, readRoleFile, listFilesRecursive,
} = require('./shared');
const { renderBody } = require('./render');

// CON-88: when agentMerge.enabled is true, additively merges the Claude Code
// permission grant it requires into `<out>/.claude/settings.json`'s
// `permissions.allow` array — the one place Claude Code's auto-mode
// permission classifier actually reads (the config key `agentMerge.enabled`
// is, by itself, invisible to it; see design.md of the
// agent-merge-permission-preflight change). Read-modify-write on the whole
// parsed object so every other key (`permissions.deny`/`ask`, anything else
// a human added) and every other pre-existing `permissions.allow` entry
// survives untouched — never a blind overwrite, and never a crash over a
// malformed pre-existing settings file (treated as `{}` instead, same
// degrade-safely posture `doctor`'s other checks use). Never touches the
// file at all when `agentMerge.enabled` is false — not even to remove a
// rule a previous sync added (append-only; see agentMergePermissionRules()'s
// own header comment in lib/config.js for why).
// Reads+parses `<out>/.claude/settings.json`, degrading to `{}` on a missing
// or malformed file (same posture every merger below already used inline) —
// extracted so `diff.js` can compute the exact same starting point `sync`'s
// mergers do, without writing anything.
function readSettingsJson(settingsPath) {
  let settings = {};
  if (exists(settingsPath)) {
    try { settings = JSON.parse(read(settingsPath)); } catch (_) { settings = {}; }
  }
  return (settings == null || typeof settings !== 'object') ? {} : settings;
}

// Pure mutate-and-return: applies the agentMerge permission grant to an
// already-parsed settings object in place, returning it. Split out from
// mergeAgentMergeSettings() below so `diff.js` can compute the exact merged
// result `sync` would produce (for a content-level diff) without going
// through write().
function applyAgentMergeSettings(c, settings) {
  if (!c.agentMerge || !c.agentMerge.enabled) return settings;
  settings.permissions = (settings.permissions && typeof settings.permissions === 'object') ? settings.permissions : {};
  const existingAllow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  const allow = existingAllow.slice();
  for (const rule of agentMergePermissionRules()) {
    if (!allow.includes(rule)) allow.push(rule);
  }
  settings.permissions.allow = allow;
  return settings;
}

function mergeAgentMergeSettings(c, out, dry) {
  if (!c.agentMerge || !c.agentMerge.enabled) return;
  const settingsPath = path.join(out, '.claude', 'settings.json');
  const settings = applyAgentMergeSettings(c, readSettingsJson(settingsPath));
  write(settingsPath, JSON.stringify(settings, null, 2) + '\n', dry);
}

// track-per-run-cost-spend, design.md Decision 3: when `costTracking.enabled`
// is true, additively appends the SAME `report-cost.sh` hook entry into BOTH
// `settings.hooks.SessionEnd` AND `settings.hooks.SubagentStop` —
// design.md Decision 1's empirical finding is that `SessionEnd` alone only
// ever reports the orchestrator/root role; every other role's cost is only
// observable via `SubagentStop`. Structured exactly like
// `mergeAgentMergeSettings` above: read-modify-write the whole parsed
// `.claude/settings.json`, never disturbing any other pre-existing key
// (including any other hook entries under either event name). Never touches
// `hooks` at all when `costTracking.enabled` is false — not even to remove
// an entry a previous sync added (append-only, matching
// mergeAgentMergeSettings's own convention).
// Pure mutate-and-return counterpart to applyAgentMergeSettings() above —
// same split, same reason (diff.js needs the merged result, not a write).
function applyCostHookSettings(c, settings) {
  if (!c.costTracking || !c.costTracking.enabled) return settings;
  settings.hooks = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};

  const hookEntry = { matcher: '', hooks: [{ type: 'command', command: 'scripts/concertino/report-cost.sh' }] };
  const hasReportCostEntry = (arr) => arr.some((entry) =>
    entry && Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => h && h.command === 'scripts/concertino/report-cost.sh'));

  for (const eventName of ['SessionEnd', 'SubagentStop']) {
    const existing = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
    settings.hooks[eventName] = hasReportCostEntry(existing) ? existing : existing.concat([hookEntry]);
  }
  return settings;
}

function mergeCostHookSettings(c, out, dry) {
  if (!c.costTracking || !c.costTracking.enabled) return;
  const settingsPath = path.join(out, '.claude', 'settings.json');
  const settings = applyCostHookSettings(c, readSettingsJson(settingsPath));
  write(settingsPath, JSON.stringify(settings, null, 2) + '\n', dry);
}

// ---------- harness emitters ---------------------------------------------
function emitClaude(c, out, core, dry) {
  const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
  for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
    const r = meta.roles[role];
    let tools = r.baseTools.slice();
    if (r.usesUi && c.ui.enabled && c.ui.tool === 'playwright') tools = tools.concat(meta.playwrightTools);
    const mcp = (r.mcpTools && r.mcpTools[c.ticketProvider.kind]) || [];
    tools = tools.concat(mcp);
    const body = renderBody(readRoleFile(role, out, core), c, 'claude-code');
    const desc = r.description.split('{{project}}').join(c.project.name);
    const model = resolveModel(c, 'claude-code', role);
    const fm = [
      '---',
      '# concertino:sync v' + VERSION,
      'name: concertino-' + role,
      'description: >-',
      '  ' + desc,
      'model: ' + model,
      'color: ' + r.color,
      'tools:',
      ...tools.map((t) => '  - ' + t),
      '---',
      ''
    ].join('\n');
    write(path.join(out, '.claude', 'agents', 'concertino-' + role + '.md'), fm + body, dry);
  }
  const cmd = read(path.join(ADAPTERS, 'claude-code', 'command.md'))
    .split('{{project}}').join(c.project.name)
    .split('{{idExample}}').join(c.ticketProvider.idExample);
  write(path.join(out, '.claude', 'commands', 'concertino-deliver.md'), cmd, dry);
  // CON-98, design.md Decision 4: the `a` (address-failure) entry point —
  // claude-code only (no Codex/OpenCode equivalent; see emitCodex/
  // emitOpencode, which have no matching write).
  const addressFailureCmd = read(path.join(ADAPTERS, 'claude-code', 'address-failure-command.md'))
    .split('{{project}}').join(c.project.name)
    .split('{{idExample}}').join(c.ticketProvider.idExample);
  write(path.join(out, '.claude', 'commands', 'concertino-address-failure.md'), addressFailureCmd, dry);
  mergeAgentMergeSettings(c, out, dry);
  mergeCostHookSettings(c, out, dry);
}

// A role's rendered `.codex/agents/*.toml` gets `model_provider = "ollama"`
// only when it is Ollama-routed (design.md Decision 2/3: "codex" in
// providers.ollama.harnesses AND no explicit models.codex.<role> override) —
// else the placeholder renders empty, preserving today's file untouched.
function codexModelProviderLine(c, role) {
  return isOllamaRouted(c, 'codex', role) ? 'model_provider = "ollama"\n' : '';
}

// Merges `blockText` into `existing` at a `<!-- CONCERTINO:BEGIN/END -->`
// region (creating one at the end if none is present yet), so hand-authored
// content outside the markers survives a re-sync. Shared by AGENTS.md
// (Markdown, hence HTML comments) — extracted so the same convention can be
// reused for a different host file format (see codexOllamaConfigToml below,
// which needs TOML's own `#` comment syntax instead).
function mergeMarkedRegion(existing, blockText, markerRe) {
  if (existing == null) return blockText;
  return markerRe.test(existing) ? existing.replace(markerRe, blockText) : existing.trimEnd() + '\n\n' + blockText;
}
const AGENTS_MD_MARKER_RE = /<!-- CONCERTINO:BEGIN[\s\S]*?<!-- CONCERTINO:END -->\n?/;

// `.codex/config.toml`'s Concertino-managed region. TOML has no
// HTML-comment equivalent, so the merge-marker convention AGENTS.md uses is
// adapted to TOML's own `#` comment syntax — same regex-delimited-region
// mechanism, different host syntax. The region is still written (and, more
// importantly, still MATCHED) so a project synced before this fix has its
// stale block replaced rather than left behind forever.
//
// It no longer contains a `[model_providers.ollama]` definition. CON-63
// rendered one there; Codex refuses it:
//
//   Ignored unsupported project-local config keys in .../.codex/config.toml:
//   model_providers. If you want these settings to apply, manually set them
//   in your user-level config.toml.
//
// — verified against codex-cli 0.146.0, which prints that on EVERY launch in
// such a project. Worse, pairing it with `-c model_provider=ollama` (what
// CON-65's per-ticket routing used to spawn) names a provider Codex cannot
// resolve, and the run dies on a malformed request:
//
//   {"error":{"message":"input[0]: unknown input item type:
//    \"additional_tools\"","type":"invalid_request_error"}}
//
// Codex's supported route to a local model is the `--oss --local-provider`
// flag pair instead, which lib/ui/harness.js's providerCommandFlags now
// emits — no project-local provider definition required, and nothing for
// Codex to ignore.
const CODEX_CONFIG_TOML_MARKER_RE = /# CONCERTINO:BEGIN[\s\S]*?# CONCERTINO:END\n?/;
function codexOllamaConfigToml(c) {
  const ollama = c.providers.ollama;
  return [
    '# CONCERTINO:BEGIN (generated by `concertino sync` — edit concertino.config.json, not here)',
    '# Local-model routing for Codex is NOT configured here: Codex ignores',
    '# `model_providers` in a project-local config.toml (it is a user-level',
    '# key only). Concertino launches a local run as',
    '#   codex --oss --local-provider ollama -m <model>',
    '# instead, so nothing project-local is needed. Endpoint in use:',
    '#   ' + ollama.baseUrl,
    '# Codex\'s --oss path requires a THINKING-capable model — check with',
    '# `ollama show <model>` before setting providers.ollama.models.',
    '# CONCERTINO:END',
    '',
  ].join('\n');
}

// What each role file is FOR, in one line — the index has to give the model
// enough to pick the right file without opening all five, which is the whole
// point of not inlining them.
const CODEX_ROLE_INDEX = {
  orchestrator: 'drives the run end to end: setup, planning, phase transitions, delivery, cleanup. Start here.',
  executor: 'implements the planned change, runs the verification gates, commits.',
  evaluator: 're-runs the gates and reviews the diff; returns PASS or change requests.',
  skeptic: 'cold verification at the design and final gates; owns subjective judgement.',
  auditor: 'when agent-merge is enabled, verifies the merge conditions after the PR exists, then merges or escalates.',
};

function emitCodex(c, out, core, dry) {
  const header = read(path.join(ADAPTERS, 'codex', 'header.md')).split('{{project}}').join(c.project.name);
  const roles = ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor'];

  // CON-74: role bodies are written as SEPARATE files and referenced from
  // AGENTS.md by path, rather than concatenated into it.
  //
  // AGENTS.md is part of Codex's standing instructions — it is re-sent on
  // every request for the entire run. Inlining all five bodies made that
  // ~23k tokens per turn, against ~1.9k for the equivalent Claude Code
  // executor turn (which pays for one role's body because each role is its
  // own agent). Identical instructions, ~12.7x the standing cost, purely
  // from how they are packaged.
  //
  // That is survivable on a hosted 200k-token model and fatal on a local
  // one: at Ollama's largest fully-GPU-resident window on a 16GB card
  // (32768), the inlined form consumed 71% of the context before the agent
  // read a single file, and runs died mid-stream once tool output pushed
  // them over. Reading a role when its phase begins keeps the standing cost
  // to this header plus an index.
  const rolesDir = path.join(out, '.codex', 'roles');
  for (const role of roles) {
    const body = renderBody(read(path.join(core, 'roles', role + '.md')), c, 'codex');
    const title = role[0].toUpperCase() + role.slice(1);
    write(path.join(rolesDir, 'concertino-' + role + '.md'),
      '# Concertino ' + title + ' (' + c.project.name + ')\n\n' +
      '<!-- generated by `concertino sync` — edit core/roles/' + role + '.md, not here -->\n\n' +
      body + '\n', dry);
  }

  const roleIndex = [
    '## Role specs — read the one whose phase you are entering',
    '',
    'Each is a separate file so it costs nothing until you need it. Read with',
    'your file-reading tool; the paths are relative to the repository root.',
    '',
  ].concat(roles.map((role) =>
    '- **' + role[0].toUpperCase() + role.slice(1) + '** — `.codex/roles/concertino-' + role + '.md`  \n' +
    '  ' + CODEX_ROLE_INDEX[role])).join('\n');

  let blockText = header.replace('<!-- CONCERTINO:ROLES -->', roleIndex)
    + '\n\n<!-- CONCERTINO:END -->\n';

  const agentsPath = path.join(out, 'AGENTS.md');
  const full = mergeMarkedRegion(exists(agentsPath) ? read(agentsPath) : null, blockText, AGENTS_MD_MARKER_RE);
  write(agentsPath, full, dry);

  const tmpl = read(path.join(ADAPTERS, 'codex', 'agent.toml.tmpl'));
  const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
  for (const role of ['executor', 'evaluator', 'auditor']) {
    const body = renderBody(readRoleFile(role, out, core), c, 'codex');
    const desc = meta.roles[role].description.split('{{project}}').join(c.project.name);
    const toml = tmpl.split('{{role}}').join(role)
      .split('{{description}}').join(desc.replace(/"/g, '\\"'))
      .split('{{model}}').join(resolveModel(c, 'codex', role))
      .split('{{model_provider}}').join(codexModelProviderLine(c, role))
      .split('{{body}}').join(body);
    write(path.join(out, '.codex', 'agents', 'concertino-' + role + '.toml'), '# concertino:sync v' + VERSION + '\n' + toml, dry);
  }
  copy(path.join(ADAPTERS, 'codex', 'prompt.md'), path.join(out, '.codex', 'prompts', 'concertino-deliver.md'), dry);
  if (!dry) console.log('  ' + green('wrote') + ' ' + path.join(out, '.codex', 'prompts', 'concertino-deliver.md'));

  // Written whenever providers.ollama exists — see codexOllamaConfigToml
  // above for why the region is now documentation rather than a provider
  // definition, and why it must still be emitted (to replace the stale
  // block a pre-fix sync left behind).
  if (c.providers.ollama) {
    const configPath = path.join(out, '.codex', 'config.toml');
    const merged = mergeMarkedRegion(exists(configPath) ? read(configPath) : null, codexOllamaConfigToml(c), CODEX_CONFIG_TOML_MARKER_RE);
    write(configPath, merged, dry);
  }
}

// ---------- OpenCode adapter ------------------------------------------------
// Research findings (tasks.md 4.1, design.md Open Questions 1-3), confirmed
// against the sst/opencode (opencode.ai) source and docs
// (packages/web/src/content/docs/{config,agents,commands,providers}.mdx and
// packages/opencode/src/index.ts). Kept here, in source, rather than atop the
// adapter template files themselves: adapters/opencode/prompt.md's own YAML
// frontmatter must be the literal first bytes of the rendered file (a
// leading HTML comment there breaks OpenCode's frontmatter parser), and
// adapters/opencode/header.md gets prepended into a rendered agent's actual
// system-prompt body — shipping maintainer notes into every orchestrator
// invocation would be pure token waste, not documentation.
//
// - Native project config: `opencode.json` (or `opencode.jsonc`) at the
//   project root — JSON, deep-merged with global/remote config, so a
//   Concertino-managed sub-key (`provider.ollama`) can be written without
//   disturbing unrelated hand-authored keys.
// - Agent definitions: Markdown files with YAML frontmatter
//   (`description`/`mode`/`model`/`permission`) under `.opencode/agents/`
//   (plural — the modern convention; `.opencode/agent/` singular is also
//   accepted for back-compat). `mode: primary` agents are the ones a session
//   can be switched into directly (and what a command's own `agent:`
//   frontmatter field selects); `mode: subagent` agents are invoked via the
//   Task tool or `@name` mention.
// - Delivery command: Markdown files with YAML frontmatter
//   (`description`/`agent`/`model`) under `.opencode/commands/`, invoked as
//   `/concertino-deliver` — the same `$ARGUMENTS` placeholder Claude Code's
//   command file uses.
// - Ollama provider: `provider.ollama` = `{ npm: "@ai-sdk/openai-compatible",
//   name, options: { baseURL, apiKey }, models: { <id>: { name } } }` — the
//   OpenAI-compatible provider shape, `options.apiKey` supporting
//   `{env:VAR}` substitution for a credential env var name (never the value).
// - Runtime-identity signal (design.md Decision 6): confirmed, not guessed —
//   `packages/opencode/src/index.ts`'s CLI entrypoint unconditionally sets
//   `process.env.OPENCODE = "1"` (and `OPENCODE_PID`) in its own process
//   before dispatching any subcommand; the bash tool spawns child processes
//   with the inherited environment (no explicit `env` override in
//   `packages/core/src/tool/bash.ts`), so `OPENCODE` is present, non-empty,
//   in any shell command OpenCode's agent runs — including
//   `setup-worktree.sh`. See core/scripts/setup-worktree.sh's detect_harness().
// - Multi-agent dispatch (design.md Decision 5 / Open Question 1): OpenCode
//   has a genuine subagent/Task-tool mechanism (primary agents can invoke
//   `mode: subagent` agents and receive a result), but no publicly documented
//   guarantee of Claude Code's warm-resume-across-turns semantics
//   (`SendMessage` to a suspended agent). Per design.md's stated preference
//   for understating rather than overstating a harness's capability, this
//   adapter defaults to the conservative, Codex-like sequential-single-thread
//   description, with the Task tool documented as an optional worker-dispatch
//   path (parallel to Codex's optional `spawn_agents_on_csv`) — never a
//   required one.
const OPENCODE_ROLES = ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor'];

// Mirrors Claude Code's baseTools shape (design.md Decision 5's "reuse
// adapters/claude-code/agents.json for shared per-role metadata where
// compatible"): orchestrator/executor may Edit; evaluator/skeptic/auditor
// may Write (reports) but not Edit source — best-effort tool-permission
// parity with the other two harnesses' per-role tool sets, not a strict
// mapping (OpenCode's permission model is shaped differently).
function opencodePermission(role) {
  return ['evaluator', 'skeptic', 'auditor'].includes(role) ? { edit: 'deny' } : undefined;
}

function renderOpencodeAgentMd(c, out, core, role, meta, header) {
  const r = meta.roles[role];
  const desc = r.description.split('{{project}}').join(c.project.name);
  const model = resolveModel(c, 'opencode', role);
  const mode = role === 'orchestrator' ? 'primary' : 'subagent';
  const perm = opencodePermission(role);
  const fm = [
    '---',
    '# concertino:sync v' + VERSION,
    'description: ' + JSON.stringify(desc),
    'mode: ' + mode,
    'model: ' + model,
  ];
  if (perm) {
    fm.push('permission:');
    for (const k of Object.keys(perm)) fm.push('  ' + k + ': ' + perm[k]);
  }
  fm.push('---', '');
  const body = renderBody(readRoleFile(role, out, core), c, 'opencode');
  // Only the orchestrator (the primary agent a session is switched into via
  // `/concertino-deliver`'s `agent:` frontmatter) carries the shared header —
  // parallel to how Codex's header appears once, at the top of the single
  // AGENTS.md a Codex session reads in whole. The other four roles are
  // subagent system prompts; like Claude Code's own per-role files, they
  // carry only their own role content.
  const prefix = role === 'orchestrator' ? header + '\n\n' : '';
  return fm.join('\n') + prefix + body;
}

// opencode.json is ordinary JSON (no comment syntax to hide a marked region
// in), so instead of AGENTS.md/config.toml's regex-delimited text region,
// this is a structural key-level merge: only the Concertino-managed
// `provider.ollama` key is set, every other top-level key (and every other
// `provider.<id>` entry) in an existing hand-authored opencode.json survives
// untouched.
function mergeOpencodeJson(existing, c) {
  let obj = {};
  if (existing != null) {
    try { obj = JSON.parse(existing); } catch (_) { obj = {}; }
  }
  if (!obj['$schema']) obj['$schema'] = 'https://opencode.ai/config.json';
  // CON-65: same widened gate as codex's config.toml block above — the
  // provider registration is inert until an agent/model actually references
  // `ollama/<model>`, and rendering it whenever providers.ollama is
  // configured is what lets a per-ticket `provider:ollama` run resolve its
  // models against a registered provider on a subscription-default project.
  const ollama = c.providers.ollama;
  if (ollama) {
    obj.provider = obj.provider || {};
    const models = {};
    for (const id of Object.values(ollama.models || {})) models[id] = { name: id };
    obj.provider.ollama = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Ollama (local)',
      // Ollama's OpenAI-compatible API is served under /v1 — baseUrl itself
      // is Ollama's own bare API root (see the schema's own baseUrl
      // description); this adapter appends what OpenCode's provider shape
      // specifically requires, exactly as Codex's own adapter separately
      // decides what it needs from the same baseUrl (design.md Decision 1).
      options: Object.assign(
        { baseURL: ollama.baseUrl.replace(/\/+$/, '') + '/v1' },
        ollama.apiKeyEnv ? { apiKey: '{env:' + ollama.apiKeyEnv + '}' } : {}
      ),
      models,
    };
  }
  return JSON.stringify(obj, null, 2) + '\n';
}

function emitOpencode(c, out, core, dry) {
  const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
  const header = read(path.join(ADAPTERS, 'opencode', 'header.md')).split('{{project}}').join(c.project.name);
  for (const role of OPENCODE_ROLES) {
    write(path.join(out, '.opencode', 'agents', 'concertino-' + role + '.md'),
      renderOpencodeAgentMd(c, out, core, role, meta, header), dry);
  }
  const cmd = read(path.join(ADAPTERS, 'opencode', 'prompt.md'))
    .split('{{project}}').join(c.project.name)
    .split('{{idExample}}').join(c.ticketProvider.idExample);
  write(path.join(out, '.opencode', 'commands', 'concertino-deliver.md'), cmd, dry);

  const cfgPath = path.join(out, 'opencode.json');
  const merged = mergeOpencodeJson(exists(cfgPath) ? read(cfgPath) : null, c);
  write(cfgPath, merged, dry);
}

// ---------- copy shared assets into the project --------------------------
function copyAssets(out, core, dry, withScripts) {
  for (const f of fs.readdirSync(path.join(core, 'laws')))
    copy(path.join(core, 'laws', f), path.join(out, '.concertino', 'laws', f), dry);
  copy(path.join(core, 'workflow-state.template.md'), path.join(out, '.concertino', 'workflow-state.template.md'), dry);
  if (withScripts) {
    for (const f of listFilesRecursive(path.join(core, 'scripts'))) {
      const dest = path.join(out, 'scripts', 'concertino', f);
      copy(path.join(core, 'scripts', f), dest, dry);
      if (!dry && f.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    }
  }
  if (!dry) console.log('  ' + green('refreshed') + ' .concertino/ assets' + (withScripts ? ' + scripts/concertino/' : ''));
}

module.exports = {
  emitClaude, emitCodex, emitOpencode, copyAssets,
  mergeAgentMergeSettings, mergeCostHookSettings,
  readSettingsJson, applyAgentMergeSettings, applyCostHookSettings,
  codexModelProviderLine, mergeMarkedRegion, codexOllamaConfigToml,
  CODEX_CONFIG_TOML_MARKER_RE, AGENTS_MD_MARKER_RE, CODEX_ROLE_INDEX,
  OPENCODE_ROLES, renderOpencodeAgentMd,
  mergeOpencodeJson,
};
