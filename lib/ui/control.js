'use strict';

// The kill/restart seam pulled out of watch.js's terminal-driving loop, same
// motivation as prompt.js: testable without a tty, and — the point of this
// module existing at all — testable with a fake session so the kill-then-
// spawn ORDER is actually exercised, not just each half in isolation.
//
// Two independent properties, both belt-and-braces against a single bad
// keypress (see drilldown.js's own re-check on 'y', which is the first
// layer; this is the second):
//
//   1. Never destroy something before knowing a replacement is possible.
//      `restartConfirmed` reuses `submitTicket` for validation — the same
//      function the `n` prompt calls, `{{TICKET}}` substitution included —
//      but calls it to CHECK before calling `session.kill`, so an adopted
//      window that fails TICKET_RE is refused outright instead of being
//      destroyed and then denied its replacement (slice-2b Important 1).
//
//   2. Never act on a run that stopped being live between "confirm opened"
//      and "y pressed". The confirmation can sit on screen across many
//      one-second poll cycles while a human reads the warning; `runs` here
//      is whatever the poll loop most recently observed, so re-deriving
//      liveness from it at the moment of execution — not trusting that the
//      screen-level check (drilldown.js) was never bypassed — is this
//      module's own independent gate (slice-2b Important 2).
const { looksLikeTicket } = require('./ticket');
const { isLive } = require('./screens/drilldown');

function findRun(ticket, runs) {
  return (runs || []).find((r) => r.ticket === ticket) || null;
}

function killConfirmed(ticket, runs, session) {
  const run = findRun(ticket, runs);
  if (!run || !isLive(run)) return { killed: false, reason: 'not-live' };
  session.kill(ticket);
  return { killed: true };
}

function restartConfirmed(ticket, runs, session, launchCommand, submitTicket) {
  const run = findRun(ticket, runs);
  if (!run || !isLive(run)) {
    return { killed: false, spawned: false, error: null, reason: 'not-live' };
  }
  // Validate BEFORE destroying anything. looksLikeTicket is the exact check
  // submitTicket makes internally — checked here first only so kill() is
  // never reached when we already know the spawn will be refused, not to
  // introduce a second copy of the {{TICKET}} substitution (there remains
  // exactly one substitution site: inside submitTicket itself).
  if (!looksLikeTicket(ticket)) {
    return { killed: false, spawned: false, error: 'not a ticket id', reason: 'invalid-ticket' };
  }
  session.kill(ticket);
  const result = submitTicket(ticket, launchCommand, session);
  return { killed: true, spawned: result.spawned, error: result.error };
}

module.exports = { killConfirmed, restartConfirmed };
