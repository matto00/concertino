'use strict';

// The PRESETS screen's actions (CON-111): opening a fresh editing session
// against `.concertino/cache/presets.json`, row navigation, the name-entry
// prompt (create/rename), delete-with-confirm, the per-row h/s/p/m field
// cycles (design.md Decision 4), and the validate-then-save gate (design.md
// Decision 5). Dispatched from watch.js's applyAction — see
// controllers/index.js for the shared contract.
//
// `openPresets` is called DIRECTLY by controllers/settings.js's
// 'open-presets' case (not through the applyAction loop — see that
// controller's own comment) — exported alongside `handle`, mirroring
// controllers/settings.js's own `openSettings` export. `'open-presets'`
// deliberately has NO case in this file's own `handle` switch below —
// settings.js is its sole owner, keeping CONTROLLERS' action-type sets
// disjoint (controllers/index.js's own stated invariant); a second case
// here would be dead code, since `settings` is registered ahead of
// `presets` in CONTROLLERS and applyAction's loop is first-match-wins.
//
// presetsScreen (pure renderer) and harnessCmd (provider-choice domain) are
// pure requires; presetsCache (filesystem I/O) arrives through ctx.deps —
// see watch.js's own header comment on why every fakeable/stateful
// dependency flows through there.

const crypto = require('crypto');
const presetsScreen = require('../screens/presets');
const harnessCmd = require('../harness');

// design.md Decision 2: a fresh preset's defaults mirror what a FRESH launch
// plan itself seeds from (controllers/launchpad.js's own 'open-launchplan'
// case) — the project's first configured harness (canonical form) or null
// when none is configured, 'default' speed, no provider, and the project's
// configured agent-merge default.
function defaultPresetFields(config) {
  const harnesses = Array.isArray(config && config.harnesses) ? config.harnesses : [];
  return {
    harness: harnesses.length ? harnesses[0] : null,
    speed: 'default',
    provider: null,
    agentMerge: !!(config && config.agentMerge && config.agentMerge.enabled),
  };
}

// design.md Decision 4: the harness cycle domain — null (follow the batch)
// plus the project's configured harnesses, in CANONICAL form, falling back
// to `['claude-code']` exactly as controllers/launchpad.js's own
// 'open-launchplan' case does for its own (CLI-label-space) `harnesses`.
function configuredHarnessesCanonical(config) {
  return (Array.isArray(config && config.harnesses) && config.harnesses.length)
    ? config.harnesses.slice()
    : ['claude-code'];
}

function selectedPreset(s) {
  if (!s || !s.presets || !s.presets.length) return null;
  return s.presets[Math.max(0, Math.min(s.rowIndex || 0, s.presets.length - 1))] || null;
}

function handle(action, ctx) {
  const S = ctx.S;
  const { presetsCache } = ctx.deps;

  switch (action.type) {
    case 'presets-move-row': {
      const s = S.presets;
      if (!s) return true;
      const len = s.presets.length;
      if (!len) return true;
      s.rowIndex = Math.max(0, Math.min((s.rowIndex || 0) + action.delta, len - 1));
      return true;
    }

    // Opens the name-entry prompt (design.md Decision 4/tasks.md 2.3) —
    // 'new' seeds it empty; the appended row itself is only created on
    // commit (see 'presets-commit-prompt' below), matching fleet.js's own
    // "the prompt is not the record" shape.
    case 'presets-new':
      if (S.presets) {
        S.presets.prompt = { mode: 'new', value: '', error: null };
        S.presets.saveError = null;
      }
      return true;

    // Same prompt, seeded with the selected preset's CURRENT name (design.md
    // Decision 4/tasks.md 2.3).
    case 'presets-rename': {
      const s = S.presets;
      const p = selectedPreset(s);
      if (!s || !p) return true;
      s.prompt = { mode: 'rename', value: p.name, error: null };
      s.saveError = null;
      return true;
    }

    case 'presets-open-delete-confirm': {
      const s = S.presets;
      if (!s || !s.presets.length) return true;
      s.deleteConfirm = { index: Math.max(0, Math.min(s.rowIndex || 0, s.presets.length - 1)) };
      return true;
    }

    case 'presets-cancel-delete':
      if (S.presets) S.presets.deleteConfirm = null;
      return true;

    // Removes the staged row at the captured index — nothing is written to
    // disk until 'presets-save' (spec.md's "Deleting a preset requires
    // confirmation" scenario).
    case 'presets-confirm-delete': {
      const s = S.presets;
      if (!s || !s.deleteConfirm) return true;
      const idx = s.deleteConfirm.index;
      s.deleteConfirm = null;
      if (idx >= 0 && idx < s.presets.length) s.presets.splice(idx, 1);
      s.rowIndex = Math.max(0, Math.min(s.rowIndex || 0, s.presets.length - 1));
      s.saveError = null;
      return true;
    }

    case 'presets-prompt-type':
      if (S.presets && S.presets.prompt) {
        S.presets.prompt.value += action.char;
        S.presets.prompt.error = null;
      }
      return true;

    case 'presets-prompt-backspace':
      if (S.presets && S.presets.prompt) S.presets.prompt.value = S.presets.prompt.value.slice(0, -1);
      return true;

    case 'presets-cancel-prompt':
      if (S.presets) S.presets.prompt = null;
      return true;

    // On commit, either appends a new preset (design.md Decision 2 defaults)
    // or renames the selected one (updates `name`/`updatedAt`), depending on
    // which prompt mode is open — tasks.md 3.4. An empty (post-trim) name
    // cancels rather than committing, mirroring fleet.js's own promptKey
    // "empty submit = cancel" precedent for its single-line prompt.
    case 'presets-commit-prompt': {
      const s = S.presets;
      if (!s || !s.prompt) return true;
      const name = (s.prompt.value || '').trim();
      if (!name) {
        s.prompt = null;
        return true;
      }
      const now = Date.now();
      if (s.prompt.mode === 'rename') {
        const p = selectedPreset(s);
        if (p) {
          p.name = name;
          p.updatedAt = now;
        }
      } else {
        const fields = defaultPresetFields(ctx.config);
        s.presets.push({
          id: crypto.randomUUID(),
          name,
          harness: fields.harness,
          speed: fields.speed,
          provider: fields.provider,
          agentMerge: fields.agentMerge,
          createdAt: now,
          updatedAt: now,
        });
        s.rowIndex = s.presets.length - 1;
      }
      s.prompt = null;
      s.saveError = null;
      return true;
    }

    // design.md Decision 4: cycles the selected row's harness through
    // `null` plus the project's configured harnesses (canonical form),
    // wrapping.
    case 'presets-cycle-harness': {
      const s = S.presets;
      const p = selectedPreset(s);
      if (!s || !p) return true;
      const choices = [null, ...configuredHarnessesCanonical(ctx.config)];
      const idx = choices.indexOf(p.harness);
      p.harness = choices[(idx + 1 + choices.length) % choices.length];
      p.updatedAt = Date.now();
      s.saveError = null;
      return true;
    }

    case 'presets-cycle-speed': {
      const s = S.presets;
      const p = selectedPreset(s);
      if (!s || !p) return true;
      const ORDER = ['default', 'fast', 'slow'];
      const idx = ORDER.indexOf(p.speed);
      p.speed = ORDER[(idx + 1) % ORDER.length];
      p.updatedAt = Date.now();
      s.saveError = null;
      return true;
    }

    // Gated on `providers.ollama` being configured — the same gate this
    // screen's own footer hint and handleKey already apply (design.md
    // Decision 4). Choices come from the SAME harnessCmd.providerChoices()
    // the launch plan's own row-provider cycle uses, keyed on the row's
    // CURRENT harness.
    case 'presets-cycle-provider': {
      const s = S.presets;
      const p = selectedPreset(s);
      if (!s || !p || !s.providerConfigured) return true;
      const choices = harnessCmd.providerChoices(ctx.config, p.harness);
      if (choices.length < 2) return true;
      const idx = choices.indexOf(p.provider);
      p.provider = choices[(idx + 1) % choices.length];
      p.updatedAt = Date.now();
      s.saveError = null;
      return true;
    }

    case 'presets-toggle-agent-merge': {
      const s = S.presets;
      const p = selectedPreset(s);
      if (!s || !p) return true;
      p.agentMerge = !p.agentMerge;
      p.updatedAt = Date.now();
      s.saveError = null;
      return true;
    }

    // design.md Decision 5: validate the full staged list before writing —
    // non-empty names, case-sensitive uniqueness, and (defensively) every
    // field's own domain. On failure, the screen stays open with the
    // specific error(s) shown inline and the invalid state still staged;
    // nothing is written (spec.md's "Saving with a duplicate name is
    // rejected" scenario).
    case 'presets-save': {
      const s = S.presets;
      if (!s) return true;
      const errors = [];
      const seen = new Set();
      for (const p of s.presets) {
        if (!p.name || !p.name.trim()) errors.push('every preset needs a non-empty name');
        if (seen.has(p.name)) errors.push('duplicate preset name: ' + p.name);
        seen.add(p.name);
        if (!presetsCache.isValidEntry(p)) errors.push(p.name + ': invalid field value');
      }
      if (errors.length) {
        s.saveError = Array.from(new Set(errors));
        return true;
      }
      presetsCache.write(ctx.root, s.presets);
      S.presets = null;
      S.mode = 'settings';
      return true;
    }

    // The translated Escape action (screens/presets.js's routeHandleKey) —
    // NOT the generic 'back', which watch.js's applyAction already
    // intercepts unconditionally and routes to backToFleet() ahead of every
    // controller (design.md Decision 6). Discards every staged change.
    case 'back-to-settings-from-presets':
      S.presets = null;
      S.mode = 'settings';
      return true;

    default:
      return false;
  }
}

// design.md Decision 6: builds S.presets FRESH every time (mirroring
// controllers/settings.js's own openSettings() — no persistent reuse across
// visits), reading `presets-cache.read(ctx.root).presets` into a staged
// working copy deep-cloned so edits never mutate the on-disk snapshot until
// 'presets-save' actually writes it.
function openPresets(ctx) {
  const S = ctx.S;
  const { presetsCache } = ctx.deps;
  const onDisk = presetsCache.read(ctx.root).presets;
  S.presets = {
    presets: JSON.parse(JSON.stringify(onDisk)),
    rowIndex: 0,
    prompt: null,
    deleteConfirm: null,
    saveError: null,
    providerConfigured: !!(ctx.config && ctx.config.providers && ctx.config.providers.ollama),
  };
  S.mode = 'presets';
}

module.exports = { handle, openPresets };
