'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderPresets, handleKey, render, routeHandleKey, harnessWord, providerWord,
} = require('../lib/ui/screens/presets');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function samplePreset(over) {
  return Object.assign({
    id: 'p1',
    name: 'fast local',
    harness: 'claude-code',
    speed: 'fast',
    provider: 'ollama',
    agentMerge: true,
    createdAt: 1000,
    updatedAt: 1000,
  }, over);
}

function presetsState(over) {
  return Object.assign({
    presets: [samplePreset()],
    rowIndex: 0,
    prompt: null,
    deleteConfirm: null,
    saveError: null,
    providerConfigured: true,
  }, over);
}

// --- render: empty/populated states -------------------------------------

test('renders an empty-state message when no presets are staged', () => {
  const out = plain(renderPresets(presetsState({ presets: [] }), { cols: 80 }));
  assert.match(out, /no presets saved/);
});

test('renders one row per staged preset, with the row cursor on the selected one', () => {
  const out = plain(renderPresets(presetsState({
    presets: [samplePreset({ name: 'alpha' }), samplePreset({ id: 'p2', name: 'beta' })],
    rowIndex: 1,
  }), { cols: 100 }));
  assert.match(out, /alpha/);
  assert.match(out, /beta/);
  const betaLine = out.split('\n').find((l) => l.includes('beta'));
  assert.match(betaLine, /▸/);
});

test('renders "unavailable" and an esc-back footer when state is absent', () => {
  const out = plain(renderPresets(null, { cols: 80 }));
  assert.match(out, /presets unavailable/);
  assert.match(out, /esc back/);
});

// --- render: field display -------------------------------------------------

test('harnessWord/providerWord render null as an explicit "(none)"', () => {
  assert.match(plain(harnessWord(null)), /\(none\)/);
  assert.match(plain(providerWord(null)), /\(none\)/);
});

test('providerWord uses the operator vocabulary (local/subscription)', () => {
  assert.equal(plain(providerWord('ollama')), 'local');
  assert.equal(plain(providerWord('default')), 'subscription');
});

// --- render: footer hints only hint keys that currently do something -------

test('with no presets, the footer hints only j/k, n, S, esc — not r/d/h/s/p/m', () => {
  const out = plain(renderPresets(presetsState({ presets: [] }), { cols: 100 }));
  const footer = out.split('\n').slice(-2).join(' ');
  assert.match(footer, /n new/);
  assert.doesNotMatch(footer, /r rename/);
  assert.doesNotMatch(footer, /d delete/);
  assert.doesNotMatch(footer, /h harness/);
});

test('with a preset staged, the footer hints r/d/h/s/m and S/esc', () => {
  const out = plain(renderPresets(presetsState(), { cols: 100 }));
  const footer = out.split('\n').slice(-2).join(' ');
  assert.match(footer, /r rename/);
  assert.match(footer, /d delete/);
  assert.match(footer, /h harness/);
  assert.match(footer, /s speed/);
  assert.match(footer, /m agent-merge/);
  assert.match(footer, /S save/);
  assert.match(footer, /esc discard/);
});

test('p (provider) is hinted only when providers.ollama is configured', () => {
  const configured = plain(renderPresets(presetsState({ providerConfigured: true }), { cols: 100 }));
  const notConfigured = plain(renderPresets(presetsState({ providerConfigured: false }), { cols: 100 }));
  assert.match(configured.split('\n').slice(-2).join(' '), /p provider/);
  assert.doesNotMatch(notConfigured.split('\n').slice(-2).join(' '), /p provider/);
});

// --- render: overlays own the footer while open -----------------------------

test('the delete confirmation names the target preset', () => {
  const out = plain(renderPresets(presetsState({ deleteConfirm: { index: 0 } }), { cols: 100 }));
  assert.match(out, /delete preset "fast local"/);
  assert.match(out.split('\n').slice(-2).join(' '), /y confirm/);
});

test('an open prompt shows its typed value and the commit/cancel footer', () => {
  const out = plain(renderPresets(presetsState({ prompt: { mode: 'new', value: 'nightly', error: null } }), { cols: 100 }));
  assert.match(out, /nightly/);
  assert.match(out.split('\n').slice(-2).join(' '), /↵ commit\s+esc cancel/);
});

test('a save error is shown inline', () => {
  const out = plain(renderPresets(presetsState({ saveError: ['duplicate preset name: x'] }), { cols: 100 }));
  assert.match(out, /duplicate preset name: x/);
});

// --- key handling: overlays own every keystroke while open ------------------

test('delete confirm: y confirms, anything else cancels', () => {
  const s = { presets: presetsState({ deleteConfirm: { index: 0 } }) };
  assert.deepEqual(handleKey('y', s), { type: 'presets-confirm-delete' });
  assert.deepEqual(handleKey('n', s), { type: 'presets-cancel-delete' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'presets-cancel-delete' });
});

test('prompt: types, backspaces, commits, cancels', () => {
  const s = { presets: presetsState({ prompt: { mode: 'new', value: '', error: null } }) };
  assert.deepEqual(handleKey('a', s), { type: 'presets-prompt-type', char: 'a' });
  assert.deepEqual(handleKey('\x7f', s), { type: 'presets-prompt-backspace' });
  assert.deepEqual(handleKey('\r', s), { type: 'presets-commit-prompt' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'presets-cancel-prompt' });
});

test('prompt: an escape sequence (multi-byte) is ignored, not typed literally', () => {
  const s = { presets: presetsState({ prompt: { mode: 'new', value: '', error: null } }) };
  assert.equal(handleKey('\x1b[A', s), null);
});

// --- key handling: top level -------------------------------------------

test('j/k move the row cursor; n opens the new-preset prompt; S saves; esc discards', () => {
  const s = { presets: presetsState() };
  assert.deepEqual(handleKey('j', s), { type: 'presets-move-row', delta: 1 });
  assert.deepEqual(handleKey('k', s), { type: 'presets-move-row', delta: -1 });
  assert.deepEqual(handleKey('n', s), { type: 'presets-new' });
  assert.deepEqual(handleKey('S', s), { type: 'presets-save' });
  assert.deepEqual(handleKey('\x1b', s), { type: 'back' });
});

test('r/d/h/s/m only fire when a preset is selected', () => {
  const withPreset = { presets: presetsState() };
  assert.deepEqual(handleKey('r', withPreset), { type: 'presets-rename' });
  assert.deepEqual(handleKey('d', withPreset), { type: 'presets-open-delete-confirm' });
  assert.deepEqual(handleKey('h', withPreset), { type: 'presets-cycle-harness' });
  assert.deepEqual(handleKey('s', withPreset), { type: 'presets-cycle-speed' });
  assert.deepEqual(handleKey('m', withPreset), { type: 'presets-toggle-agent-merge' });

  const empty = { presets: presetsState({ presets: [] }) };
  assert.equal(handleKey('r', empty), null);
  assert.equal(handleKey('d', empty), null);
  assert.equal(handleKey('h', empty), null);
  assert.equal(handleKey('s', empty), null);
  assert.equal(handleKey('m', empty), null);
});

test('p cycles the provider only when providers.ollama is configured', () => {
  const configured = { presets: presetsState({ providerConfigured: true }) };
  assert.deepEqual(handleKey('p', configured), { type: 'presets-cycle-provider' });

  const notConfigured = { presets: presetsState({ providerConfigured: false }) };
  assert.equal(handleKey('p', notConfigured), null);
});

test('handleKey with no presets session at all: only bare escape does anything', () => {
  assert.deepEqual(handleKey('\x1b', {}), { type: 'back' });
  assert.equal(handleKey('n', {}), null);
});

// --- router seam: render/routeHandleKey -------------------------------------

test('render(state, opts) reads state.presets', () => {
  const out = plain(render({ presets: presetsState() }, { cols: 100 }));
  assert.match(out, /fast local/);
});

// design.md Decision 6: routeHandleKey translates the internal `back` into
// `back-to-settings-from-presets`, NEVER the bare `back` watch.js's
// applyAction would otherwise intercept and route to backToFleet() ahead of
// the presets controller — mirroring docview.js's own routeHandleKey.
test('routeHandleKey translates Escape into back-to-settings-from-presets, not back', () => {
  const action = routeHandleKey('\x1b', { presets: presetsState() });
  assert.deepEqual(action, { type: 'back-to-settings-from-presets' });
});

test('routeHandleKey passes every other action through unchanged', () => {
  const action = routeHandleKey('n', { presets: presetsState() });
  assert.deepEqual(action, { type: 'presets-new' });
});

test('routeHandleKey returns null for an unrecognised key', () => {
  assert.equal(routeHandleKey('z', { presets: presetsState() }), null);
});
