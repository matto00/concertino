'use strict';

// Sessions-screen actions (CON-78): opening/refreshing the process/tmux
// discovery pass, cursor movement, and the attach/kill dispatch split from
// design.md Decision 7 (revised — skeptic design round 1, change requests
// 2/3) — a MANAGED row delegates to the exact same
// `control.killConfirmed`/`session.attach` call sites the drill-down uses
// (no second implementation), while a FREELANCE row gets the minimal new
// `session.attachTarget`/`killTarget` path plus a bare SIGTERM fallback for
// a session with no tmux ancestor. Dispatched from watch.js's applyAction —
// see controllers/index.js for the shared contract.
//
// `discovery`/`killSessionTarget`/`control` arrive via ctx.deps (all three
// touch /proc, spawn processes, or shell out to tmux) — see watch.js's own
// header comment on why every fakeable dependency is required there, not
// re-required here. `attach-session` (the freelance attach) is handled
// specially in watch.js's own applyAction instead, right next to 'attach' —
// it needs the same terminal-suspend/restore machinery doAttach() already
// owns, which no controller has access to.

// discovery.discover() already wraps every internal step in its own
// try/catch (design.md Decision 1's "never blocks or slows the poll loop"
// acceptance criterion) — this is defence in depth, not the primary guard,
// so a discovery module swapped in by a test (or a future refactor) that
// forgets that discipline still can't take the dashboard down with it.
function runDiscover(ctx) {
  try {
    return ctx.deps.discovery.discover({
      config: ctx.config,
      sessionName: ctx.session.name,
      now: Date.now(),
    });
  } catch (e) {
    return [];
  }
}

function openSessions(ctx) {
  const S = ctx.S;
  S.sessionsData = runDiscover(ctx);
  S.sessionsSelected = 0;
  S.sessionsKillConfirm = null;
  S.sessionsConfirmTicket = null;
  S.drillConfirm = null;
  S.sessionsError = null;
  S.mode = 'sessions';
}

function refreshSessions(ctx) {
  const S = ctx.S;
  S.sessionsData = runDiscover(ctx);
  S.sessionsError = null;
  const len = S.sessionsData.length;
  if (S.sessionsSelected >= len) S.sessionsSelected = Math.max(0, len - 1);
}

function moveSessions(ctx, delta) {
  const S = ctx.S;
  const len = (S.sessionsData || []).length;
  if (!len) return;
  S.sessionsSelected = Math.max(0, Math.min((S.sessionsSelected || 0) + delta, len - 1));
}

// Managed row's confirmed kill — calls control.killConfirmed itself (the
// exact same function drilldown.js's 'kill-confirmed' case calls) rather
// than reusing that case verbatim, so a `{killed: false}` result can be
// surfaced here instead of silently discarded the way drilldown's own case
// discards it (it has nowhere the sessions screen reads to show it — see
// design.md Decision 7's revision for the full reasoning).
function killManagedConfirmed(ctx, ticket) {
  const S = ctx.S;
  const result = ctx.deps.control.killConfirmed(ticket, S.runs, ctx.session);
  S.drillConfirm = null;
  S.sessionsConfirmTicket = null;
  S.sessionsError = result.killed ? null : ('kill failed for ' + ticket + ': ' + (result.reason || 'unknown reason'));
}

// Freelance kill: a tmux-backed session's window is killed via the
// generalised session.killTarget (same shape as the ticket-scoped kill()); a
// non-tmux session gets a bare SIGTERM. Both wrapped — ESRCH (already
// exited) / EPERM (owned by another user) surface as a one-line notice
// rather than crashing (spec.md's "A kill failure is surfaced, not silently
// dropped").
function killFreelanceConfirmed(ctx) {
  const S = ctx.S;
  const confirm = S.sessionsKillConfirm;
  S.sessionsKillConfirm = null;
  if (!confirm) return;
  try {
    if (confirm.tmux) {
      ctx.deps.killSessionTarget(confirm.tmux.session, confirm.tmux.windowId);
    } else {
      process.kill(confirm.pid, 'SIGTERM');
    }
    S.sessionsError = null;
  } catch (e) {
    S.sessionsError = 'kill failed for pid ' + confirm.pid + ': ' + e.message;
  }
}

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    case 'open-sessions':
      openSessions(ctx);
      return true;

    case 'refresh-sessions':
      refreshSessions(ctx);
      return true;

    case 'move-sessions':
      moveSessions(ctx, action.delta);
      return true;

    // Managed-only: opens the y-confirm gate, capturing the target ticket at
    // the moment 'k' was pressed (evaluator cycle-1 change request 1) —
    // `S.drillConfirm` stays the boolean gate (mirroring the drill-down's
    // own prompt exactly, design.md Decision 7), but `S.sessionsConfirmTicket`
    // — not `sessions[selected]` — is what the 'y' handler and the render
    // both act on, so a background auto-refresh reordering `S.sessionsData`
    // in between can never retarget the pending kill.
    case 'open-managed-kill-confirm':
      S.drillConfirm = 'kill';
      S.sessionsConfirmTicket = action.ticket;
      return true;

    case 'cancel-managed-kill-confirm':
      S.drillConfirm = null;
      S.sessionsConfirmTicket = null;
      return true;

    case 'kill-session-managed':
      killManagedConfirmed(ctx, action.ticket);
      return true;

    // Freelance-only: opens the y-confirm gate, capturing the target at the
    // moment 'k' was pressed (mirrors drilldown's own confirm capturing
    // `run.ticket` at 'confirm-action' time) — the 'y' handler below acts on
    // this captured target, never on whatever row happens to be selected
    // when it fires (a refresh could have reordered the list in between).
    case 'kill-session-confirm':
      S.sessionsKillConfirm = { pid: action.pid, tmux: action.tmuxTarget || null };
      return true;

    case 'cancel-session-kill-confirm':
      S.sessionsKillConfirm = null;
      return true;

    case 'kill-session-confirmed':
      killFreelanceConfirmed(ctx);
      return true;

    default:
      return false;
  }
}

module.exports = {
  handle, openSessions, refreshSessions, moveSessions,
  killManagedConfirmed, killFreelanceConfirmed,
};
