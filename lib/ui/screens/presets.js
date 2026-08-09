'use strict';

// The PRESETS screen (CON-111): create, rename, delete and edit named
// batch-level launch presets — reached with `p` from the settings screen
// (mode = 'settings'), never from the fleet directly. All preset lifecycle
// actions live here; the launch plan itself offers only `w` (apply) — see
// design.md Decisions 2/4.
//
// Pure: (state, opts) -> string / (key, state) -> action | null, following
// the same router seam settings.js/sessions.js use. `watch.js`/the presets
// controller own the actual session object (`state.presets`) — built fresh
// every time `p` opens this screen (design.md Decision 6, mirroring
// settings.js's own openSettings()) — and apply every action this module
// returns; this file never touches the filesystem itself.
//
// Layout: one box, one row per staged preset (name/harness/speed/provider/
// agent-merge columns) with a `▸` row cursor, cycled with the SAME
// h/s/p/m keys the launch plan's own batch-level knobs already use
// (design.md Decision 4 — a deliberate divergence from settings.js's own
// generic schema-driven field editor; see its header comment for why).

const f = require('../format');
const layout = require('../layout');
const { sectionHeader } = require('../widgets/header');
const { emptyState } = require('../widgets/empty');

// Every box costs 2 columns to its border characters and 2 more to box()'s
// default horizontal padding — see fleet.js/drilldown.js/launchplan.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;

function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    return contentLines.map((l) => f.truncate(l, opts.width));
  }
  return layout.box(contentLines, opts);
}

// The operator's own vocabulary for the two dimensions whose raw value is
// not self-identifying — same words launchplan.js's own row annotation uses
// (providerWord), plus the "unset" cases a preset's own null values need
// that a launch plan's rows never do (a preset may deliberately not touch a
// dimension at all).
function harnessWord(harness) {
  return harness == null ? f.dim('(none)') : harness;
}

function providerWord(provider) {
  if (provider == null) return f.dim('(none)');
  return provider === 'ollama' ? 'local' : 'subscription';
}

const NAME_W = 20;
const HARNESS_W = 13;
const SPEED_W = 8;
const PROVIDER_W = 13;

function presetRow(p, selected, width) {
  const cursor = selected ? ' ' + f.cyan('▸') + ' ' : '   ';
  const name = f.padTo(f.truncate(p.name, NAME_W), NAME_W);
  const harness = f.padTo(harnessWord(p.harness), HARNESS_W);
  const speed = f.padTo(p.speed, SPEED_W);
  const provider = f.padTo(providerWord(p.provider), PROVIDER_W);
  const merge = p.agentMerge ? f.green('merge on') : f.dim('merge off');
  const line = cursor + name + ' ' + harness + ' ' + speed + ' ' + provider + ' ' + merge;
  return f.truncate(line, width);
}

function headerRow(width) {
  const line = '   ' + f.padTo('NAME', NAME_W) + ' ' + f.padTo('HARNESS', HARNESS_W) + ' ' +
    f.padTo('SPEED', SPEED_W) + ' ' + f.padTo('PROVIDER', PROVIDER_W) + ' ' + 'AGENT-MERGE';
  return f.dim(f.truncate(line, width));
}

function renderPresets(s, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);

  if (!s) {
    return [sectionHeader({ label: 'PRESETS', colour: f.bold }), '',
      f.dim('  presets unavailable'), '', f.dim('  esc back')].join('\n');
  }

  const out = [];
  out.push(sectionHeader({ label: 'PRESETS', colour: f.bold }));
  out.push('');

  const presets = s.presets || [];
  const rowIndex = presets.length ? Math.max(0, Math.min(s.rowIndex || 0, presets.length - 1)) : 0;
  const boxWidth = cols;
  const rowWidth = Math.max(20, boxWidth - BOX_BORDER_PADDING_COLS);

  let content;
  if (presets.length) {
    content = [headerRow(rowWidth), ...presets.map((p, i) => presetRow(p, i === rowIndex, rowWidth))];
  } else {
    content = emptyState({ message: '  no presets saved — press n to create one' });
  }
  const boxHeight = content.length + 2;
  for (const line of pane(content, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');

  // --- overlay: delete confirm or the name-entry prompt own every keystroke
  // while open (mirroring settings.js's own chooser/prompt precedence) ------
  if (s.deleteConfirm) {
    const target = presets[s.deleteConfirm.index];
    out.push('  ' + f.yellow('delete preset "' + (target ? target.name : '') + '"?'));
  } else if (s.prompt) {
    out.push('  ' + f.bold(s.prompt.mode === 'rename' ? 'rename preset' : 'new preset name'));
    out.push('  ' + f.truncate(s.prompt.value || '', Math.max(0, cols - 4)) + '▏');
    if (s.prompt.error) out.push('  ' + f.red(f.truncate(s.prompt.error, cols - 2)));
  }

  if (s.saveError && s.saveError.length) {
    out.push('');
    for (const msg of s.saveError) out.push('  ' + f.red(f.truncate('✗ ' + msg, cols - 2)));
  }
  out.push('');

  if (s.deleteConfirm) {
    out.push(f.dim('  y confirm   (any other key) cancel'));
  } else if (s.prompt) {
    out.push(f.dim('  ↵ commit   esc cancel'));
  } else {
    const hints = ['j/k move', 'n new'];
    // Only hinting keys that currently do something — same discipline
    // launchplan.js's own footer follows (design.md Decision 4/tasks.md 2.2).
    if (presets.length) {
      hints.push('r rename', 'd delete', 'h harness', 's speed');
      if (s.providerConfigured) hints.push('p provider');
      hints.push('m agent-merge');
    }
    hints.push('S save', 'esc discard');
    for (const line of f.hintLines(hints, cols)) out.push(line);
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// --- key handling ------------------------------------------------------
// Pure: (key, { presets }) -> action | null. watch.js/the presets controller
// own `state.presets` and interpret every action returned here.
function handleKey(key, state) {
  const s = state && state.presets;
  if (!s) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  if (s.deleteConfirm) {
    if (key === 'y') return { type: 'presets-confirm-delete' };
    return { type: 'presets-cancel-delete' };
  }

  if (s.prompt) {
    if (key.length > 1) return null;
    if (key === '\x1b' || key === '') return { type: 'presets-cancel-prompt' };
    if (key === '\x7f' || key === '\b') return { type: 'presets-prompt-backspace' };
    if (key === '\r' || key === '\n') return { type: 'presets-commit-prompt' };
    if (key >= ' ') return { type: 'presets-prompt-type', char: key };
    return null;
  }

  // Escape (no prompt/confirm open) — internal shape kept OPAQUE to this
  // module, exactly as docview.js's own handleKey does; routeHandleKey below
  // translates it into the concrete, non-generic action this screen actually
  // needs (design.md Decision 6).
  if (key === '\x1b') return { type: 'back' };
  if (key === 'S') return { type: 'presets-save' };
  if (key === 'n') return { type: 'presets-new' };

  if (key === 'j' || key === '\x1b[B') return { type: 'presets-move-row', delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'presets-move-row', delta: -1 };

  const presets = s.presets || [];
  if (presets.length) {
    if (key === 'r') return { type: 'presets-rename' };
    if (key === 'd') return { type: 'presets-open-delete-confirm' };
    if (key === 'h') return { type: 'presets-cycle-harness' };
    if (key === 's') return { type: 'presets-cycle-speed' };
    if (key === 'p' && s.providerConfigured) return { type: 'presets-cycle-provider' };
    if (key === 'm') return { type: 'presets-toggle-agent-merge' };
  }
  return null;
}

// Uniform router seam: every screen exposes render(state, opts)/
// routeHandleKey(key, state) — see router.js.
function render(state, opts) {
  return renderPresets(state && state.presets, opts);
}

// mode = 'presets' is entered ONLY from the settings screen's `p` key
// (design.md Decision 6) — never from the fleet, so its own Escape must NOT
// emit the bare `back` action: watch.js's applyAction intercepts that
// unconditionally and routes it to backToFleet() before any controller sees
// it (verified directly in watch.js). Translated here into a concrete action
// the presets controller owns instead — mirrors docview.js's own
// routeHandleKey (`back` -> `back-to-drilldown-from-doc`) exactly.
function routeHandleKey(key, state) {
  const action = handleKey(key, { presets: state && state.presets });
  if (!action) return null;
  if (action.type === 'back') return { type: 'back-to-settings-from-presets' };
  return action;
}

module.exports = {
  renderPresets, handleKey, render, routeHandleKey,
  presetRow, headerRow, harnessWord, providerWord,
};
