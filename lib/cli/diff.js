'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { withDefaults, resolveModel } = require('../config');
const {
  REPO, ADAPTERS, VERSION, green, cyan, dim, red,
  read, exists, readRoleFile, resolveOut, resolveConfigPath, hasHelpFlag, parseHarnessList,
  listFilesRecursive, reportProvenance,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderBody, renderEnv, renderSpeedsJson } = require('./render');
const {
  codexModelProviderLine, mergeMarkedRegion, codexOllamaConfigToml,
  CODEX_CONFIG_TOML_MARKER_RE, OPENCODE_ROLES, renderOpencodeAgentMd,
  mergeOpencodeJson, readSettingsJson, applyAgentMergeSettings, applyCostHookSettings,
  AGENTS_MD_MARKER_RE, CODEX_ROLE_INDEX,
} = require('./emit');
const { printUsage } = require('./help');

function diffFile(dest, newContent) {
  if (!exists(dest)) {
    console.log('\n' + green('+++ ') + cyan(path.relative(process.cwd(), dest)) + dim(' (new file)'));
    const lines = newContent.split('\n');
    lines.slice(0, 8).forEach((l) => process.stdout.write(green('+' + l + '\n')));
    if (lines.length > 8) console.log(dim('    ... (' + lines.length + ' lines total)'));
    return 'new';
  }
  const existing = read(dest);
  if (existing === newContent) {
    console.log('  ' + dim('unchanged  ' + path.relative(process.cwd(), dest)));
    return 'unchanged';
  }
  const tmp = path.join(os.tmpdir(), 'concertino-diff-' + process.pid);
  fs.writeFileSync(tmp, newContent, 'utf8');
  try {
    execSync(`diff -u "${dest}" "${tmp}"`, { encoding: 'utf8' });
    return 'unchanged';
  } catch (e) {
    const lines = (e.stdout || '').split('\n');
    console.log('\n' + cyan(path.relative(process.cwd(), dest)));
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) process.stdout.write(dim(line + '\n'));
      else if (line.startsWith('+'))  process.stdout.write(green(line + '\n'));
      else if (line.startsWith('-'))  process.stdout.write(red(line + '\n'));
      else if (line.startsWith('@@')) process.stdout.write(cyan(line + '\n'));
      else process.stdout.write(dim(line + '\n'));
    }
    return 'changed';
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function cmdDiff(args) {
  if (hasHelpFlag(args)) { printUsage('diff'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  if (!exists(cfgPath)) { console.error(red('error: ') + 'no config at ' + cfgPath); process.exit(1); }
  const c = withDefaults(JSON.parse(read(cfgPath)));
  const core = resolveCore(REPO, out, args.core);
  const { harnesses, error } = parseHarnessList(args.harness, c.harnesses);
  if (error) { console.error(red('error: ') + error); process.exit(1); }
  console.log('concertino diff → ' + out);
  reportProvenance(core);

  const counts = { changed: 0, new: 0, unchanged: 0 };
  const diff = (dest, content) => { const r = diffFile(dest, content); counts[r]++; };

  diff(path.join(out, 'scripts', 'concertino', '.concertino.env'), renderEnv(c));
  diff(path.join(out, 'scripts', 'concertino', 'speeds.json'), renderSpeedsJson(c));

  // copyAssets() parity (tasks.md 3.1-3.3): the exact trio CON-133/CON-52
  // were filed about — files most likely to carry un-upstreamed local fixes,
  // and previously invisible to `diff` entirely. Mirrors copyAssets()'s own
  // enumeration (fs.readdirSync(core/laws) flat, listFilesRecursive for the
  // nested core/scripts/lib/ case) verbatim — read verbatim, no renderBody,
  // since copyAssets() copies these byte-for-byte.
  for (const f of fs.readdirSync(path.join(core, 'laws')))
    diff(path.join(out, '.concertino', 'laws', f), read(path.join(core, 'laws', f)));
  diff(path.join(out, '.concertino', 'workflow-state.template.md'), read(path.join(core, 'workflow-state.template.md')));
  for (const f of listFilesRecursive(path.join(core, 'scripts')))
    diff(path.join(out, 'scripts', 'concertino', f), read(path.join(core, 'scripts', f)));

  if (harnesses.includes('claude-code')) {
    const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
      const r = meta.roles[role];
      let tools = r.baseTools.slice();
      if (r.usesUi && c.ui.enabled && c.ui.tool === 'playwright') tools = tools.concat(meta.playwrightTools);
      tools = tools.concat((r.mcpTools && r.mcpTools[c.ticketProvider.kind]) || []);
      const body = renderBody(readRoleFile(role, out, core), c, 'claude-code');
      const desc = r.description.split('{{project}}').join(c.project.name);
      const model = resolveModel(c, 'claude-code', role);
      const fm = ['---', '# concertino:sync v' + VERSION, 'name: concertino-' + role, 'description: >-', '  ' + desc, 'model: ' + model, 'color: ' + r.color, 'tools:', ...tools.map((t) => '  - ' + t), '---', ''].join('\n');
      diff(path.join(out, '.claude', 'agents', 'concertino-' + role + '.md'), fm + body);
    }
    const cmd = read(path.join(ADAPTERS, 'claude-code', 'command.md'))
      .split('{{project}}').join(c.project.name)
      .split('{{idExample}}').join(c.ticketProvider.idExample);
    diff(path.join(out, '.claude', 'commands', 'concertino-deliver.md'), cmd);

    // tasks.md 3.4: the address-failure entry point — mirrors emitClaude()'s
    // own read()/split()/join() exactly.
    const addressFailureCmd = read(path.join(ADAPTERS, 'claude-code', 'address-failure-command.md'))
      .split('{{project}}').join(c.project.name)
      .split('{{idExample}}').join(c.ticketProvider.idExample);
    diff(path.join(out, '.claude', 'commands', 'concertino-address-failure.md'), addressFailureCmd);

    // tasks.md 3.5: `.claude/settings.json` is a merged-region file — the
    // diff must reflect the MERGED outcome sync would leave on disk, not a
    // raw block, so applyAgentMergeSettings then applyCostHookSettings are
    // applied in the exact same order emitClaude() applies
    // mergeAgentMergeSettings()/mergeCostHookSettings() (emit.js:121-122),
    // the second reading what the first wrote — never diffed independently.
    // Mirrors mergeAgentMergeSettings()/mergeCostHookSettings()'s own early
    // returns exactly: sync writes NOTHING to settings.json at all when both
    // are disabled (not even an empty `{}`) — diffing unconditionally would
    // falsely report a "new file" sync would never actually create.
    if ((c.agentMerge && c.agentMerge.enabled) || (c.costTracking && c.costTracking.enabled)) {
      const settingsPath = path.join(out, '.claude', 'settings.json');
      const mergedSettings = applyCostHookSettings(c, applyAgentMergeSettings(c, readSettingsJson(settingsPath)));
      diff(settingsPath, JSON.stringify(mergedSettings, null, 2) + '\n');
    }
  }

  if (harnesses.includes('codex')) {
    const tmpl = read(path.join(ADAPTERS, 'codex', 'agent.toml.tmpl'));
    const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    for (const role of ['executor', 'evaluator', 'auditor']) {
      const body = renderBody(readRoleFile(role, out, core), c, 'codex');
      const desc = meta.roles[role].description.split('{{project}}').join(c.project.name);
      const toml = '# concertino:sync v' + VERSION + '\n' + tmpl
        .split('{{role}}').join(role)
        .split('{{description}}').join(desc.replace(/"/g, '\\"'))
        .split('{{model}}').join(resolveModel(c, 'codex', role))
        .split('{{model_provider}}').join(codexModelProviderLine(c, role))
        .split('{{body}}').join(body);
      diff(path.join(out, '.codex', 'agents', 'concertino-' + role + '.toml'), toml);
    }
    if ((c.providers.ollama && (c.providers.ollama.harnesses || []).includes('codex'))) {
      const configPath = path.join(out, '.codex', 'config.toml');
      const merged = mergeMarkedRegion(exists(configPath) ? read(configPath) : null, codexOllamaConfigToml(c), CODEX_CONFIG_TOML_MARKER_RE);
      diff(configPath, merged);
    }

    // tasks.md 3.6: `.codex/roles/concertino-*.md` — reproduces emitCodex()'s
    // per-role render (renderBody + the same title/header wrapper) exactly.
    const codexHeader = read(path.join(ADAPTERS, 'codex', 'header.md')).split('{{project}}').join(c.project.name);
    const codexRoles = ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor'];
    for (const role of codexRoles) {
      const body = renderBody(read(path.join(core, 'roles', role + '.md')), c, 'codex');
      const title = role[0].toUpperCase() + role.slice(1);
      const rendered = '# Concertino ' + title + ' (' + c.project.name + ')\n\n' +
        '<!-- generated by `concertino sync` — edit core/roles/' + role + '.md, not here -->\n\n' +
        body + '\n';
      diff(path.join(out, '.codex', 'roles', 'concertino-' + role + '.md'), rendered);
    }

    // tasks.md 3.7: AGENTS.md — reproduces emitCodex()'s blockText
    // construction (header + role index) and merges via the same
    // mergeMarkedRegion() against the existing file, exactly as emitCodex()
    // does, so hand-authored content outside the markers is never treated
    // as a diff.
    const roleIndex = [
      '## Role specs — read the one whose phase you are entering',
      '',
      'Each is a separate file so it costs nothing until you need it. Read with',
      'your file-reading tool; the paths are relative to the repository root.',
      '',
    ].concat(codexRoles.map((role) =>
      '- **' + role[0].toUpperCase() + role.slice(1) + '** — `.codex/roles/concertino-' + role + '.md`  \n' +
      '  ' + CODEX_ROLE_INDEX[role])).join('\n');
    const blockText = codexHeader.replace('<!-- CONCERTINO:ROLES -->', roleIndex)
      + '\n\n<!-- CONCERTINO:END -->\n';
    const agentsPath = path.join(out, 'AGENTS.md');
    const mergedAgents = mergeMarkedRegion(exists(agentsPath) ? read(agentsPath) : null, blockText, AGENTS_MD_MARKER_RE);
    diff(agentsPath, mergedAgents);

    // tasks.md 3.8: `.codex/prompts/concertino-deliver.md` — a plain copy(),
    // not a render; diff the adapter source verbatim.
    diff(path.join(out, '.codex', 'prompts', 'concertino-deliver.md'), read(path.join(ADAPTERS, 'codex', 'prompt.md')));
  }

  if (harnesses.includes('opencode')) {
    const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    const header = read(path.join(ADAPTERS, 'opencode', 'header.md')).split('{{project}}').join(c.project.name);
    for (const role of OPENCODE_ROLES) {
      diff(path.join(out, '.opencode', 'agents', 'concertino-' + role + '.md'), renderOpencodeAgentMd(c, out, core, role, meta, header));
    }
    const cmd = read(path.join(ADAPTERS, 'opencode', 'prompt.md'))
      .split('{{project}}').join(c.project.name)
      .split('{{idExample}}').join(c.ticketProvider.idExample);
    diff(path.join(out, '.opencode', 'commands', 'concertino-deliver.md'), cmd);
    const cfgPath = path.join(out, 'opencode.json');
    diff(cfgPath, mergeOpencodeJson(exists(cfgPath) ? read(cfgPath) : null, c));
  }

  const summary = [
    counts.changed   ? cyan(counts.changed + ' changed')     : dim('0 changed'),
    counts.new       ? green(counts.new + ' new')            : dim('0 new'),
    dim(counts.unchanged + ' unchanged'),
  ].join(dim('  ·  '));
  console.log('\n  ' + summary);
  if (counts.changed || counts.new) console.log('  ' + dim('run `concertino sync` to apply'));
}

module.exports = { cmdDiff };
