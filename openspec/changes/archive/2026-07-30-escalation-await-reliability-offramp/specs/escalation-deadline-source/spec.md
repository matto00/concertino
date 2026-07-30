## ADDED Requirements

### Requirement: emit-event.sh sources .concertino.env so CONCERTINO_ESCALATION_TIMEOUT_MIN actually applies
`core/scripts/emit-event.sh` SHALL source `.concertino.env` when it can be found, so `CONCERTINO_ESCALATION_TIMEOUT_MIN` (and any other setting `.concertino.env` carries) actually reaches the script instead of silently falling back to a hardcoded default. It SHALL check, in order: (1) `.concertino.env` next to the currently executing script file (matching the convention `assert-phase.sh`/`start-servers.sh`/`cleanup.sh`/`resolve-speed.sh`/`setup-worktree.sh` already use); (2) if not found there, `.concertino.env` at `scripts/concertino/` under the resolved main checkout (the same main-checkout resolution already used for the event log path). Neither check SHALL fail or error when no `.concertino.env` exists anywhere — the pre-existing hardcoded default SHALL apply exactly as before this change. A value sourced from `.concertino.env` SHALL take precedence over an already-exported value of the same name in the calling process's environment, matching the sibling scripts' existing unconditional-source convention.

#### Scenario: A configured timeout applies when the script runs from the main checkout
- **WHEN** `emit-event.sh` is invoked from a location whose own directory contains a `.concertino.env` setting `CONCERTINO_ESCALATION_TIMEOUT_MIN`
- **THEN** an `--await` call's deadline is computed using that configured value, not the hardcoded default

#### Scenario: A configured timeout applies when the script runs from inside a worktree
- **WHEN** `emit-event.sh` is invoked via a relative path from inside a git worktree whose own copy of the containing directory has no `.concertino.env`, but the main checkout's corresponding `scripts/concertino/.concertino.env` sets `CONCERTINO_ESCALATION_TIMEOUT_MIN`
- **THEN** an `--await` call's deadline is still computed using the main checkout's configured value

#### Scenario: No .concertino.env anywhere leaves the existing default unaffected
- **WHEN** `emit-event.sh` runs in a repository with no `.concertino.env` at either checked location (e.g. a throwaway test repo)
- **THEN** `--await`'s deadline is computed from the pre-existing hardcoded default, byte-for-byte the same as before this change

#### Scenario: A sourced value overrides an already-exported environment variable
- **WHEN** the calling process has already exported `CONCERTINO_ESCALATION_TIMEOUT_MIN` to one value, and a `.concertino.env` found at either checked location sets it to a different value
- **THEN** the sourced value from `.concertino.env` is what `--await`'s deadline is computed from
