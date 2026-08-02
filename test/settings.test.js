'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  renderSettings, handleKey, buildFieldMeta, fieldsForSection, currentValue, formatValue,
} = require('../lib/ui/screens/settings');
const configLib = require('../lib/config');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const schema = configLib.loadSchema();
const HELIO_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'examples', 'helio.json'), 'utf8'),
);

function settingsState(over) {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  const sections = configLib.schemaSectionOrder(schema);
  return Object.assign({
    cfgPath: '/tmp/concertino.config.json',
    raw: HELIO_CONFIG,
    candidate: JSON.parse(JSON.stringify(HELIO_CONFIG)),
    schema,
    fieldMeta,
    sections,
    sectionIndex: 0,
    fieldIndex: 0,
    focus: 'sections',
    prompt: null,
    saveError: null,
  }, over);
}

// --- buildFieldMeta / flattenSchema reuse -----------------------------------
// design.md Decision 3, skeptic round 1 change request 1: models.*/
// modelTiers.*/devServers.* are all behind a $ref and speeds has no static
// property names at all — a naive walk produces zero leaf fields for any of
// these. Regression-guards that gap directly through the screen's own
// buildFieldMeta, not just lib/config.js's flattenSchema.

test('buildFieldMeta resolves $ref-behind sections (models/modelTiers/devServers) to real leaf fields', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  assert.ok(fieldMeta.has('models.claude-code.orchestrator'), 'models.claude-code.* must not be empty');
  assert.ok(fieldMeta.has('modelTiers.codex.standard'), 'modelTiers.codex.* must not be empty');
  assert.ok(fieldMeta.has('devServers.backend.start'), 'devServers.backend.* must not be empty');
});

test('buildFieldMeta enumerates speeds from the config instance, not the schema', () => {
  const withSpeeds = Object.assign({}, HELIO_CONFIG, { speeds: { fast: { roleTiers: {} } } });
  const fieldMeta = buildFieldMeta(schema, withSpeeds);
  assert.ok(fieldMeta.has('speeds.fast.roleTiers.orchestrator'));
  assert.ok(!fieldMeta.has('speeds.default.roleTiers.orchestrator'), 'only the names actually present in the config instance should appear');
});

test('buildFieldMeta synthesizes a single "default" speed when speeds is absent entirely', () => {
  const noSpeeds = Object.assign({}, HELIO_CONFIG);
  delete noSpeeds.speeds;
  const fieldMeta = buildFieldMeta(schema, noSpeeds);
  assert.ok(fieldMeta.has('speeds.default.roleTiers.orchestrator'));
});

// --- editability rules -------------------------------------------------------
// spec.md: "Scalar and enum leaf fields are editable in place ... nested
// under project, worktree.ports, ui, dashboard, budgets, agentMerge,
// commitTrailer, per-role entries of models/modelTiers, and speeds."
// Array-of-object/object-collection fields (harnesses, gates, canonicalDocs,
// devServers) are read-only.

test('project/dashboard/budgets/agentMerge/commitTrailer leaf fields are editable', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  assert.equal(fieldMeta.get('project.name').editable, true);
  assert.equal(fieldMeta.get('dashboard.maxConcurrent').editable, true);
  assert.equal(fieldMeta.get('budgets.executionCycles').editable, true);
  assert.equal(fieldMeta.get('agentMerge.enabled').editable, true);
  assert.equal(fieldMeta.get('commitTrailer').editable, true);
  assert.equal(fieldMeta.get('models.claude-code.orchestrator').editable, true);
});

test('worktree.ports.* is editable but the rest of worktree is not', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  assert.equal(fieldMeta.get('worktree.ports.frontendBase').editable, true);
  assert.equal(fieldMeta.get('worktree.base').editable, false);
  assert.equal(fieldMeta.get('worktree.envFiles').editable, false);
});

test('harnesses/gates/canonicalDocs/devServers are read-only', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  assert.equal(fieldMeta.get('harnesses').editable, false);
  assert.equal(fieldMeta.get('gates').editable, false);
  assert.equal(fieldMeta.get('canonicalDocs').editable, false);
  assert.equal(fieldMeta.get('devServers.backend.start').editable, false);
});

test('ticketProvider/specProvider leaf fields are read-only even though they are plain scalars', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  assert.equal(fieldMeta.get('ticketProvider.kind').editable, false);
  assert.equal(fieldMeta.get('specProvider.kind').editable, false);
});

// --- current-value resolution ------------------------------------------------

test('an explicitly-set field is not flagged as defaulted', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  const entry = fieldMeta.get('project.name');
  const { value, isDefaulted } = currentValue(HELIO_CONFIG, entry);
  assert.equal(value, HELIO_CONFIG.project.name);
  assert.equal(isDefaulted, false);
});

test('an unset field with a schema default shows that default, flagged as defaulted', () => {
  const cfg = { project: { name: 'x' } };
  const fieldMeta = buildFieldMeta(schema, cfg);
  const entry = fieldMeta.get('project.baseBranch');
  const { value, isDefaulted } = currentValue(cfg, entry);
  assert.equal(value, 'main');
  assert.equal(isDefaulted, true);
});

test('formatValue renders arrays of scalars, objects, and array-of-object counts distinctly', () => {
  assert.equal(formatValue(['claude-code', 'codex']), 'claude-code, codex');
  assert.equal(formatValue([{ name: 'test' }, { name: 'build' }]), '2 items');
  assert.equal(formatValue(true), 'true');
  assert.equal(formatValue(3), '3');
});

// --- render -------------------------------------------------------------

test('renderSettings shows a description, current value, and type/enum for a representative field in every section', () => {
  const fieldMeta = buildFieldMeta(schema, HELIO_CONFIG);
  const sections = configLib.schemaSectionOrder(schema);
  for (const section of sections) {
    const fields = fieldsForSection(fieldMeta, section);
    assert.ok(fields.length > 0, `${section} should have at least one leaf field`);
    const state = settingsState({ sectionIndex: sections.indexOf(section), fieldIndex: 0, focus: 'fields' });
    const out = plain(renderSettings(state, { cols: 100 }));
    assert.match(out, new RegExp(section.toUpperCase()));
  }
});

test('an enum field shows its allowed values', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('ui'), focus: 'fields' });
  const fieldMeta = state.fieldMeta;
  const fields = fieldsForSection(fieldMeta, 'ui');
  const toolIndex = fields.findIndex((e) => e.path === 'ui.tool');
  state.fieldIndex = toolIndex;
  const out = plain(renderSettings(state, { cols: 100 }));
  assert.match(out, /playwright\|none/);
});

test('an unset field visibly shows "(default)"', () => {
  const cfg = { project: { name: 'x' } };
  const fieldMeta = buildFieldMeta(schema, cfg);
  const state = settingsState({
    raw: cfg, candidate: cfg, fieldMeta,
    sectionIndex: configLib.schemaSectionOrder(schema).indexOf('project'), focus: 'fields',
  });
  const out = plain(renderSettings(state, { cols: 100 }));
  assert.match(out, /\(default\)/);
});

test('a read-only field is hinted with the concertino update / hand-edit escape hatch', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('gates'), focus: 'fields' });
  const out = plain(renderSettings(state, { cols: 100 }));
  assert.match(out, /read-only/);
  assert.match(out, /concertino update/);
});

test('the footer always shows both esc discard and S save', () => {
  const out = plain(renderSettings(settingsState({}), { cols: 100 }));
  assert.match(out, /esc discard/);
  assert.match(out, /S save/);
});

// --- handleKey ------------------------------------------------------------

test('Enter on a boolean field toggles it (settings-toggle-field), not a text prompt', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('agentMerge'), focus: 'fields', fieldIndex: 0 });
  const action = handleKey('\r', { settings: state });
  assert.deepEqual(action, { type: 'settings-toggle-field', path: 'agentMerge.enabled' });
});

test('Enter on an enum field cycles it (settings-cycle-field)', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('agentMerge'), focus: 'fields' });
  const fields = fieldsForSection(state.fieldMeta, 'agentMerge');
  state.fieldIndex = fields.findIndex((e) => e.path === 'agentMerge.mergeMethod');
  const action = handleKey('\r', { settings: state });
  assert.deepEqual(action, { type: 'settings-cycle-field', path: 'agentMerge.mergeMethod' });
});

test('Enter on a free-text field opens a seeded prompt (settings-open-field-prompt)', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('project'), focus: 'fields', fieldIndex: 0 });
  const action = handleKey('\r', { settings: state });
  assert.deepEqual(action, { type: 'settings-open-field-prompt', path: 'project.name' });
});

test('Enter on a read-only field is a no-op', () => {
  const sections = configLib.schemaSectionOrder(schema);
  const state = settingsState({ sectionIndex: sections.indexOf('gates'), focus: 'fields', fieldIndex: 0 });
  assert.equal(handleKey('\r', { settings: state }), null);
});

test('Escape with no prompt open discards and returns to the fleet', () => {
  const state = settingsState({});
  assert.deepEqual(handleKey('\x1b', { settings: state }), { type: 'back' });
});

test('Escape while a field prompt is open only cancels the field edit', () => {
  const state = settingsState({ prompt: { path: 'project.name', value: 'x', error: null } });
  assert.deepEqual(handleKey('\x1b', { settings: state }), { type: 'settings-cancel-prompt' });
});

test('typing and Enter inside a field prompt produce prompt-type/commit actions', () => {
  const state = settingsState({ prompt: { path: 'project.name', value: 'my', error: null } });
  assert.deepEqual(handleKey('x', { settings: state }), { type: 'settings-prompt-type', char: 'x' });
  assert.deepEqual(handleKey('\r', { settings: state }), { type: 'settings-commit-prompt' });
  assert.deepEqual(handleKey('\x7f', { settings: state }), { type: 'settings-prompt-backspace' });
});

test('S triggers save (only when no prompt is open)', () => {
  const state = settingsState({});
  assert.deepEqual(handleKey('S', { settings: state }), { type: 'settings-save' });
});

test('j/k move the section cursor while focus is sections; tab/l/Enter moves focus to fields', () => {
  const state = settingsState({ focus: 'sections' });
  assert.deepEqual(handleKey('j', { settings: state }), { type: 'settings-move-section', delta: 1 });
  assert.deepEqual(handleKey('k', { settings: state }), { type: 'settings-move-section', delta: -1 });
  assert.deepEqual(handleKey('\t', { settings: state }), { type: 'settings-focus-fields' });
});

test('j/k move the field cursor while focus is fields; h/tab moves focus back to sections', () => {
  const state = settingsState({ focus: 'fields' });
  assert.deepEqual(handleKey('j', { settings: state }), { type: 'settings-move-field', delta: 1 });
  assert.deepEqual(handleKey('h', { settings: state }), { type: 'settings-focus-sections' });
});
