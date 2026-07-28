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

function submitTicket(ticket, launchCommand, session) {
  if (!looksLikeTicket(ticket)) {
    return { spawned: false, error: 'not a ticket id' };
  }
  try {
    session.spawn(ticket, launchCommand.split('{{TICKET}}').join(ticket));
    return { spawned: true, error: null };
  } catch (e) {
    // spawn() throws deliberately rather than leave a half-made window.
    // Report it the same way a validation failure is reported: on the
    // prompt, with the prompt left open, rather than taking the dashboard
    // down over one bad launch.
    return {
      spawned: false,
      error: 'could not start ' + ticket + ': ' +
        String((e && e.message) || e).split('\n')[0],
    };
  }
}

module.exports = { submitTicket };
