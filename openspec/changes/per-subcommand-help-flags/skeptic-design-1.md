## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **14 `cmd*` functions, not 13.** Ran `grep -n "^\(async \)\?function cmd" lib/cli/*.js` against the actual worktree: found exactly 14 matches (init, sync, update, validate, diff, doctor, watch, prune, upgrade, gates, completion, eject, migrate, answer). Matches design.md/proposal.md's claim and their explicit correction of the ticket's "thirteen" undercount. Confirmed real, not a hallucinated grep result.

- **`parseArgs` really doesn't handle `-h`.** Read `lib/cli/shared.js`'s `parseArgs`: regex is `/^--([^=]+)(?:=(.*))?$/`, which only matches tokens starting with `--`. Ran it directly: `parseArgs(['-h'])` → `{_: ['-h']}` (no `help` key), `parseArgs(['sync','--help'])` → `{_: ['sync'], help: true}`. Confirms the design's `hasHelpFlag(args)` approach (`args.help === true || args._.includes('-h')`) is necessary and correct — `-h` genuinely falls into `_`.

- **`cmdAnswer`'s argv-parsing divergence is real.** Read `lib/cli/answer.js` and `bin/concertino`: `cmdAnswer` is invoked as `await cmdAnswer(process.argv.slice(3))` — raw argv, not the shared `parseArgs` result every other command gets. Its own `parseAnswerArgv` uses hand-rolled regexes (`/^--([a-z-]+)=(.*)$/` and `/^--([a-z-]+)$/`) that would swallow a bare `--help` as a value-bearing flag (consuming the next token as its bogus value) and would push a bare `-h` into `pos` unrecognized. Design's Decision 2 (a dedicated `argv.includes('--help') || argv.includes('-h')` check before calling `parseAnswerArgv`) correctly avoids both failure modes.

- **`help.js` really is one monolithic string today.** Read `lib/cli/help.js` in full — a single template literal covering all 14 commands' usage text, with no per-command accessor. Confirms the extraction work claimed in Decision 3 / tasks.md 2.1–2.4 is real, not already-done or unnecessary.

- **Test infra exists to support tasks.md §5.** `test/completion.test.js`, `test/answer.test.js`, `test/validate.test.js` etc. already exist under `test/`, so the testing plan (extend existing CLI tests) is grounded, not aspirational.

- **Found a real, unaddressed contradiction: bare `concertino --help` changes behavior, contradicting design.md's own stated non-goal.**
  `bin/concertino` computes `cmd = args._[0] || 'watch'`. For bare `concertino --help` (no subcommand token), `parseArgs(['--help'])` → `{_: [], help: true}`, so `args._[0]` is `undefined` and `cmd` defaults to `'watch'` — dispatching to `cmdWatch(args)` with `args.help === true` already set.
  I verified today's actual behavior by running `node bin/concertino --help` in the worktree: it launches the full live-fleet TUI dashboard, completely ignoring `--help` — exactly the class of bug the ticket is about, just triggered through the *default* path rather than an explicit `watch` subcommand.
  Under the proposed design, task 3.7 adds a `hasHelpFlag(args)` check as the first line of `cmdWatch`. Since bare `--help` sets `args.help = true`, this check will now fire for the *bare* invocation too, printing `watch`'s usage block and exiting 0 instead of launching the dashboard.
  This directly contradicts:
  - proposal.md line 11: "No changes to `bin/concertino`'s top-level dispatch — the default (no subcommand) and `concertino help` continue to route exactly as today."
  - proposal.md line 21: "`cli-default-command` ... unaffected, since the default/bare invocation ... untouched."
  - design.md line 15 (Non-Goals): "No change to `bin/concertino`'s top-level dispatch, the default bare-`concertino` behavior, or `concertino help` itself."
  These claims are only true of the *dispatch code*; they are false of the *observable behavior* of bare `concertino --help`, because `cmdWatch` is reached by both the explicit `watch` subcommand and the default fallback, and the change instruments `cmdWatch` unconditionally.
  I also checked bare `concertino -h` (short flag): `parseArgs(['-h'])` → `{_: ['-h']}`, so `cmd = '-h'`, which matches none of the `if/else` branches and falls to `else help()` — the aggregate help, both before and after this change (verified by running it: prints the full `concertino help` output). So bare `-h` and bare `--help` are asymmetric today, and remain asymmetric (differently) after the change — `-h` → aggregate help, `--help` → `watch`'s single-command usage block, and neither is decided upon or tested anywhere in this change's artifacts.
  This is not covered by any scenario in `specs/cli-subcommand-help/spec.md` (all four requirements there talk about "a subcommand" or "`concertino help`", never about bare invocation), nor is it a task in `tasks.md`. It's a real gap: an implementer following the tasks literally will introduce this behavior change to the tool's single most common invocation (`concertino --help`) without anyone having decided whether it's wanted, and an evaluator won't catch it because nothing in the planning artifacts asks for a test on it.

### Verdict: REFUTE

### Change Requests

1. **Resolve the bare `concertino --help`/`-h` question explicitly in design.md and reflect it in spec.md/tasks.md.** Pick one:
   - (a) Accept it as intended (bare `--help` now shows `watch`'s usage instead of launching the dashboard) — update proposal.md/design.md's non-goal language (it is currently factually wrong per the evidence above), add a spec.md scenario for it, and add a tasks.md test case (`concertino --help` with no subcommand → `watch` usage, exit 0); also decide/document what bare `-h` should do so the two aren't left arbitrarily inconsistent, or
   - (b) Explicitly exclude the bare/default path from getting help behavior (e.g. `cmdWatch`'s check only fires when reached via the literal `watch` subcommand, not the `|| 'watch'` fallback — which does require a `bin/concertino`-side signal of some kind, so the "no changes to `bin/concertino`" non-goal in proposal.md/design.md needs to be revised to carve out this one line).
   Either is acceptable; leaving it undecided is not, since the current artifacts assert a non-goal that the chosen mechanism does not actually hold.

### Non-blocking notes

- Decision 3's `printUsage(cmdName)` spec ("prints `banner()` + that command's block") doesn't say whether the trailing `Docs: ...` footer line from `help()`'s aggregate output is included per-subcommand. Worth a one-line clarification in design.md so the executor doesn't have to guess, though the spec's "matching the per-command section already in `lib/cli/help.js`" wording makes the intended answer (footer excluded) reasonably inferable already.
