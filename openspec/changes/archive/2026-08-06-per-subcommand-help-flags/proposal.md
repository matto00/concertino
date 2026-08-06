## Why

No `concertino` subcommand supports its own `--help`/`-h` flag today. `concertino sync --help` silently ignores the flag and runs `sync` for real; `concertino update --help` is actively misinterpreted (parsed as a boolean flag, then still fails validation for a missing `key=value` positional with a `usage:` error that never mentions `--help`). The only documentation surface is the shared top-level `concertino help`, which is not discoverable from within a subcommand the way `--help`/`-h` conventionally is. This was flagged as finding 4 of the CON-59 CLI audit (`docs/cli-audit-2026-08.md`).

## What Changes

- Add a shared `hasHelpFlag(args)` helper in `lib/cli/shared.js` that recognizes both `--help` and the short `-h` flag. (`-h` is not parsed as a flag by the existing `parseArgs` regex — it lands in `args._` — so the helper needs to check both `args.help` and `args._.includes('-h')`.)
- Extract each subcommand's existing usage block out of `lib/cli/help.js`'s single monolithic string into a per-command lookup (e.g. a `usage(cmdName)` function or exported map) that both `concertino help` and the new per-subcommand check can render from — a single source of truth, not a second copy of the text.
- At the top of every `cmd*` function across `lib/cli/*.js` (`cmdInit`, `cmdSync`, `cmdUpdate`, `cmdValidate`, `cmdDiff`, `cmdDoctor`, `cmdWatch`, `cmdPrune`, `cmdUpgrade`, `cmdGates`, `cmdCompletion`, `cmdEject`, `cmdMigrate`, `cmdAnswer` — 14 functions found via `grep -n "^\(async \)\?function cmd" lib/cli/*.js`, the ticket's tally of "thirteen" undercounts by one), add a `hasHelpFlag(args)` check that prints that command's usage block and returns/exits before any other argument validation runs.
- `cmdAnswer` parses `process.argv.slice(3)` directly via its own `parseAnswerArgv`, not the shared `parseArgs` — its help check needs to inspect the raw argv slice rather than a `parseArgs` result; call this out explicitly in `design.md` and `tasks.md` so it isn't implemented identically to the other 13 by copy-paste.
- **One narrow, explicit carve-out to `bin/concertino`'s dispatch (found by the design-soundness gate, round 1):** `bin/concertino` defaults a bare `concertino` invocation (no subcommand token) to `cmdWatch` (`cmd = args._[0] || 'watch'`). Once `cmdWatch` itself gains a `--help`/`-h` check (per this change), a bare `concertino --help` would newly dispatch into `cmdWatch` with `args.help` already set and print `watch`'s single-command usage instead of launching the dashboard — while bare `concertino -h` already falls through to the aggregate `help()` today (since `-h` isn't a recognized subcommand token) and would keep doing so, leaving the two arbitrarily inconsistent. `bin/concertino` adds one explicit check — `if (!args._[0] && hasHelpFlag(args)) { help(); process.exit(0); }`, placed before the existing dispatch — so bare `--help` and bare `-h` both consistently show the aggregate `concertino help` output, matching `-h`'s existing behavior today. This is the one line of `bin/concertino`'s dispatch that does change; everything else (explicit `concertino watch --help`, and every other subcommand's dispatch) is untouched.
- No other changes to `bin/concertino`'s top-level dispatch — an explicit subcommand invocation (e.g. `concertino watch --help`, `concertino sync --help`) continues to route exactly as today, straight into that command's own function.

## Capabilities

### New Capabilities

- `cli-subcommand-help`: every `concertino <subcommand>` accepts `--help`/`-h`, printing that subcommand's own usage block and exiting 0, taking precedence over the subcommand's own argument validation.

### Modified Capabilities

- `cli-default-command`: bare `concertino --help`/`-h` (no subcommand token) now consistently prints the aggregate `concertino help` output and exits 0, instead of the current asymmetric behavior (bare `-h` already shows aggregate help; bare `--help` today launches the dashboard, ignoring the flag entirely — the exact bug class this ticket targets, just reached via the default path). Every other aspect of the default command (bare `concertino` with no flags at all still launches the dashboard) is unchanged.

## Impact

- Affected code: `lib/cli/shared.js` (new `hasHelpFlag` helper), `lib/cli/help.js` (refactor to expose per-command usage text), all 14 `lib/cli/*.js` command modules (add the help check), `bin/concertino` (one added line: bare-invocation `--help`/`-h` carve-out, see above).
- No API/config/dependency changes.
- Test impact: existing CLI tests (if any) covering usage/error output for malformed args should continue to pass; new tests should cover `--help`/`-h` on at least one representative subcommand from each argument-shape family (flag-only, e.g. `sync`; positional `key=value`, e.g. `update`; raw-argv, e.g. `answer`).
