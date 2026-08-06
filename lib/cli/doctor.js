'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const {
  REPO, green, yellow, gray, red, dim,
  section, read, exists,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { checkAgentMergePermission, withAgentMergeFixHint } = require('../config');

// ---------- rendered-artifact drift (doctor) ------------------------------
// The silent failure this exists to catch: `scripts/concertino/*.sh` reverted
// by a local edit or a stale merge, and `.claude/agents/concertino-*.md` older
// than the core it was rendered from — the agent files are gitignored, so they
// never travel through git and a fresh clone has none at all. Neither says
// anything. The agents simply stop emitting, and the dashboard shows an empty
// screen for a run that is actually in flight.
//
// BYTES, not mtimes. copyAssets() copies these verbatim, so a byte difference
// is exact evidence of drift with no false positives, whereas mtime says
// nothing useful about an npm-installed package where install time is arbitrary.
function checkArtifacts(out, core, coreForced, harnesses, cfg, r) {
  section('Rendered artifacts');
  r.ok('core', core + (coreForced ? dim('  (forced via --core)') : dim('  (auto-detected)')));

  const missing = [], differs = [];
  let checked = 0;
  const compare = (src, dest) => {
    checked++;
    const rel = path.relative(out, dest);
    if (!exists(dest)) { missing.push(rel); return; }
    if (!fs.readFileSync(src).equals(fs.readFileSync(dest))) differs.push(rel);
  };

  for (const f of fs.readdirSync(path.join(core, 'scripts')))
    compare(path.join(core, 'scripts', f), path.join(out, 'scripts', 'concertino', f));
  for (const f of fs.readdirSync(path.join(core, 'laws')))
    compare(path.join(core, 'laws', f), path.join(out, '.concertino', 'laws', f));
  compare(path.join(core, 'workflow-state.template.md'),
    path.join(out, '.concertino', 'workflow-state.template.md'));

  // Missing and differing are different user problems: one file never arrived,
  // the other arrived and was then changed underneath them.
  if (missing.length) r.warn('missing: ' + missing.join(', ') + ' — run `concertino sync`');
  if (differs.length) r.warn('differs from core: ' + differs.join(', ') + ' — run `concertino sync`');
  if (!missing.length && !differs.length) r.ok('copied assets', checked + ' files match core');

  // The agent files are rendered from templates + config, so there is no
  // byte-identical source to compare them against. Existence is the honest
  // check; claiming more than that would be worse than checking less.
  const absent = [];
  if (harnesses.includes('claude-code')) {
    for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
      const p = path.join(out, '.claude', 'agents', 'concertino-' + role + '.md');
      if (!exists(p)) absent.push(path.relative(out, p));
    }
    const cmdPath = path.join(out, '.claude', 'commands', 'concertino-deliver.md');
    if (!exists(cmdPath)) absent.push(path.relative(out, cmdPath));
  }
  if (harnesses.includes('codex') && !exists(path.join(out, 'AGENTS.md'))) absent.push('AGENTS.md');
  const ollamaHarnesses = (cfg.providers && cfg.providers.ollama && cfg.providers.ollama.harnesses) || [];
  if (harnesses.includes('codex') && ollamaHarnesses.includes('codex') && !exists(path.join(out, '.codex', 'config.toml')))
    absent.push('.codex/config.toml');
  if (harnesses.includes('opencode')) {
    for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
      const p = path.join(out, '.opencode', 'agents', 'concertino-' + role + '.md');
      if (!exists(p)) absent.push(path.relative(out, p));
    }
    const cmdPath = path.join(out, '.opencode', 'commands', 'concertino-deliver.md');
    if (!exists(cmdPath)) absent.push(path.relative(out, cmdPath));
    if (!exists(path.join(out, 'opencode.json'))) absent.push('opencode.json');
  }

  absent.length
    ? r.warn('not rendered: ' + absent.join(', ') + ' — run `concertino sync`')
    : r.ok('agent files', 'present for ' + harnesses.join(', '));
}

// ---------- local-base-behind-remote check (doctor, CON-25) ---------------
// Names the likely CAUSE of the rendered-artifact drift checkArtifacts()
// above already detects: Phase 4 cleanup's fast-forward not having run, or a
// merge that landed outside the workflow entirely. Best-effort — a fetch
// failure (offline, or no such remote) must never make doctor hang or fail;
// it just skips this one check silently, exactly like cleanup.sh's own
// fast-forward step does for the same reason.
function checkBaseBranch(out, cfg, r) {
  const remote = (cfg.project && cfg.project.baseRemote) || 'origin';
  const branch = (cfg.project && cfg.project.baseBranch) || 'main';
  section('Git');

  let fetchOk = true;
  try {
    execSync(`git fetch --quiet ${remote} ${branch}`, { cwd: out, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) { fetchOk = false; }
  if (!fetchOk) return;

  let counts;
  try {
    counts = execSync(`git rev-list --left-right --count ${branch}...${remote}/${branch}`,
      { cwd: out, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return; }

  // `--left-right --count A...B` prints "<unique to A> <unique to B>" —
  // ahead, then behind. Ahead-only or even is silent: a human legitimately
  // ahead of origin (unpushed local commits) is a different, unrelated
  // situation this check must not false-positive against.
  const m = /^(\d+)\s+(\d+)$/.exec(counts);
  if (!m) return;
  const behind = parseInt(m[2], 10);
  if (behind > 0) {
    r.warn(`local ${branch} is ${behind} commit${behind === 1 ? '' : 's'} behind ${remote}/${branch} — ` +
      'usually because Phase 4 cleanup\'s fast-forward didn\'t run, or a merge landed outside the ' +
      'workflow; run `concertino sync` after bringing it forward');
  } else {
    r.ok('base branch', `${branch} is current with ${remote}/${branch}`);
  }
}

// ---------- Ollama per-role model validation (doctor, CON-73) -------------
// Extends the reachability check below: a model *name* that resolves and a
// model that can actually run under the harness that will use it are two
// different things. Codex's `--oss` route rejects any model whose
// capabilities don't include `thinking`, and that failure otherwise surfaces
// only at launch, inside a spawned tmux window. Gated entirely behind the
// baseUrl reachability check succeeding — an unreachable Ollama must skip
// these cleanly, never throw, never fail doctor. Same try/catch-returns-null
// shape as this file's `shell()` helper: a network failure or unparseable
// response degrades to "skip this one check", not a crash.
function fetchJson(args) {
  try {
    return JSON.parse(execFileSync('curl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    return null;
  }
}

function checkOllamaModels(ollama, r) {
  const models = ollama.models || {};
  const roles = Object.keys(models);
  if (!roles.length) return;

  // 1. Pulled-locally check, via /api/tags' native tag list (exact ":tag"
  // strings match what providers.ollama.models uses; see design.md).
  const tags = fetchJson(['-sf', '-m', '3', `${ollama.baseUrl}/api/tags`]);
  const localTags = tags && Array.isArray(tags.models) ? tags.models.map((m) => m.name) : null;
  if (localTags) {
    for (const role of roles) {
      const model = models[role];
      if (!localTags.includes(model)) {
        r.warn(`ollama.models.${role}: "${model}" is not pulled locally — run \`ollama pull ${model}\``);
      }
    }
  }

  // 2. Capability check, via /api/show — one call per distinct model id
  // (roles frequently share a model), then reported once per role so the
  // warning names the config key the user would actually go fix. Args
  // passed as an array (execFileSync, no shell) so a model id containing
  // shell metacharacters can't do anything but fail to match a real model.
  const codexRouted = (ollama.harnesses || []).includes('codex');
  const capsByModel = {};
  for (const model of new Set(Object.values(models))) {
    const show = fetchJson([
      '-sf', '-m', '3', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ model }),
      `${ollama.baseUrl}/api/show`,
    ]);
    if (show === null) continue; // fetch itself failed — skip this model entirely, per design.md
    capsByModel[model] = Array.isArray(show.capabilities) ? show.capabilities : [];
  }
  for (const role of roles) {
    const model = models[role];
    const caps = capsByModel[model];
    if (!caps) continue;
    if (!caps.includes('tools')) {
      r.warn(`ollama.models.${role}: "${model}" is missing the "tools" capability — every concertino role uses tool calls`);
    }
    if (codexRouted && !caps.includes('thinking')) {
      r.warn(`ollama.models.${role}: "${model}" is missing the "thinking" capability — required by Codex's \`--oss\` route`);
    }
  }
}

// ---------- Ollama / gateway prerequisites (doctor, CON-63) ---------------
// Best-effort, non-fatal — mirrors checkBaseBranch's own best-effort fetch
// pattern immediately above: a network check must never make doctor hang or
// fail outright, so failures are reported as warnings and doctor keeps
// running every other check regardless. Never prints the value of any
// credential named by apiKeyEnv — at most, reports whether the named
// environment variable is set (non-empty), never its contents.
function checkOllamaProvider(cfg, r) {
  const ollama = cfg.providers && cfg.providers.ollama;
  if (!ollama || !(ollama.harnesses || []).length) return;
  section('Providers');

  const reachable = (label, url) => {
    if (!url) { r.warn(label + ': baseUrl not set — cannot check reachability'); return false; }
    try {
      execSync(`curl -sf -m 3 "${url}" -o /dev/null`, { stdio: ['ignore', 'ignore', 'ignore'] });
      r.ok(label, url);
      return true;
    } catch (e) {
      r.warn(label + ' unreachable at ' + url + ' — is it running? (non-fatal; ' +
        (ollama.harnesses || []).join(', ') + ' will fail to reach it until it is)');
      return false;
    }
  };
  const reportKeyEnv = (label, envName) => {
    const set = !!(process.env[envName] && process.env[envName].length);
    r.ok(label, envName + (set ? ' (set)' : dim(' (not set)')));
  };

  const baseReachable = reachable('ollama', ollama.baseUrl);
  if (ollama.apiKeyEnv) reportKeyEnv('ollama.apiKeyEnv', ollama.apiKeyEnv);

  // CON-75 design.md Decision 6: report which of the two claude-code routes
  // (direct/gateway) this project resolves to, purely additive to the
  // existing reachability/model checks below. Gateway wins when configured
  // (unchanged pre-CON-75 behavior) — mirrors isOllamaRouted's own
  // precedence in lib/config.js.
  if ((ollama.harnesses || []).includes('claude-code')) {
    if (ollama.gateway) {
      r.ok('providers.ollama.route', 'gateway');
      reachable('gateway', ollama.gateway.baseUrl);
      if (ollama.gateway.apiKeyEnv) reportKeyEnv('gateway.apiKeyEnv', ollama.gateway.apiKeyEnv);
    } else {
      r.ok('providers.ollama.route', 'direct');
    }
  }

  if (baseReachable) checkOllamaModels(ollama, r);
}

// ---------- agent-merge permission-grant check (doctor, CON-88) -----------
// Runtime counterpart to `lib/config.js`'s `collectConfigIssues` "Agent-merge"
// section (`concertino validate`) — both call the shared
// `checkAgentMergePermission` (same script, same PASS/FAIL interpretation),
// reported here through doctor's own ok/warn instead of validate's. Silent
// no-op (no section header at all) unless agentMerge.enabled is true and
// claude-code is a configured harness — mirrors checkBaseBranch/
// checkOllamaProvider's own conditional-section precedent above.
function checkAgentMerge(out, cfg, r) {
  const harnesses = Array.isArray(cfg.harnesses) ? cfg.harnesses : [];
  if (!cfg.agentMerge || !cfg.agentMerge.enabled || !harnesses.includes('claude-code')) return;
  section('Agent-merge');
  const result = checkAgentMergePermission(cfg, out);
  if (result && result.ok) {
    r.ok('agentMerge.permissions', 'grant present in .claude/settings.json');
  } else {
    const reason = (result && result.reason) || 'permission grant missing';
    r.warn(withAgentMergeFixHint(reason));
  }
}

function cmdDoctor(args) {
  const out = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
  console.log('concertino doctor');
  const errs = [], warns = [];
  const ok   = (label, val) => console.log(`  ${green('✓')} ${gray(String(label).padEnd(18))} ${val ?? ''}`);
  const warn = (msg)        => { warns.push(msg); console.log(`  ${yellow('!')} ${msg}`); };
  const fail = (msg)        => { errs.push(msg);  console.log(`  ${red('✗')} ${msg}`); };
  const shell = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); } catch { return null; } };

  section('Runtime');
  const nodeVer = shell('node --version');
  nodeVer ? ok('node', nodeVer) : fail('node not found on PATH');
  const gitUser  = shell('git config user.name');
  const gitEmail = shell('git config user.email');
  (gitUser && gitEmail) ? ok('git identity', gitUser + ' <' + gitEmail + '>') : warn('git user.name / user.email not configured — commits will be anonymous');
  const ghOut = shell('gh auth status 2>&1');
  (ghOut && /Logged in to/.test(ghOut)) ? ok('gh auth', 'authenticated') : warn('gh not authenticated — run `gh auth login` (needed for PR creation)');

  section('Dashboard');
  const tmuxVer = shell('tmux -V 2>/dev/null');
  tmuxVer ? ok('tmux', tmuxVer) : warn('tmux not found — `concertino watch` needs it');

  section('Config');
  if (!exists(cfgPath)) {
    warn('no concertino.config.json — run `concertino init` to create one');
  } else {
    let cfg;
    try { cfg = JSON.parse(read(cfgPath)); ok('config', 'found'); }
    catch { fail('concertino.config.json is not valid JSON'); }
    if (cfg) {
      const harnesses = cfg.harnesses || [];
      const tp = cfg.ticketProvider || {};
      const ui = cfg.ui || {};

      // Each harness's CLI is checked only when that harness is actually
      // configured — opencode-harness spec: "concertino doctor checks only
      // the CLIs of selected harnesses" (fixes the pre-existing gap where
      // the claude-code check below ran unconditionally, tasks.md 4.9).
      if (harnesses.includes('claude-code')) {
        section('Claude Code CLI');
        const claudeVer = shell('claude --version 2>/dev/null');
        claudeVer ? ok('claude', claudeVer) : fail('`claude` not found — install from https://claude.ai/code');
      }

      if (harnesses.includes('codex')) {
        section('Codex CLI');
        const codexVer = shell('codex --version 2>/dev/null');
        codexVer ? ok('codex', codexVer) : fail('`codex` CLI not found — install the OpenAI Codex CLI');
      }

      if (harnesses.includes('opencode')) {
        section('OpenCode CLI');
        const opencodeVer = shell('opencode --version 2>/dev/null');
        opencodeVer ? ok('opencode', opencodeVer) : fail('`opencode` CLI not found — install from https://opencode.ai');
      }

      checkOllamaProvider(cfg, { ok, warn });
      checkAgentMerge(out, cfg, { ok, warn });

      if (tp.kind === 'linear') {
        section('Linear MCP');
        const mcpPath = path.join(out, '.mcp.json');
        if (exists(mcpPath)) {
          try {
            const mcp = JSON.parse(read(mcpPath));
            const has = mcp.mcpServers && mcp.mcpServers.linear;
            has ? ok('.mcp.json', 'linear server present') : warn('.mcp.json found but no "linear" entry under mcpServers');
          } catch { warn('.mcp.json is not valid JSON'); }
        } else {
          warn('no .mcp.json found — add the Linear MCP server for ticket access (see claude.ai/code docs)');
        }
      }

      if (ui.enabled && ui.tool === 'playwright') {
        section('Playwright');
        const pwVer = shell('npx playwright --version 2>/dev/null');
        pwVer ? ok('playwright', pwVer) : warn('playwright not found — run `npx playwright install` in the project');
      }

      checkBaseBranch(out, cfg, { ok, warn });

      const core = resolveCore(REPO, out, args.core);
      checkArtifacts(out, core, !!args.core, harnesses, cfg, { ok, warn });
    }
  }

  const verdict = errs.length ? red('✗ action required') : green('✓ environment ready');
  const counts = [];
  if (errs.length)  counts.push(red(errs.length + ' error' + (errs.length !== 1 ? 's' : '')));
  if (warns.length) counts.push(yellow(warns.length + ' warning' + (warns.length !== 1 ? 's' : '')));
  if (!counts.length) counts.push(dim('all checks passed'));
  console.log('\n  ' + verdict + '  ' + counts.join(dim('  ·  ')));
  if (errs.length) process.exit(1);
}

module.exports = { cmdDoctor };
