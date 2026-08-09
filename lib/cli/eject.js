'use strict';

const path = require('path');

const { withDefaults, resolveModel } = require('../config');
const {
  REPO, ADAPTERS, VERSION, dim, red,
  read, exists, readRoleFile, resolveOut, resolveConfigPath, hasHelpFlag, parseHarnessList,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderBody } = require('./render');
const { codexModelProviderLine, renderOpencodeAgentMd } = require('./emit');
const { printUsage } = require('./help');

// Renders `role` for a single `harness`, returning the rendered string, or
// `null` (plus a stderr note) if `harness` doesn't support `role` — strictly
// codex's narrower role set (executor/evaluator/auditor only). `role` is
// assumed already globally validated against the 5-role set by the caller
// (design.md Decision 5a) — claude-code/opencode never return `null` here,
// since both validate against that identical global set, already ruled out
// by the time this function runs.
function renderForHarness(harness, role, c, out, core, meta) {
  if (harness === 'claude-code') {
    const r = meta.roles[role];
    let tools = r.baseTools.slice();
    if (r.usesUi && c.ui.enabled && c.ui.tool === 'playwright') tools = tools.concat(meta.playwrightTools);
    tools = tools.concat((r.mcpTools && r.mcpTools[c.ticketProvider.kind]) || []);
    const overridePath = path.join(out, '.concertino', 'roles', role + '.md');
    if (exists(overridePath)) process.stderr.write(dim('note: using local override .concertino/roles/' + role + '.md\n'));
    const body = renderBody(readRoleFile(role, out, core), c, 'claude-code');
    const desc  = r.description.split('{{project}}').join(c.project.name);
    const model = resolveModel(c, 'claude-code', role);
    const fm = ['---', '# concertino:sync v' + VERSION, 'name: concertino-' + role, 'description: >-', '  ' + desc, 'model: ' + model, 'color: ' + r.color, 'tools:', ...tools.map((t) => '  - ' + t), '---', ''].join('\n');
    return fm + body;
  }
  if (harness === 'codex') {
    if (!['executor', 'evaluator', 'auditor'].includes(role)) {
      console.error(red('error: ') + 'codex harness only has executor, evaluator, and auditor');
      return null;
    }
    const tmpl = read(path.join(ADAPTERS, 'codex', 'agent.toml.tmpl'));
    const body  = renderBody(readRoleFile(role, out, core), c, 'codex');
    const desc  = meta.roles[role].description.split('{{project}}').join(c.project.name);
    return '# concertino:sync v' + VERSION + '\n' + tmpl
      .split('{{role}}').join(role)
      .split('{{description}}').join(desc.replace(/"/g, '\\"'))
      .split('{{model}}').join(resolveModel(c, 'codex', role))
      .split('{{model_provider}}').join(codexModelProviderLine(c, role))
      .split('{{body}}').join(body);
  }
  // harness === 'opencode' — the only remaining value; parseHarnessList
  // already rejected anything outside the three known harness ids.
  const overridePath = path.join(out, '.concertino', 'roles', role + '.md');
  if (exists(overridePath)) process.stderr.write(dim('note: using local override .concertino/roles/' + role + '.md\n'));
  const header = read(path.join(ADAPTERS, 'opencode', 'header.md')).split('{{project}}').join(c.project.name);
  return renderOpencodeAgentMd(c, out, core, role, meta, header);
}

function cmdEject(args) {
  if (hasHelpFlag(args)) { printUsage('eject'); return; }
  const role    = args.role;
  const out     = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);

  if (!role) {
    console.error(red('error: ') + '--role is required  (orchestrator | executor | evaluator | skeptic | auditor)');
    process.exit(1);
  }

  const { harnesses, error: harnessError } = parseHarnessList(args.harness, ['claude-code']);
  if (harnessError) { console.error(red('error: ') + harnessError); process.exit(1); }

  if (!exists(cfgPath)) {
    console.error(red('error: ') + 'no config at ' + cfgPath);
    process.exit(1);
  }

  const c = withDefaults(JSON.parse(read(cfgPath)));
  const core = resolveCore(REPO, out, args.core);

  // Validate --role exactly once, globally, before touching any harness in
  // the list — design.md Decision 5a. A role outside the fixed 5-role set is
  // invalid regardless of which harness was named, so this must not be
  // folded into the per-harness codex-only skip-and-continue path below.
  const meta = JSON.parse(read(path.join(ADAPTERS, 'claude-code', 'agents.json')));
  if (!meta.roles[role]) {
    console.error(red('error: ') + 'unknown role "' + role + '" — valid: ' + Object.keys(meta.roles).join(', '));
    process.exit(1);
  }

  const results = [];
  for (const h of harnesses) {
    const rendered = renderForHarness(h, role, c, out, core, meta);
    if (rendered !== null) results.push({ harness: h, content: rendered });
  }

  if (results.length === 0) {
    // Every harness in the list was unsupported for this role (codex-only
    // case, since --role already passed the global check above) — mirrors
    // today's single-harness-unsupported-role behavior: no stdout, exit 1.
    process.exit(1);
  }

  // Header presence is driven by how many harnesses were *named*, not how
  // many produced output — a list of two where one is skipped still prints
  // the surviving section with a header (design.md Decision 4, spec.md
  // "unsupported role is skipped, not fatal" scenario).
  if (harnesses.length === 1) {
    process.stdout.write(results[0].content);
  } else {
    for (const r of results) {
      process.stdout.write('# ---- harness: ' + r.harness + ' ----\n' + r.content);
    }
  }
}

module.exports = { cmdEject };
