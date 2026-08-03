## ADDED Requirements

### Requirement: `opencode` is a valid configured harness
`concertino.config.json`'s `harnesses` array SHALL accept `"opencode"` as a
valid entry, alongside the existing `"claude-code"` and `"codex"` values.
`concertino validate` SHALL NOT report `"opencode"` as an unknown harness.
An unconfigured project's default `harnesses` value SHALL remain
`["claude-code", "codex"]` — `opencode` SHALL NOT be added by default.

#### Scenario: opencode accepted in harnesses
- **WHEN** a project's config has `"harnesses": ["opencode"]`
- **THEN** `concertino validate` reports the harness as valid, with no
  "unknown harnesses" error

#### Scenario: default harnesses unchanged
- **WHEN** a project's config has no `harnesses` field at all
- **THEN** the effective (defaulted) `harnesses` value is
  `["claude-code", "codex"]` — `opencode` is not present

### Requirement: `concertino sync` renders OpenCode's native project configuration
When `harnesses` includes `"opencode"`, `concertino sync` SHALL render
OpenCode's native project configuration, per-role agent definitions for
`orchestrator`, `executor`, `evaluator`, `skeptic`, and `auditor`, and a
delivery command/prompt equivalent to the other harnesses'
`concertino-deliver` entry point. When `harnesses` does not include
`"opencode"`, `concertino sync` SHALL NOT write any OpenCode-specific files.

#### Scenario: opencode files rendered when configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["opencode"]`
- **THEN** OpenCode's native project configuration file, per-role agent
  definitions, and a delivery command/prompt file are written under the
  project's OpenCode configuration directory

#### Scenario: opencode files absent when not configured
- **WHEN** `concertino sync` runs for a project whose config has
  `"harnesses": ["claude-code", "codex"]` (no `opencode`)
- **THEN** no OpenCode-specific files are written, and no existing
  OpenCode-unrelated file's content changes as a result of this requirement

### Requirement: `concertino doctor` checks only the CLIs of selected harnesses
`concertino doctor` SHALL check for the presence of each harness's CLI only
when that harness is present in the project's configured `harnesses` — this
applies uniformly to `claude-code`, `codex`, and `opencode` alike (a
project selecting fewer than all three harnesses SHALL NOT see a warning or
failure about an unselected harness's CLI).

#### Scenario: opencode CLI checked when opencode configured
- **WHEN** `concertino doctor` runs for a project whose config has
  `"harnesses": ["opencode"]`
- **THEN** doctor checks for the `opencode` CLI on `PATH` and reports its
  presence or absence

#### Scenario: claude-code CLI not checked when claude-code is not configured
- **WHEN** `concertino doctor` runs for a project whose config has
  `"harnesses": ["codex"]` (no `claude-code`)
- **THEN** doctor does not check for or report on the `claude` CLI

### Requirement: `concertino eject`/`diff`/`upgrade`/completions support opencode
`concertino eject --harness=opencode --role=<role>` SHALL print the rendered
OpenCode agent definition for a supported role to stdout, using the same
harness-dispatch pattern as `--harness=claude-code`/`--harness=codex`.
`concertino diff` SHALL include OpenCode's rendered files in its comparison
when `opencode` is configured. `concertino upgrade`'s stale-rendered-file
scan SHALL include OpenCode's rendered directory. `concertino completion`'s
`--harness=` value completions (zsh and bash) SHALL include `opencode`.

#### Scenario: eject supports opencode
- **WHEN** a user runs `concertino eject --harness=opencode --role=executor`
  against a project with a valid config
- **THEN** the rendered OpenCode executor agent definition is printed to
  stdout

#### Scenario: unknown harness error still lists opencode as valid
- **WHEN** a user runs `concertino eject --harness=bogus --role=executor`
- **THEN** the error message lists `claude-code`, `codex`, and `opencode` as
  the valid harness values

#### Scenario: completions include opencode
- **WHEN** a user requests zsh or bash completions for `concertino sync
  --harness=`
- **THEN** `opencode` appears among the completion candidates

### Requirement: OpenCode runtime-identity signal (best-effort)
`setup-worktree.sh` and `resolve-speed.sh` SHALL attempt to detect a running
OpenCode process via a best-effort, undocumented-contract environment-variable
check, evaluated after the existing `CLAUDECODE` and
`CODEX_SANDBOX`/`CODEX_SANDBOX_NETWORK_DISABLED` checks and before falling
back to the static `CONCERTINO_HARNESS` default. Absence of the signal, or
the signal never being set by OpenCode in practice, SHALL NOT be treated as
an error — detection SHALL fall through to the existing fallback chain
exactly as it does today for a harness with no matching runtime signal.

#### Scenario: opencode runtime signal detected
- **WHEN** `setup-worktree.sh` runs in a process where the OpenCode runtime
  signal is set, and neither `CLAUDECODE` nor `CODEX_SANDBOX*` is set
- **THEN** the `run.start` event records `harness=opencode`

#### Scenario: no opencode signal falls back safely
- **WHEN** `setup-worktree.sh` runs in a process where no runtime signal
  (Claude Code, Codex, or OpenCode) is set
- **THEN** the `run.start` event records the static `CONCERTINO_HARNESS`
  value, or `unknown` if that is also empty — exactly today's existing
  fallback behavior, unaffected by this requirement
