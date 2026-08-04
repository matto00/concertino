'use strict';

// The settings screen (CON-57): browse and edit every field in
// `concertino.config.json`, grouped by `config/concertino.schema.json`'s own
// top-level keys, with per-field description/current-value/type shown, and
// staged edits validated against the schema (via lib/config.js's
// `collectConfigIssues` — the SAME function `concertino validate` itself
// runs) before being written back to disk.
//
// Pure: (state, opts) -> string / (key, state) -> action | null, following
// the exact router seam every other screen uses (design.md Decision 1).
// `watch.js` owns the actual settings session object (`state.settings`) —
// built fresh every time `s` opens this screen from the fleet (design.md
// Decision 4: no persistent reuse across visits, unlike the launch pad) —
// and applies every action this module returns; this file never touches the
// filesystem itself.
//
// Layout: two panes (design.md Decision 4) — SECTIONS (left) lists the
// schema's top-level keys in schema-declaration order; the selected
// section's FIELDS (right) lists its leaf dotted sub-paths, current value,
// and type/enum badge — modeled directly on drilldown.js's/launchpad.js's
// existing box-per-pane, `focus`-gated key routing. A third, full-width
// detail pane below (mirroring launchpad.js's own inline ticket-detail
// pane) shows the selected field's description, its edit prompt (when one
// is open), and any save-time validation errors.

const f = require('../format');
const layout = require('../layout');
const textwrap = require('../textwrap');
const configLib = require('../../config');

// Every box costs 2 columns to its border characters and 2 more to
// box()'s default horizontal padding — see fleet.js/drilldown.js/
// launchpad.js's identical constant.
const BOX_BORDER_PADDING_COLS = 4;

const SECTIONS_WIDTH = 22;

// Sections whose leaf fields are, in principle, editable in this slice
// (design.md Non-Goals / spec.md's "Scalar and enum leaf fields are
// editable in place" requirement names exactly this list). `worktree` is
// special-cased below: only its `ports.*` sub-tree is editable — the rest
// of `worktree` (base/envFiles/linkModules/hooks) is out of scope, same as
// `ticketProvider`/`specProvider`/`harnesses`/`devServers`/`gates`/
// `canonicalDocs`, which are not in this set at all and so render
// read-only regardless of their own field types.
const EDITABLE_SECTIONS = new Set([
  'project', 'ui', 'dashboard', 'budgets', 'agentMerge', 'models', 'modelTiers', 'speeds', 'commitTrailer',
]);

function sectionEditable(section, subPath) {
  if (section === 'worktree') return subPath === 'ports' || subPath.indexOf('ports.') === 0;
  return EDITABLE_SECTIONS.has(section);
}

// A field's edit AFFORDANCE (design.md Decision 5): enum wins over boolean/
// text (an enum field is never edited as free text — Decision 5's whole
// point is that an edit can never produce a value outside the enum), then
// boolean, then plain scalar text. Anything else (array/object, or a schema
// node with no declared type at all — e.g. an array's own `items` schema)
// is 'readonly': Non-Goals excludes structural editing of those entirely,
// regardless of which section they live under.
function fieldKind(meta) {
  if (meta.enum && meta.enum.length) return 'enum';
  if (meta.type === 'boolean') return 'boolean';
  if (meta.type === 'string' || meta.type === 'integer' || meta.type === 'number') return 'text';
  return 'readonly';
}

// buildFieldMeta(schema, configInstance) -> Map<dottedPath, { ...
// lib/config.js's flattenSchema entry, path, section, subPath, kind,
// editable }>. Built once per settings session (schema/section shape does
// not change mid-session — design.md Decision 3) by watch.js's
// openSettings(), not re-derived per keypress/render.
function buildFieldMeta(schema, configInstance) {
  const flat = configLib.flattenSchema(schema, configInstance);
  const meta = new Map();
  for (const [dottedPath, info] of flat) {
    const dot = dottedPath.indexOf('.');
    const section = dot === -1 ? dottedPath : dottedPath.slice(0, dot);
    const subPath = dot === -1 ? '' : dottedPath.slice(dot + 1);
    const kind = fieldKind(info);
    const editable = sectionEditable(section, subPath) && kind !== 'readonly';
    meta.set(dottedPath, Object.assign({}, info, { path: dottedPath, section, subPath, kind, editable }));
  }
  return meta;
}

// Leaf field entries for one section, in the same order buildFieldMeta's
// Map iterates them in (schema declaration / DFS order — a plain object
// literal parsed from JSON preserves insertion order for string keys, and
// Map preserves insertion order unconditionally).
function fieldsForSection(fieldMeta, section) {
  const out = [];
  for (const entry of fieldMeta.values()) {
    if (entry.section === section) out.push(entry);
  }
  return out;
}

// The current-value resolver (design.md Decision 3 / tasks.md 2.3): reads
// the raw, pre-withDefaults() on-disk-shaped object (the session's staged
// `candidate`, which starts as a clone of the raw on-disk config) at the
// field's own dotted path; falls back to the flattened schema's OWN
// `default` only when that path is genuinely absent. Never routes through
// `withDefaults()`, which does not cover every section (`dashboard` at all,
// `ui.tool` only when the whole `ui` object is absent) — see design.md's
// own reasoning for why that partial coverage cannot be trusted here.
function currentValue(candidate, entry) {
  const raw = configLib.getAtPath(candidate, entry.path);
  if (raw !== undefined) return { value: raw, isDefaulted: false };
  return { value: entry.default, isDefaulted: true };
}

function formatValue(value) {
  if (value === undefined) return f.dim('(unset)');
  if (Array.isArray(value)) {
    if (!value.length) return f.dim('(empty)');
    const allScalar = value.every((v) => v === null || typeof v !== 'object');
    return allScalar ? value.join(', ') : `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (value && typeof value === 'object') {
    const n = Object.keys(value).length;
    return `{${n} field${n === 1 ? '' : 's'}}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function sectionRow(name, selected, paneFocused) {
  const marker = selected ? '▸' : ' ';
  const line = ' ' + marker + ' ' + name;
  if (!selected) return line;
  return paneFocused ? line : f.dim(line);
}

function fieldRow(entry, candidate, selected, paneFocused, width) {
  const marker = selected ? '▸' : ' ';
  const { value, isDefaulted } = currentValue(candidate, entry);
  const label = entry.subPath || entry.section;
  const badge = entry.enum ? '[' + entry.enum.join('|') + ']' : (entry.type ? '<' + entry.type + '>' : '');
  const tags = (isDefaulted ? ' (default)' : '') + (entry.editable ? '' : ' (read-only)');
  const line = ' ' + marker + ' ' + f.padTo(f.truncate(label, 26), 26) + ' ' +
    formatValue(value) + f.dim(tags) + '  ' + f.dim(badge);
  const truncated = f.truncate(line, width);
  if (!selected) return entry.editable ? truncated : f.dim(truncated);
  return paneFocused ? truncated : f.dim(truncated);
}

function renderSettings(settings, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);

  if (!settings) {
    return [f.bold('SETTINGS'), '', f.dim('  settings unavailable'), '', f.dim('  esc back')].join('\n');
  }

  const out = [];
  out.push(f.bold('concertino') + f.dim(' · settings — ' + settings.cfgPath));
  out.push('');

  const sections = settings.sections || [];
  const sectionsFocused = settings.focus === 'sections';
  const fieldsFocused = settings.focus === 'fields';

  const leftContent = sections.length
    ? sections.map((name, i) => sectionRow(name, i === settings.sectionIndex, sectionsFocused))
    : [f.dim('  (no sections)')];

  const GAP = 1;
  const rightContentW = Math.max(20, cols - SECTIONS_WIDTH - 2 * BOX_BORDER_PADDING_COLS - GAP);
  const leftPaneWidth = SECTIONS_WIDTH + BOX_BORDER_PADDING_COLS;
  const rightPaneWidth = rightContentW + BOX_BORDER_PADDING_COLS;

  const currentSection = sections[settings.sectionIndex] || null;
  const fields = currentSection ? fieldsForSection(settings.fieldMeta, currentSection) : [];
  const rightContent = fields.length
    ? fields.map((entry, i) => fieldRow(entry, settings.candidate, i === settings.fieldIndex, fieldsFocused, rightContentW))
    : [f.dim('  (no fields in this section)')];

  const paneHeight = Math.max(leftContent.length, rightContent.length) + 2;
  const sectionsTitle = 'SECTIONS';
  const fieldsTitle = f.truncate((currentSection || '(none)').toUpperCase(), rightContentW);

  const leftBox = layout.degrade(leftPaneWidth, paneHeight)
    ? [sectionsTitle, ...leftContent].map((l) => f.truncate(l, leftPaneWidth))
    : layout.box(leftContent, { width: leftPaneWidth, height: paneHeight, title: sectionsTitle, focused: sectionsFocused });
  const rightBox = layout.degrade(rightPaneWidth, paneHeight)
    ? [fieldsTitle, ...rightContent].map((l) => f.truncate(l, rightPaneWidth))
    : layout.box(rightContent, { width: rightPaneWidth, height: paneHeight, title: fieldsTitle, focused: fieldsFocused });

  for (const line of layout.hsplit([
    { lines: leftBox, width: leftPaneWidth },
    { lines: rightBox, width: rightPaneWidth },
  ])) out.push(line);
  out.push('');

  // --- detail pane: selected field's description, edit prompt, save error --
  const selectedField = fields[settings.fieldIndex] || null;
  const detailWidth = cols;
  const detailInnerWidth = Math.max(1, detailWidth - BOX_BORDER_PADDING_COLS);
  const detailContent = [];

  if (settings.prompt) {
    const entry = settings.fieldMeta.get(settings.prompt.path);
    detailContent.push(f.bold(entry ? entry.path : settings.prompt.path));
    detailContent.push('  ' + f.truncate(settings.prompt.value || '', Math.max(0, detailInnerWidth - 4)) + '▏');
    if (settings.prompt.error) detailContent.push('  ' + f.red(f.truncate(settings.prompt.error, detailInnerWidth - 2)));
  } else if (selectedField) {
    detailContent.push(f.bold(selectedField.path));
    const desc = selectedField.description || f.dim('(no description in the schema)');
    for (const line of textwrap.wrap(desc, detailInnerWidth)) detailContent.push(line);
    if (!selectedField.editable) {
      detailContent.push('');
      detailContent.push(f.dim('  read-only in this screen — edit via `concertino update` or hand-edit concertino.config.json'));
    }
  } else {
    detailContent.push(f.dim('(no field selected)'));
  }

  if (settings.saveError && settings.saveError.length) {
    detailContent.push('');
    for (const msg of settings.saveError) detailContent.push(f.red(f.truncate('✗ ' + msg, detailInnerWidth)));
  }

  const detailHeight = detailContent.length + 2;
  const detailBox = layout.degrade(detailWidth, detailHeight)
    ? detailContent.map((l) => f.truncate(l, detailWidth))
    : layout.box(detailContent, { width: detailWidth, height: detailHeight, focused: false });
  for (const line of detailBox) out.push(line);
  out.push('');

  // --- footer: always shows both exit actions (spec.md's own requirement) --
  if (settings.prompt) {
    out.push(f.dim('  ↵ commit   esc cancel'));
  } else {
    const hints = ['j/k move'];
    hints.push(sectionsFocused ? 'tab/↵/l fields' : 'tab/h sections');
    if (fieldsFocused && selectedField && selectedField.editable) hints.push('↵/space edit');
    hints.push('S save', 'esc discard');
    // f.hintLines: wraps rather than letting the downstream cols clamp
    // silently drop trailing hints on a narrow terminal (see fleet.js).
    for (const line of f.hintLines(hints, cols)) out.push(line);
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// --- key handling ----------------------------------------------------------
// Pure: (key, { settings }) -> action | null. watch.js owns the settings
// session and interprets every action returned here (design.md Decision 1).
function handleKey(key, state) {
  const settings = state && state.settings;
  if (!settings) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  // A field's free-text edit prompt (design.md Decision 5) — mirrors
  // fleet.js's own promptKey exactly, seeded with the current value instead
  // of starting empty (watch.js's 'settings-open-field-prompt' handler seeds
  // it).
  if (settings.prompt) {
    if (key.length > 1) return null;
    if (key === '\x1b' || key === '') return { type: 'settings-cancel-prompt' };
    if (key === '\x7f' || key === '\b') return { type: 'settings-prompt-backspace' };
    if (key === '\r' || key === '\n') return { type: 'settings-commit-prompt' };
    if (key >= ' ') return { type: 'settings-prompt-type', char: key };
    return null;
  }

  // Escape (no prompt open) discards every staged edit and returns to the
  // fleet screen — spec.md's own "Escape returns to the fleet screen without
  // saving" scenario. Reuses the generic 'back' action every other screen's
  // Escape already emits (design.md Decision 1) — watch.js's shared
  // backToFleet() clears settings state alongside every other screen's own.
  if (key === '\x1b') return { type: 'back' };
  // Capital S — deliberately distinct from the fleet screen's own lowercase
  // `s` (design.md Decision 6) — validates the full candidate and, only if
  // clean, writes it to disk.
  if (key === 'S') return { type: 'settings-save' };

  const sections = settings.sections || [];
  const currentSection = sections[settings.sectionIndex];
  const fields = currentSection ? fieldsForSection(settings.fieldMeta, currentSection) : [];

  if (settings.focus !== 'fields') {
    if (key === 'j' || key === '\x1b[B') return { type: 'settings-move-section', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'settings-move-section', delta: -1 };
    if (key === '\r' || key === 'l' || key === '\x1b[C' || key === '\t') return { type: 'settings-focus-fields' };
    return null;
  }

  // focus === 'fields'
  if (key === 'j' || key === '\x1b[B') return { type: 'settings-move-field', delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'settings-move-field', delta: -1 };
  if (key === 'h' || key === '\x1b[D' || key === '\t') return { type: 'settings-focus-sections' };
  if (key === '\r' || key === ' ') {
    const entry = fields[settings.fieldIndex];
    if (!entry || !entry.editable) return null; // read-only field: Enter is a no-op (spec.md)
    if (entry.kind === 'boolean') return { type: 'settings-toggle-field', path: entry.path };
    if (entry.kind === 'enum') return { type: 'settings-cycle-field', path: entry.path };
    return { type: 'settings-open-field-prompt', path: entry.path };
  }
  return null;
}

// Uniform router seam: every screen exposes render(state, opts)/
// routeHandleKey(key, state) so router.js never needs to know a screen's
// own internal shape (mirrors docview.js's/ticketdraft.js's identical
// pair).
function render(state, opts) {
  return renderSettings(state && state.settings, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, { settings: state && state.settings });
}

module.exports = {
  renderSettings, handleKey, render, routeHandleKey,
  buildFieldMeta, fieldsForSection, currentValue, formatValue,
  fieldKind, sectionEditable, EDITABLE_SECTIONS,
};
