'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const configLib = require('../lib/config');

// CON-57: lib/config.js is the shared extraction (design.md Decision 2/3)
// both `bin/concertino` (cmdValidate/cmdUpdate) and the settings screen
// reach for. These tests exercise collectConfigIssues/flattenSchema/
// withDefaults directly as a library, independent of the CLI's own stdout
// formatting (covered separately by test/validate.test.js's byte-identical-
// output checks).

function baseConfig(over) {
  return Object.assign(
    {
      harnesses: ['claude-code'],
      project: { name: 'fixture-project', baseBranch: 'main' },
      ticketProvider: { kind: 'linear', idExample: 'ABC-123' },
      specProvider: { kind: 'none' },
      worktree: { ports: { frontendBase: 5173, backendBase: 8080 } },
      gates: [{ name: 'test', when: 'always', command: 'true' }],
    },
    over,
  );
}

// --- collectConfigIssues is a pure function with no emit ------------------

test('collectConfigIssues with no emit produces no console output and no process.exit', () => {
  // If this threw or exited, the test process itself would abort — the
  // assertion is that it returns normally with a plain object.
  const result = configLib.collectConfigIssues(baseConfig({}), { out: __dirname });
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.errors.length, 0);
});

test('collectConfigIssues reports missing required fields by path', () => {
  const { errors } = configLib.collectConfigIssues({}, { out: __dirname });
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes('project'));
  assert.ok(paths.includes('ticketProvider'));
  assert.ok(paths.includes('specProvider'));
  assert.ok(paths.includes('worktree'));
  assert.ok(paths.includes('gates'));
});

// --- Budgets (tasks.md 1.2, skeptic round 1 change request 3) -------------

test('budgets.* left unset is not an error', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({}), { out: __dirname });
  assert.equal(errors.filter((e) => e.path.startsWith('budgets')).length, 0);
});

test('a non-numeric budgets.executionCycles is rejected', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ budgets: { executionCycles: 'abc' } }), { out: __dirname },
  );
  assert.ok(errors.some((e) => e.path === 'budgets.executionCycles'));
});

test('every budgets.* key rejects a non-integer value', () => {
  for (const key of ['executionCycles', 'skepticDesignRounds', 'skepticFinalRounds', 'debugAttempts']) {
    const { errors } = configLib.collectConfigIssues(
      baseConfig({ budgets: { [key]: 1.5 } }), { out: __dirname },
    );
    assert.ok(errors.some((e) => e.path === 'budgets.' + key), key + ' should reject a non-integer');
  }
});

test('an integer budgets.executionCycles is accepted', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ budgets: { executionCycles: 5 } }), { out: __dirname },
  );
  assert.equal(errors.filter((e) => e.path === 'budgets.executionCycles').length, 0);
});

// --- Dashboard (tasks.md 1.3, skeptic round 1 change request 3) -----------
// Minimums mirror config/concertino.schema.json exactly: maxConcurrent >= 1,
// escalationTimeoutMinutes >= 0, retentionDays >= 1.

test('dashboard.maxConcurrent below its schema minimum (1) is rejected', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { maxConcurrent: 0 } }), { out: __dirname },
  );
  assert.ok(errors.some((e) => e.path === 'dashboard.maxConcurrent'));
});

test('dashboard.retentionDays below its schema minimum (1) is rejected', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { retentionDays: 0 } }), { out: __dirname },
  );
  assert.ok(errors.some((e) => e.path === 'dashboard.retentionDays'));
});

test('dashboard.escalationTimeoutMinutes at its schema minimum (0) is accepted', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { escalationTimeoutMinutes: 0 } }), { out: __dirname },
  );
  assert.equal(errors.filter((e) => e.path === 'dashboard.escalationTimeoutMinutes').length, 0);
});

test('a non-string dashboard.tmuxSession is rejected', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { tmuxSession: 42 } }), { out: __dirname },
  );
  assert.ok(errors.some((e) => e.path === 'dashboard.tmuxSession'));
});

test('a non-boolean dashboard.launchPad.enabled is rejected', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { launchPad: { enabled: 'yes' } } }), { out: __dirname },
  );
  assert.ok(errors.some((e) => e.path === 'dashboard.launchPad.enabled'));
});

test('a below-minimum dashboard value keeps the config otherwise valid — only that one field fails', () => {
  const { errors } = configLib.collectConfigIssues(
    baseConfig({ dashboard: { maxConcurrent: -1 } }), { out: __dirname },
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'dashboard.maxConcurrent');
});

// --- flattenSchema / schemaSectionOrder -----------------------------------

test('schemaSectionOrder matches config/concertino.schema.json\'s own top-level declaration order', () => {
  const schema = configLib.loadSchema();
  const order = configLib.schemaSectionOrder(schema);
  assert.deepEqual(order, [
    'harnesses', 'project', 'ticketProvider', 'specProvider', 'worktree', 'devServers',
    'gates', 'canonicalDocs', 'ui', 'dashboard', 'budgets', 'models', 'modelTiers',
    'providers', 'speeds', 'agentMerge', 'commitTrailer',
  ]);
});

test('flattenSchema resolves $ref for models/modelTiers/devServers', () => {
  const schema = configLib.loadSchema();
  const flat = configLib.flattenSchema(schema, {});
  assert.ok(flat.has('models.claude-code.skeptic'));
  assert.ok(flat.has('modelTiers.claude-code.standard'));
  assert.ok(flat.has('devServers.frontend.health'));
});

test('flattenSchema carries description/type/enum/default through for a representative field', () => {
  const schema = configLib.loadSchema();
  const flat = configLib.flattenSchema(schema, {});
  const entry = flat.get('dashboard.maxConcurrent');
  assert.equal(entry.type, 'integer');
  assert.equal(entry.default, 2);
  assert.match(entry.description, /maxConcurrent/i);

  const enumEntry = flat.get('ui.tool');
  assert.deepEqual(enumEntry.enum, ['playwright', 'none']);
});

test('getAtPath reads a nested value and returns undefined for a missing path', () => {
  assert.equal(configLib.getAtPath({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(configLib.getAtPath({ a: {} }, 'a.b.c'), undefined);
  assert.equal(configLib.getAtPath({}, 'a.b'), undefined);
});

// --- CON-63: opencode harness + providers.ollama ---------------------------

test('opencode is accepted as a valid harness with no "unknown harnesses" error', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({ harnesses: ['opencode'] }), { out: __dirname });
  assert.equal(errors.filter((e) => e.path === 'harnesses').length, 0);
});

test('withDefaults leaves the default harnesses list unchanged (opencode not added)', () => {
  const c = configLib.withDefaults({
    project: { name: 'p' }, ticketProvider: { kind: 'github' }, specProvider: { kind: 'none' },
    worktree: { ports: { frontendBase: 1, backendBase: 2 } }, gates: [],
  });
  assert.deepEqual(c.harnesses, ['claude-code', 'codex']);
});

test('providers.ollama accepted with no errors attributable to the providers block', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['codex'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['codex'], models: { executor: 'llama3.1:70b' } } },
  }), { out: __dirname });
  assert.equal(errors.filter((e) => e.path.startsWith('providers.')).length, 0);
});

test('absent providers is a no-op: collectConfigIssues reports nothing for the Providers section', () => {
  const { errors, warnings } = configLib.collectConfigIssues(baseConfig({}), { out: __dirname });
  assert.equal(errors.filter((e) => e.path.startsWith('providers.')).length, 0);
  assert.equal(warnings.filter((w) => w.path.startsWith('providers.')).length, 0);
});

function ollamaBase(over) {
  const c = configLib.withDefaults({
    project: { name: 'p' }, ticketProvider: { kind: 'github' }, specProvider: { kind: 'none' },
    worktree: { ports: { frontendBase: 1, backendBase: 2 } }, gates: [],
    harnesses: ['codex'],
  });
  c.providers = { ollama: Object.assign({ baseUrl: 'http://localhost:11434', harnesses: ['codex'] }, over) };
  return c;
}

test('resolveModel: provider model map used when harness is Ollama-routed and no explicit override', () => {
  const c = ollamaBase({ models: { executor: 'llama3.1:70b' } });
  assert.equal(configLib.resolveModel(c, 'codex', 'executor'), 'llama3.1:70b');
});

test('resolveModel: explicit models.<harness>.<role> override wins over the provider model map', () => {
  const c = ollamaBase({ models: { executor: 'llama3.1:70b' } });
  c.models.codex.executor = 'codex-mini-latest';
  assert.equal(configLib.resolveModel(c, 'codex', 'executor'), 'codex-mini-latest');
});

test('resolveModel: claude-code is NOT routed through the provider model map on the gateway route', () => {
  const c = ollamaBase({ harnesses: ['claude-code'], models: { executor: 'llama3.1:70b' }, gateway: { baseUrl: 'http://gw' } });
  const model = configLib.resolveModel(c, 'claude-code', 'executor');
  assert.notEqual(model, 'llama3.1:70b');
  assert.equal(model, 'sonnet');
});

test('resolveModel: claude-code IS routed through the provider model map on the direct route (CON-75, no gateway configured)', () => {
  const c = ollamaBase({ harnesses: ['claude-code'], models: { executor: 'qwen3:8b' } });
  assert.equal(configLib.resolveModel(c, 'claude-code', 'executor'), 'qwen3:8b');
});

test('resolveModel: a fourth/unknown harness falls back to FALLBACK_MODEL[\'claude-code\'], never a bare ternary default', () => {
  const c = configLib.withDefaults({
    project: { name: 'p' }, ticketProvider: { kind: 'github' }, specProvider: { kind: 'none' },
    worktree: { ports: { frontendBase: 1, backendBase: 2 } }, gates: [],
  });
  assert.equal(configLib.resolveModel(c, 'some-future-harness', 'executor'), configLib.FALLBACK_MODEL['claude-code']);
});

test('isOllamaRouted: true only when harness is in providers.ollama.harnesses and no explicit override', () => {
  const c = ollamaBase({});
  assert.equal(configLib.isOllamaRouted(c, 'codex', 'executor'), true);
  c.models.codex.executor = 'gpt-5.1-codex';
  assert.equal(configLib.isOllamaRouted(c, 'codex', 'executor'), false);
});

// --- CON-75: claude-code direct route (no gateway) ---------------------

test('isOllamaRouted: claude-code IS routed on the direct route (no gateway configured)', () => {
  const c = ollamaBase({ harnesses: ['claude-code'] });
  assert.equal(configLib.isOllamaRouted(c, 'claude-code', 'executor'), true);
});

test('isOllamaRouted: claude-code is excluded on the gateway route', () => {
  const c = ollamaBase({ harnesses: ['claude-code'], gateway: { baseUrl: 'http://gw' } });
  assert.equal(configLib.isOllamaRouted(c, 'claude-code', 'executor'), false);
});

test('isOllamaRouted: claude-code with an explicit override is excluded on either route', () => {
  const direct = ollamaBase({ harnesses: ['claude-code'] });
  direct.models['claude-code'].executor = 'sonnet';
  assert.equal(configLib.isOllamaRouted(direct, 'claude-code', 'executor'), false);

  const gateway = ollamaBase({ harnesses: ['claude-code'], gateway: { baseUrl: 'http://gw' } });
  gateway.models['claude-code'].executor = 'sonnet';
  assert.equal(configLib.isOllamaRouted(gateway, 'claude-code', 'executor'), false);
});

test('isOllamaRouted: non-claude-code harnesses are unaffected by the gateway key', () => {
  const c = ollamaBase({ harnesses: ['codex'], gateway: { baseUrl: 'http://gw' } });
  assert.equal(configLib.isOllamaRouted(c, 'codex', 'executor'), true);
});

// Regression: the Models section's alias check pre-dates CON-75 and assumed
// claude-code ALWAYS resolves to a hosted alias (opus/sonnet/haiku or a
// claude-* string) — true unconditionally back when isOllamaRouted excluded
// claude-code entirely. On the direct route resolveModel can now legitimately
// return a real Ollama model id (e.g. "qwen3:8b"), which must not be flagged
// as an "unrecognized alias".
test('validation: a real Ollama model id for claude-code on the direct route is not warned as an unrecognized alias', () => {
  const { warnings } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434',
        harnesses: ['claude-code'],
        models: { orchestrator: 'qwen3:8b', executor: 'qwen3:8b', evaluator: 'qwen3:8b', skeptic: 'qwen3:8b', auditor: 'qwen3:8b' },
      },
    },
  }), { out: __dirname });
  assert.equal(warnings.filter((w) => w.path.startsWith('models.claude-code')).length, 0);
});

test('validation: a genuinely bad claude-code model still warns on the gateway route (baseline unchanged)', () => {
  const { warnings } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    models: { 'claude-code': { executor: 'not-a-real-alias' } },
  }), { out: __dirname });
  assert.ok(warnings.some((w) => w.path === 'models.claude-code.executor'));
});

test('validation passes on the direct route: claude-code + baseUrl + no gateway (CON-75)', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['claude-code'] } },
  }), { out: __dirname });
  assert.equal(errors.filter((e) => e.path.startsWith('providers.ollama.gateway')).length, 0);
});

test('validation fails when providers.ollama.gateway is configured but incomplete (no baseUrl)', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['claude-code'], gateway: {} } },
  }), { out: __dirname });
  const err = errors.find((e) => e.path === 'providers.ollama.gateway.baseUrl');
  assert.ok(err, 'expected an error at providers.ollama.gateway.baseUrl');
});

test('validation passes with a complete gateway configured (unchanged)', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['claude-code'], gateway: { baseUrl: 'http://localhost:4000' } } },
  }), { out: __dirname });
  assert.equal(errors.filter((e) => e.path.startsWith('providers.ollama.gateway')).length, 0);
});

test('providers.ollama.harnesses naming a harness this project has not configured is rejected', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['claude-code'],
    providers: { ollama: { baseUrl: 'http://localhost:11434', harnesses: ['codex'] } },
  }), { out: __dirname });
  assert.ok(errors.some((e) => e.path === 'providers.ollama.harnesses'));
});

test('providers.ollama.baseUrl must be a non-empty string when providers.ollama is present', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({
    harnesses: ['codex'],
    providers: { ollama: { baseUrl: '', harnesses: ['codex'] } },
  }), { out: __dirname });
  assert.ok(errors.some((e) => e.path === 'providers.ollama.baseUrl'));
});

// --- CON-62: VALID_HARNESSES / per-ticket harness override --------------

test('VALID_HARNESSES is the exact implemented-adapter set, in order', () => {
  assert.deepEqual(configLib.VALID_HARNESSES, ['claude-code', 'codex', 'opencode']);
});

test('parseHarnessOverrideLabels: no matching label -> null', () => {
  assert.equal(configLib.parseHarnessOverrideLabels([]), null);
  assert.equal(configLib.parseHarnessOverrideLabels(['bug', 'p1']), null);
  assert.equal(configLib.parseHarnessOverrideLabels(undefined), null);
});

test('parseHarnessOverrideLabels: one matching label -> its value', () => {
  assert.deepEqual(configLib.parseHarnessOverrideLabels(['bug', 'harness:codex']), ['codex']);
});

test('parseHarnessOverrideLabels: more than one matching label -> every value (caller decides ambiguous)', () => {
  assert.deepEqual(
    configLib.parseHarnessOverrideLabels(['harness:codex', 'harness:claude-code']),
    ['codex', 'claude-code'],
  );
});

test('classifyHarnessOverride: no label -> no-override', () => {
  assert.deepEqual(configLib.classifyHarnessOverride([]), { kind: 'no-override' });
});

test('classifyHarnessOverride: implemented value -> valid', () => {
  assert.deepEqual(configLib.classifyHarnessOverride(['harness:codex']), { kind: 'valid', value: 'codex' });
});

test('classifyHarnessOverride: opencode (CON-63) is an implemented value -> valid', () => {
  // The new combination this merge creates: CON-62's per-ticket override
  // mechanism must recognize CON-63's third harness as implemented, not
  // just claude-code/codex.
  assert.deepEqual(configLib.classifyHarnessOverride(['harness:opencode']), { kind: 'valid', value: 'opencode' });
});

test('classifyHarnessOverride: unimplemented value -> invalid', () => {
  assert.deepEqual(
    configLib.classifyHarnessOverride(['harness:local-llm']),
    { kind: 'invalid', value: 'local-llm' },
  );
});

test('classifyHarnessOverride: two harness: labels -> ambiguous', () => {
  assert.deepEqual(
    configLib.classifyHarnessOverride(['harness:codex', 'harness:claude-code']),
    { kind: 'ambiguous', values: ['codex', 'claude-code'] },
  );
});

// --- CON-62: collectConfigIssues renders opts.ticketHarnessCheck ----------
// (design.md Decision 6 / tasks.md 4.4 option (a)) — the network fetch
// itself lives in bin/concertino (untestable here without mocking the
// network); these tests exercise the already-classified shape it hands in.

test('ticketHarnessCheck omitted -> no ticket-harness line, no new errors (tasks.md 4.5 no-op)', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({}), { out: __dirname });
  assert.equal(errors.filter((e) => e.path === 'ticket.harness').length, 0);
});

test('ticketHarnessCheck kind=no-override -> informational, no error', () => {
  const emitted = [];
  const { errors } = configLib.collectConfigIssues(baseConfig({}), {
    out: __dirname,
    ticketHarnessCheck: { ticketId: 'CON-1', kind: 'no-override' },
    emit: { ok: (label, val) => emitted.push([label, val]) },
  });
  assert.equal(errors.length, 0);
  assert.ok(emitted.some(([, val]) => /CON-1 has no harness override/.test(String(val))));
});

test('ticketHarnessCheck kind=valid -> informational, names ticket + value, no error', () => {
  const emitted = [];
  const { errors } = configLib.collectConfigIssues(baseConfig({}), {
    out: __dirname,
    ticketHarnessCheck: { ticketId: 'CON-1', kind: 'valid', value: 'codex' },
    emit: { ok: (label, val) => emitted.push([label, val]) },
  });
  assert.equal(errors.length, 0);
  assert.ok(emitted.some(([, val]) => /CON-1 declares harness:codex/.test(String(val))));
  assert.ok(emitted.some(([, val]) => /takes precedence/.test(String(val))));
});

test('ticketHarnessCheck kind=invalid -> validation error naming ticket + value', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({}), {
    out: __dirname,
    ticketHarnessCheck: { ticketId: 'CON-1', kind: 'invalid', value: 'local-llm' },
  });
  const e = errors.find((e) => e.path === 'ticket.harness');
  assert.ok(e, 'expected a ticket.harness error');
  assert.match(e.message, /CON-1/);
  assert.match(e.message, /local-llm/);
});

test('ticketHarnessCheck kind=ambiguous -> validation error naming every value', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({}), {
    out: __dirname,
    ticketHarnessCheck: { ticketId: 'CON-1', kind: 'ambiguous', values: ['codex', 'claude-code'] },
  });
  const e = errors.find((e) => e.path === 'ticket.harness');
  assert.ok(e, 'expected a ticket.harness error');
  assert.match(e.message, /CON-1/);
  assert.match(e.message, /codex/);
  assert.match(e.message, /claude-code/);
});

test('ticketHarnessCheck kind=unsupported-provider -> informational, no error', () => {
  const { errors } = configLib.collectConfigIssues(baseConfig({}), {
    out: __dirname,
    ticketHarnessCheck: { ticketId: 'CON-1', kind: 'unsupported-provider', providerKind: 'manual' },
  });
  assert.equal(errors.filter((e) => e.path === 'ticket.harness').length, 0);
});

// --- Agent-merge (CON-88 agent-merge-permission-preflight) -----------------
// collectConfigIssues' new "Agent-merge" section shells out to the real
// scripts/concertino/check-agent-merge-permission.sh against `opts.out` — a
// throwaway git repo with a real copy of the script is built per test
// (never this checkout's own .claude/), mirroring the isolation
// check-merge-readiness.test.sh already uses at the shell-test layer.
const REPO_SCRIPT = path.join(__dirname, '..', 'core', 'scripts', 'check-agent-merge-permission.sh');

function agentMergeProject({ settings, noScript } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-agentmerge-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  // `noScript`: the actual first-touch state for this whole feature — a
  // project that turned `agentMerge.enabled: true` on but has never run
  // `concertino sync` yet, so `scripts/concertino/` doesn't exist at all.
  // Every OTHER helper call below (and every pre-existing test in this
  // file) pre-copies the script first — this is deliberately the one path
  // that does not (skeptic-final-1.md Change Request 1: none of the
  // pre-fix tests exercised "the script itself is missing", only "the
  // script runs and reports FAIL").
  if (!noScript) {
    fs.mkdirSync(path.join(dir, 'scripts', 'concertino'), { recursive: true });
    fs.copyFileSync(REPO_SCRIPT, path.join(dir, 'scripts', 'concertino', 'check-agent-merge-permission.sh'));
    fs.chmodSync(path.join(dir, 'scripts', 'concertino', 'check-agent-merge-permission.sh'), 0o755);
  }
  if (settings !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  }
  return dir;
}

const BOTH_RULES_SETTINGS = { permissions: { allow: ['Bash(gh pr merge:*)', 'Task(concertino-auditor)'] } };
const ONE_RULE_SETTINGS = { permissions: { allow: ['Bash(gh pr merge:*)'] } };

test('agentMergePermissionRules returns the two required Claude Code allow rules', () => {
  assert.deepEqual(configLib.agentMergePermissionRules(), ['Bash(gh pr merge:*)', 'Task(concertino-auditor)']);
});

test('Agent-merge section: enabled + claude-code + grant present -> ok, no warning', () => {
  const dir = agentMergeProject({ settings: BOTH_RULES_SETTINGS });
  try {
    const emitted = { ok: [], warn: [] };
    const { errors, warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir, emit: { section: () => {}, ok: (l, v) => emitted.ok.push([l, v]), warn: (m) => emitted.warn.push(m) } },
    );
    assert.equal(errors.length, 0);
    assert.equal(warnings.filter((w) => w.path === 'agentMerge.permissions').length, 0);
    assert.ok(emitted.ok.some(([label]) => label === 'agentMerge.permissions'));
    assert.equal(emitted.warn.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: enabled + claude-code + grant missing one rule -> warning naming it', () => {
  const dir = agentMergeProject({ settings: ONE_RULE_SETTINGS });
  try {
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir },
    );
    const w = warnings.find((w) => w.path === 'agentMerge.permissions');
    assert.ok(w, 'expected an agentMerge.permissions warning');
    assert.match(w.message, /Task\(concertino-auditor\)/);
    assert.match(w.message, /concertino sync/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: enabled + claude-code + no settings.json -> warning', () => {
  const dir = agentMergeProject();
  try {
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir },
    );
    const w = warnings.find((w) => w.path === 'agentMerge.permissions');
    assert.ok(w, 'expected an agentMerge.permissions warning');
    assert.match(w.message, /no \.claude\/settings\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: disabled -> section entirely silent', () => {
  const dir = agentMergeProject();
  try {
    const emitted = { section: [] };
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: false, mergeMethod: 'squash' } }),
      { out: dir, emit: { section: (t) => emitted.section.push(t) } },
    );
    assert.equal(warnings.filter((w) => w.path === 'agentMerge.permissions').length, 0);
    assert.ok(!emitted.section.includes('Agent-merge'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: claude-code absent from harnesses -> section entirely silent', () => {
  const dir = agentMergeProject();
  try {
    const emitted = { section: [] };
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ harnesses: ['codex'], agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir, emit: { section: (t) => emitted.section.push(t) } },
    );
    assert.equal(warnings.filter((w) => w.path === 'agentMerge.permissions').length, 0);
    assert.ok(!emitted.section.includes('Agent-merge'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkAgentMergePermission returns null (not applicable) when agentMerge is disabled', () => {
  assert.equal(configLib.checkAgentMergePermission(baseConfig({ agentMerge: { enabled: false } }), __dirname), null);
});

test('checkAgentMergePermission returns null (not applicable) when claude-code is not configured', () => {
  assert.equal(
    configLib.checkAgentMergePermission(baseConfig({ harnesses: ['codex'], agentMerge: { enabled: true } }), __dirname),
    null,
  );
});

test('checkAgentMergePermission returns { ok: true } when the grant is present', () => {
  const dir = agentMergeProject({ settings: BOTH_RULES_SETTINGS });
  try {
    const result = configLib.checkAgentMergePermission(baseConfig({ agentMerge: { enabled: true } }), dir);
    assert.deepEqual(result, { ok: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- CON-88 skeptic-final-1.md Change Request 1 ----------------------------
// A project that turned agentMerge.enabled on but has never run
// `concertino sync` yet has no scripts/concertino/ at all — the check
// script itself is missing, not merely reporting FAIL. Before the fix,
// execFileSync's raw `spawnSync ... ENOENT` leaked into the reason text;
// the fix must return a clean, on-brand reason instead, naming what's
// missing (AC1's own wording) rather than an internal path/errno.

test('checkAgentMergePermission: the check script itself missing (never synced) returns a clean reason, not a raw ENOENT', () => {
  const dir = agentMergeProject({ noScript: true });
  try {
    const result = configLib.checkAgentMergePermission(baseConfig({ agentMerge: { enabled: true } }), dir);
    assert.equal(result.ok, false);
    assert.match(result.reason, /check-agent-merge-permission\.sh not found/);
    assert.doesNotMatch(result.reason, /ENOENT/);
    assert.doesNotMatch(result.reason, /spawnSync/);
    // The raw reason deliberately does NOT carry its own "run `concertino
    // sync`" clause any more (skeptic-final-2.md Change Request 2) — that's
    // withAgentMergeFixHint's job, exercised below and in the
    // "Agent-merge section" test, so it's said exactly once at render time.
    assert.doesNotMatch(result.reason, /concertino sync/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: the check script itself missing (never synced) warns cleanly, not with a raw ENOENT', () => {
  const dir = agentMergeProject({ noScript: true });
  try {
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir },
    );
    const w = warnings.find((w) => w.path === 'agentMerge.permissions');
    assert.ok(w, 'expected an agentMerge.permissions warning');
    assert.match(w.message, /check-agent-merge-permission\.sh not found/);
    assert.doesNotMatch(w.message, /ENOENT/);
    assert.doesNotMatch(w.message, /spawnSync/);
    // The rendered message carries exactly one "run `concertino sync`"
    // instruction, not zero and not two.
    const hits = (w.message.match(/concertino sync/g) || []).length;
    assert.equal(hits, 1, `expected exactly one "concertino sync" mention, got ${hits}: ${w.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- CON-88 skeptic-final-2.md Change Request 2 -----------------------------
// withAgentMergeFixHint must never double the "run `concertino sync`"
// instruction when the underlying reason already carries one of its own
// (e.g. the shell script's own "no .claude/settings.json found" message, if
// it or a future message ever embeds that phrase again).

test('withAgentMergeFixHint appends the instruction once when reason has none', () => {
  const msg = configLib.withAgentMergeFixHint('missing permission rule: Bash(gh pr merge:*)');
  const hits = (msg.match(/concertino sync/g) || []).length;
  assert.equal(hits, 1);
});

test('withAgentMergeFixHint does not double the instruction when reason already has one', () => {
  const msg = configLib.withAgentMergeFixHint('no .claude/settings.json found — run `concertino sync`');
  const hits = (msg.match(/concertino sync/g) || []).length;
  assert.equal(hits, 1);
});

// --- CON-88 skeptic-final-2.md Change Request 1 -----------------------------
// Both required permission rules missing at once (an empty/irrelevant
// permissions.allow) is at least as likely a first-touch scenario as either
// state the round-1 regression tests cover — the check script writes one
// "FAIL <msg>" line per missing rule, and the fix must collapse that into a
// single-line reason before it ever reaches a single-line warn() renderer.

test('checkAgentMergePermission: both rules missing collapses the two-line stderr into one clean, single-line reason', () => {
  const dir = agentMergeProject({ settings: { permissions: { allow: [] } } });
  try {
    const result = configLib.checkAgentMergePermission(baseConfig({ agentMerge: { enabled: true } }), dir);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason, /\n/, 'reason must not contain an embedded newline');
    assert.doesNotMatch(result.reason, /^FAIL /, 'reason must not carry a leading FAIL token');
    assert.match(result.reason, /Bash\(gh pr merge:\*\)/);
    assert.match(result.reason, /Task\(concertino-auditor\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Agent-merge section: both rules missing renders as one coherent single-line warning', () => {
  const dir = agentMergeProject({ settings: { permissions: { allow: [] } } });
  try {
    const { warnings } = configLib.collectConfigIssues(
      baseConfig({ agentMerge: { enabled: true, mergeMethod: 'squash' } }),
      { out: dir },
    );
    const w = warnings.find((w) => w.path === 'agentMerge.permissions');
    assert.ok(w, 'expected an agentMerge.permissions warning');
    assert.doesNotMatch(w.message, /\n/, 'rendered warning must not contain an embedded newline');
    assert.doesNotMatch(w.message, /^FAIL /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
