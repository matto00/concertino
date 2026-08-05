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

// CON-57 shipped this screen with a per-section allowlist on top of the
// per-type check below, so whole sections rendered read-only no matter how
// ordinary their fields were: `providers.ollama.models.executor` is a plain
// string, and `ticketProvider.teamKey`, `worktree.base` and every
// `devServers.*` field likewise — 27 scalars in all, uneditable only
// because their section was outside that first slice. That was scoping, not
// a safety property, and it made exactly the two things this project's
// multi-harness work added (`harnesses`, `providers.ollama`) impossible to
// turn on from inside the TUI (CON-72).
//
// The allowlist is gone: a field's type is now the only thing that decides,
// and the answer is "yes" for every shape this screen has an editor for.
// Retained (and still exported) as the historical record of what that slice
// covered — nothing calls it to gate an edit any more.
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
// boolean, then plain scalar text.
//
// CON-72 adds the two array shapes the schema actually uses:
//
//   'enum-list'   — items carry an `enum` (`harnesses`,
//                   `providers.ollama.harnesses`). Edited as a multi-select
//                   over the declared values, so — exactly like the scalar
//                   enum case — an edit can never produce a member outside
//                   the schema.
//   'scalar-list' — items are string/number/integer (`worktree.envFiles`,
//                   `hooks`, `linkModules`, `ui.triggers`, `ui.breakpoints`).
//                   Edited as one delimited line, the same text prompt a
//                   scalar uses.
//
// 'readonly' now means only what it always should have: a shape with no
// editor. In practice that is an array of OBJECTS (`gates`, `canonicalDocs`
// — each element is a multi-field record, and editing those in place is a
// genuinely different screen) or a node the schema declares no type for.
function fieldKind(meta) {
  if (meta.enum && meta.enum.length) return 'enum';
  if (meta.type === 'boolean') return 'boolean';
  if (meta.type === 'string' || meta.type === 'integer' || meta.type === 'number') return 'text';
  if (meta.type === 'array' && meta.items) {
    if (meta.items.enum && meta.items.enum.length) return 'enum-list';
    const t = meta.items.type;
    if (t === 'string' || t === 'integer' || t === 'number') return 'scalar-list';
  }
  return 'readonly';
}

// Why a read-only field is read-only — shown in the detail pane instead of
// the old blanket "edit via `concertino update` or hand-edit" line, which
// was misleading the moment the reason was "this shape has no editor
// anywhere" rather than "not in this slice".
function readonlyReason(entry) {
  if (entry.type === 'array') {
    return 'each entry is a multi-field record — edit `' + entry.path + '` in concertino.config.json';
  }
  return 'the schema declares no editable type for this field';
}

// When an edit actually reaches the thing it configures. Saving writes
// concertino.config.json and nothing else: rendered artifacts
// (.claude/agents, .codex, .opencode, .concertino.env, speeds.json) are
// regenerated by `concertino sync`, and a live run resolved its models once
// at setup and carries them for its whole life. Saying so per field beats
// letting someone edit a model id and wonder why the run they are watching
// did not change.
function effectNote(entry) {
  if (entry.section === 'dashboard') return 'applies when the dashboard next starts';
  return 'applies to runs launched after the next `concertino sync`';
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
    // Type is the whole gate now — see EDITABLE_SECTIONS' comment above.
    const editable = kind !== 'readonly';
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

  if (settings.chooser) {
    // CON-72: the enum-list multi-select. Every value the schema allows is
    // listed with its membership state, so the edit is a set of toggles
    // rather than free text — the same "an edit can never leave the enum"
    // guarantee the scalar enum cycle already gives.
    const entry = settings.fieldMeta.get(settings.chooser.path);
    detailContent.push(f.bold(entry ? entry.path : settings.chooser.path));
    const chosen = settings.chooser.selected || [];
    (settings.chooser.options || []).forEach((opt, i) => {
      const cursor = i === settings.chooser.index ? f.cyan('▸') : ' ';
      const box = chosen.includes(opt) ? f.green('[x]') : f.dim('[ ]');
      detailContent.push('  ' + cursor + ' ' + box + ' ' + opt);
    });
    if (!chosen.length) detailContent.push('  ' + f.dim('(none selected — saving an empty list is allowed)'));
  } else if (settings.prompt) {
    const entry = settings.fieldMeta.get(settings.prompt.path);
    detailContent.push(f.bold(entry ? entry.path : settings.prompt.path));
    if (entry && entry.kind === 'scalar-list') {
      detailContent.push(f.dim('  comma-separated list'));
    }
    detailContent.push('  ' + f.truncate(settings.prompt.value || '', Math.max(0, detailInnerWidth - 4)) + '▏');
    if (settings.prompt.error) detailContent.push('  ' + f.red(f.truncate(settings.prompt.error, detailInnerWidth - 2)));
  } else if (selectedField) {
    detailContent.push(f.bold(selectedField.path));
    const desc = selectedField.description || f.dim('(no description in the schema)');
    for (const line of textwrap.wrap(desc, detailInnerWidth)) detailContent.push(line);
    detailContent.push('');
    if (selectedField.editable) {
      detailContent.push(f.dim('  ' + effectNote(selectedField)));
    } else {
      detailContent.push(f.dim('  read-only — ' + readonlyReason(selectedField)));
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
  if (settings.chooser) {
    for (const line of f.hintLines(['j/k move', 'space toggle', '↵ commit', 'esc cancel'], cols)) out.push(line);
  } else if (settings.prompt) {
    out.push(f.dim('  ↵ commit   esc cancel'));
  } else {
    const hints = ['j/k move'];
    hints.push(sectionsFocused ? 'tab/↵/l fields' : 'tab/h sections');
    if (fieldsFocused && selectedField && selectedField.editable) {
      hints.push(selectedField.kind === 'enum-list' ? '↵/space choose' : '↵/space edit');
    }
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

  // CON-72: the enum-list multi-select owns every keystroke while open —
  // the same precedence the free-text prompt below already has, for the
  // same reason (a sub-editor must not leak j/k through to the field list
  // underneath it).
  if (settings.chooser) {
    if (key === '\x1b') return { type: 'settings-cancel-chooser' };
    if (key === '\r' || key === '\n') return { type: 'settings-commit-chooser' };
    if (key === ' ') return { type: 'settings-chooser-toggle' };
    if (key === 'j' || key === '\x1b[B') return { type: 'settings-chooser-move', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'settings-chooser-move', delta: -1 };
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
    if (entry.kind === 'enum-list') return { type: 'settings-open-chooser', path: entry.path };
    // 'text' and 'scalar-list' share the one-line prompt — the list case
    // seeds/commits it as a comma-separated value (see the controller).
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
  readonlyReason, effectNote,
};
