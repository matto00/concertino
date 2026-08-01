'use strict';

// The ticket-draft screen (CON-21). Reached from the fleet view's `n` prompt
// when the typed value is not ticket-shaped (see fleet.js's promptKey and
// design.md Decision 4): a headless drafting invocation (lib/ui/draft.js)
// produces a title/description/acceptanceCriteria draft, and this screen
// shows it for review — edit any field, confirm to create the ticket in the
// provider and launch the run, or abandon with zero side effects.
//
// Modeled on escalation.js's per-field edit sub-mode (open-reply/reply-type/
// reply-backspace), design.md Decision 3 — adapted for three independently
// editable, PERSISTENT fields rather than one ephemeral reply: escape while
// editing a field commits that field's buffer and returns to the overview,
// it does not discard it. Abandoning the WHOLE draft is a separate action,
// only reachable from the overview (never mid-field-edit).
//
// Pure: (state, opts) -> string / (key, state) -> action | null. Never
// touches Linear or the filesystem itself — watch.js's applyAction is what
// actually creates the ticket, launches the run and refreshes the cache
// (design.md Decision 1/5).

const f = require('../format');
const layout = require('../layout');
const textwrap = require('../textwrap');

// Matches fleet.js/escalation.js/drilldown.js's identical constant — every
// box costs 2 columns to its border characters and 2 more to box()'s default
// horizontal padding.
const BOX_BORDER_PADDING_COLS = 4;

const FIELDS = [
  { name: 'title', key: 't', label: 'title' },
  { name: 'description', key: 'd', label: 'description' },
  { name: 'acceptanceCriteria', key: 'a', label: 'acceptance criteria' },
];

function renderTicketDraft(draft, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const out = [];
  out.push(f.bold('concertino') + f.dim(' · new ticket'));
  out.push('');

  // The screen can only ever be reached with a live draft (watch.js clears
  // ticketDraft and returns to the fleet in the same step it leaves this
  // mode) — this mirrors escalation.js's own "run vanished" defensive
  // render rather than assuming that can never happen.
  if (!draft) {
    out.push(f.dim('  no draft in progress'));
    out.push('');
    out.push(f.dim('  esc back'));
    return out.map((l) => f.truncate(l, cols)).join('\n');
  }

  const field = draft.field;
  const innerWidth = Math.max(1, cols - BOX_BORDER_PADDING_COLS - 4);
  const boxContent = [];

  for (const def of FIELDS) {
    const active = !!(field && field.name === def.name);
    const marker = active ? '▸ ' : '  ';
    boxContent.push(marker + f.bold('[' + def.key + '] ' + def.label));
    const raw = active ? field.value : draft[def.name];
    const text = String(raw || '').trim();
    const lines = text ? textwrap.wrap(text, innerWidth) : [f.dim('(empty)')];
    for (const l of lines) boxContent.push('    ' + l);
    if (active) boxContent.push('    ▏');
    boxContent.push('');
  }

  if (draft.error) {
    boxContent.push(f.red(f.truncate(draft.error, Math.max(0, cols - BOX_BORDER_PADDING_COLS))));
    boxContent.push('');
  }

  // Trailing blank dropped as a content row — the box's own bottom border is
  // the visual break, same discipline as escalation.js's boxContent.
  if (boxContent.length && boxContent[boxContent.length - 1] === '') boxContent.pop();

  const boxHeight = boxContent.length + 2;
  for (const line of layout.box(boxContent, { width: cols, height: boxHeight, title: 'NEW TICKET', focused: false })) {
    out.push(line);
  }
  out.push('');

  if (draft.creating) {
    out.push(f.dim('  creating…'));
  } else if (field) {
    const multiline = field.name !== 'title';
    out.push(f.dim('  esc save field' + (multiline ? '   ↵ newline' : '   ↵ save field')));
  } else {
    out.push(f.dim('  t/d/a edit   c confirm   esc abandon'));
  }

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

// Given a keypress and { draft }, returns an action for watch.js to carry
// out, or null for "no-op, no redraw". Never mutates — watch.js owns
// ticketDraft and interprets what comes back.
function handleKey(key, state) {
  const draft = state && state.draft;
  if (!draft) {
    if (key === '\x1b') return { type: 'cancel-draft' };
    return null;
  }

  // Nothing is bound while the create+launch call is in flight — the same
  // "busy, only what's already been dispatched can finish" discipline
  // fleet.js's promptKey gives prompt.drafting.
  if (draft.creating) return null;

  if (key.length > 1) return null;

  const field = draft.field;
  if (field) {
    const multiline = field.name !== 'title';
    if (key === '\x1b' || key === '') return { type: 'commit-draft-field' }; // Escape/Ctrl-C: save, don't discard
    if (key === '\x7f' || key === '\b') return { type: 'draft-field-backspace' };
    if (key === '\r' || key === '\n') {
      if (multiline) return { type: 'draft-field-type', char: '\n' };
      return { type: 'commit-draft-field' };
    }
    if (key >= ' ') return { type: 'draft-field-type', char: key };
    return null;
  }

  if (key === '\x1b' || key === '') return { type: 'cancel-draft' };
  if (key === 't') return { type: 'open-draft-field', field: 'title' };
  if (key === 'd') return { type: 'open-draft-field', field: 'description' };
  if (key === 'a') return { type: 'open-draft-field', field: 'acceptanceCriteria' };
  if (key === 'c') return { type: 'confirm-draft' };
  return null;
}

// Uniform router seam: every screen exposes render(state, opts)/routeHandleKey
// so router.js never needs to know a screen's own internal shape — mirrors
// escalation.js's identical pair.
function render(state, opts) {
  return renderTicketDraft(state && state.ticketDraft, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, { draft: state && state.ticketDraft });
}

module.exports = { renderTicketDraft, handleKey, render, routeHandleKey, FIELDS };
