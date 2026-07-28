'use strict';

// The escalation screen. Pure: (run, opts) -> string. Reached from the fleet
// view by selecting a run whose `escalation` is live. Answering writes
// `answer.json` (see lib/ui/store.js) — this module never touches disk itself;
// it only renders and, from handleKey, describes what the human asked for as
// an action for watch.js to carry out.

const f = require('../format');
const layout = require('../layout');

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — see fleet.js/drilldown.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;

// 't' is reserved for "type a reply" and must never be shadowed by an option
// that happens to start with the same letter.
const RESERVED_KEYS = new Set(['t']);

// Draws the question/context/options block through layout.box(), or — below
// layout.degrade()'s threshold — falls back to the pre-change flat rendering
// (no frame). See drilldown.js's identical `pane()` helper for why this is
// realistically dead code given this screen's own width floor, kept anyway
// per spec.md's "Narrow or short terminals drop borders before content".
function pane(contentLines, opts) {
  if (layout.degrade(opts.width, opts.height)) {
    return contentLines.map((l) => f.truncate(l, opts.width));
  }
  return layout.box(contentLines, opts);
}

// One key per option, derived from its first letter. An option whose letter
// collides with something already bound (the reserved reply key, or an
// earlier option) gets no single-letter key at all — silently dropping it
// would advertise a binding that doesn't exist, so callers must only render
// keys this function actually returned.
function optionKeys(options) {
  const map = new Map();
  for (const opt of options || []) {
    const letter = String(opt).trim().slice(0, 1).toLowerCase();
    if (!letter || RESERVED_KEYS.has(letter) || map.has(letter)) continue;
    map.set(letter, opt);
  }
  return map;
}

function renderEscalation(run, opts) {
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const reply = (opts && opts.reply) || null;
  const notice = (opts && opts.notice) || null;

  // A run that vanished between "open this screen" and "draw it" (the poll
  // loop is the only thing that can make that happen) must render safely
  // rather than throw — watch.js falls back to the fleet on the next draw,
  // but this frame still has to produce something.
  if (!run) {
    return [f.bold('concertino'), '', f.dim('  run no longer available'), '',
      f.dim('  esc back')].join('\n');
  }

  const esc = run.escalation;
  const out = [];
  const name = run.changeName || f.dim('(no branch yet)');
  out.push(f.bold('concertino') + f.dim(' · ' + run.ticket + '  ' + name));
  out.push('');

  if (!esc) {
    // Answered or timed out since this screen was opened — the poll loop will
    // send us back to the fleet on its next tick. Say so rather than render a
    // stale question as if it were still live.
    out.push(f.dim('  no escalation on this run — returning to the fleet'));
    out.push('');
    out.push(f.dim('  esc back'));
    return out.map((l) => f.truncate(l, cols)).join('\n');
  }

  const stale = !!run.escalationStale;
  // A live escalation is exactly the fleet view's "needs-you" status — reads
  // from the shared STATUS_COLOUR table (design.md Decision 4/task 6.1)
  // rather than an ad hoc f.yellow pick, same value, one source of truth.
  const tag = stale ? f.dim('[stale]') : f.STATUS_COLOUR['needs-you']('ESCALATION');
  const phase = run.phase || (run.telemetry === 'none' ? 'no telemetry' : 'phase unknown');

  // The question/context/options block is this screen's one interactive
  // surface — wrapped in a single box, plain/unfocused border set, matching
  // design.md Decision 2's single-pane rule (no second input target on this
  // screen for a "focused" style to be distinguished against, same reasoning
  // as fleet.js's four sections and drilldown.js's three panels).
  const boxWidth = cols;
  const innerWidth = Math.max(0, boxWidth - BOX_BORDER_PADDING_COLS);
  const boxContent = [];
  boxContent.push(tag + '  ' + f.dim(phase));
  boxContent.push('');
  boxContent.push(f.truncate(esc.question, innerWidth));
  boxContent.push('');

  // Context renders between the question and the options — the whole point
  // (CON-11) is deciding from this screen alone. Degrade honestly when there
  // is none: no label, no empty frame, identical to pre-change output.
  // gather-escalation-context.sh's blocks are multi-line by design (one
  // labelled field per line) — render line-by-line rather than squashing
  // through a single f.truncate, which drops embedded newlines outright.
  if (esc.context) {
    for (const line of String(esc.context).split('\n')) {
      boxContent.push(f.truncate(line, innerWidth));
    }
    if (esc.contextTruncated && esc.contextRef) {
      boxContent.push(f.dim(f.truncate('full context: ' + esc.contextRef, innerWidth)));
    }
    boxContent.push('');
  }

  const keys = optionKeys(esc.options);
  if (stale) {
    boxContent.push(f.dim('nobody is waiting on this — it cannot be answered here'));
  } else {
    for (const [letter, opt] of keys) {
      boxContent.push('  ' + f.bold('[' + letter + ']' + opt.slice(1)));
    }
    boxContent.push('  ' + f.bold('[t]ype a reply…'));
  }
  // Trailing blank dropped as a content row: the box's own bottom border is
  // now the visual break between this panel and the meta/footer lines below
  // it (design.md Decision 3's "the border replaces the trailing blank
  // separator" reasoning, applied here the same way fleet.js applies it).

  const boxHeight = boxContent.length + 2;
  for (const line of pane(boxContent, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');

  const meta = [];
  if (esc.role) meta.push('raised by ' + esc.role);
  if (esc.raisedAt != null) meta.push(f.dur(Math.max(0, now - esc.raisedAt)) + ' ago');
  if (meta.length) out.push('  ' + f.dim(meta.join('   ·   ')));

  if (!stale) {
    out.push('');
    out.push('  ' + f.dim('writes .concertino/runs/' + run.ticket + '/answer.json — agent is polling'));
  }

  if (reply) {
    out.push('');
    out.push('  ' + f.bold('reply') + f.dim(' › ') + f.truncate(reply.value || '', Math.max(0, cols - 14)) + '▏');
    if (reply.error) out.push('  ' + f.red(f.truncate(reply.error, Math.max(0, cols - 4))));
  }

  if (notice) {
    out.push('');
    out.push('  ' + f.red(f.truncate(notice, cols - 4)));
  }

  out.push('');
  if (reply) {
    out.push(f.dim('  ↵ send   esc cancel'));
  } else if (stale) {
    out.push(f.dim('  ↵ attach   esc back'));
  } else {
    const hints = Array.from(keys.keys()).map((letter) => letter + ' ' + keys.get(letter)).join('   ');
    out.push(f.dim('  ' + (hints ? hints + '   ' : '') + 't reply   ↵ attach   esc back'));
  }

  return out.map((l) => (f.visibleLength(l) > cols ? f.truncate(l, cols) : l)).join('\n');
}

// Given a keypress and the local screen state ({ run, reply }), returns an
// action for watch.js to carry out, or null for "no-op, no redraw". Never
// mutates — watch.js owns state and interprets what comes back.
function handleKey(key, state) {
  const run = state && state.run;
  const reply = state && state.reply;

  if (!run) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  if (reply) {
    if (key.length > 1) return null;
    if (key === '\x1b' || key === '') return { type: 'cancel-reply' };       // Escape / Ctrl-C
    if (key === '\x7f' || key === '\b') return { type: 'reply-backspace' };
    if (key === '\r' || key === '\n') {
      const value = (reply.value || '').trim();
      if (!value) return { type: 'cancel-reply' };
      return { type: 'submit-reply', ticket: run.ticket, value };
    }
    if (key >= ' ') return { type: 'reply-type', char: key };
    return null;
  }

  if (key === '\x1b') return { type: 'back' };
  if (key === '\r') return { type: 'attach', ticket: run.ticket };

  const esc = run.escalation;
  if (esc && !run.escalationStale) {
    if (key === 't') return { type: 'open-reply' };
    const keys = optionKeys(esc.options);
    if (keys.has(key)) return { type: 'answer', ticket: run.ticket, value: keys.get(key) };
  }

  return null;
}

// Uniform router seam: every screen exposes render(state, opts) so the router
// never needs to know a screen's own internal shape. `state.runs` is the full
// fleet; the screen picks out the one run it cares about by ticket, so it
// always reflects the latest poll rather than a snapshot taken when the
// screen was opened.
function render(state, opts) {
  const run = (state.runs || []).find((r) => r.ticket === state.escalationTicket) || null;
  return renderEscalation(run, Object.assign({}, opts, {
    reply: state.escalationReply,
    notice: state.escalationNotice,
  }));
}

function routeHandleKey(key, state) {
  const run = (state.runs || []).find((r) => r.ticket === state.escalationTicket) || null;
  return handleKey(key, { run, reply: state.escalationReply });
}

module.exports = { renderEscalation, handleKey, render, routeHandleKey, optionKeys };
