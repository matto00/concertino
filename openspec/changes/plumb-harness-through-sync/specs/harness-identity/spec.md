## ADDED Requirements

### Requirement: `concertino sync` renders a `CONCERTINO_HARNESS` static default
`concertino sync` SHALL write a `CONCERTINO_HARNESS` key into
`scripts/concertino/.concertino.env` alongside the other `CONCERTINO_*` values. When
the project config's `harnesses` array has exactly one entry, the value SHALL be
that harness. When `harnesses` has more than one entry, the value SHALL be empty —
sync SHALL NOT write the full configured list or an arbitrary single pick as a
stand-in for a value it cannot determine at render time.

#### Scenario: Single harness configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["claude-code"]`
- **THEN** the rendered `.concertino.env` contains `CONCERTINO_HARNESS='claude-code'`

#### Scenario: Multiple harnesses configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["claude-code", "codex"]`
- **THEN** the rendered `.concertino.env` contains `CONCERTINO_HARNESS=''`

### Requirement: `setup-worktree.sh` resolves the running harness at runtime
`setup-worktree.sh` SHALL determine the harness for the `run.start` telemetry
event's `harness=` field using this resolution order: (1) a runtime signal read
directly from the process environment — `CLAUDECODE` set non-empty indicates
`claude-code`; `CODEX_SANDBOX` or `CODEX_SANDBOX_NETWORK_DISABLED` set non-empty
indicates `codex`; (2) if no runtime signal is present, the static
`CONCERTINO_HARNESS` value sourced from `.concertino.env`; (3) if neither resolves
a value, the literal string `unknown`. The script SHALL NOT report a harness value
that contradicts a detected runtime signal.

#### Scenario: Run started under Claude Code
- **WHEN** `setup-worktree.sh` runs in a process where `CLAUDECODE` is set
  (regardless of the project's configured `harnesses` or the static
  `CONCERTINO_HARNESS` default)
- **THEN** the `run.start` event records `harness=claude-code`

#### Scenario: Run started under Codex
- **WHEN** `setup-worktree.sh` runs in a process where `CODEX_SANDBOX` (or
  `CODEX_SANDBOX_NETWORK_DISABLED`) is set
- **THEN** the `run.start` event records `harness=codex`

#### Scenario: Both runtime signals set simultaneously
- **WHEN** `setup-worktree.sh` runs in a process where both `CLAUDECODE` and
  `CODEX_SANDBOX` are set
- **THEN** the `run.start` event records `harness=claude-code` — `CLAUDECODE` is
  checked first and wins, since a Codex sandbox process would not independently
  set `CLAUDECODE`

#### Scenario: No runtime signal, single-harness project
- **WHEN** `setup-worktree.sh` runs with neither `CLAUDECODE` nor `CODEX_SANDBOX`
  set, and the project's `.concertino.env` has a non-empty static
  `CONCERTINO_HARNESS`
- **THEN** the `run.start` event records that static value

#### Scenario: No runtime signal, no static default
- **WHEN** `setup-worktree.sh` runs with neither `CLAUDECODE` nor `CODEX_SANDBOX`
  set, and `CONCERTINO_HARNESS` is unset or empty
- **THEN** the `run.start` event records `harness=unknown`

### Requirement: `concertino validate` surfaces harness-telemetry resolution
`concertino validate` SHALL print an informational line in the "Integrations"
section describing how `CONCERTINO_HARNESS` will resolve for the project's
configured `harnesses` (a static value for a single configured harness, or
runtime-detection for more than one). This SHALL never be reported as a
validation error — an empty static default for a multi-harness project is a
correct, expected state, not a misconfiguration.

#### Scenario: Validate reports static resolution
- **WHEN** `concertino validate` runs against a config with
  `"harnesses": ["claude-code"]`
- **THEN** the Integrations section reports the static harness value that will be
  written to `CONCERTINO_HARNESS`, and validation does not fail because of it

#### Scenario: Validate reports runtime-detection resolution
- **WHEN** `concertino validate` runs against a config with
  `"harnesses": ["claude-code", "codex"]`
- **THEN** the Integrations section reports that `CONCERTINO_HARNESS` resolves at
  runtime rather than statically, and validation does not fail because of it
