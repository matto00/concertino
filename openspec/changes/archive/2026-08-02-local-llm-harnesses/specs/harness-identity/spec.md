## MODIFIED Requirements

### Requirement: `setup-worktree.sh` resolves the running harness at runtime
`setup-worktree.sh` SHALL determine the harness for the `run.start` telemetry
event's `harness=` field using this resolution order: (1) a runtime signal
read directly from the process environment — `CLAUDECODE` set non-empty
indicates `claude-code`; `CODEX_SANDBOX` or `CODEX_SANDBOX_NETWORK_DISABLED`
set non-empty indicates `codex`; a best-effort OpenCode runtime signal set
non-empty indicates `opencode`, checked after the `CLAUDECODE` and
`CODEX_SANDBOX*` checks; (2) if no runtime signal is present, the static
`CONCERTINO_HARNESS` value sourced from `.concertino.env`; (3) if neither
resolves a value, the literal string `unknown`. The script SHALL NOT report a
harness value that contradicts a detected runtime signal. The OpenCode signal
is not a documented public contract (mirroring the existing two signals'
same caveat) — its absence, or OpenCode never setting it in practice, SHALL
NOT be treated as an error and SHALL simply fall through to step (2).

#### Scenario: Run started under Claude Code
- **WHEN** `setup-worktree.sh` runs in a process where `CLAUDECODE` is set
  (regardless of the project's configured `harnesses` or the static
  `CONCERTINO_HARNESS` default)
- **THEN** the `run.start` event records `harness=claude-code`

#### Scenario: Run started under Codex
- **WHEN** `setup-worktree.sh` runs in a process where `CODEX_SANDBOX` (or
  `CODEX_SANDBOX_NETWORK_DISABLED`) is set
- **THEN** the `run.start` event records `harness=codex`

#### Scenario: Run started under OpenCode
- **WHEN** `setup-worktree.sh` runs in a process where the OpenCode runtime
  signal is set, and neither `CLAUDECODE` nor `CODEX_SANDBOX*` is set
- **THEN** the `run.start` event records `harness=opencode`

#### Scenario: Both runtime signals set simultaneously
- **WHEN** `setup-worktree.sh` runs in a process where both `CLAUDECODE` and
  `CODEX_SANDBOX` are set
- **THEN** the `run.start` event records `harness=claude-code` — `CLAUDECODE` is
  checked first and wins, since a Codex sandbox process would not independently
  set `CLAUDECODE`

#### Scenario: Claude Code signal wins over an OpenCode signal
- **WHEN** `setup-worktree.sh` runs in a process where both `CLAUDECODE` and
  the OpenCode runtime signal are set
- **THEN** the `run.start` event records `harness=claude-code` — `CLAUDECODE`
  is checked first in the resolution order

#### Scenario: No runtime signal, single-harness project
- **WHEN** `setup-worktree.sh` runs with none of `CLAUDECODE`,
  `CODEX_SANDBOX*`, or the OpenCode runtime signal set, and the project's
  `.concertino.env` has a non-empty static `CONCERTINO_HARNESS`
- **THEN** the `run.start` event records that static value

#### Scenario: No runtime signal, no static default
- **WHEN** `setup-worktree.sh` runs with none of `CLAUDECODE`,
  `CODEX_SANDBOX*`, or the OpenCode runtime signal set, and
  `CONCERTINO_HARNESS` is unset or empty
- **THEN** the `run.start` event records `harness=unknown`

#### Scenario: OpenCode signal absent or unrecognized does not error
- **WHEN** `setup-worktree.sh` runs in a process where OpenCode is actually
  running but the guessed runtime signal is not the one OpenCode actually
  sets (or sets none at all)
- **THEN** `setup-worktree.sh` does not fail or report an error — it falls
  through to the static `CONCERTINO_HARNESS` value, or `unknown`, exactly as
  it would for any other harness with no detected runtime signal
