'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { withDefaults, resolveModel } = require('../config');
const {
  REPO, ADAPTERS, VERSION, green, cyan, dim, red,
  read, exists, readRoleFile,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderBody, renderEnv, renderSpeedsJson } = require('./render');
const {
  codexModelProviderLine, mergeMarkedRegion, codexOllamaConfigToml,
  CODEX_CONFIG_TOML_MARKER_RE, OPENCODE_ROLES, renderOpencodeAgentMd,
  mergeOpencodeJson,
} = require('./emit');

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
  const out = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
  if (!exists(cfgPath)) { console.error(red('error: ') + 'no config at ' + cfgPath); process.exit(1); }
  const c = withDefaults(JSON.parse(read(cfgPath)));
  const core = resolveCore(REPO, out, args.core);
  const harnesses = args.harness ? args.harness.split(',') : c.harnesses;
  console.log('concertino diff → ' + out);

  const counts = { changed: 0, new: 0, unchanged: 0 };
  const diff = (dest, content) => { const r = diffFile(dest, content); counts[r]++; };

  diff(path.join(out, 'scripts', 'concertino', '.concertino.env'), renderEnv(c));
  diff(path.join(out, 'scripts', 'concertino', 'speeds.json'), renderSpeedsJson(c));

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
