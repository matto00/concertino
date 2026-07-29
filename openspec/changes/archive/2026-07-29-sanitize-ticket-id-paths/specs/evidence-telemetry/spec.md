## MODIFIED Requirements

### Requirement: persist-evidence.sh copies an artifact into the main checkout and returns a durable ref
`core/scripts/persist-evidence.sh <TICKET_ID> <SOURCE_PATH>` SHALL copy `SOURCE_PATH` into
`<main checkout>/.concertino/runs/<TICKET_ID>/evidence/` (creating the directory as needed),
resolving the main checkout the same way `emit-event.sh` does, regardless of whether the
script is invoked from within a worktree. On success it SHALL print `READY ref=<absolute
destination path>` to stdout and exit 0. On failure — `TICKET_ID` does not match
`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`, the source is missing or unreadable, or the copy cannot be
written — it SHALL print `FAIL <reason>` to stderr and exit non-zero, and SHALL NOT print a
`READY` line. The `TICKET_ID` shape check SHALL run before the main checkout is resolved or any
directory is created, so a rejected `TICKET_ID` produces no filesystem side effect of any kind.

#### Scenario: Artifact is persisted to the main checkout, not the worktree
- **WHEN** `persist-evidence.sh TICKET-1 <path-to-a-file-inside-a-worktree>` is run
- **THEN** a copy of that file exists at
  `<main checkout>/.concertino/runs/TICKET-1/evidence/<basename>`, and the script prints
  `READY ref=<that absolute path>`

#### Scenario: The returned ref survives the worktree being removed
- **WHEN** `persist-evidence.sh` has persisted an artifact for a ticket, and the worktree it
  was copied from is subsequently deleted (as `cleanup.sh --phase4` does)
- **THEN** the path printed in the earlier `READY ref=` line still exists and is readable

#### Scenario: Missing source artifact fails without emitting a ref
- **WHEN** `persist-evidence.sh` is given a `SOURCE_PATH` that does not exist
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, and prints no `READY` line

#### Scenario: Re-persisting the same artifact is idempotent
- **WHEN** `persist-evidence.sh` is run twice in a row for the same ticket and source path
- **THEN** both runs succeed and the destination file matches the source's current content
  after each run

#### Scenario: An invalid TICKET_ID fails before touching the filesystem
- **WHEN** `persist-evidence.sh` is given a `TICKET_ID` that does not match
  `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` (e.g. `../../../../escape`), even with a valid, readable
  `SOURCE_PATH`
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, prints no `READY` line, and
  creates no directory or file anywhere, including outside `.concertino/runs/`
