# cli-subcommand-help Specification

## Purpose
Ensures every `concertino` subcommand recognizes `--help`/`-h`, printing its
own usage block (sourced from a single shared location shared with
`concertino help`) and exiting 0 before any argument validation or side
effects.
## Requirements
### Requirement: Per-subcommand `--help`/`-h` flag
Every `concertino <subcommand>` command SHALL recognize both `--help` and `-h` as requests for that subcommand's own usage text, independent of the shared top-level `concertino help` command.

#### Scenario: Long flag on a flag-only command
- **WHEN** a user runs `concertino sync --help`
- **THEN** the CLI prints `sync`'s usage block (the same text shown in `concertino help`'s `sync` section) and exits with status 0, without performing a sync

#### Scenario: Short flag on a flag-only command
- **WHEN** a user runs `concertino doctor -h`
- **THEN** the CLI prints `doctor`'s usage block and exits with status 0, without running any environment checks

### Requirement: Help flag precedence over argument validation
The `--help`/`-h` check SHALL run before any of the subcommand's own argument validation, config loading, or side effects, so that a malformed or missing positional argument never suppresses the help output.

#### Scenario: Help requested alongside a missing required positional
- **WHEN** a user runs `concertino update --help` (with no `key=value` pairs)
- **THEN** the CLI prints `update`'s usage block and exits 0, rather than printing the `usage: concertino update <key=value>` validation error

#### Scenario: Help requested on the raw-argv command
- **WHEN** a user runs `concertino answer --help` or `concertino answer -h` (with no ticket/value positionals)
- **THEN** the CLI prints `answer`'s usage block and exits 0, rather than printing the `usage: concertino answer <ticket> <value>` validation error

### Requirement: Single source of truth for usage text
Per-subcommand usage text SHALL be sourced from one shared location reused by both `concertino help` and each subcommand's own `--help`/`-h` output, so the two can never drift out of sync.

#### Scenario: Aggregate help output unchanged
- **WHEN** a user runs `concertino help`
- **THEN** the output is unchanged (byte-for-byte) from before this change, since it is now composed from the same per-command text the individual `--help` checks render

### Requirement: No regression when help is not requested
Subcommands SHALL behave exactly as before this change when `--help`/`-h` is not present in the invocation.

#### Scenario: Normal invocation still executes
- **WHEN** a user runs `concertino gates --run=some-gate` (no `--help`/`-h`)
- **THEN** the CLI executes `gates` normally, with no change in output or exit code compared to before this change

#### Scenario: Explicit `watch` subcommand gets its own usage, not the aggregate help
- **WHEN** a user runs `concertino watch --help` (explicit subcommand token)
- **THEN** the CLI prints `watch`'s own single-command usage block (not the aggregate `concertino help` output) and exits 0, without launching the dashboard

(Bare `concertino --help`/`-h` with no subcommand token, and bare `concertino` with no flags, are specified by the `cli-default-command` capability's own delta in this change — see `specs/cli-default-command/spec.md` — since they concern the default-command dispatch, not a specific subcommand's own help behavior.)

