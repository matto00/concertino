'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { submitTicket } = require('../lib/ui/prompt');

const TEMPLATE = 'claude "/concertino-deliver {{TICKET}}"';

test('rejects a non-ticket-shaped value and never calls spawn', () => {
  const session = { spawn() { throw new Error('spawn must not be called for an invalid ticket'); } };
  const result = submitTicket('$(touch /tmp/should-not-run)', TEMPLATE, session);
  assert.equal(result.spawned, false);
  assert.match(result.error, /not a ticket id/);
});

// Shell-injection regression — the exact payload that worked before the fix.
// session.spawn's real implementation (lib/ui/session.js) hands the built
// command string to `tmux respawn-window`, which runs it through `sh`, so a
// ticket of `$(touch <path>)` landed inside the double-quoted launchCommand
// and ran during shell expansion, before `claude` ever started. This fake
// spawn reproduces that same shell hand-off (minus tmux) so the test proves
// the injection is blocked before it reaches a shell at all, not just before
// it reaches tmux.
test('regression: a ticket of $(touch <path>) is rejected and the path is never created', () => {
  const mark = path.join(os.tmpdir(), 'concertino-injection-regression-' + process.pid + '-' + Date.now());
  fs.rmSync(mark, { force: true });
  try {
    const ticket = '$(touch ' + mark + ')';
    const session = {
      spawn(_ticket, cmd) {
        try {
          execSync(cmd, { shell: '/bin/sh', timeout: 2000, stdio: 'ignore' });
        } catch (e) {
          // `claude` may not be on PATH, or may hang past the timeout — both
          // irrelevant here. The command substitution that creates `mark`
          // already ran during shell expansion, before any of that.
        }
      },
    };

    const result = submitTicket(ticket, TEMPLATE, session);

    assert.equal(result.spawned, false, 'an injection payload must not be treated as a successful launch');
    assert.match(result.error, /not a ticket id/);
    assert.equal(fs.existsSync(mark), false, 'shell injection ran and created the marker file');
  } finally {
    fs.rmSync(mark, { force: true });
  }
});

// A `;`-style payload is deferred (runs when `claude` exits) rather than
// during expansion, but it must be caught by the same shape check.
test('regression: a ticket of "; cmd" is rejected', () => {
  const session = { spawn() { throw new Error('spawn must not be called for an invalid ticket'); } };
  const result = submitTicket('CON-1"; touch /tmp/should-not-run; echo "', TEMPLATE, session);
  assert.equal(result.spawned, false);
  assert.match(result.error, /not a ticket id/);
});

test('accepts a ticket-shaped value and spawns exactly once with the substituted command', () => {
  let calls = 0;
  let seen = null;
  const session = {
    spawn(ticket, cmd) { calls++; seen = { ticket, cmd }; },
  };
  const result = submitTicket('CON-777', TEMPLATE, session);
  assert.equal(result.spawned, true);
  assert.equal(result.error, null);
  assert.equal(calls, 1);
  assert.deepEqual(seen, { ticket: 'CON-777', cmd: 'claude "/concertino-deliver CON-777"' });
});

test('a failed spawn on a valid ticket is reported as an error, not thrown', () => {
  const session = { spawn() { throw new Error('tmux exited 1'); } };
  const result = submitTicket('CON-9', TEMPLATE, session);
  assert.equal(result.spawned, false);
  assert.match(result.error, /could not start CON-9/);
  assert.match(result.error, /tmux exited 1/);
});
