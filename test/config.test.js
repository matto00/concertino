'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
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
    'speeds', 'agentMerge', 'commitTrailer',
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

// --- CON-62: VALID_HARNESSES / per-ticket harness override --------------

test('VALID_HARNESSES is the exact implemented-adapter set, in order', () => {
  assert.deepEqual(configLib.VALID_HARNESSES, ['claude-code', 'codex']);
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
