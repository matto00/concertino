'use strict';

// The one implementation of POSIX single-quote escaping, shared by every
// caller that hands a string through `sh` as a single shell argument.
// Single quotes (unlike double quotes) suppress ALL shell interpretation of
// their contents — command substitution (backticks, `$(...)`), variable
// expansion (`$VAR`), glob expansion — which matters wherever the quoted
// text is not fully under this codebase's control (a per-window env value in
// lib/ui/session.js's `spawn()`, an inlined harness prompt body in
// lib/ui/prompt.js's `submitTicket()` — see design.md's CON-79 Decision 3).
// A single embedded `'` cannot be escaped from inside a single-quoted
// string, so the standard technique closes the quote, emits an escaped
// literal quote, and reopens it: `'\''`.
//
// Extracted here (rather than left as the inline expression session.js
// used before CON-79) so this safety-critical escape has exactly one
// implementation, not a second, subtly-different one growing alongside it.
function shQuote(str) {
  return "'" + String(str).replace(/'/g, "'\"'\"'") + "'";
}

module.exports = { shQuote };
