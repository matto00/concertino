'use strict';

// The escalation screen. Pure: (run, opts) -> string. Reached from the fleet
// view by selecting a run whose `escalation` is live. Answering writes
// `answer.json` (see lib/ui/store.js) — this module never touches disk itself;
// it only renders and, from handleKey, describes what the human asked for as
// an action for watch.js to carry out.

const f = require('../format');
const layout = require('../layout');
const textwrap = require('../textwrap');
const docview = require('./docview');
const { inputLines } = require('../widgets/textinput');
const { sectionHeader } = require('../widgets/header');

// Every box costs 2 columns to its border characters (one per side) and 2
// more to `box()`'s default horizontal padding — see fleet.js/drilldown.js's
// identical constant.
const BOX_BORDER_PADDING_COLS = 4;

// 't' is reserved for "type a reply"; 'j'/'k' (lazygit-layout pass) scroll
// the context block — none of the three may ever be shadowed by an option
// that happens to start with the same letter.
const RESERVED_KEYS = new Set(['t', 'j', 'k']);

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

// CON-46: true only when `esc.subQuestions` is a non-empty array — the sole
// switch between the single-question rendering/handleKey path (unchanged)
// and the wizard step-through path. An absent/empty array degrades to the
// single-question shape, never a wizard with zero steps.
function isWizard(esc) {
  return !!(esc && Array.isArray(esc.subQuestions) && esc.subQuestions.length > 0);
}

// Clamps a candidate step index into `[0, subQuestions.length - 1]` — a
// stale or out-of-range `escalationSubIndex` (e.g. after a step count
// somehow shrank) must never pick a step that doesn't exist rather than
// throwing or silently rendering nothing.
function clampSubIndex(subIndex, subQuestions) {
  const i = Number.isInteger(subIndex) ? subIndex : 0;
  return Math.max(0, Math.min(i, subQuestions.length - 1));
}

// CON-46, design.md Decision 7: given `store.readSubAnswers()`'s result (or
// `null`, when no `answer.json` exists yet) and the escalation's declared
// sub-question count, returns the step index a reopened wizard should
// resume at — the first unanswered (`null`) slot, the last step when every
// slot already has an answer (nothing left to advance past — e.g. a
// completion the poll loop hasn't yet noticed), or `0` when nothing has been
// recorded yet at all. Exported so `watch.js`'s `open-escalation` handling
// and this module's own tests share exactly one definition of "resume
// point" rather than two implementations that could quietly drift apart.
function resumeSubIndex(recorded, total) {
  if (!recorded || !Array.isArray(recorded.subAnswers) || !recorded.subAnswers.length) return 0;
  const firstUnanswered = recorded.subAnswers.findIndex((a) => a == null);
  if (firstUnanswered !== -1) return firstUnanswered;
  return Math.max(0, total - 1);
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

  // CON-46: when `subQuestions` is present and non-empty, render exactly the
  // current step — its own question/options — never any other step (design.md
  // Decision 6). A single-question escalation (no `subQuestions`) computes the
  // exact same `currentQuestion`/`currentOptions` values it always rendered,
  // so that path is provably unchanged (task 5.4).
  const wizard = isWizard(esc);
  const subIndex = wizard ? clampSubIndex((opts && opts.subIndex), esc.subQuestions) : 0;
  const currentStep = wizard ? (esc.subQuestions[subIndex] || {}) : null;
  const currentQuestion = wizard ? (currentStep.question || '') : esc.question;
  const currentOptions = wizard ? (currentStep.options || []) : esc.options;

  // The question/context/options block is this screen's one interactive
  // surface — wrapped in a single box, plain/unfocused border set, matching
  // design.md Decision 2's single-pane rule (no second input target on this
  // screen for a "focused" style to be distinguished against, same reasoning
  // as fleet.js's four sections and drilldown.js's three panels).
  const boxWidth = cols;
  const innerWidth = Math.max(0, boxWidth - BOX_BORDER_PADDING_COLS);
  const boxContent = [];
  // No icon here — `tag` is already governed by STATUS_COLOUR (the
  // "needs-you"/stale distinction), matching fleet.js's own status-governed
  // section headings (NEEDS YOU/RUNNING/FAILED/DONE), which likewise carry
  // no icon since one would only duplicate what STATUS_COLOUR already
  // signals (dashboard-iconography's own requirement). Routed through
  // sectionHeader anyway, as a plain passthrough, so this composed header
  // line is built the same one way every other screen's header line is.
  boxContent.push(sectionHeader({ label: tag + '  ' + f.dim(phase) }));
  if (wizard) {
    boxContent.push(f.dim('sub-question ' + (subIndex + 1) + ' of ' + esc.subQuestions.length));
  }
  boxContent.push('');
  for (const line of textwrap.wrap(currentQuestion, innerWidth)) boxContent.push(line);
  boxContent.push('');

  // Context renders between the question and the options — the whole point
  // (CON-11) is deciding from this screen alone. Degrade honestly when there
  // is none: no label, no empty frame, identical to pre-change output.
  // gather-escalation-context.sh's blocks are multi-line by design (one
  // labelled field per line) — textwrap.wrap() already splits on '\n' first
  // and wraps each line independently, so this preserves that field-per-line
  // shape while also wrapping any individual over-long line (lazygit-layout
  // pass) instead of hard-truncating it with an ellipsis. Lines beyond a
  // fixed viewport scroll (docview.windowBody, using opts.contextScroll)
  // rather than overflowing the box.
  if (esc.context) {
    const contextLines = textwrap.wrap(String(esc.context), innerWidth);
    const CONTEXT_VIEWPORT_ROWS = 10;
    const contextViewportRows = Math.min(contextLines.length, CONTEXT_VIEWPORT_ROWS);
    const windowedContext = contextLines.length <= contextViewportRows
      ? contextLines
      : docview.windowBody(contextLines, contextViewportRows, (opts && opts.contextScroll) || 0);
    for (const line of windowedContext) boxContent.push(line);
    if (esc.contextTruncated && esc.contextRef) {
      boxContent.push(f.dim(f.truncate('full context: ' + esc.contextRef, innerWidth)));
    }
    boxContent.push('');
  }

  const keys = optionKeys(currentOptions);
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

  // Lazygit-layout pass: grow-to-fill (design.md Decision 2). `meta` is
  // computed here — ahead of the box push — purely so `belowBoxRows` below
  // can know, before the box is sized, exactly how many rows will follow it
  // this frame; the values pushed to `out` later are unchanged.
  const meta = [];
  if (esc.role) meta.push('raised by ' + esc.role);
  if (esc.raisedAt != null) meta.push(f.dur(Math.max(0, now - esc.raisedAt)) + ' ago');

  // `belowBoxRows` mirrors, row-for-row, every push that happens after the
  // box below — the blank separator, the optional meta line, the optional
  // "writes answer.json…" hint (2 rows), the optional reply block (2 or 3
  // rows depending on `reply.error`), the optional notice block (2 rows),
  // the blank before the footer, and the footer line itself. Kept in lockstep
  // with the actual pushes below by construction — same reasoning as
  // `launchplan.js`'s existing `belowBoxRows`.
  let belowBoxRows = 1; // blank separator after the box
  if (meta.length) belowBoxRows += 1;
  if (!stale) belowBoxRows += 2;
  if (reply) {
    belowBoxRows += 2;
    if (reply.error) belowBoxRows += 1;
  }
  if (notice) belowBoxRows += 2;
  belowBoxRows += 1; // blank before the footer
  belowBoxRows += 1; // footer line

  const naturalBoxHeight = boxContent.length + 2;
  const budget = (opts && opts.rows) > 0 ? opts.rows - 1 : 0;
  let boxHeight = naturalBoxHeight;
  if (budget > 0) {
    const usedSoFar = out.length + belowBoxRows;
    boxHeight = Math.max(naturalBoxHeight, budget - usedSoFar);
  }
  for (const line of pane(boxContent, { width: boxWidth, height: boxHeight, focused: false })) out.push(line);
  out.push('');

  if (meta.length) out.push('  ' + f.dim(meta.join('   ·   ')));

  if (!stale) {
    out.push('');
    out.push('  ' + f.dim('writes .concertino/runs/' + run.ticket + '/answer.json — agent is polling'));
  }

  if (reply) {
    out.push('');
    for (const line of inputLines({ label: 'reply', value: reply.value, cols, error: reply.error })) out.push(line);
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

// Given a keypress and the local screen state ({ run, reply, subIndex }),
// returns an action for watch.js to carry out, or null for "no-op, no
// redraw". Never mutates — watch.js owns state and interprets what comes
// back.
//
// CON-46: both ways of answering the current wizard step — an option key, or
// a confirmed free-text reply — resolve to the SAME `answer-sub` action
// (index, value, total). There is no action type that accepts an arbitrary
// target step; "cannot jump ahead of an unanswered one" is therefore true by
// construction (design.md Decision 6), not a range check that could later be
// bypassed. The single-question path (no `subQuestions`) computes the exact
// same `currentOptions` it always used and returns the exact same `answer`/
// `submit-reply` actions it always did — provably unchanged (task 5.4).
function handleKey(key, state) {
  const run = state && state.run;
  const reply = state && state.reply;

  if (!run) {
    if (key === '\x1b') return { type: 'back' };
    return null;
  }

  const esc = run.escalation;
  const wizard = isWizard(esc);
  const subIndex = wizard ? clampSubIndex(state && state.subIndex, esc.subQuestions) : 0;
  const currentOptions = wizard ? (esc.subQuestions[subIndex].options || []) : (esc ? esc.options : []);
  const total = wizard ? esc.subQuestions.length : 0;

  if (reply) {
    if (key.length > 1) return null;
    if (key === '\x1b' || key === '') return { type: 'cancel-reply' };       // Escape / Ctrl-C
    if (key === '\x7f' || key === '\b') return { type: 'reply-backspace' };
    if (key === '\r' || key === '\n') {
      const value = (reply.value || '').trim();
      if (!value) return { type: 'cancel-reply' };
      if (wizard) return { type: 'answer-sub', ticket: run.ticket, index: subIndex, value, total };
      return { type: 'submit-reply', ticket: run.ticket, value };
    }
    if (key >= ' ') return { type: 'reply-type', char: key };
    return null;
  }

  if (key === '\x1b') return { type: 'back' };
  if (key === '\r') return { type: 'attach', ticket: run.ticket };

  if (esc && !run.escalationStale) {
    if (key === 't') return { type: 'open-reply' };
    // Lazygit-layout pass: scrolls the context block when it overflows its
    // viewport — j/k/page-keys via the shared docview.scrollDelta, same
    // 10-line page-jump trade-off launchplan.js's own ticket-list scroll
    // makes (no precomputed viewport-rows to size a page exactly here).
    const scrollKey = docview.scrollDelta(key, 10);
    if (scrollKey) return { type: 'scroll-escalation-context', delta: scrollKey.lines };
    const keys = optionKeys(currentOptions);
    if (keys.has(key)) {
      if (wizard) return { type: 'answer-sub', ticket: run.ticket, index: subIndex, value: keys.get(key), total };
      return { type: 'answer', ticket: run.ticket, value: keys.get(key) };
    }
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
    contextScroll: state.escalationContextScroll,
    subIndex: state.escalationSubIndex,
  }));
}

function routeHandleKey(key, state) {
  const run = (state.runs || []).find((r) => r.ticket === state.escalationTicket) || null;
  return handleKey(key, { run, reply: state.escalationReply, subIndex: state.escalationSubIndex });
}

module.exports = { renderEscalation, handleKey, render, routeHandleKey, optionKeys, resumeSubIndex };
