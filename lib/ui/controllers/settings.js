'use strict';

// Settings-screen actions (CON-57): opening a fresh editing session against
// the on-disk config, section/field navigation, staged edits (toggle / enum
// cycle / text prompt), and the validate-then-save gate. Dispatched from
// watch.js's applyAction — see controllers/index.js for the shared contract.
//
// settingsScreen (pure renderer + field-meta helpers) and lib/config.js's
// schema/validation logic are pure requires; only `root` and navigation come
// through ctx.

const fs = require('fs');
const path = require('path');
const settingsScreen = require('../screens/settings');
const configLib = require('../../config');

// CON-57, design.md Decision 4: builds a FRESH settings session every time —
// never reuses a prior one, unlike openLaunchPad(). Reads
// `concertino.config.json` directly off disk (the same default path
// `bin/concertino`'s own cmdWatch resolves when no `--config` override is
// given — the in-memory config loaded once at startup carries no path of its
// own, so this is the one place in the dashboard that re-reads the file
// itself rather than trusting that snapshot) so a hand-edit, another
// `concertino update`, or a PRIOR settings-screen save between visits is
// always reflected. A missing or unparseable file degrades to `{}` rather
// than crashing the dashboard — collectConfigIssues will report the same
// missing-required-field errors `concertino validate` would, right there in
// the detail pane, once a save is attempted.
function openSettings(ctx) {
  const S = ctx.S;
  const cfgPath = path.join(ctx.root, 'concertino.config.json');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { raw = {}; }
  const schema = configLib.loadSchema();
  S.settings = {
    cfgPath,
    raw,
    // The working copy every staged edit mutates in place (deepSet) — the
    // raw, pre-withDefaults() on-disk shape plus in-session edits, never the
    // withDefaults()-expanded object (design.md Decision 3's own "never
    // materialize schema defaults back to disk" reasoning).
    candidate: JSON.parse(JSON.stringify(raw)),
    schema,
    fieldMeta: settingsScreen.buildFieldMeta(schema, raw),
    sections: configLib.schemaSectionOrder(schema),
    sectionIndex: 0,
    fieldIndex: 0,
    focus: 'sections',
    prompt: null,
    saveError: null,
  };
  S.mode = 'settings';
}

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    case 'open-settings':
      openSettings(ctx);
      return true;

    case 'settings-move-section': {
      if (!S.settings) return true;
      const len = S.settings.sections.length;
      S.settings.sectionIndex = Math.max(0, Math.min(S.settings.sectionIndex + action.delta, len - 1));
      S.settings.fieldIndex = 0;
      S.settings.saveError = null;
      return true;
    }

    case 'settings-move-field': {
      if (!S.settings) return true;
      const section = S.settings.sections[S.settings.sectionIndex];
      const fields = settingsScreen.fieldsForSection(S.settings.fieldMeta, section);
      if (!fields.length) return true;
      S.settings.fieldIndex = Math.max(0, Math.min(S.settings.fieldIndex + action.delta, fields.length - 1));
      S.settings.saveError = null;
      return true;
    }

    case 'settings-focus-fields':
      if (S.settings) S.settings.focus = 'fields';
      return true;

    case 'settings-focus-sections':
      if (S.settings) S.settings.focus = 'sections';
      return true;

    // Enter/Space on a boolean field (design.md Decision 5) — flips the
    // staged value directly, no text prompt. Reads the CURRENT value the
    // same way the field pane displays it (candidate, falling back to the
    // schema default) so toggling a still-unset field starts from what is
    // actually on screen, not from `undefined`.
    case 'settings-toggle-field': {
      if (!S.settings) return true;
      const entry = S.settings.fieldMeta.get(action.path);
      if (!entry) return true;
      const { value } = settingsScreen.currentValue(S.settings.candidate, entry);
      configLib.deepSet(S.settings.candidate, action.path, !value);
      S.settings.saveError = null;
      return true;
    }

    // Enter/Space on an enum field — cycles to the next allowed value,
    // wrapping back to the first after the last (spec.md's own scenario) —
    // never free text, so an edit here can never produce a value outside the
    // enum.
    case 'settings-cycle-field': {
      if (!S.settings) return true;
      const entry = S.settings.fieldMeta.get(action.path);
      if (!entry || !entry.enum || !entry.enum.length) return true;
      const { value } = settingsScreen.currentValue(S.settings.candidate, entry);
      const idx = entry.enum.indexOf(value);
      const next = entry.enum[(idx + 1 + entry.enum.length) % entry.enum.length];
      configLib.deepSet(S.settings.candidate, action.path, next);
      S.settings.saveError = null;
      return true;
    }

    // Enter on a string/number/integer field with no enum — opens the
    // single-line text prompt, seeded with the field's CURRENT value
    // (design.md Decision 5 — unlike fleet.js's own `n` prompt, which always
    // starts empty).
    case 'settings-open-field-prompt': {
      if (!S.settings) return true;
      const entry = S.settings.fieldMeta.get(action.path);
      if (!entry) return true;
      const { value } = settingsScreen.currentValue(S.settings.candidate, entry);
      S.settings.prompt = { path: action.path, value: value != null ? String(value) : '', error: null };
      return true;
    }

    case 'settings-prompt-type':
      if (S.settings && S.settings.prompt) {
        S.settings.prompt.value += action.char;
        S.settings.prompt.error = null;
      }
      return true;

    case 'settings-prompt-backspace':
      if (S.settings && S.settings.prompt) S.settings.prompt.value = S.settings.prompt.value.slice(0, -1);
      return true;

    // Escape while a field's edit prompt is open — cancels just that field's
    // in-progress edit, returning to the field list with the value unchanged
    // (spec.md's own scenario); does NOT leave the settings screen (that is
    // the bare-Escape 'back' case, only reachable when no prompt is open —
    // see settings.js's handleKey).
    case 'settings-cancel-prompt':
      if (S.settings) S.settings.prompt = null;
      return true;

    // Commits the typed text into the in-memory candidate at the field's
    // dotted path, coercing to number/integer via the same coerce() helper
    // `concertino update` already uses (design.md Decision 5) — "5" typed
    // for an integer field becomes `5`, not "5". Validation happens once, on
    // save, against the whole candidate (Decision 5's own reasoning) — not
    // here.
    case 'settings-commit-prompt': {
      if (!S.settings || !S.settings.prompt) return true;
      const entry = S.settings.fieldMeta.get(S.settings.prompt.path);
      const typed = S.settings.prompt.value;
      const value = entry && (entry.type === 'integer' || entry.type === 'number') ? configLib.coerce(typed) : typed;
      configLib.deepSet(S.settings.candidate, S.settings.prompt.path, value);
      S.settings.prompt = null;
      S.settings.saveError = null;
      return true;
    }

    // Capital S — validates the full in-memory candidate (the raw on-disk
    // shape plus every staged edit, NOT the withDefaults()-expanded object)
    // via the SAME collectConfigIssues `concertino validate` itself runs
    // (design.md Decision 2/6). On success, writes it to disk (identical
    // serialization to cmdUpdate's own write) and returns to the fleet; on
    // failure, shows the specific error(s) inline and keeps the screen open
    // with the invalid edits still staged (spec.md's "An invalid edit is
    // rejected, not written").
    case 'settings-save': {
      if (!S.settings) return true;
      const { errors } = configLib.collectConfigIssues(S.settings.candidate, { out: ctx.root });
      if (errors.length) {
        S.settings.saveError = errors.map((e) => e.path + ': ' + e.message);
        return true;
      }
      fs.writeFileSync(S.settings.cfgPath, JSON.stringify(S.settings.candidate, null, 2) + '\n');
      ctx.backToFleet();
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle, openSettings };
