'use strict';

// The sessions screen (CON-78): a second, lower-level lens beside the
// run-centric fleet — every discovered harness process, Concertino-managed
// or freelance, with harness/version/cwd/tmux-location/age and a per-row
// attach/kill affordance. Pure: (state, opts) -> string /
// (key, state) -> action | null, following the same router seam every other
// screen uses (see settings.js's own header comment for the closest
// analogue — a screen with no per-ticket sub-state beyond a cursor and a
// confirm flag).
//
// Movement is arrow-keys only (never bare j/k) — the same choice
// drilldown.js makes for its own TICKET/TIMELINE/GATES panels, for the same
// reason: `k` is reserved for kill here too (design.md Decision 7 /
// tasks.md 3.1's own "matching drilldown.js's own hint-list convention").
//
// Confirm state is split across two different fields, deliberately (design.md
// Decision 7's own confirm-state-field bullet): a MANAGED row's kill confirm
// reads `state.drillConfirm` as its boolean GATE (mirroring the drill-down's
// own prompt exactly, since a managed kill delegates to the same underlying
// action) but `state.sessionsConfirmTicket` as its TARGET — captured the
// moment `k` is pressed, never re-derived from `sessions[selected]` while
// the confirm is up. A FREELANCE row's confirm reads `state.sessionsKillConfirm`
// (`{ pid, tmux }`, also captured at `k`-press time) for both gate and
// target. Both captures exist for the same reason: the sessions screen's own
// background auto-refresh (watch.js's bounded 3-tick cadence) can replace
// `state.sessionsData` — and reorder it — while a confirm sits on screen
// waiting for the operator to read it and press `y`; resolving the target
// from the live list at THAT moment could silently retarget the kill to
// whatever session now happens to occupy the same array index (evaluator
// cycle-1 change request 1). Capturing at `k`-press time, and never
// re-deriving, closes that window for both row kinds.

const f = require('../format');
const { confirmLines } = require('../widgets/confirm');
const { emptyState } = require('../widgets/empty');

function ownerLabel(sess) {
  if (sess.managed) return 'managed · ' + sess.ticket;
  if (sess.nearTicket) return 'freelance · near ticket ' + sess.nearTicket + '\'s worktree';
  return 'freelance';
}

function isAttachable(sess) {
  return !!(sess.managed || sess.tmux);
}

function tmuxLabel(sess) {
  return sess.tmux ? sess.tmux.session + ':' + sess.tmux.window : 'not in tmux';
}

function sessionRow(sess, isSelected, width) {
  const marker = isSelected ? '▸' : ' ';
  const harnessCol = f.padTo(f.truncate(sess.harness || '?', 10), 10);
  const versionCol = f.padTo(f.truncate(sess.version || 'unknown', 10), 10);
  const cwdCol = f.padTo(f.truncate(sess.cwd || 'unknown', 26), 26);
  const tmuxCol = f.padTo(f.truncate(tmuxLabel(sess), 20), 20);
  const ageCol = f.padTo(sess.ageMs != null ? f.dur(sess.ageMs) : 'unknown', 5);
  const owner = ownerLabel(sess);
  const suffix = isAttachable(sess) ? '' : '  ' + f.dim('(not attachable)');
  const line = ' ' + marker + ' ' + harnessCol + ' ' + versionCol + ' ' + cwdCol + ' ' + tmuxCol + ' ' + ageCol + '  ' + owner + suffix;
  const truncated = f.truncate(line, width);
  return isSelected ? f.bold(truncated) : truncated;
}

function headerRow(width) {
  const line = '   ' + f.padTo('HARNESS', 10) + ' ' + f.padTo('VERSION', 10) + ' ' +
    f.padTo('CWD', 26) + ' ' + f.padTo('TMUX', 20) + ' ' + f.padTo('AGE', 5) + '  OWNER';
  return f.dim(f.truncate(line, width));
}

function renderSessions(state, opts) {
  const cols = Math.max(50, (opts && opts.cols) || 80);
  const sessions = state.sessionsData;

  const out = [];
  out.push(f.bold('concertino') + f.dim(' · sessions'));
  out.push('');

  if (sessions == null) {
    out.push(f.dim('  discovering…'));
    out.push('');
    out.push(f.dim('  esc back'));
    return out.map((l) => f.truncate(l, cols)).join('\n');
  }

  const selected = sessions.length ? Math.max(0, Math.min(state.sessionsSelected || 0, sessions.length - 1)) : 0;
  const sess = sessions[selected] || null;

  if (sessions.length) {
    out.push(headerRow(cols));
    for (let i = 0; i < sessions.length; i++) out.push(sessionRow(sessions[i], i === selected, cols));
  } else {
    for (const line of emptyState({ message: '  no harness sessions discovered' })) out.push(line);
  }
  out.push('');

  if (state.sessionsError) {
    out.push('  ' + f.red(f.truncate(state.sessionsError, cols - 4)));
    out.push('');
  }

  // Both confirm branches render from the value CAPTURED at k-press time
  // (`state.sessionsConfirmTicket` / `state.sessionsKillConfirm`), never
  // from `sess` (the currently-selected row) — see this file's own header
  // comment on why re-deriving here would be exactly the bug a background
  // auto-refresh could exploit.
  const managedConfirming = state.drillConfirm === 'kill' && !!state.sessionsConfirmTicket;
  const freelanceConfirming = !!state.sessionsKillConfirm;

  if (managedConfirming || freelanceConfirming) {
    const label = managedConfirming ? state.sessionsConfirmTicket : ('pid ' + state.sessionsKillConfirm.pid);
    for (const line of confirmLines({
      warning: f.red(f.bold('kill ' + label + '?') + ' ends the session — it cannot resume'),
      confirmHint: 'y confirm   (any other key) cancel',
    })) out.push(line);
  } else {
    const hints = ['↑/↓ move', 'r refresh'];
    if (sess) {
      if (isAttachable(sess)) hints.push('↵ attach');
      hints.push('k kill');
    }
    hints.push('esc back');
    for (const line of f.hintLines(hints, cols)) out.push(line);
  }

  return out.map((l) => f.truncate(l, cols)).join('\n');
}

// Pure: (key, state) -> action | null. watch.js owns sessionsData/
// sessionsSelected/sessionsKillConfirm/sessionsError and applies every
// action this returns — see controllers/sessions.js.
function handleKey(key, state) {
  const sessions = state.sessionsData || [];
  const selected = sessions.length ? Math.max(0, Math.min(state.sessionsSelected || 0, sessions.length - 1)) : 0;
  const sess = sessions[selected] || null;

  // A destructive action needs a deliberate 'y'; anything else backs out
  // without acting (mirrors drilldown.js's own confirm handling exactly).
  // Both branches act on the value CAPTURED at k-press time, never on `sess`
  // (the currently-selected row) — see this file's own header comment.
  if (state.drillConfirm === 'kill' && state.sessionsConfirmTicket) {
    if (key === 'y') return { type: 'kill-session-managed', ticket: state.sessionsConfirmTicket };
    return { type: 'cancel-managed-kill-confirm' };
  }
  if (state.sessionsKillConfirm) {
    if (key === 'y') return { type: 'kill-session-confirmed' };
    return { type: 'cancel-session-kill-confirm' };
  }

  if (key === '\x1b') return { type: 'back' };
  if (key === 'r') return { type: 'refresh-sessions' };
  if (key === '\x1b[B') return { type: 'move-sessions', delta: 1 };
  if (key === '\x1b[A') return { type: 'move-sessions', delta: -1 };

  if (!sess) return null;

  if (key === '\r' && isAttachable(sess)) {
    return sess.managed
      ? { type: 'attach', ticket: sess.ticket }
      : { type: 'attach-session', session: sess.tmux.session, windowId: sess.tmux.windowId };
  }

  if (key === 'k') {
    // The ticket/pid is captured HERE, in the action itself — not left for
    // the controller to re-derive later from whatever row a refresh may
    // have since reordered into this position.
    if (sess.managed) return { type: 'open-managed-kill-confirm', ticket: sess.ticket };
    return { type: 'kill-session-confirm', pid: sess.pid, tmuxTarget: sess.tmux };
  }

  return null;
}

// Uniform router seam: every screen exposes render(state, opts)/
// routeHandleKey(key, state) — see router.js.
function render(state, opts) {
  return renderSessions(state, opts);
}

function routeHandleKey(key, state) {
  return handleKey(key, state);
}

module.exports = {
  renderSessions, handleKey, render, routeHandleKey,
  sessionRow, ownerLabel, isAttachable, tmuxLabel,
};
