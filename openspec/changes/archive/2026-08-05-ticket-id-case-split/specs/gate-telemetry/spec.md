## ADDED Requirements

### Requirement: assert-phase.sh and start-servers.sh accept an explicit ticket id

`core/scripts/assert-phase.sh` and `core/scripts/start-servers.sh` SHALL each accept the canonical
ticket id as an explicit, optional trailing positional argument (after every argument that phase or
script already required). When provided, every `gate.result`/`gate.warning` event that invocation
emits SHALL be tagged with that value verbatim. When omitted, each script SHALL fall back to its
existing `${WORKTREE_PATH##*/}` basename inference — this fallback is a documented degradation
path, not the primary mechanism, mirroring the shape `core/scripts/cleanup.sh` already established
for this exact problem (CON-64).

#### Scenario: assert-phase.sh tags telemetry with the explicit ticket id, ignoring basename case

- **WHEN** `assert-phase.sh setup <WORKTREE_PATH> CON-79` is run against a worktree whose basename
  is `con-79` (a lowercase ticket suffix)
- **THEN** the emitted `gate.result` event's `ticket` field is `CON-79`, not `con-79`

#### Scenario: start-servers.sh tags telemetry with the explicit ticket id, ignoring basename case

- **WHEN** `start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT> CON-79` is run against a
  worktree whose basename is `con-79`
- **THEN** every `gate.result` event it emits (for backend and/or frontend) has `ticket` field
  `CON-79`, not `con-79`

#### Scenario: omitting the explicit ticket id falls back to basename inference, unchanged

- **WHEN** `assert-phase.sh setup <WORKTREE_PATH>` or
  `start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>` is run with no trailing ticket id
  argument, against a worktree whose basename matches the ticket shape
- **THEN** the emitted event's `ticket` field equals that basename, exactly as before this change

#### Scenario: an explicit ticket id run alongside a non-ticket-shaped basename still tags correctly

- **WHEN** `assert-phase.sh setup <WORKTREE_PATH> CON-79` is run against a worktree whose basename
  does not match the ticket shape at all (e.g. `local-llm-harnesses`)
- **THEN** the emitted `gate.result` event's `ticket` field is `CON-79` — the explicit argument
  takes priority over inference regardless of whether inference would have succeeded

### Requirement: existing stdout/stderr/exit-code contracts are unaffected

Adding the explicit trailing ticket-id argument SHALL NOT change any byte of
`assert-phase.sh`'s or `start-servers.sh`'s existing `PASS`/`FAIL`/`READY` stdout or stderr output,
nor their exit codes, whether or not the new argument is supplied.

#### Scenario: stdout is unchanged with the new argument supplied

- **WHEN** `assert-phase.sh setup <WORKTREE_PATH> CON-79` succeeds
- **THEN** stdout is exactly `PASS setup`, identical to the no-argument invocation

#### Scenario: stdout is unchanged without the new argument

- **WHEN** `assert-phase.sh setup <WORKTREE_PATH>` succeeds with no trailing ticket id
- **THEN** stdout is exactly `PASS setup`, identical to before this change
