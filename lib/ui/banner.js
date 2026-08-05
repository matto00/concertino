'use strict';

// The cross-screen escalation banner (CON-25). A persistent notice, composed
// above whatever screen is on top, for the OLDEST live escalation across the
// whole fleet — not just the current run's own screen or the fleet's own
// `NEEDS YOU` section. Pure: (liveEscalations, opts) -> string | null, and a
// small handleKey for its own reply box — no disk access here, exactly like
// lib/ui/screens/escalation.js.
//
// Deliberately its OWN, separately-namespaced action verbs
// (`banner-reply-type`/`banner-reply-backspace`/`banner-cancel-reply`/
// `banner-submit-reply`) — never the bare `reply-type`/`submit-reply`/...
// verbs escalation.js owns. watch.js's `applyAction` cases for THOSE verbs
// hardcode the dedicated escalation screen's own `escalationReply` state and
// `submit-reply`'s success path force-navigates to the fleet
// (`answerEscalation` -> `backToFleet()`) — exactly the "leaves whatever
// screen you were on" requirement this module exists to satisfy. Reusing
// them unmodified would silently mutate state nothing reads and, on a
// successful submit, yank the human back to the fleet. See design.md
// Decision 6 (revised after design-gate round 1) for the full reasoning.

const f = require('./format');
const { inputLines } = require('./widgets/textinput');

// Reserved, global "open the banner's reply box" key. Audited against every
// screen's own handleKey (fleet/drilldown/launchpad/ticketview/launchplan/
// escalation) before being picked — none of them bind 'g' to anything, so
// this cannot shadow an existing per-screen binding (design.md Decision 6 /
// tasks.md task 6.4).
const RESERVED_KEY = 'g';

// `liveEscalations` is `watch.js`'s own `computeLiveEscalations(runs)` —
// already filtered to `run.escalation && !run.escalationStale` and sorted
// oldest-`raisedAt`-first, so index 0 here is always the one this banner
// targets. Returns null (nothing to render) when there is nothing live —
// callers must skip composing this into the frame in that case rather than
// print an empty banner.
function renderBanner(liveEscalations, opts) {
  if (!liveEscalations || !liveEscalations.length) return null;

  const cols = Math.max(40, (opts && opts.cols) || 80);
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const reply = (opts && opts.reply) || null;

  const oldest = liveEscalations[0];
  const esc = oldest.escalation;
  const more = liveEscalations.length - 1;

  const tag = f.STATUS_COLOUR['needs-you']('ESCALATION');
  const meta = [oldest.ticket];
  if (esc.role) meta.push(esc.role);
  if (esc.raisedAt != null) meta.push(f.dur(Math.max(0, now - esc.raisedAt)) + ' ago');
  const metaStr = f.dim(meta.join('   ·   '));
  const moreStr = more > 0 ? f.dim('   (+' + more + ' more)') : '';

  const lines = [f.truncate(tag + '  ' + metaStr + moreStr, cols)];

  if (reply) {
    for (const line of inputLines({ label: 'reply', value: reply.value, cols, error: reply.error })) lines.push(line);
    lines.push(f.dim('  ↵ send   esc cancel'));
  } else {
    const question = f.truncate(esc.question || '', Math.max(0, cols - 14));
    lines.push('  ' + question + f.dim('   [' + RESERVED_KEY + '] reply'));
  }

  return lines.map((l) => f.truncate(l, cols)).join('\n');
}

// Given a keypress and the banner's own local state ({ reply }), returns an
// action for watch.js to carry out, or null. `state.ticket` is threaded
// through by watch.js (the escalation the reply box currently targets — the
// oldest live one at the moment `g` was pressed) so `banner-submit-reply`
// knows which run's answer to write, exactly as escalation.js's own
// handleKey threads `run.ticket` through its `answer`/`submit-reply` actions.
function handleKey(key, state) {
  const reply = state && state.reply;
  if (!reply) return null;

  if (key.length > 1) return null;
  if (key === '\x1b' || key === '') return { type: 'banner-cancel-reply' };   // Escape / Ctrl-C
  if (key === '\x7f' || key === '\b') return { type: 'banner-reply-backspace' };
  if (key === '\r' || key === '\n') {
    const value = (reply.value || '').trim();
    if (!value) return { type: 'banner-cancel-reply' };
    return { type: 'banner-submit-reply', ticket: state.ticket, value };
  }
  if (key >= ' ') return { type: 'banner-reply-type', char: key };
  return null;
}

// Whether the banner should be suppressed because the screen already on top
// IS the oldest live escalation's own dedicated screen — showing it there
// would literally duplicate what lib/ui/screens/escalation.js already
// renders (design.md Decision 6 / spec.md's "suppressed on its own
// escalation's screen" scenario). A plain function of (mode, escalationTicket,
// liveEscalations) — exported so watch.js's draw() and this module's own
// tests agree on the SAME boolean rather than keeping two independent copies
// of the same condition in sync by hand.
function suppressedOnOwnScreen(mode, escalationTicket, liveEscalations) {
  return mode === 'escalation' && !!(liveEscalations && liveEscalations.length) &&
    escalationTicket === liveEscalations[0].ticket;
}

module.exports = { renderBanner, handleKey, suppressedOnOwnScreen, RESERVED_KEY };
