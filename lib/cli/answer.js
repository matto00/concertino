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

// CON-156 (cycle 2, finding 1): before writing anything, learn the REAL shape
// of the escalation this ticket last raised — whether it is multi-part at
// all, and if so its true sub-question count — from the escalation.raised
// event itself (the same source --await/--wait-only's own MULTI_PART/TOTAL
// derivation in emit-event.sh uses), never from what the caller merely
// claims via --sub/--total. Without this, a caller answering a multi-part
// escalation with no --sub at all falls straight into the single-question
// `writeAnswer` path below, which happily writes `{answer}` with no
// `subAnswers` at all — and (pre-fix) let a stale/careless `--total` silently
// resize, and drop existing entries from, an in-progress subAnswers array.
//
// Returns `{ found: false }` when no escalation.raised event exists for this
// ticket at all (e.g. a test fixture, or a ticket this process has no run
// directory for) — callers fall back to requiring an explicit, internally-
// consistent --sub/--total pair in that case, exactly as before this fix,
// since there is no ground truth to validate against.
function readEscalationShape(root, ticket) {
  const { events } = store.readEvents(root, ticket);
  let last = null;
  for (const ev of events) {
    if (ev.kind === 'escalation.raised') last = ev;
  }
  if (!last) return { found: false, multiPart: false, total: null };
  let total = 0;
  let subQuestions = [];
  if (last.sub_questions != null) {
    try {
      const parsed = typeof last.sub_questions === 'string' ? JSON.parse(last.sub_questions) : last.sub_questions;
      if (Array.isArray(parsed)) {
        total = parsed.length;
        subQuestions = parsed;
      }
    } catch (_) {
      // A malformed sub_questions payload on the raised event itself degrades
      // to "single-question", mirroring emit-event.sh's own TOTAL=0 fallback.
    }
  }
  return { found: true, multiPart: total > 0, total, subQuestions };
}

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

  // CON-156 (cycle 2, finding 1): look up the ticket's real escalation shape
  // BEFORE branching on what the caller passed — this is what catches a
  // caller answering a multi-part escalation with no --sub at all (the
  // "most likely real trigger" the review called out: `concertino answer T
  // "both yes"` on a 2-part escalation would otherwise fall straight into
  // the single-question writeAnswer() path below with no diagnostic at all).
  const shape = readEscalationShape(root, ticket);
  if (shape.found && shape.multiPart && !hasSub) {
    console.error(red('error: ') + ticket + ' is a multi-part escalation (' + shape.total
      + ' sub-questions) — answer it with --sub <index> (1-based), e.g. --sub 1 for the first');
    process.exit(1);
  }
  if (shape.found && !shape.multiPart && hasSub) {
    console.error(red('error: ') + ticket + ' is a single-question escalation — do not pass --sub/--total');
    process.exit(1);
  }

  if (hasSub) {
    // CON-151: `--sub` is 1-based, matching what a human types and what
    // every confirmation/prompt in this codebase shows ("sub N/total" in the
    // CLI confirmation below, "sub-question N of total" in the dashboard
    // wizard at lib/ui/screens/escalation.js). It is converted to the
    // 0-based array slot only at this one boundary, immediately before
    // calling store.writeSubAnswer (which — like the dashboard's own
    // controller, lib/ui/controllers/escalation.js — is 0-based
    // internally). Never let the raw 1-based `humanIndex` reach
    // writeSubAnswer, and never print the converted 0-based `slot` back to
    // the operator — the bug this replaces was exactly that mismatch.
    const humanIndex = Number(flags.sub);
    if (!Number.isInteger(humanIndex)) {
      console.error(red('error: ') + '--sub <index> (1-based) must be an integer');
      process.exit(1);
    }

    // CON-156 (cycle 2, finding 1): --total is validated against — and, when
    // omitted, DERIVED from — the escalation's real sub-question count
    // whenever that count is known (shape.found && shape.multiPart). A
    // mismatched --total is refused outright rather than honoured: silently
    // accepting a wrong --total is exactly what let store.writeSubAnswer's
    // read-modify-write (lib/ui/store.js:273) treat the existing subAnswers
    // array as stale and reset it to `new Array(total).fill(null)`, dropping
    // every answer already recorded. --total stays required only when no
    // escalation.raised event exists to derive it from (test fixtures, or a
    // ticket with no run directory) — there is no ground truth to check
    // against in that case, so the pre-existing explicit-pair contract holds.
    let total;
    if (flags.total !== undefined) {
      total = Number(flags.total);
      if (!Number.isInteger(total)) {
        console.error(red('error: ') + '--total <n> must be an integer');
        process.exit(1);
      }
      if (shape.found && shape.multiPart && total !== shape.total) {
        console.error(red('error: ') + '--total ' + total + ' does not match ' + ticket
          + "'s real sub-question count (" + shape.total + ') — refusing to write; a mismatched'
          + ' --total would silently resize answer.json and could drop already-recorded answers');
        process.exit(1);
      }
    } else if (shape.found && shape.multiPart) {
      total = shape.total;
    } else {
      console.error(red('error: ') + '--total <n> is required (no escalation.raised event found for '
        + ticket + ' to derive the real sub-question count from)');
      process.exit(1);
    }

    if (humanIndex < 1 || humanIndex > total) {
      console.error(red('error: ') + 'sub-question index out of range: ' + humanIndex
        + ' (valid range: 1-' + total + ')');
      process.exit(1);
    }
    const slot = humanIndex - 1;

    // CON-179: pass the sub-question's own text (learned above, from the
    // SAME escalation.raised event `total` was derived from — never from
    // caller input) so it rides alongside the value in answer.json. When the
    // shape wasn't found (no escalation.raised event at all — a test fixture
    // path already handled above by requiring an explicit --total), there is
    // no text to attach; writeSubAnswer falls back to the legacy bare-value
    // shape in that case.
    const question = (shape.found && shape.multiPart && shape.subQuestions[slot])
      ? shape.subQuestions[slot].question
      : undefined;

    // CON-179 (cycle-2 finding 4): pass the full raised sub_questions array
    // too, not just this slot's own text -- it's what lets writeSubAnswer
    // recover from (discard-and-restart) a provenance-mismatched file
    // instead of refusing every slot as "already answered" forever.
    const result = store.writeSubAnswer(root, ticket, slot, value, total, question, shape.subQuestions);
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
      const values = ((subAnswers && subAnswers.subAnswers) || []).map(store.subAnswerValue);
      const subAnswersJson = JSON.stringify(values);
      recordAnswered(root, ticket, ['sub_answers=' + subAnswersJson]);
      console.log(green('answered') + ' ' + ticket + ' (sub ' + humanIndex + '/' + total + ') — escalation.answered recorded');
      process.exit(0);
    }

    console.log(green('recorded') + ' ' + ticket + ' (sub ' + humanIndex + '/' + total
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
