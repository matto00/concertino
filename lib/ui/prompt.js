'use strict';

// What happens when the `n` prompt is submitted, pulled out of watch.js's
// terminal-driving loop so it can be unit tested without a tty: given the
// typed value, the configured launchCommand template and something that can
// spawn a session, decide whether to spawn and what to report.
//
// Validation happens before the ticket ever reaches session.spawn. The
// launchCommand template puts the ticket inside a shell string (by default
// `claude "/concertino-deliver {{TICKET}}"`), and `sh` still expands `$(...)`
// and friends even inside double quotes — so anything that isn't
// ticket-shaped must never be substituted in at all.
const { looksLikeTicket } = require('./ticket');

// The only two flags the `n` prompt accepts, trailing the ticket id, separated
// by whitespace — the same per-run agent-merge override `/concertino-deliver`
// accepts on the Claude Code side (see adapters/claude-code/command.md /
// core/roles/orchestrator.md's AGENT_MERGE_OVERRIDE). Anything else typed
// after the ticket — including a shape that merely LOOKS like one of these
// two — is rejected outright rather than passed through: this is an allowlist
// of exact strings, not a permissive parse.
const AGENT_MERGE_FLAGS = new Set(['--agent-merge', '--no-agent-merge']);

// CON-22: the speed token — independent of AGENT_MERGE_FLAGS (its own set,
// its own trailing slot). This ships speed-only OR agent-merge-only parsing
// (not yet combined in one typed value — see design.md Decision 6's Open
// Questions); `parseTicketInput` below accepts exactly one trailing token
// drawn from either set, never both at once.
const SPEED_FLAGS = new Set(['fast', 'slow']);

// Splits "TICKET", "TICKET --agent-merge"/"TICKET --no-agent-merge", or
// "TICKET fast"/"TICKET slow" into its parts. Returns null for anything else
// — including extra whitespace-separated tokens, a flag that isn't one of
// the exact strings above, or a ticket portion that doesn't itself look like
// a ticket id. Never partially accepts: the whole typed value is well-formed,
// or none of it is used.
function parseTicketInput(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return looksLikeTicket(parts[0]) ? { ticket: parts[0], flag: null, speed: null } : null;
  }
  if (parts.length === 2 && looksLikeTicket(parts[0])) {
    if (AGENT_MERGE_FLAGS.has(parts[1])) return { ticket: parts[0], flag: parts[1], speed: null };
    if (SPEED_FLAGS.has(parts[1])) return { ticket: parts[0], flag: null, speed: parts[1] };
  }
  return null;
}

// `env` (optional, CON-65) is a { NAME: value } map of per-window
// environment for the spawned harness process — threaded through verbatim
// to session.spawn, which owns the quoting/injection mechanics. Omitted (the
// original three-argument signature, every pre-existing call site) it
// changes nothing.
function submitTicket(ticket, launchCommand, session, env) {
  const parsed = parseTicketInput(ticket);
  if (!parsed) {
    return { spawned: false, error: 'not a ticket id' };
  }
  // The flag/speed (if any) lands INSIDE the substituted {{TICKET}} value —
  // never appended after launchCommand's own closing quote — so it ends up
  // inside the quoted `/concertino-deliver` argument exactly like the ticket
  // id itself (e.g. `claude "/concertino-deliver CON-17 --agent-merge"` or
  // `claude "/concertino-deliver CON-17 fast"`). Appending it outside the
  // quotes would mean `$ARGUMENTS` on the Claude Code side never sees it at
  // all. At most one of flag/speed is ever set (parseTicketInput's own
  // one-trailing-token-only contract), so this never has to decide an order
  // between the two.
  const trailing = parsed.flag || parsed.speed;
  const substituted = trailing ? parsed.ticket + ' ' + trailing : parsed.ticket;
  try {
    session.spawn(parsed.ticket, launchCommand.split('{{TICKET}}').join(substituted), env);
    return { spawned: true, error: null };
  } catch (e) {
    // spawn() throws deliberately rather than leave a half-made window.
    // Report it the same way a validation failure is reported: on the
    // prompt, with the prompt left open, rather than taking the dashboard
    // down over one bad launch.
    return {
      spawned: false,
      error: 'could not start ' + parsed.ticket + ': ' +
        String((e && e.message) || e).split('\n')[0],
    };
  }
}

module.exports = { submitTicket, parseTicketInput };
