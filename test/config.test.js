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
