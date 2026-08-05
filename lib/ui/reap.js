'use strict';

// Reaps ("closes") a finished run's tmux window — the tmux-window
// counterpart to lib/ui/retention.js's log pruning (see
// openspec/changes/reap-finished-run-tmux-windows/design.md). A window is
// closed only once the run's log has recorded a terminal `run.end`
// (endStatus is non-null) AND one of two things is true: tmux reports the
// pane dead, or the window is still alive but has sat idle past a grace
// period since it finished. See selectReapable for why the second case
// exists and what it refuses.
//
// The invariant, in both cases: a dead window whose run never emitted
// `run.end` is tier-1 telemetry (reducer.js's deriveStatus, second line) —
// the only remaining evidence a crashed run existed and failed — and must
// never be touched, no matter how long it sits there.

const fs = require('fs');
const store = require('./store');

// The default grace period before a DELIVERED run's still-open window is
// closed (see the second reap condition below). Long enough that someone
// watching the run finish can read the tail in place; short enough that an
// unattended fleet does not accumulate idle sessions overnight.
const DEFAULT_IDLE_GRACE_MIN = 10;

// Pure: `runs` is exactly the array lib/ui/reducer.js#reduce() already
// produces every poll — `endStatus` is non-null only once a `run.end` event
// has been parsed from the log (applyEvent's `run.end` case), and
// `window.alive` is tmux's own `pane_dead` bit sampled fresh this same poll
// (session.listWindows()/watch.js's sampleWindows()). No I/O, no re-read of
// the event log — every fact this needs is already sitting on the object
// the poll loop computed moments earlier.
//
// TWO independent reasons to reap, sharing one hard guarantee:
//
//   1. Terminal AND the window is already dead. The original condition:
//      the process is gone, the window is a corpse, close it.
//
//   2. Terminal, the window is STILL ALIVE, and `idleGraceMs` has passed
//      since `run.end`. A harness does not exit when the workflow finishes
//      — it returns to its prompt and waits. That session holds a process,
//      a tmux window, and (when Remote Control is on for all sessions) a
//      registration that keeps a delivered run visible on the operator's
//      phone indefinitely. Nothing will ever close it: condition 1 requires
//      a death that never comes. This is what makes an unattended fleet
//      self-clearing.
//
// The guarantee both share: a dead window whose run never emitted
// `run.end` is tier-1 telemetry (reducer.js's deriveStatus, second line) —
// the only remaining evidence a crashed run existed and failed — and is
// never touched, no matter how long it sits there.
//
// Condition 2 additionally refuses a run with a LIVE escalation. CON-48:
// `cleanup.sh` emits `run.end` mid-Phase-4, and the orchestrator can raise
// a question afterwards — reducer.js's own status() gives that escalation
// precedence over `endStatus` for exactly this reason. Reaping there would
// kill a session waiting on a human, which is the one thing worse than
// leaving it open.
//
// `now`/`idleGraceMs` are optional: called with neither (every pre-existing
// call site, and the tests that pin condition 1) only condition 1 applies,
// so the original behaviour is unchanged.
function selectReapable(runs, now, idleGraceMs) {
  const graceMs = typeof idleGraceMs === 'number' ? idleGraceMs : DEFAULT_IDLE_GRACE_MIN * 60 * 1000;
  return (runs || [])
    .filter((run) => {
      if (run.endStatus == null || !run.window) return false;
      if (run.window.alive === false) return true;
      // Alive: only the idle-grace path can reap it, and only when we were
      // given a clock to measure against and an end time to measure from.
      if (typeof now !== 'number' || typeof run.endedAt !== 'number') return false;
      if (run.escalation && !run.escalationStale) return false;
      return now - run.endedAt >= graceMs;
    })
    .map((run) => run.ticket);
}

// Capture-then-kill, in that fixed order, for every ticket selectReapable
// returns. The kill always proceeds — even when captureFull throws/errors,
// or the scrollback write fails (permissions, races) — a courtesy capture
// must never gate reclaiming the window; the kill itself already degrades
// the same way today (session.kill swallows all errors). Returns the list
// of tickets reaped, for tests/telemetry.
function reapFinished(root, session, runs, now, idleGraceMs) {
  const reaped = [];
  for (const ticket of selectReapable(runs, now, idleGraceMs)) {
    let scrollback = '';
    try {
      scrollback = session.captureFull(ticket);
    } catch (e) {
      scrollback = '';
    }
    try {
      fs.mkdirSync(store.runDir(root, ticket), { recursive: true });
      fs.writeFileSync(store.scrollbackPath(root, ticket), scrollback);
    } catch (e) {
      // Best-effort: a write failure must never block the kill below.
    }
    session.kill(ticket);
    reaped.push(ticket);
  }
  return reaped;
}

module.exports = { selectReapable, reapFinished, DEFAULT_IDLE_GRACE_MIN };
