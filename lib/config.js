'use strict';

// Shared config-domain logic — the one place `bin/concertino` (the CLI) and
// `lib/ui/screens/settings.js` (the in-TUI settings screen, CON-57) both
// reach for reading/defaulting/validating `concertino.config.json` against
// `config/concertino.schema.json`, rather than each re-implementing it.
//
// Extracted from `bin/concertino` (design.md's Open Question, resolved in
// favour of a shared module): `bin/concertino` itself is a CLI entrypoint
// that runs its own top-level IIFE the instant it is loaded (no
// `module.exports`, no `require.main === module` guard — see its own bottom
// section), so it is not safe for `lib/ui/screens/settings.js` to
// `require()` directly. Everything here is a plain, side-effect-free (at
// require time) function/constant module instead — `bin/concertino` now
// requires THIS file, not the other way around.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(REPO, 'config', 'concertino.schema.json');

// ---------- ANSI colors ----------------------------------------------------
// A deliberate, verbatim duplicate of bin/concertino's own tiny color
// helpers (not a require of lib/ui/format.js, whose cyan/etc. dispatch to
// 256-colour codes when the terminal supports them) — collectConfigIssues'
// message text must stay byte-for-byte identical to what `cmdValidate`
// printed before this extraction (tasks.md 1.4), and that only holds if the
// exact same 3-bit escape codes are used to build it.
const TTY = !!process.stdout.isTTY;
const dim  = (s) => TTY ? `\x1b[2m${s}\x1b[22m` : s;
const cyan = (s) => TTY ? `\x1b[36m${s}\x1b[39m` : s;
const red  = (s) => TTY ? `\x1b[31m${s}\x1b[39m` : s;

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// ---------- constants (moved verbatim from bin/concertino) ----------------
const CODEX_MODEL_FALLBACK = 'codex-mini-latest'; // used only if config has no models.codex.<role> or modelTiers.codex.standard
const DEFAULT_MODEL_TIERS = {
  'claude-code': { cheap: 'haiku', standard: 'sonnet', capable: 'opus' },
  codex: { cheap: 'codex-mini-latest', standard: 'codex-mini-latest', capable: 'gpt-5.1-codex' },
  opencode: { cheap: 'anthropic/claude-haiku-4-5', standard: 'anthropic/claude-sonnet-4-5', capable: 'anthropic/claude-opus-4-1' },
};
const IMPLICIT_DEFAULT_SPEED = {
  budgets: {},
  roleTiers: { orchestrator: 'standard', executor: 'standard', evaluator: 'standard', skeptic: 'standard', auditor: 'standard' },
};
const ROLES = ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor'];
const HARNESSES = ['claude-code', 'codex', 'opencode'];
// resolveModel's last-resort fallback, keyed by harness — restructured off a
// map (design.md Decision 2 / tasks.md 2.4) so a fourth harness never
// silently inherits 'sonnet' the way a bare ternary would.
const FALLBACK_MODEL = {
  'claude-code': 'sonnet',
  codex: CODEX_MODEL_FALLBACK,
  opencode: DEFAULT_MODEL_TIERS.opencode.standard,
};

// ---------- config defaults (moved verbatim from bin/concertino) ----------
function withModelDefaults(c) {
  c.models = c.models || {};
  c.models['claude-code'] = c.models['claude-code'] || {};
  c.models.codex = c.models.codex || {};
  c.models.opencode = c.models.opencode || {};
  c.modelTiers = c.modelTiers || {};
  for (const h of HARNESSES) {
    c.modelTiers[h] = Object.assign({}, DEFAULT_MODEL_TIERS[h], c.modelTiers[h] || {});
  }
  c.speeds = c.speeds || {};
  if (!c.speeds.default) c.speeds.default = JSON.parse(JSON.stringify(IMPLICIT_DEFAULT_SPEED));
  return c;
}

function withDefaults(c) {
  c.harnesses = c.harnesses || ['claude-code', 'codex'];
  c.project.baseBranch = c.project.baseBranch || 'main';
  c.project.baseRemote = c.project.baseRemote || 'origin';
  c.ticketProvider.idExample = c.ticketProvider.idExample || 'TICKET-123';
  const sp = c.specProvider || (c.specProvider = { kind: 'none' });
  if (!sp.changeDir) sp.changeDir = sp.kind === 'openspec'
    ? 'openspec/changes/<CHANGE_NAME>' : 'spec/changes/<CHANGE_NAME>';
  c.worktree.base = c.worktree.base || '.concertino/worktrees';
  c.worktree.envFiles = c.worktree.envFiles || [];
  c.worktree.linkModules = c.worktree.linkModules || [];
  c.worktree.hooks = c.worktree.hooks || [];
  c.canonicalDocs = c.canonicalDocs || [];
  c.ui = c.ui || { enabled: false, tool: 'none' };
  c.budgets = Object.assign(
    { executionCycles: 3, skepticDesignRounds: 3, skepticFinalRounds: 2, debugAttempts: 2 },
    c.budgets || {}
  );
  withModelDefaults(c);
  // providers defaults to {} — a project with no providers key behaves
  // identically to today (design.md Decision 7 / tasks.md 2.3). Deliberately
  // does NOT synthesize a fake `ollama` block when absent: presence of
  // c.providers.ollama is itself the "opted in" signal every downstream
  // check (resolveModel, collectConfigIssues, the harness emitters) reads.
  c.providers = c.providers || {};
  c.agentMerge = Object.assign(
    { enabled: false, mergeMethod: 'squash' },
    c.agentMerge || {}
  );
  c.commitTrailer = c.commitTrailer || '';
  return c;
}

// Is this harness+role's model provided directly by Ollama? True iff the
// harness is listed in providers.ollama.harnesses, no explicit
// models.<harness>.<role> override is set (the same presence check
// resolveModel's own first line performs — design.md Decision 2's
// "role-level Ollama-routed" definition), AND the harness is NOT
// claude-code. claude-code is deliberately excluded here even when it
// legally appears in providers.ollama.harnesses: it never speaks to Ollama
// directly (design.md Decision 4) — an Anthropic-compatible gateway sits in
// between and is what remaps a hosted-looking model id to the local Ollama
// model, so claude-code's own `model:` frontmatter must stay an ordinary
// hosted alias/string, never an Ollama model id. Exported so render call
// sites (emitCodex/emitOpencode/cmdDiff/cmdEject) can independently decide
// whether to render provider wiring for a given role without resolveModel
// itself returning a second value.
function isOllamaRouted(c, harness, role) {
  if (harness === 'claude-code') return false;
  const explicit = c.models && c.models[harness] && c.models[harness][role];
  if (explicit) return false;
  const ollama = c.providers && c.providers.ollama;
  return !!(ollama && (ollama.harnesses || []).includes(harness));
}

function resolveModel(c, harness, role) {
  const explicit = c.models && c.models[harness] && c.models[harness][role];
  if (explicit) return explicit;
  // Provider-model-map fallback tier (design.md Decision 2) — deliberately
  // skipped for claude-code; see isOllamaRouted's comment above for why.
  if (isOllamaRouted(c, harness, role)) {
    const ollama = c.providers.ollama;
    if (ollama.models && ollama.models[role]) return ollama.models[role];
  }
  const defaultSpeed = (c.speeds && c.speeds.default) || IMPLICIT_DEFAULT_SPEED;
  const tier = (defaultSpeed.roleTiers && defaultSpeed.roleTiers[role]) || 'standard';
  const tiers = c.modelTiers && c.modelTiers[harness];
  if (tiers && tiers[tier]) return tiers[tier];
  return FALLBACK_MODEL[harness] || FALLBACK_MODEL['claude-code'];
}

function deepSet(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

// Read-only counterpart to deepSet — tolerant of missing intermediate
// objects (returns `undefined` rather than throwing), used by the settings
// screen's current-value resolver (design.md Decision 3) to read a raw,
// pre-withDefaults() config at an arbitrary dotted schema path.
function getAtPath(obj, dotKey) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function loadConfig(args, out) {
  const p = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
  if (!exists(p)) {
    console.error(red('error: ') + 'no config at ' + p + ' — run `concertino init` first.');
    process.exit(1);
  }
  return withDefaults(JSON.parse(read(p)));
}

// ---------- collectConfigIssues --------------------------------------------
// Extracted from `cmdValidate` (bin/concertino) — design.md Decision 2,
// tasks.md 1.1-1.4. A pure function of `cfg` (plus `opts.out`, the project
// root two of the pre-existing checks need to stat files against — see
// below): no console.log, no process.exit. Returns
// `{ errors: [{ path, message }], warnings: [{ path, message }] }`.
//
// `opts.emit` is optional: `{ section(title), ok(label, val), warn(msg),
// fail(msg) }`. When supplied (only `cmdValidate` supplies it), each of
// this function's checks ALSO calls straight through to it, in the exact
// same order cmdValidate's own inline checks used to run in — which is what
// keeps `concertino validate`'s printed output byte-identical to
// pre-refactor (tasks.md 1.4) while still letting this function run
// silently, as a pure validator, when `lib/ui/screens/settings.js` calls it
// against a candidate config before writing (design.md Decision 2/6).
//
// `opts.out` (default `process.cwd()`) is the project root — needed only by
// the two checks that stat real files on disk (worktree.envFiles,
// canonicalDocs paths). This is a deliberate, narrow extension of design.md's
// single-argument `collectConfigIssues(cfg)` sketch: those two checks
// already existed in `cmdValidate` before this ticket and read files
// relative to `out`/`args.out`, so dropping that parameter would silently
// disable them rather than truly "moving the existing checks verbatim".
//
// Two sections are newly added here (NOT present in `cmdValidate` before
// this ticket) — Budgets and Dashboard — closing the gap the skeptic's
// design-gate round 1 flagged: this ticket's free-text edit prompt
// (settings.js, Decision 5) is the first thing that ever lets an operator
// type an arbitrary, uncoerced string into `budgets.*`/`dashboard.*`, and
// without these checks that string would save to disk unvalidated.
function collectConfigIssues(cfg, opts) {
  const o = opts || {};
  const emit = o.emit || {};
  const out = o.out || process.cwd();

  const errors = [];
  const warnings = [];
  const sec  = (title)        => { if (emit.section) emit.section(title); };
  const ok   = (label, val)   => { if (emit.ok) emit.ok(label, val); };
  const warn = (p, msg)       => { warnings.push({ path: p, message: msg }); if (emit.warn) emit.warn(msg); };
  const fail = (p, msg)       => { errors.push({ path: p, message: msg }); if (emit.fail) emit.fail(msg); };

  // ── Structure ────────────────────────────────────────────────────────────
  // The section HEADER, the "no config at <path>" existence check, and the
  // "invalid JSON" parse check are `cmdValidate`'s own pre-checks (they run
  // before a `cfg` object even exists to pass in here) — see its own call
  // site. Only the "required fields present" check, below, is part of this
  // function.
  const REQUIRED = ['project', 'ticketProvider', 'specProvider', 'worktree', 'gates'];
  const missing = REQUIRED.filter((k) => cfg[k] == null);
  missing.length
    ? missing.forEach((k) => fail(k, `missing required field: ${cyan(k)}`))
    : ok('required fields', REQUIRED.join(', '));

  // ── Project ──────────────────────────────────────────────────────────────
  sec('Project');
  const p = cfg.project || {};
  p.name ? ok('name', p.name) : fail('project.name', 'project.name is required');
  ok('baseBranch', p.baseBranch || dim('(defaults to main)'));
  ok('baseRemote', p.baseRemote || dim('(defaults to origin)'));

  // ── Integrations ─────────────────────────────────────────────────────────
  sec('Integrations');
  const VALID_HARNESSES = ['claude-code', 'codex', 'opencode'];
  const harnesses = Array.isArray(cfg.harnesses) ? cfg.harnesses : [];
  const badHarnesses = harnesses.filter((h) => !VALID_HARNESSES.includes(h));
  if (!harnesses.length) fail('harnesses', 'harnesses must not be empty');
  else if (badHarnesses.length) fail('harnesses', `unknown harnesses: ${badHarnesses.join(', ')} (valid: ${VALID_HARNESSES.join(', ')})`);
  else ok('harnesses', harnesses.join(', '));

  if (harnesses.length === 1) {
    ok('harness telemetry', `static: ${harnesses[0]}`);
  } else if (harnesses.length > 1) {
    ok('harness telemetry', `runtime-detected (${harnesses.length} harnesses configured)`);
  }

  const tp = cfg.ticketProvider || {};
  ['linear', 'github', 'manual'].includes(tp.kind)
    ? ok('ticketProvider', tp.kind + (tp.idExample ? dim('  e.g. ' + tp.idExample) : ''))
    : fail('ticketProvider.kind', `ticketProvider.kind must be linear|github|manual (got: ${JSON.stringify(tp.kind)})`);
  if (cfg.dashboard && cfg.dashboard.launchPad && cfg.dashboard.launchPad.enabled === true && !tp.teamKey) {
    warn('ticketProvider.teamKey', 'ticketProvider.teamKey not set — dashboard.launchPad.enabled is true, so the launch pad will fall back ' +
      'to a guess derived from ticketProvider.idExample, which is a sample id, not a real team key');
  }

  const sp = cfg.specProvider || {};
  if (!['openspec', 'none'].includes(sp.kind)) {
    fail('specProvider.kind', `specProvider.kind must be openspec|none (got: ${JSON.stringify(sp.kind)})`);
  } else {
    ok('specProvider', sp.kind);
    if (sp.kind === 'openspec') {
      for (const k of ['scaffoldCmd', 'applyCmd', 'validateCmd', 'archiveCmd']) {
        if (!sp[k]) warn(`specProvider.${k}`, `specProvider.${k} not set — agents will fall back to prose instructions`);
      }
    }
  }

  // ── Worktree ─────────────────────────────────────────────────────────────
  sec('Worktree');
  const wt = cfg.worktree || {};
  const ports = wt.ports || {};
  (Number.isInteger(ports.frontendBase) && Number.isInteger(ports.backendBase))
    ? ok('ports', `frontend ${ports.frontendBase}+N  ·  backend ${ports.backendBase}+N`)
    : fail('worktree.ports', 'worktree.ports.frontendBase and backendBase must be integers');
  if (wt.envFiles && wt.envFiles.length) {
    const notFound = wt.envFiles.filter((f) => !exists(path.join(out, f)));
    notFound.length
      ? warn('worktree.envFiles', `envFiles not found: ${notFound.join(', ')} — worktree setup will warn at runtime`)
      : ok('envFiles', wt.envFiles.join(', '));
  }

  // ── Gates ────────────────────────────────────────────────────────────────
  sec('Gates');
  const gates = cfg.gates || [];
  if (!gates.length) {
    fail('gates', 'no gates configured — executor will skip all verification');
  } else {
    ok('count', `${gates.length} gate${gates.length !== 1 ? 's' : ''}: ` + gates.map((g) => g.name).join(', '));
    gates.forEach((g, i) => {
      if (!g.name || !g.when || !g.command) fail(`gates[${i}]`, `gate missing name/when/command: ${JSON.stringify(g)}`);
      else if (/^echo "TODO/.test(g.command)) warn(`gates[${i}]`, `gate ${cyan(g.name)}: placeholder — update gates in concertino.config.json`);
    });
  }

  // ── Models ───────────────────────────────────────────────────────────────
  sec('Models');
  const rawModels = cfg.models;
  const oldFlatKeys = (rawModels && typeof rawModels === 'object')
    ? Object.keys(rawModels).filter((k) => typeof rawModels[k] === 'string')
    : [];
  if (oldFlatKeys.length) {
    fail('models',
      `models is the pre-delivery-speed-presets flat shape (bare string value(s) for: ${oldFlatKeys.join(', ')}). ` +
      `models is now per-harness, per-role: models.orchestrator="sonnet" -> models["claude-code"].orchestrator="sonnet"; ` +
      `models.codex="codex-mini-latest" -> models.codex.<role>="codex-mini-latest" per role, or omit entirely to use ` +
      `modelTiers.codex.standard. See CHANGELOG for the full migration.`
    );
  } else {
    const c2 = withModelDefaults(JSON.parse(JSON.stringify(cfg)));
    const ALIASES = ['opus', 'sonnet', 'haiku'];
    for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
      const m = resolveModel(c2, 'claude-code', role);
      (ALIASES.includes(m) || /^claude-/.test(m))
        ? ok('claude-code.' + role, m)
        : warn(`models.claude-code.${role}`, `models["claude-code"].${role}: unrecognized alias "${m}" — check Claude Code docs for valid model aliases`);
    }
    if ((cfg.harnesses || []).includes('codex')) {
      for (const role of ['executor', 'evaluator', 'auditor']) {
        ok('codex.' + role, resolveModel(c2, 'codex', role));
      }
    }
    if ((cfg.harnesses || []).includes('opencode')) {
      for (const role of ['orchestrator', 'executor', 'evaluator', 'skeptic', 'auditor']) {
        ok('opencode.' + role, resolveModel(c2, 'opencode', role));
      }
    }
  }

  // ── UI & dev servers ─────────────────────────────────────────────────────
  sec('UI & dev servers');
  const ui = cfg.ui || {};
  if (ui.enabled) {
    ['playwright', 'none'].includes(ui.tool)
      ? ok('ui.tool', ui.tool)
      : fail('ui.tool', `ui.tool must be playwright|none (got: ${JSON.stringify(ui.tool)})`);
    (ui.triggers && ui.triggers.length)
      ? ok('ui.triggers', ui.triggers.join(', '))
      : warn('ui.triggers', 'ui.triggers is empty — UI review will never activate');
    const hasDev = cfg.devServers && (cfg.devServers.backend || cfg.devServers.frontend);
    if (!hasDev) warn('devServers', 'ui.enabled is true but no devServers configured — start-servers.sh will be a no-op');
  } else {
    ok('ui', dim('disabled') + '  (Phase 3 N/A for all tickets)');
  }
  const ds = cfg.devServers || {};
  for (const side of ['backend', 'frontend']) {
    const s = ds[side];
    if (s) {
      if (!s.start)  fail(`devServers.${side}.start`, `devServers.${side}.start is required`);
      if (!s.health) fail(`devServers.${side}.health`, `devServers.${side}.health is required`);
      if (s.start && s.health) ok(side, s.health);
    }
  }

  // ── Canonical docs ───────────────────────────────────────────────────────
  sec('Canonical docs');
  const docs = cfg.canonicalDocs || [];
  if (!docs.length) {
    ok('canonicalDocs', dim('none configured'));
  } else {
    docs.forEach((d, i) => {
      if (!d.path || !d.bindTo || !d.bindTo.length) {
        fail(`canonicalDocs[${i}]`, `canonicalDoc missing path or bindTo: ${JSON.stringify(d)}`);
      } else if (!exists(path.join(out, d.path))) {
        warn(`canonicalDocs[${i}].path`, `canonicalDocs "${d.path}" not found in project root — agents will fail to read it`);
      } else {
        ok(d.path, dim('→') + ' ' + d.bindTo.join(', '));
      }
    });
  }

  // ── Budgets (NEW — tasks.md 1.2, design.md Decision 2) ──────────────────
  // Every field here is `type: integer` with no schema `minimum` — so "is an
  // integer" (Number.isInteger) is the whole check; nothing below invents a
  // lower bound the schema itself does not declare.
  sec('Budgets');
  const budgets = cfg.budgets || {};
  const BUDGET_KEYS = ['executionCycles', 'skepticDesignRounds', 'skepticFinalRounds', 'debugAttempts'];
  const setBudgetKeys = BUDGET_KEYS.filter((k) => budgets[k] !== undefined);
  if (!setBudgetKeys.length) {
    ok('budgets', dim('unset — using schema defaults'));
  } else {
    for (const k of setBudgetKeys) {
      Number.isInteger(budgets[k])
        ? ok('budgets.' + k, budgets[k])
        : fail(`budgets.${k}`, `budgets.${k} must be an integer (got: ${JSON.stringify(budgets[k])})`);
    }
  }

  // ── Dashboard (NEW — tasks.md 1.3, design.md Decision 2) ────────────────
  // `maxConcurrent`/`escalationTimeoutMinutes`/`retentionDays` minimums
  // mirror config/concertino.schema.json's own `minimum` values exactly
  // (1/0/1 respectively, schema.json lines ~123-133) — not invented here.
  sec('Dashboard');
  const dash = cfg.dashboard || {};
  if (dash.tmuxSession !== undefined) {
    typeof dash.tmuxSession === 'string'
      ? ok('dashboard.tmuxSession', dash.tmuxSession)
      : fail('dashboard.tmuxSession', `dashboard.tmuxSession must be a string (got: ${JSON.stringify(dash.tmuxSession)})`);
  }
  if (dash.launchCommand !== undefined) {
    typeof dash.launchCommand === 'string'
      ? ok('dashboard.launchCommand', dash.launchCommand)
      : fail('dashboard.launchCommand', `dashboard.launchCommand must be a string (got: ${JSON.stringify(dash.launchCommand)})`);
  }
  const DASHBOARD_MINIMUMS = { maxConcurrent: 1, escalationTimeoutMinutes: 0, retentionDays: 1 };
  for (const k of Object.keys(DASHBOARD_MINIMUMS)) {
    if (dash[k] === undefined) continue;
    const min = DASHBOARD_MINIMUMS[k];
    (Number.isInteger(dash[k]) && dash[k] >= min)
      ? ok('dashboard.' + k, dash[k])
      : fail(`dashboard.${k}`, `dashboard.${k} must be an integer >= ${min} (got: ${JSON.stringify(dash[k])})`);
  }
  const lpConf = dash.launchPad || {};
  if (lpConf.enabled !== undefined) {
    typeof lpConf.enabled === 'boolean'
      ? ok('dashboard.launchPad.enabled', lpConf.enabled)
      : fail('dashboard.launchPad.enabled', `dashboard.launchPad.enabled must be a boolean (got: ${JSON.stringify(lpConf.enabled)})`);
  }
  if (lpConf.backlog !== undefined) {
    typeof lpConf.backlog === 'boolean'
      ? ok('dashboard.launchPad.backlog', lpConf.backlog)
      : fail('dashboard.launchPad.backlog', `dashboard.launchPad.backlog must be a boolean (got: ${JSON.stringify(lpConf.backlog)})`);
  }

  // ── Providers (NEW — design.md Decision 4, tasks.md 2.7) ────────────────
  // A no-op section when providers/providers.ollama is absent — every check
  // below is scoped inside the `if (ollama)` guard, so an unconfigured
  // project (or one with providers: {}, withDefaults()'s own default) prints
  // nothing new here and fails nothing new.
  sec('Providers');
  const ollama = cfg.providers && cfg.providers.ollama;
  if (!ollama) {
    ok('providers', dim('none configured'));
  } else {
    (typeof ollama.baseUrl === 'string' && ollama.baseUrl.length)
      ? ok('providers.ollama.baseUrl', ollama.baseUrl)
      : fail('providers.ollama.baseUrl', `providers.ollama.baseUrl must be a non-empty string (got: ${JSON.stringify(ollama.baseUrl)})`);

    const ollamaHarnesses = ollama.harnesses || [];
    const cfgHarnesses = Array.isArray(cfg.harnesses) ? cfg.harnesses : [];
    const unknownOllamaHarnesses = ollamaHarnesses.filter((h) => !cfgHarnesses.includes(h));
    if (unknownOllamaHarnesses.length) {
      fail('providers.ollama.harnesses',
        `providers.ollama.harnesses names harnesses not present in this project's own harnesses: ` +
        `${unknownOllamaHarnesses.join(', ')} (configured harnesses: ${cfgHarnesses.join(', ') || '(none)'})`);
    } else if (ollamaHarnesses.length) {
      ok('providers.ollama.harnesses', ollamaHarnesses.join(', '));
    } else {
      ok('providers.ollama.harnesses', dim('none — providers.ollama is configured but no harness routes through it'));
    }

    if (ollamaHarnesses.includes('claude-code') && !ollama.gateway) {
      fail('providers.ollama.gateway',
        'providers.ollama.harnesses includes "claude-code" but no providers.ollama.gateway ' +
        'is configured — Claude Code cannot connect to Ollama directly; configure an ' +
        'Anthropic-compatible gateway (e.g. LiteLLM) via providers.ollama.gateway.baseUrl.');
    } else if (ollama.gateway) {
      ok('providers.ollama.gateway', ollama.gateway.baseUrl || dim('(no baseUrl set)'));
    }

    if (ollama.apiKeyEnv) ok('providers.ollama.apiKeyEnv', ollama.apiKeyEnv);
  }

  return { errors, warnings };
}

// ---------- schema flattening (settings screen, design.md Decision 3) -----

function loadSchema() {
  return JSON.parse(read(SCHEMA_PATH));
}

function resolveRef(schema, ref) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref || '');
  if (!m) return {};
  return (schema.$defs && schema.$defs[m[1]]) || {};
}

// Walks one schema node, resolving a `$ref` (if present) before deciding
// whether to recurse (object with `properties`) or record a leaf. `path_` is
// the dotted path built up so far; `out` is the Map leaves are written into.
function flattenNode(node, schema, path_, out) {
  const resolved = node && node.$ref ? resolveRef(schema, node.$ref) : (node || {});
  if (resolved.type === 'object' && resolved.properties) {
    for (const key of Object.keys(resolved.properties)) {
      flattenNode(resolved.properties[key], schema, path_ ? path_ + '.' + key : key, out);
    }
    return;
  }
  out.set(path_, {
    description: resolved.description,
    type: resolved.type,
    enum: resolved.enum,
    default: resolved.default,
  });
}

// flattenSchema(schema, configInstance) -> Map<dottedPath, { description,
// type, enum, default }>. `configInstance` is only consulted for `speeds`,
// whose named presets exist solely in the config instance, not as static
// schema property names (design.md Decision 3 / tasks.md 2.1-2.2). Every
// other section resolves purely from `schema` itself, `$ref`s included.
function flattenSchema(schema, configInstance) {
  const out = new Map();
  const props = (schema && schema.properties) || {};
  for (const key of Object.keys(props)) {
    if (key === 'speeds') {
      const speedRef = props.speeds && props.speeds.additionalProperties;
      const names = Object.keys((configInstance && configInstance.speeds) || {});
      const speedNames = names.length ? names : ['default'];
      for (const name of speedNames) flattenNode(speedRef, schema, 'speeds.' + name, out);
      continue;
    }
    flattenNode(props[key], schema, key, out);
  }
  return out;
}

// The schema's own top-level key declaration order — the settings screen's
// section list order (tasks.md 3.1). `Object.keys` on a plain object
// literal parsed from JSON preserves source (insertion) order for string
// keys, so this is exactly the order `config/concertino.schema.json` itself
// declares them in.
function schemaSectionOrder(schema) {
  return Object.keys((schema && schema.properties) || {});
}

module.exports = {
  REPO, SCHEMA_PATH,
  DEFAULT_MODEL_TIERS, IMPLICIT_DEFAULT_SPEED, ROLES, HARNESSES, CODEX_MODEL_FALLBACK, FALLBACK_MODEL,
  withModelDefaults, withDefaults, resolveModel, isOllamaRouted,
  deepSet, coerce, getAtPath,
  loadConfig, collectConfigIssues,
  loadSchema, flattenSchema, schemaSectionOrder, resolveRef,
};
