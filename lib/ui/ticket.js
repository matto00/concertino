'use strict';

// What a ticket id looks like, project-wide. The procedure scripts already
// guard path-derived ticket ids with this exact pattern (see
// core/scripts/assert-phase.sh's looks_like_ticket) — reused here verbatim so
// there is one definition, not two that can drift apart.
//
// It admits letters, digits, `#`, underscore, hyphen — and nothing else. In
// particular: no `$`, backtick, `(`, `)`, `;`, quote, backslash, whitespace —
// or dot. That is not incidental: watch.js interpolates this value into a
// launchCommand string that lands inside double quotes in a shell command
// (`claude "/concertino-deliver {{TICKET}}"`), where `sh` still performs
// command substitution and variable expansion. A value that matches this
// pattern contains no shell metacharacters at all, so it cannot inject into
// that context regardless of what surrounds it.
//
// Dot is excluded for a second reason that has nothing to do with the shell:
// session.js addresses tmux windows as `session:ticket`, and tmux's target
// syntax treats `.` as the window/pane separator (`session:window.pane`). A
// ticket containing `.` — e.g. `a.b_c-9` — makes that target ambiguous and
// breaks tmux addressing (see session.js's own defence-in-depth check for
// what that does if it isn't caught here first).
const TICKET_RE = /^[A-Za-z#][A-Za-z0-9_-]*[0-9]$/;

function looksLikeTicket(value) {
  return typeof value === 'string' && TICKET_RE.test(value);
}

module.exports = { looksLikeTicket, TICKET_RE };
