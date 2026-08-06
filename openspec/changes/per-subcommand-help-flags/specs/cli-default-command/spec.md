## MODIFIED Requirements

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
