'use strict';

// What a ticket id looks like, project-wide. The procedure scripts already
// guard path-derived ticket ids with this exact pattern (see
// core/scripts/assert-phase.sh's looks_like_ticket) — reused here verbatim so
// there is one definition, not two that can drift apart.
//
// It admits letters, digits, `#`, dot, underscore, hyphen — and nothing else.
// In particular: no `$`, backtick, `(`, `)`, `;`, quote, backslash or
// whitespace. That is not incidental: watch.js interpolates this value into a
// launchCommand string that lands inside double quotes in a shell command
// (`claude "/concertino-deliver {{TICKET}}"`), where `sh` still performs
// command substitution and variable expansion. A value that matches this
// pattern contains no shell metacharacters at all, so it cannot inject into
// that context regardless of what surrounds it.
const TICKET_RE = /^[A-Za-z#][A-Za-z0-9._-]*[0-9]$/;

function looksLikeTicket(value) {
  return typeof value === 'string' && TICKET_RE.test(value);
}

module.exports = { looksLikeTicket, TICKET_RE };
