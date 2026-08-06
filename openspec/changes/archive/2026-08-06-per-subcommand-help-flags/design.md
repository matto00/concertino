## Context

`bin/concertino` dispatches to 14 `cmd*` functions across `lib/cli/*.js` (`cmdInit`, `cmdSync`, `cmdUpdate`, `cmdValidate`, `cmdDiff`, `cmdDoctor`, `cmdWatch`, `cmdPrune`, `cmdUpgrade`, `cmdGates`, `cmdCompletion`, `cmdEject`, `cmdMigrate`, `cmdAnswer`). None of them recognize `--help`/`-h`. Most parse args via the shared `parseArgs(argv)` in `lib/cli/shared.js`, which only recognizes long `--key[=value]` flags via regex — a bare `-h` is not matched and falls into the `args._` positional array instead. `cmdAnswer` is the one outlier: it parses `process.argv.slice(3)` directly with its own hand-rolled `parseAnswerArgv`, for reasons documented in its own file header (space-separated `--sub 1`-style flags that `parseArgs` can't represent).

Usage text for every subcommand already exists, but only as one hard-coded template string inside `help.js`'s `help()` function — there's no per-command accessor today.

## Goals / Non-Goals

**Goals:**
- Every one of the 14 `cmd*` functions recognizes `--help`/`-h` and, when present, prints that command's own usage block and exits 0 — before any of the command's own argument validation/side effects run.
- A single source of truth for each command's usage text, reused by both `concertino help` (unchanged output) and the new per-subcommand checks — no duplicated usage strings.
- `cmdAnswer`'s raw-argv parsing is handled correctly, not papered over by assuming `parseArgs` semantics apply to it.

**Non-Goals:**
- No change to `bin/concertino`'s top-level dispatch for an *explicit* subcommand invocation (e.g. `concertino watch --help` routes to `cmdWatch` exactly as today) — the one exception is the bare-invocation carve-out in Decision 5 below.
- No change to bare `concertino` (no flags at all) — it continues to launch the dashboard exactly as today.
- No new flags/behavior beyond `--help`/`-h`.
- No change to exit codes or output for any command when `--help`/`-h` is *not* passed.

## Decisions

1. **Add `hasHelpFlag(args)` to `lib/cli/shared.js`.** Signature: `hasHelpFlag(args) => boolean`, checking `args.help === true || (Array.isArray(args._) && args._.includes('-h'))`. This covers every command that uses `parseArgs` (`args.help` catches `--help`; `args._.includes('-h')` catches the short flag, since `-h` isn't consumed by `parseArgs`'s regex and lands in `_`). Alternative considered: teach `parseArgs` itself to special-case `-h` → `help: true`. Rejected — `parseArgs` is shared by every command including ones with positional args that could themselves legitimately be the literal string `-h` in some future command; a dedicated `hasHelpFlag` helper is a narrower, additive surface that doesn't change `parseArgs`'s existing contract or its output shape for the 13 commands already relying on it.

2. **`cmdAnswer` gets its own check, not `hasHelpFlag`.** `parseAnswerArgv` already extracts `pos`/`flags` from raw argv, and `--help`/`-h` would currently be swallowed into `pos` (a bare `--help` matches `parseAnswerArgv`'s "value-bearing flag" branch and would consume the next token as a bogus value; `-h` isn't recognized as a flag at all by its regexes and lands in `pos`). Add a check directly in `cmdAnswer`, before calling `parseAnswerArgv`: `if (argv.includes('--help') || argv.includes('-h')) { printUsage('answer'); process.exit(0); }`. This is the one command whose implementation intentionally diverges from the other 13 (per proposal.md); documenting it here so it isn't collapsed into `hasHelpFlag` by accident during implementation.

3. **Refactor `help.js` to expose per-command usage.** Split the current single template literal into a `USAGE` map (or a `usageFor(cmdName)` function) keyed by command name, each value the exact existing text block for that command (colors/dim formatting preserved). `help()` iterates the map in the existing display order to reproduce today's `concertino help` output byte-for-byte. Export a `printUsage(cmdName)` helper (prints `banner()` + that command's block only — the trailing `Docs: docs/quickstart.md · ...` footer line from `help()`'s aggregate output is a footer for the *whole* help listing, not any single command, so it is excluded from `printUsage`'s per-command output) for the 14 `cmd*` functions to call. Alternative considered: leave `help.js` untouched and hand-write a second, shorter usage string per command inside each `cmd*` function. Rejected — creates two copies of the same documentation that will drift (this is exactly the kind of duplication the CON-59 audit is trying to eliminate elsewhere); a single extraction keeps `concertino help` and `concertino <cmd> --help` provably in sync.

4. **Check placement: first line of the function body, before any other logic.** For all 14 commands, the `hasHelpFlag`/raw-argv check comes before argument validation, config loading, or any side effect — satisfying the ticket's acceptance criterion that `--help` takes precedence over validation errors (e.g. `concertino update --help` must print usage, not the `key=value` positional error).

5. **Bare-invocation carve-out in `bin/concertino` (added after design-gate round 1 review).** `bin/concertino` computes `cmd = args._[0] || 'watch'` — a bare `concertino` with no subcommand token defaults to `cmdWatch`. Once `cmdWatch` gains its `hasHelpFlag` check (Decision 4, task 3.7), a bare `concertino --help` would newly dispatch into `cmdWatch` with `args.help` already `true` and print `watch`'s single-command usage instead of launching the dashboard — while bare `concertino -h` already falls through today to `bin/concertino`'s final `else help()` branch (since `-h` isn't `args._[0]` of any recognized subcommand, `cmd` becomes the literal string `'-h'`, which matches no branch), showing the aggregate help. Left unaddressed, this makes bare `--help` and bare `-h` behave differently from each other, and differently from what the ticket's audit finding was about (a `--help` that should show help, not run the command).
   Resolution: `bin/concertino` adds one explicit check, placed after `args`/`cmd` are computed but before the dispatch `if`/`else if` chain: `if (!args._[0] && hasHelpFlag(args)) { help(); process.exit(0); }`. This makes both bare `--help` and bare `-h` consistently print the aggregate `concertino help` output — matching `-h`'s existing behavior today, and fixing `--help`'s. An *explicit* `concertino watch --help` is unaffected by this check (it has `args._[0] === 'watch'`) and instead exercises `cmdWatch`'s own new per-command check from Decision 4, printing `watch`'s usage specifically.
   Alternative considered: give `cmdWatch` a way to distinguish "reached via explicit `watch`" from "reached via bare-invocation fallback" (e.g. pass a second argument). Rejected — this couples `cmdWatch`'s signature to how `bin/concertino` invoked it, adding a special case to the one function this change otherwise treats identically to the other 13; resolving it one level up in `bin/concertino`, before dispatch, keeps `cmdWatch` itself uniform with the rest.

## Risks / Trade-offs

- [Extracting `help.js`'s single string into a per-command map could subtly change whitespace/formatting for `concertino help`'s aggregate output] → Mitigation: after the refactor, diff `concertino help`'s stdout against a pre-change capture to confirm byte-for-byte parity; this is a concrete verification step in `tasks.md`.
- [14 call sites touched increases surface for a copy-paste mistake, e.g. missing the check on one command or ordering it after validation] → Mitigation: tasks.md tracks each of the 14 modules as its own checklist item; evaluator reviews confirm the check precedes existing logic in every file, not just some.
- [`cmdAnswer`'s divergent check could itself be missed or miscopied from the other 13] → Mitigation: called out explicitly as Decision 2 and its own tasks.md item, with a distinct test case exercising `concertino answer --help` and `concertino answer -h`.

## Migration Plan

No data/config migration. Pure CLI-behavior addition, backward compatible (no existing invocation currently relies on `--help`/`-h` being ignored or mis-parsed in a way user code depends on). Ships as a normal PR; no rollback complexity beyond reverting the commit.
