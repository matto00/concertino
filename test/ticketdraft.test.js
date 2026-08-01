'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderTicketDraft, handleKey, render, routeHandleKey } = require('../lib/ui/screens/ticketdraft');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function draft(over) {
  return Object.assign({
    seed: 'add a share button to dashboards',
    title: 'Add a share button to dashboards',
    description: 'Dashboards need a share action so a link can be copied.',
    acceptanceCriteria: '- a share button appears on every dashboard\n- clicking it copies a link',
    field: null,
    error: null,
    creating: false,
  }, over);
}

const OPTS = { cols: 78 };

// --- render ------------------------------------------------------------

test('renders all three fields', () => {
  const out = plain(renderTicketDraft(draft({}), OPTS));
  assert.match(out, /NEW TICKET/);
  assert.match(out, /\[t\] title/);
  assert.match(out, /Add a share button to dashboards/);
  assert.match(out, /\[d\] description/);
  assert.match(out, /Dashboards need a share action/);
  assert.match(out, /\[a\] acceptance criteria/);
  assert.match(out, /a share button appears on every dashboard/);
});

test('an empty field renders as (empty) rather than a blank line indistinguishable from a wrapped one', () => {
  const out = plain(renderTicketDraft(draft({ description: '' }), OPTS));
  assert.match(out, /\(empty\)/);
});

test('a null draft renders a safe fallback rather than throwing', () => {
  const out = renderTicketDraft(null, OPTS);
  assert.match(out, /no draft in progress/);
  assert.match(out, /esc back/);
});

test('the overview footer advertises edit/confirm/abandon', () => {
  const out = plain(renderTicketDraft(draft({}), OPTS));
  assert.match(out, /t\/d\/a edit/);
  assert.match(out, /c confirm/);
  assert.match(out, /esc abandon/);
});

test('editing a field shows the active field marker and its own footer', () => {
  const editing = draft({ field: { name: 'title', value: 'Edited title' } });
  const out = plain(renderTicketDraft(editing, OPTS));
  assert.match(out, /▸ \[t\] title/);
  assert.match(out, /Edited title/);
  assert.match(out, /esc save field/);
});

test('editing a multi-line field advertises the newline hint; title (single-line) does not', () => {
  const editingDesc = draft({ field: { name: 'description', value: 'x' } });
  assert.match(plain(renderTicketDraft(editingDesc, OPTS)), /↵ newline/);

  const editingTitle = draft({ field: { name: 'title', value: 'x' } });
  assert.doesNotMatch(plain(renderTicketDraft(editingTitle, OPTS)), /↵ newline/);
});

test('an inline error is shown, and creating shows a busy indicator', () => {
  const errored = draft({ error: 'could not create ticket: linear: HTTP 500' });
  assert.match(plain(renderTicketDraft(errored, OPTS)), /could not create ticket: linear: HTTP 500/);

  const creating = draft({ creating: true });
  assert.match(plain(renderTicketDraft(creating, OPTS)), /creating…/);
});

// --- handleKey: overview -------------------------------------------------

test('t/d/a open the corresponding field for editing', () => {
  assert.deepEqual(handleKey('t', { draft: draft({}) }), { type: 'open-draft-field', field: 'title' });
  assert.deepEqual(handleKey('d', { draft: draft({}) }), { type: 'open-draft-field', field: 'description' });
  assert.deepEqual(handleKey('a', { draft: draft({}) }), { type: 'open-draft-field', field: 'acceptanceCriteria' });
});

test('c confirms the draft', () => {
  assert.deepEqual(handleKey('c', { draft: draft({}) }), { type: 'confirm-draft' });
});

test('escape abandons the draft from the overview', () => {
  assert.deepEqual(handleKey('\x1b', { draft: draft({}) }), { type: 'cancel-draft' });
  assert.deepEqual(handleKey('', { draft: draft({}) }), { type: 'cancel-draft' }); // Ctrl-C
});

test('an unbound key at the overview is a no-op', () => {
  assert.equal(handleKey('z', { draft: draft({}) }), null);
});

test('no draft in state: escape still returns to the fleet, everything else is a no-op', () => {
  assert.deepEqual(handleKey('\x1b', { draft: null }), { type: 'cancel-draft' });
  assert.equal(handleKey('c', { draft: null }), null);
});

test('nothing is bound while creating — the busy overview does not accept t/d/a/c/esc', () => {
  const busy = draft({ creating: true });
  assert.equal(handleKey('t', { draft: busy }), null);
  assert.equal(handleKey('c', { draft: busy }), null);
  assert.equal(handleKey('\x1b', { draft: busy }), null);
});

// --- handleKey: editing a field -------------------------------------------

test('typing appends to the field buffer', () => {
  const editing = { draft: draft({ field: { name: 'title', value: 'T' } }) };
  assert.deepEqual(handleKey('x', editing), { type: 'draft-field-type', char: 'x' });
});

test('backspace removes a character from the field buffer', () => {
  const editing = { draft: draft({ field: { name: 'title', value: 'Ti' } }) };
  assert.deepEqual(handleKey('\x7f', editing), { type: 'draft-field-backspace' });
});

test('enter on the single-line title field commits it', () => {
  const editing = { draft: draft({ field: { name: 'title', value: 'T' } }) };
  assert.deepEqual(handleKey('\r', editing), { type: 'commit-draft-field' });
});

test('enter on a multi-line field (description/acceptanceCriteria) inserts a newline instead of committing', () => {
  const editingDesc = { draft: draft({ field: { name: 'description', value: 'D' } }) };
  assert.deepEqual(handleKey('\r', editingDesc), { type: 'draft-field-type', char: '\n' });

  const editingAC = { draft: draft({ field: { name: 'acceptanceCriteria', value: 'A' } }) };
  assert.deepEqual(handleKey('\r', editingAC), { type: 'draft-field-type', char: '\n' });
});

test('escape while editing commits the field rather than discarding it — fields are persistent, not an ephemeral reply', () => {
  const editing = { draft: draft({ field: { name: 'description', value: 'edited' } }) };
  assert.deepEqual(handleKey('\x1b', editing), { type: 'commit-draft-field' });
});

test('a letter that would otherwise open a different field (t/d/a) types into the currently open field instead', () => {
  const editing = { draft: draft({ field: { name: 'description', value: 'D' } }) };
  assert.deepEqual(handleKey('t', editing), { type: 'draft-field-type', char: 't' });
  assert.deepEqual(handleKey('a', editing), { type: 'draft-field-type', char: 'a' });
});

test('an arrow key (multi-byte escape sequence) while editing is ignored, not typed literally', () => {
  const editing = { draft: draft({ field: { name: 'title', value: 'x' } }) };
  assert.equal(handleKey('\x1b[A', editing), null);
});

// --- router seam -----------------------------------------------------------

test('render(state, opts) reads state.ticketDraft', () => {
  const out = plain(render({ ticketDraft: draft({}) }, OPTS));
  assert.match(out, /NEW TICKET/);
});

test('routeHandleKey(key, state) reads state.ticketDraft', () => {
  assert.deepEqual(routeHandleKey('c', { ticketDraft: draft({}) }), { type: 'confirm-draft' });
});
