'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// DEFAULT_MODEL_TIERS is referenced directly below (buildConfig);
// withDefaults is used by cmdInit's own render of .concertino.env.
const { DEFAULT_MODEL_TIERS, withDefaults } = require('../config');
const {
  REPO, bold, dim, cyan, green, yellow, gray,
  banner, section, read, exists, write, copy, hasHelpFlag,
} = require('./shared');
const { resolveCore } = require('./resolve-core');
const { renderEnv } = require('./render');
const { copyAssets } = require('./emit');
const { cmdSync } = require('./sync');
const { printUsage } = require('./help');

// ---------- gate auto-detection ------------------------------------------
function detectGates(dir) {
  const has = (f) => exists(path.join(dir, f));
  const gates = [];
  const sources = [];

  if (has('package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(read(path.join(dir, 'package.json'))).scripts || {}; } catch (_) {}
    sources.push('package.json');
    if (scripts.lint)          gates.push({ name: 'lint',      when: 'always', command: 'npm run lint' });
    if (scripts['type-check']) gates.push({ name: 'typecheck', when: 'always', command: 'npm run type-check' });
    else if (scripts.tsc)      gates.push({ name: 'typecheck', when: 'always', command: 'npm run tsc' });
    if (scripts.test)          gates.push({ name: 'test',      when: 'always', command: 'npm test' });
    if (scripts.build)         gates.push({ name: 'build',     when: 'always', command: 'npm run build' });
  }

  if (has('pyproject.toml') || has('setup.py')) {
    sources.push(has('pyproject.toml') ? 'pyproject.toml' : 'setup.py');
    gates.push({ name: 'lint', when: 'always', command: 'ruff check .' });
    gates.push({ name: 'test', when: 'always', command: 'pytest' });
  }

  if (has('Cargo.toml')) {
    sources.push('Cargo.toml');
    gates.push({ name: 'test',   when: 'always', command: 'cargo test' });
    gates.push({ name: 'clippy', when: 'always', command: 'cargo clippy -- -D warnings' });
  }

  if (has('go.mod')) {
    sources.push('go.mod');
    gates.push({ name: 'test', when: 'always', command: 'go test ./...' });
    gates.push({ name: 'vet',  when: 'always', command: 'go vet ./...' });
  }

  if (has('build.sbt')) {
    sources.push('build.sbt');
    gates.push({ name: 'test', when: 'always', command: 'sbt test' });
  }

  if (gates.length) {
    return {
      detected: true,
      label: sources.join(', '),
      gates,
    };
  }

  return {
    detected: false,
    label: null,
    gates: [
      { name: 'lint',  when: 'always', command: 'echo "TODO: configure lint gate"' },
      { name: 'test',  when: 'always', command: 'echo "TODO: configure test gate"' },
      { name: 'build', when: 'always', command: 'echo "TODO: configure build gate"' },
    ],
  };
}

// ---------- interactive init (TUI) ----------------------------------------
function makeAsk(rl) {
  return (label, def, step) => new Promise((res) => {
    const stepPfx = (step != null) ? gray(`[${step}]`) + ' ' : '  ';
    const defSufx = (def !== undefined && def !== '') ? ' ' + dim(`[${def}]`) : '';
    const prompt = `  ${stepPfx}${cyan(label)}${defSufx}${gray(' › ')}`;
    rl.question(prompt, (a) => res(((a || '').trim()) || (def || '')));
  });
}

async function askChoice(ask, label, opts, def, step) {
  const optStr = opts.map((o) => o === def ? bold(o) : o).join(dim('/'));
  for (;;) {
    const raw = (await ask(`${label} ${dim('(' + optStr + ')')}`, def, step)).toLowerCase().trim();
    if (opts.includes(raw)) return raw;
    console.log(`  ${yellow('!')} please choose one of: ${opts.join(', ')}`);
  }
}

async function askYN(ask, label, def, step) {
  const a = await ask(`${label} ${dim('(y/n)')}`, def ? 'y' : 'n', step);
  return a.toLowerCase().startsWith('y');
}

function idExampleFor(kind) {
  return { linear: 'ABC-123', github: '#123', local: 'TICKET-1' }[kind] || 'TICKET-1';
}

// The seven non-empty subsets of the three harnesses, for promptConfig's
// single-select "Harnesses" prompt (tasks.md 4.13) — this project's prompt
// infra (askChoice) is a single-pick-from-a-list, not a true multi-select.
const HARNESS_COMBOS = {
  'claude-code': ['claude-code'],
  codex: ['codex'],
  opencode: ['opencode'],
  'claude-code+codex': ['claude-code', 'codex'],
  'claude-code+opencode': ['claude-code', 'opencode'],
  'codex+opencode': ['codex', 'opencode'],
  all: ['claude-code', 'codex', 'opencode'],
};

function buildConfig(a) {
  const cfg = {
    harnesses: a.harnesses || ['claude-code', 'codex'],
    project: { name: a.name, baseBranch: a.baseBranch },
    ticketProvider: { kind: a.ticket, idExample: idExampleFor(a.ticket) },
    specProvider: a.spec === 'openspec'
      ? {
          kind: 'openspec',
          changeDir: 'openspec/changes/<CHANGE_NAME>',
          scaffoldCmd: 'openspec new change "<CHANGE_NAME>"',
          applyCmd: 'openspec instructions apply --change "<CHANGE_NAME>" --json',
          validateCmd: 'openspec validate --change "<CHANGE_NAME>"',
          archiveCmd: 'openspec archive "<CHANGE_NAME>" --yes'
        }
      : { kind: 'none', changeDir: 'spec/changes/<CHANGE_NAME>' },
    worktree: {
      base: '.concertino/worktrees',
      ports: { frontendBase: a.frontendBase, backendBase: a.backendBase },
      envFiles: [],
      hooks: []
    },
    gates: a.gates || [
      { name: 'lint',  when: 'always', command: 'echo "TODO: configure lint gate"' },
      { name: 'test',  when: 'always', command: 'echo "TODO: configure test gate"' },
      { name: 'build', when: 'always', command: 'echo "TODO: configure build gate"' },
    ],
    canonicalDocs: [],
    ui: a.hasUi
      ? { enabled: true, tool: 'playwright', triggers: ['src/**'], breakpoints: [1280, 768, 0] }
      : { enabled: false, tool: 'none' },
    budgets: { executionCycles: 3, skepticDesignRounds: 3, skepticFinalRounds: 2, debugAttempts: 2 },
    agentMerge: { enabled: !!a.agentMergeEnabled, mergeMethod: a.agentMergeMethod || 'squash' },
    commitTrailer: a.trailer,
  };
  if (a.hasUi) {
    cfg.devServers = {
      frontend: { cwd: '.', start: 'PORT=$DEV_PORT npm run dev', health: 'http://localhost:$DEV_PORT', timeoutSec: 60 }
    };
  }
  // The interactive prompt only asks for ONE Codex model id (there is no
  // per-role prompt at init time), so it is written as the `standard` tier
  // override, not a flat `models.codex` — `models` itself stays sparse
  // (omitted entirely here; withDefaults() fills modelTiers/speeds at sync
  // time) exactly like a project that never customizes models at all.
  if (a.codexModel && a.codexModel !== DEFAULT_MODEL_TIERS.codex.standard) {
    cfg.modelTiers = { codex: Object.assign({}, DEFAULT_MODEL_TIERS.codex, { standard: a.codexModel }) };
  }
  return cfg;
}

async function promptConfig(out) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = makeAsk(rl);
  let step = 0;
  const s = () => ++step;

  // Detect gates before prompting so we can show the result in context.
  const detection = detectGates(out);

  try {
    console.log(
      `  Configure Concertino for this project.\n` +
      `  Press ${dim('↵')} to accept ${dim('[defaults]')}. Edit ${dim('concertino.config.json')} afterward for advanced fields.\n`
    );

    section('Project');
    const name = await ask('Project name', path.basename(out), s());
    const baseBranch = await ask('Base branch', 'main', s());

    section('Integrations');
    const ticket      = await askChoice(ask, 'Ticket provider', ['linear', 'github', 'local'],        'github',       s());
    const spec        = await askChoice(ask, 'Spec provider',   ['openspec', 'none'],                 'openspec',     s());
    // A true multi-select isn't available in this line-based prompt, so the
    // three harnesses' seven non-empty subsets are enumerated as combo
    // choices instead (tasks.md 4.13) — 'claude-code' remains the default,
    // unchanged from before opencode existed.
    const harnessPick = await askChoice(ask, 'Harnesses', Object.keys(HARNESS_COMBOS), 'claude-code', s());
    const harnesses   = HARNESS_COMBOS[harnessPick];
    const codexModel  = harnesses.includes('codex')
      ? await ask('Codex model ID', 'codex-mini-latest', s())
      : null;

    section('Dev servers');
    console.log(dim('  DEV_PORT = frontendBase + ticketNumber — keeps parallel tickets collision-free.'));
    const frontendBase = parseInt(await ask('Frontend port base', '5173', s()), 10) || 5173;
    const backendBase  = parseInt(await ask('Backend port base',  '8080', s()), 10) || 8080;
    const hasUi  = await askYN(ask, 'Browser UI (enables Playwright)?', false, s());

    section('Extras');
    const trailer = await ask('Commit trailer', 'Co-Authored-By: Claude <noreply@anthropic.com>', s());
    const agentMergeEnabled = await askYN(ask, 'Agent-merge (let a verified run merge its own PR)?', false, s());
    const agentMergeMethod = agentMergeEnabled
      ? await askChoice(ask, 'Agent-merge method', ['squash', 'merge', 'rebase'], 'squash', s())
      : 'squash';

    // Summary
    section('Summary');
    const gateNames = detection.gates.map((g) => g.name).join(', ');
    const gateNote = detection.detected
      ? green('✓') + ' detected from ' + detection.label + ' → ' + gateNames
      : yellow('!') + ' no project files found — placeholder gates written';
    const rows = [
      ['Project',    `${bold(name)}  ${dim('@')}  ${baseBranch}`],
      ['Harnesses',  harnesses.join(', ') + (codexModel ? dim('  model: ' + codexModel) : '')],
      ['Tickets',    ticket],
      ['Spec',       spec],
      ['Ports',    `frontend ${frontendBase}+N  ·  backend ${backendBase}+N`],
      ['UI',       hasUi ? 'playwright' : 'none'],
      ['Gates',    gateNote],
      ['Trailer',  dim(trailer || '(none)')],
      ['Agent-merge', agentMergeEnabled ? green('enabled') + dim('  (' + agentMergeMethod + ')') : dim('disabled')],
    ];
    for (const [k, v] of rows) {
      console.log(`  ${gray(k.padEnd(10))}  ${v}`);
    }

    section('What to customize next');
    const gatesLine = detection.detected
      ? '  gates           — verify the auto-detected commands match your project'
      : '  gates           — replace placeholder commands with your actual lint/test/build';
    console.log(dim(
      gatesLine + '\n' +
      '  canonicalDocs   — add your standards docs (CONTRIBUTING.md, DESIGN.md, etc.)\n' +
      '  devServers      — fill in start commands + health URLs if using dev servers\n' +
      '  worktree.hooks  — post-checkout commands (npm ci, husky install, etc.)\n' +
      '  speeds          — retune fast/default/slow budgets + per-role model tiers (models.<harness>.<role> pins a role regardless of speed)\n' +
      '  agentMerge      — override enabled/mergeMethod per project, or per-run with --agent-merge'
    ));
    console.log('');

    return buildConfig({ name, baseBranch, ticket, spec, harnesses, codexModel, frontendBase, backendBase, hasUi, trailer, gates: detection.gates, agentMergeEnabled, agentMergeMethod });
  } finally {
    rl.close();
  }
}

// ---------- provider scaffolding -----------------------------------------
function setupOpenspec(out) {
  console.log('\n  Setting up OpenSpec…');
  try {
    execSync('npm install --save-dev openspec', { cwd: out, stdio: 'inherit' });
  } catch (e) {
    console.log(`  ${yellow('!')} could not npm-install openspec (${e.message}). Install it yourself: npm i -D openspec`);
    return;
  }
  try {
    execSync('npx --no-install openspec init', { cwd: out, stdio: 'inherit' });
    console.log('  OpenSpec initialized.');
  } catch (e) {
    console.log(`  ${yellow('!')} \`openspec init\` failed (${e.message}). Run it manually when ready.`);
  }
}
function setupNoneSpecDir(out) {
  for (const d of ['spec/changes', 'spec/archive']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const keep = path.join(out, 'spec', 'archive', '.gitkeep');
  if (!exists(keep)) fs.writeFileSync(keep, '');
  console.log('  created spec/ (changes/ + archive/) at the repo root.');
}

function writeConfigFromExample(out, example, cfgPath) {
  copy(path.join(REPO, 'config', 'examples', example + '.json'), cfgPath, false);
  const obj = JSON.parse(read(cfgPath)); delete obj['$schema'];
  fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + '\n');
  return obj;
}

async function cmdInit(args) {
  if (hasHelpFlag(args)) { printUsage('init'); return; }
  const out = path.resolve(args.out || '.');
  const cfgPath = path.join(out, 'concertino.config.json');
  console.log(banner());
  console.log('concertino init → ' + out + '\n');

  let cfg, interactive = false;
  if (exists(cfgPath)) {
    console.log('  concertino.config.json already exists — keeping it.');
    cfg = JSON.parse(read(cfgPath));
  } else if (args.example) {
    cfg = writeConfigFromExample(out, args.example, cfgPath);
    console.log('  ' + green('wrote') + ' ' + cfgPath + dim('  (from example: ' + args.example + ')'));
  } else if (args.yes || !process.stdin.isTTY) {
    cfg = writeConfigFromExample(out, 'generic', cfgPath);
    // Apply gate detection on top of the generic example.
    const detection = detectGates(out);
    cfg.gates = detection.gates;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    if (detection.detected) {
      console.log('  ' + green('detected') + ' ' + detection.label + ' — configured gates: ' + detection.gates.map((g) => g.name).join(', '));
    }
    console.log('  ' + green('wrote') + ' ' + cfgPath + dim('  (generic defaults — non-interactive)'));
  } else {
    interactive = true;
    cfg = await promptConfig(out);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log('  ' + green('✓') + ' wrote ' + cfgPath);
  }

  // Resolve the core exactly once and reuse it for both the direct
  // copyAssets() call below and the internal cmdSync(...) call at the end —
  // a second, independent resolveCore() call inside cmdSync would let
  // `--core` (or auto-detection) disagree with itself within one `init`
  // invocation. See design.md Decision 6 / tasks.md 1.4.
  const core = resolveCore(REPO, out, args.core);
  copyAssets(out, core, false, true);
  const full = withDefaults(JSON.parse(JSON.stringify(cfg)));
  write(path.join(out, 'scripts', 'concertino', '.concertino.env'), renderEnv(full), false);

  if (!args['no-spec-setup']) {
    if (full.specProvider.kind === 'openspec' && (args['openspec-init'] || (interactive && await confirmOpenspecInit()))) {
      setupOpenspec(out);
    } else if (full.specProvider.kind === 'none') {
      setupNoneSpecDir(out);
    }
  }

  // Auto-sync so agent files are ready immediately.
  console.log('\n' + gray('  ─── Generating agent files ' + '─'.repeat(16)));
  await cmdSync({ _: ['sync'], config: cfgPath, out }, core);

  console.log('\n  ' + bold('Ready.') + ' Edit ' + cyan('concertino.config.json') + ' to tune gates/models/devServers, then ' + cyan('concertino sync') + ' to re-render.');
  console.log('  Start a delivery: Claude Code → ' + cyan('/concertino-deliver <TICKET_ID>'));
}

async function confirmOpenspecInit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = makeAsk(rl);
  try { return await askYN(ask, '\n  Install OpenSpec (npm i -D openspec) and run `openspec init` now?', true); }
  finally { rl.close(); }
}

module.exports = { cmdInit };
