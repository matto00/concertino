'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const { shQuote } = require('../lib/ui/shquote');

// CON-79: the one implementation of POSIX single-quote escaping, shared by
// lib/ui/session.js's env-injection and lib/ui/prompt.js's codex/opencode
// prompt inlining. Single quotes suppress every form of shell interpretation
// (unlike double quotes, which still let `sh` run command substitution on
// backticks/`$(...)`) — these tests prove that holds for exactly the
// characters this codebase's own use cases embed: apostrophes (Markdown),
// backticks (Markdown inline code), and `$` (shell variable sigil).

test('shQuote wraps a plain string in single quotes', () => {
  assert.equal(shQuote('hello'), "'hello'");
});

test('shQuote escapes an embedded single quote with the standard \'"\'"\' technique', () => {
  assert.equal(shQuote("it's a value"), "'it'\"'\"'s a value'");
});

test('shQuote escapes multiple embedded single quotes', () => {
  assert.equal(shQuote("a'b'c"), "'a'\"'\"'b'\"'\"'c'");
});

test('shQuote coerces a non-string value via String()', () => {
  assert.equal(shQuote(42), "'42'");
});

// Round-trip regression: backticks and `$` must never trigger shell
// interpretation once wrapped — the exact hazard design.md Decision 3
// identifies in adapters/codex/prompt.md's 88 backtick-delimited inline-code
// spans (double quotes would let `sh` try command substitution on these).
test('regression: a backtick-containing string survives an actual sh -c hand-off with no command substitution', () => {
  const payload = 'see `.codex/roles/concertino-orchestrator.md` and $HOME and $(echo pwned)';
  const cmd = 'printf %s ' + shQuote(payload);
  const out = execSync(cmd, { shell: '/bin/sh', encoding: 'utf8' });
  assert.equal(out, payload, 'backticks/$/$(...) inside a single-quoted argument must reach the process byte-for-byte, unexpanded');
});

test('regression: an embedded single quote survives an actual sh -c hand-off', () => {
  const payload = "it's got a `backtick` too";
  const cmd = 'printf %s ' + shQuote(payload);
  const out = execSync(cmd, { shell: '/bin/sh', encoding: 'utf8' });
  assert.equal(out, payload);
});
