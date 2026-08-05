'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { submitTicket, parseTicketInput } = require('../lib/ui/prompt');
const { LAUNCH_TEMPLATES } = require('../lib/ui/harness');
const { ADAPTERS, read } = require('../lib/cli/shared');
const { shQuote } = require('../lib/ui/shquote');

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

// --- CON-24: agent-merge per-run override in the `n` prompt -----------------

test('parseTicketInput accepts a bare ticket with no flag', () => {
  assert.deepEqual(parseTicketInput('CON-17'), { ticket: 'CON-17', flag: null, speed: null });
});

test('parseTicketInput accepts a trailing --agent-merge flag', () => {
  assert.deepEqual(parseTicketInput('CON-17 --agent-merge'), { ticket: 'CON-17', flag: '--agent-merge', speed: null });
});

test('parseTicketInput accepts a trailing --no-agent-merge flag', () => {
  assert.deepEqual(parseTicketInput('CON-17 --no-agent-merge'), { ticket: 'CON-17', flag: '--no-agent-merge', speed: null });
});

test('parseTicketInput rejects a flag that only looks like one of the two allowed strings', () => {
  assert.equal(parseTicketInput('CON-17 --agent-merge-typo'), null);
  assert.equal(parseTicketInput('CON-17 --agentmerge'), null);
});

test('parseTicketInput rejects extra tokens beyond ticket + flag', () => {
  assert.equal(parseTicketInput('CON-17 --agent-merge extra'), null);
});

test('parseTicketInput rejects a non-ticket-shaped first token even with a valid flag', () => {
  assert.equal(parseTicketInput('$(touch /tmp/x) --agent-merge'), null);
});

test('submitTicket substitutes "<ticket> --agent-merge" inside the quoted argument', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const result = submitTicket('CON-17 --agent-merge', TEMPLATE, session);
  assert.equal(result.spawned, true);
  assert.deepEqual(seen, {
    ticket: 'CON-17',
    cmd: 'claude "/concertino-deliver CON-17 --agent-merge"',
  });
});

test('submitTicket substitutes "<ticket> --no-agent-merge" the same way', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17 --no-agent-merge', TEMPLATE, session);
  assert.equal(seen.cmd, 'claude "/concertino-deliver CON-17 --no-agent-merge"');
});

test('an invalid flag never reaches session.spawn', () => {
  const session = { spawn() { throw new Error('spawn must not be called for an invalid flag'); } };
  const result = submitTicket('CON-17 --agent-merge-typo', TEMPLATE, session);
  assert.equal(result.spawned, false);
  assert.match(result.error, /not a ticket id/);
});

// --- CON-22: speed token in the `n` prompt (independent of AGENT_MERGE_FLAGS) ----

test('parseTicketInput accepts a trailing fast token', () => {
  assert.deepEqual(parseTicketInput('CON-17 fast'), { ticket: 'CON-17', flag: null, speed: 'fast' });
});

test('parseTicketInput accepts a trailing slow token', () => {
  assert.deepEqual(parseTicketInput('CON-17 slow'), { ticket: 'CON-17', flag: null, speed: 'slow' });
});

test('parseTicketInput rejects an unrecognized trailing token (not fast/slow, not an agent-merge flag)', () => {
  assert.equal(parseTicketInput('CON-17 turbo'), null);
});

test('parseTicketInput rejects extra tokens beyond ticket + speed', () => {
  assert.equal(parseTicketInput('CON-17 fast extra'), null);
});

test('submitTicket substitutes "<ticket> fast" inside the quoted argument, same insert-after-{{TICKET}} placement as --agent-merge', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const result = submitTicket('CON-17 fast', TEMPLATE, session);
  assert.equal(result.spawned, true);
  assert.deepEqual(seen, {
    ticket: 'CON-17',
    cmd: 'claude "/concertino-deliver CON-17 fast"',
  });
});

test('submitTicket substitutes "<ticket> slow" the same way', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17 slow', TEMPLATE, session);
  assert.equal(seen.cmd, 'claude "/concertino-deliver CON-17 slow"');
});

// --- CON-79: inline the real prompt content for codex/opencode --------------
//
// codex/opencode do not expand a leading-slash `/concertino-deliver <ticket>`
// string outside their own interactive TUI (see ticket.md's evidence and
// design.md's Context) — submitTicket's LAST step, after every validation and
// substitution above, replaces the short `"/concertino-deliver <request
// text>"` argument with the harness's full prompt body plus that same
// request text, single-quoted (design.md Decisions 1-4a).

const CODEX_PROMPT_BODY = read(path.join(ADAPTERS, 'codex', 'prompt.md'));
const OPENCODE_PROMPT_BODY = read(path.join(ADAPTERS, 'opencode', 'prompt.md'))
  .replace(/^---\n[\s\S]*?\n---\n\n?/, '');

test('a codex launch is constructed with the full prompt.md content, single-quoted, ending with the bare ticket', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const result = submitTicket('CON-17', LAUNCH_TEMPLATES.codex, session);
  assert.equal(result.spawned, true);
  assert.equal(seen.cmd, 'codex ' + shQuote(CODEX_PROMPT_BODY + '\n\nCON-17'));
  assert.ok(!seen.cmd.includes('/concertino-deliver'), 'the un-expandable slash string must not survive into the launched command');
});

test('a codex launch preserves the --agent-merge token, appended after the prompt body', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17 --agent-merge', LAUNCH_TEMPLATES.codex, session);
  assert.equal(seen.cmd, 'codex ' + shQuote(CODEX_PROMPT_BODY + '\n\nCON-17 --agent-merge'));
});

test('a codex launch preserves a trailing speed token, appended after the prompt body', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17 fast', LAUNCH_TEMPLATES.codex, session);
  assert.equal(seen.cmd, 'codex ' + shQuote(CODEX_PROMPT_BODY + '\n\nCON-17 fast'));
});

test('a codex launch decorated with provider flags (inserted before {{TICKET}}) still inlines correctly, flags preserved before the quoted body', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const decorated = 'codex --oss --local-provider ollama -m gpt-oss:latest "/concertino-deliver {{TICKET}}"';
  submitTicket('CON-17', decorated, session);
  assert.equal(seen.cmd,
    'codex --oss --local-provider ollama -m gpt-oss:latest ' + shQuote(CODEX_PROMPT_BODY + '\n\nCON-17'));
});

test('an opencode launch is constructed with prompt.md\'s body (frontmatter stripped), single-quoted, ending with the bare ticket', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const result = submitTicket('CON-17', LAUNCH_TEMPLATES.opencode, session);
  assert.equal(result.spawned, true);
  assert.equal(seen.cmd, 'opencode --prompt ' + shQuote(OPENCODE_PROMPT_BODY + '\n\nCON-17'));
  assert.ok(!seen.cmd.includes('---\n'), 'the YAML frontmatter delimiter must not survive into the launched command');
  assert.ok(!seen.cmd.includes('/concertino-deliver'), 'the un-expandable slash string must not survive into the launched command');
});

test("Claude Code's launch command is byte-identical to today — unaffected by the codex/opencode inlining", () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17', LAUNCH_TEMPLATES['claude-code'], session);
  assert.equal(seen.cmd, 'claude "/concertino-deliver CON-17"');
});

// design.md Decision 4a: a recognized-but-non-default codex `dashboard.launchCommand`
// operator override — one whose trailing argument does not match the exact
// `"/concertino-deliver <request text>"` shape — must pass through untouched,
// never throw, never have its trailing argument guessed at.
test('a non-default codex operator override command passes through submitTicket byte-for-byte unchanged', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  const override = 'codex -c foo "some other prompt entirely"';
  const result = submitTicket('CON-17', override, session);
  assert.equal(result.spawned, true);
  assert.equal(seen.cmd, override);
});

test('an operator override with no {{TICKET}} placeholder at all is also left untouched', () => {
  let seen = null;
  const session = { spawn(ticket, cmd) { seen = { ticket, cmd }; } };
  submitTicket('CON-17', 'codex --yolo', session);
  assert.equal(seen.cmd, 'codex --yolo');
});

// Shell round-trip: the inlined prompt body (88 backticks, 9 apostrophes,
// markdown headers) must survive an actual `sh -c` hand-off byte-for-byte —
// not just a string-equality assertion on the pre-shell command text.
// Mirrors the existing shell-injection regression tests' execSync pattern,
// but this time proving safe content survives rather than unsafe content
// getting rejected.
test('regression: the inlined codex prompt body (backticks, $, quotes) survives an actual sh -c hand-off byte-for-byte', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-shquote-roundtrip-'));
  const outFile = path.join(dir, 'argv1.txt');
  const stub = path.join(dir, 'codex');
  try {
    // A fake `codex` that writes its own first argument (the prompt) to a
    // file verbatim — proving what the REAL codex process would receive,
    // without needing a real codex binary/auth.
    fs.writeFileSync(stub, '#!/bin/sh\nprintf %s "$1" > ' + JSON.stringify(outFile) + '\n');
    fs.chmodSync(stub, 0o755);

    let seen = null;
    const session = {
      spawn(ticket, cmd) {
        seen = cmd;
        execSync(cmd, {
          shell: '/bin/sh',
          timeout: 5000,
          env: Object.assign({}, process.env, { PATH: dir + path.delimiter + process.env.PATH }),
        });
      },
    };
    const result = submitTicket('CON-17', LAUNCH_TEMPLATES.codex, session);
    assert.equal(result.spawned, true);
    assert.ok(seen.includes('`'), 'sanity: the prompt body must actually contain backticks for this test to prove anything');

    const received = fs.readFileSync(outFile, 'utf8');
    assert.equal(received, CODEX_PROMPT_BODY + '\n\nCON-17');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
