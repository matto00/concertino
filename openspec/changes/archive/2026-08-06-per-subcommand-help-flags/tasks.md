## 1. Shared helper

- [x] 1.1 Add `hasHelpFlag(args)` to `lib/cli/shared.js` (checks `args.help === true || args._.includes('-h')`) and export it.

## 2. Extract per-command usage text in help.js

- [x] 2.1 Split `help.js`'s single template string into a per-command lookup (map or `usageFor(cmdName)` function) covering all 14 commands: init, sync, update, validate, diff, doctor, watch, prune, upgrade, gates, completion, eject, migrate, answer.
- [x] 2.2 Export a `printUsage(cmdName)` helper from `help.js` that prints `banner()` + that command's usage block.
- [x] 2.3 Rewrite `help()` to compose its output from the same per-command lookup, preserving today's exact display order and formatting.
- [x] 2.4 Capture `concertino help`'s stdout before and after the refactor and diff them — confirm byte-for-byte parity.

## 3. Add `--help`/`-h` checks to the 13 `parseArgs`-based commands

- [x] 3.1 `cmdInit` (init.js)
- [x] 3.2 `cmdSync` (sync.js)
- [x] 3.3 `cmdUpdate` (update.js)
- [x] 3.4 `cmdValidate` (validate.js)
- [x] 3.5 `cmdDiff` (diff.js)
- [x] 3.6 `cmdDoctor` (doctor.js)
- [x] 3.7 `cmdWatch` (watch.js)
- [x] 3.8 `cmdPrune` (prune.js)
- [x] 3.9 `cmdUpgrade` (upgrade.js)
- [x] 3.10 `cmdGates` (gates.js)
- [x] 3.11 `cmdCompletion` (completion.js)
- [x] 3.12 `cmdEject` (eject.js)
- [x] 3.13 `cmdMigrate` (migrate.js)

For each: add `if (hasHelpFlag(args)) { printUsage('<cmdname>'); return; }` (or `process.exit(0)` where the function doesn't otherwise return early) as the first line of the function body, before any other logic.

## 4. Add the divergent check to `cmdAnswer`

- [x] 4.1 In `cmdAnswer` (answer.js), before calling `parseAnswerArgv(argv)`, add: `if (argv.includes('--help') || argv.includes('-h')) { printUsage('answer'); process.exit(0); }`.

## 5. Bare-invocation carve-out (design gate round 1)

- [x] 5.1 In `bin/concertino`, after `args`/`cmd` are computed and before the dispatch `if`/`else if` chain, add: `if (!args._[0] && hasHelpFlag(args)) { help(); process.exit(0); }`.
- [x] 5.2 Import `hasHelpFlag` from `lib/cli/shared.js` in `bin/concertino`.

## 6. Tests

- [x] 6.1 Add/extend CLI tests covering `--help` and `-h` on a representative command from each argument-shape family: `sync` (flag-only), `update` (positional `key=value`), `answer` (raw-argv) — assert usage text printed, exit code 0, no side effects (e.g. no config write, no file sync).
- [x] 6.2 Add a regression test confirming a normal invocation (no `--help`/`-h`) is unaffected, e.g. `gates --run=<gate>` still executes normally.
- [x] 6.3 Add a test confirming `concertino help`'s aggregate output is unchanged after the `help.js` refactor.
- [x] 6.4 Add tests for bare `concertino --help` and bare `concertino -h` (no subcommand token) — both must print the same aggregate `concertino help` output and exit 0, without launching the dashboard.
- [x] 6.5 Add a test for `concertino watch --help` (explicit subcommand) — must print `watch`'s own single-command usage, not the aggregate help output.
- [x] 6.6 Add a regression test confirming bare `concertino` with no flags at all still launches the dashboard unaffected.

## 7. Verification

- [x] 7.1 Run the full project gate suite (lint/tests) and confirm green.
- [x] 7.2 Manually spot-check `--help`/`-h` output for at least 3 commands against `concertino help`'s corresponding section for visual parity.
- [x] 7.3 Manually verify bare `concertino --help`, bare `concertino -h`, and `concertino watch --help` produce the three distinct behaviors specified in Decision 5 / spec.md.
- [x] 7.4 Before archiving this change (`openspec archive` has no `--dry-run`), manually confirm the delta-to-capability mapping is correct: `openspec/changes/per-subcommand-help-flags/specs/cli-default-command/spec.md` exists and contains only the modified "Bare `concertino` launches the fleet dashboard" requirement, and `openspec/changes/per-subcommand-help-flags/specs/cli-subcommand-help/spec.md` contains no default-dispatch content. Confirmed both hold as authored (archiving itself is out of the executor's scope for this change). After archiving, confirm `openspec/specs/cli-default-command/spec.md` actually picked up the new `--help`/`-h` carve-out language.
