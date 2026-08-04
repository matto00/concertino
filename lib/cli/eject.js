'use strict';

const path = require('path');

const { withDefaults, resolveModel } = require('../config');
const {
  REPO, ADAPTERS, VERSION, dim, red,
  read, exists, readRoleFile,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderBody } = require('./render');
const { codexModelProviderLine, renderOpencodeAgentMd } = require('./emit');

function cmdEject(args) {
  const role    = args.role;
  const harness = args.harness || 'claude-code';
  const out     = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');

  if (!role) {
    console.error(red('error: ') + '--role is required  (orchestrator | executor | evaluator | skeptic | auditor)');
    process.exit(1);
  }
  if (!exists(cfgPath)) {
    console.error(red('error: ') + 'no config at ' + cfgPath);
    process.exit(1);
  }

  const c = withDefaults(JSON.parse(read(cfgPath)));
  const core = resolveCore(REPO, out, args.core);

  if (harness === 'claude-code') {
    const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    const r = meta.roles[role];
    if (!r) {
      console.error(red('error: ') + 'unknown role "' + role + '" — valid: ' + Object.keys(meta.roles).join(', '));
      process.exit(1);
    }
    let tools = r.baseTools.slice();
    if (r.usesUi && c.ui.enabled && c.ui.tool === 'playwright') tools = tools.concat(meta.playwrightTools);
    tools = tools.concat((r.mcpTools && r.mcpTools[c.ticketProvider.kind]) || []);
    const overridePath = path.join(out, '.concertino', 'roles', role + '.md');
    if (exists(overridePath)) process.stderr.write(dim('note: using local override .concertino/roles/' + role + '.md\n'));
    const body = renderBody(readRoleFile(role, out, core), c, 'claude-code');
    const desc  = r.description.split('{{project}}').join(c.project.name);
    const model = resolveModel(c, 'claude-code', role);
    const fm = ['---', '# concertino:sync v' + VERSION, 'name: concertino-' + role, 'description: >-', '  ' + desc, 'model: ' + model, 'color: ' + r.color, 'tools:', ...tools.map((t) => '  - ' + t), '---', ''].join('\n');
    process.stdout.write(fm + body);
  } else if (harness === 'codex') {
    if (!['executor', 'evaluator', 'auditor'].includes(role)) {
      console.error(red('error: ') + 'codex harness only has executor, evaluator, and auditor');
      process.exit(1);
    }
    const tmpl = read(path.join(ADAPTERS, 'codex', 'agent.toml.tmpl'));
    const meta  = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    const body  = renderBody(readRoleFile(role, out, core), c, 'codex');
    const desc  = meta.roles[role].description.split('{{project}}').join(c.project.name);
    const toml  = '# concertino:sync v' + VERSION + '\n' + tmpl
      .split('{{role}}').join(role)
      .split('{{description}}').join(desc.replace(/"/g, '\\"'))
      .split('{{model}}').join(resolveModel(c, 'codex', role))
      .split('{{model_provider}}').join(codexModelProviderLine(c, role))
      .split('{{body}}').join(body);
    process.stdout.write(toml);
  } else if (harness === 'opencode') {
    const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
    if (!meta.roles[role]) {
      console.error(red('error: ') + 'unknown role "' + role + '" — valid: ' + Object.keys(meta.roles).join(', '));
      process.exit(1);
    }
    const overridePath = path.join(out, '.concertino', 'roles', role + '.md');
    if (exists(overridePath)) process.stderr.write(dim('note: using local override .concertino/roles/' + role + '.md\n'));
    const header = read(path.join(ADAPTERS, 'opencode', 'header.md')).split('{{project}}').join(c.project.name);
    process.stdout.write(renderOpencodeAgentMd(c, out, core, role, meta, header));
  } else {
    console.error(red('error: ') + 'unknown harness "' + harness + '" — valid: claude-code, codex, opencode');
    process.exit(1);
  }
}

module.exports = { cmdEject };
