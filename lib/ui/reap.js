'use strict';

// Reaps ("closes") a finished run's tmux window — the tmux-window
// counterpart to lib/ui/retention.js's log pruning (see
// openspec/changes/reap-finished-run-tmux-windows/design.md). The safety
// predicate mirrors retention.js's own hasRunEnd/isEligible split: a window
// is only ever closed once BOTH hold — the run's log has recorded a
// terminal `run.end` (endStatus is non-null) AND tmux itself already
// reports the pane as dead. A dead window whose run never emitted
// `run.end` is tier-1 telemetry (reducer.js's deriveStatus, second line) —
// the only remaining evidence a crashed run existed and failed — and must
// never be touched, no matter how long it sits there.

const fs = require('fs');
const store = require('./store');

// Pure: `runs` is exactly the array lib/ui/reducer.js#reduce() already
// produces every poll — `endStatus` is non-null only once a `run.end` event
// has been parsed from the log (applyEvent's `run.end` case), and
// `window.alive` is tmux's own `pane_dead` bit sampled fresh this same poll
// (session.listWindows()/watch.js's sampleWindows()). No I/O, no re-read of
// the event log — both facts this needs are already sitting on the object
// the poll loop computed moments earlier.
function selectReapable(runs) {
  return (runs || [])
    .filter((run) => run.endStatus != null && run.window && run.window.alive === false)
    .map((run) => run.ticket);
}

// Capture-then-kill, in that fixed order, for every ticket selectReapable
// returns. The kill always proceeds — even when captureFull throws/errors,
// or the scrollback write fails (permissions, races) — a courtesy capture
// must never gate reclaiming the window; the kill itself already degrades
// the same way today (session.kill swallows all errors). Returns the list
// of tickets reaped, for tests/telemetry.
function reapFinished(root, session, runs) {
  const reaped = [];
  for (const ticket of selectReapable(runs)) {
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

module.exports = { selectReapable, reapFinished };
