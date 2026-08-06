# CON-85: Add per-subcommand `--help`/`-h` support across the concertino CLI

## Description

Found during the CON-59 CLI audit (`docs/cli-audit-2026-08.md`, finding 4).

No subcommand supports a per-subcommand `--help`/`-h` flag (confirmed via `grep -rn "args.help\|'-h'\|--help" lib/cli/*.js bin/concertino` — zero matches). `concertino sync --help`, `concertino eject --help`, etc. all currently either run the command with `--help` silently ignored, or get misinterpreted (e.g. `concertino update --help` tries to treat `--help` as a boolean flag and still demands a `key=value` positional, printing a `usage:` error that never mentions `--help` itself). Every subcommand's only source of documentation today is the shared top-level `concertino help`.

## Suggested approach

Add a `--help`/`-h` check at the top of each of the thirteen `cmd*` functions in `lib/cli/*.js` that prints that subcommand's own usage block (the same text already in `lib/cli/help.js`'s per-command section) and exits 0. Touches all thirteen modules, so needs its own review pass rather than being folded into another change.

Referenced from `docs/cli-audit-2026-08.md` finding 4.

## Acceptance Criteria

- Every subcommand (all thirteen `cmd*` functions across `lib/cli/*.js`) supports both `--help` and `-h` flags.
- Passing `--help`/`-h` to any subcommand prints that subcommand's own usage block (matching the per-command section already in `lib/cli/help.js`) and exits with status 0.
- The `--help`/`-h` check takes precedence over normal argument validation — e.g. `concertino update --help` must print usage, not the `key=value` positional error it prints today.
- No regression to existing subcommand behavior when `--help`/`-h` is not passed.
