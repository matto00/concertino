'use strict';

// `concertino answer <ticket> <value> [--sub <index> --total <n>] [--out=DIR]`
// (CON-76 design.md Decision 4 / escalation-answer-cli spec) — a thin CLI
// wrapper over lib/ui/store.js's existing writeAnswer/writeSubAnswer, so a
// chat-given answer resolves through the exact same O_EXCL/rename-guarded
// authority the dashboard's own escalation.js controller already uses. No
// independent answer.json construction, locking, or JSON-shape logic here —
// see the escalation-answer-cli spec's "thin CLI wrapper" requirement.
//
// Argument shape is deliberately parsed by hand here rather than via
// shared.js's parseArgs: `--sub <index> --total <n>` are value-bearing flags
// interleaved with two positionals (ticket, value) — parseArgs' `--k=v`-only
// convention (every other command's flags: `--out=DIR`, `--config=PATH`)
// can't represent a space-separated `--sub 1` without losing the association
// between the flag and its value. This parser accepts both `--sub 1` and
// `--sub=1` for every flag it recognizes, so either form works.
const path = require('path');
const { red, green, yellow, dim } = require('./shared');
const { printUsage } = require('./help');
const store = require('../ui/store');

function parseAnswerArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^--([a-z-]+)=(.*)$/.exec(a);
    if (eq) {
      flags[eq[1]] = eq[2];
      continue;
    }
    const bare = /^--([a-z-]+)$/.exec(a);
    if (bare) {
      // A value-bearing flag with no `=value`: consume the next token as its
      // value. `--dry-run`-style boolean flags aren't used by this command,
      // so every recognized flag here takes a value.
      flags[bare[1]] = argv[i + 1];
      i += 1;
      continue;
    }
    pos.push(a);
  }
  return { pos, flags };
}

// After a successful (non-refused) write that actually resolves the
// escalation — unconditionally for a single-question answer, only when
// `writeSubAnswer`'s own returned `complete` is true for a multi-part
// sub-answer — record `escalation.answered` through emit-event.sh's existing
// generic non-`--await` event-write path (CON-76 design.md Decision 4a
// revised). This is the same mechanism every other event kind already uses;
// no new script mode, no duplicated JSON-line-writing logic here (see the
// escalation-answer-cli spec's own "delegate to store.js/emit-event.sh, not
// duplicate" requirements).
function recordAnswered(root, ticket, extraArgs) {
  const script = path.join(root, 'scripts', 'concertino', 'emit-event.sh');
  const { spawnSync } = require('child_process');
  const args = ['escalation.answered', 'ticket=' + ticket, 'role=orchestrator'].concat(extraArgs);
  spawnSync(script, args, { cwd: root, stdio: 'ignore' });
}

async function cmdAnswer(argv) {
  // `--help`/`-h` are checked against the raw argv here, before
  // parseAnswerArgv runs — parseAnswerArgv would otherwise swallow a bare
  // `--help` into `pos` (or `flags`, consuming the next token as its bogus
  // value) since it doesn't recognize either as a flag (design.md Decision 2).
  if (argv.includes('--help') || argv.includes('-h')) { printUsage('answer'); process.exit(0); }
  const { pos, flags } = parseAnswerArgv(argv);
  const [ticket, value] = pos;
  const root = path.resolve(flags.out || '.');

  if (!ticket || value === undefined) {
    console.error(red('error: ') + 'usage: concertino answer <ticket> <value> [--sub <index> --total <n>] [--out=DIR]');
    process.exit(1);
  }

  const hasSub = flags.sub !== undefined || flags.total !== undefined;

  if (hasSub) {
    const index = Number(flags.sub);
    const total = Number(flags.total);
    if (!Number.isInteger(index) || !Number.isInteger(total)) {
      console.error(red('error: ') + '--sub <index> and --total <n> must both be integers');
      process.exit(1);
    }

    const result = store.writeSubAnswer(root, ticket, index, value, total);
    if (!result.ok && result.reason === 'answered') {
      console.log(yellow('already answered') + dim(' — ' + result.error));
      process.exit(2);
    }
    if (!result.ok) {
      console.error(red('error: ') + result.error);
      process.exit(1);
    }

    if (result.complete) {
      const subAnswers = store.readSubAnswers(root, ticket);
      const subAnswersJson = JSON.stringify((subAnswers && subAnswers.subAnswers) || []);
      recordAnswered(root, ticket, ['sub_answers=' + subAnswersJson]);
      console.log(green('answered') + ' ' + ticket + ' (sub ' + (index + 1) + '/' + total + ') — escalation.answered recorded');
      process.exit(0);
    }

    console.log(green('recorded') + ' ' + ticket + ' (sub ' + (index + 1) + '/' + total
      + ') — escalation still open, not yet resolved');
    process.exit(0);
  }

  const result = store.writeAnswer(root, ticket, value);
  if (!result.ok && result.reason === 'answered') {
    console.log(yellow('already answered') + dim(' — ' + result.error));
    process.exit(2);
  }
  if (!result.ok) {
    console.error(red('error: ') + result.error);
    process.exit(1);
  }

  recordAnswered(root, ticket, ['answer=' + value]);
  console.log(green('answered') + ' ' + ticket + ' — escalation.answered recorded');
  process.exit(0);
}

module.exports = { cmdAnswer, parseAnswerArgv };
