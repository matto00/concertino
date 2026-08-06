# cli-default-command Specification

## Purpose
Defines the CLI's default entry-point behavior — bare `concertino` launches
the fleet dashboard — and requires every registered subcommand to be
discoverable from top-level help, shell completions, and the README.
## Requirements
### Requirement: Bare `concertino` launches the fleet dashboard
Running `concertino` with no subcommand SHALL launch the fleet dashboard
through the exact same code path as `concertino watch` — the same
`cmdWatch(args)` call, including its `--out`/`--config` flag resolution —
**except** when `--help` or `-h` is also present with no subcommand token, in
which case the CLI SHALL print the same aggregate output as `concertino help`
and exit 0 instead of launching the dashboard, so that the two flags are
handled consistently and never silently ignored.
`concertino help` and `concertino --version` SHALL continue to require being
typed explicitly and SHALL be unaffected by this default.

#### Scenario: No arguments
- **WHEN** a user runs `concertino` with no subcommand and no flags
- **THEN** the fleet dashboard launches, identically to `concertino watch`

#### Scenario: Explicit `watch` still works
- **WHEN** a user runs `concertino watch`
- **THEN** the fleet dashboard launches, identically to bare `concertino`

#### Scenario: `--out`/`--config` resolution preserved on the bare form
- **WHEN** a user runs `concertino --out=/some/path` with no subcommand
- **THEN** the dashboard launches against `/some/path`, exactly as
  `concertino watch --out=/some/path` would

#### Scenario: `help` and `--version` remain explicit
- **WHEN** a user runs `concertino help` or `concertino --version`
- **THEN** the existing help text or version string is printed, unchanged —
  neither is affected by the new bare-invocation default

#### Scenario: Bare `--help` shows aggregate help, not the dashboard
- **WHEN** a user runs bare `concertino --help` (no subcommand token)
- **THEN** the CLI prints the same aggregate output as `concertino help` and
  exits 0, without launching the dashboard

#### Scenario: Bare `-h` shows aggregate help, not the dashboard
- **WHEN** a user runs bare `concertino -h` (no subcommand token)
- **THEN** the CLI prints the same aggregate output as `concertino help` and
  exits 0, without launching the dashboard — consistent with bare `--help`
  above (both flags behave identically on the bare form)

### Requirement: Every registered subcommand is discoverable
Every subcommand dispatched in `bin/concertino`'s command table SHALL appear
in the top-level help text (`lib/cli/help.js`), every shell completion
script (`lib/cli/completion.js`'s fish/zsh/bash output), and `README.md`'s
`## CLI reference` section.

#### Scenario: Completion covers every dispatched subcommand
- **WHEN** the set of subcommands in `lib/cli/completion.js`'s `CMDS` list is
  compared against `bin/concertino`'s dispatch `if/else` chain
- **THEN** every dispatched subcommand (including `prune`, `eject`,
  `migrate`, and `answer`) appears in `CMDS`

#### Scenario: Help text covers every dispatched subcommand
- **WHEN** the top-level help text is compared against `bin/concertino`'s
  dispatch `if/else` chain
- **THEN** every dispatched subcommand, including `answer`, has a
  corresponding entry in the help output

#### Scenario: README's CLI reference covers every dispatched subcommand
- **WHEN** `README.md`'s `## CLI reference` section is compared against
  `bin/concertino`'s dispatch `if/else` chain
- **THEN** every dispatched subcommand, including `prune` and `answer`, has
  a corresponding entry, and the bare-invocation/`watch` relationship is
  documented there too

