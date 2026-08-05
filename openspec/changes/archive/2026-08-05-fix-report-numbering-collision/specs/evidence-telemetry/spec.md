## MODIFIED Requirements

### Requirement: persist-evidence.sh copies an artifact into the main checkout and returns a durable ref
`core/scripts/persist-evidence.sh <TICKET_ID> <SOURCE_PATH> [--no-clobber]` SHALL copy
`SOURCE_PATH` into `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/`, preserving
`SOURCE_PATH`'s path relative to the top-level of the git working tree that contains it (creating
whatever intermediate directories that relative path implies, as needed), resolving the main
checkout the same way `emit-event.sh` does, regardless of whether the script is invoked from
within a worktree. On success it SHALL print `READY ref=<absolute destination path>` to stdout and
exit 0. On failure — `TICKET_ID` does not match `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`, the source is
missing or unreadable, `SOURCE_PATH` is not inside any git working tree, the copy cannot be
written, or (see the `--no-clobber` requirement below) a no-clobber collision is detected — it
SHALL print `FAIL <reason>` to stderr and exit non-zero, and SHALL NOT print a `READY` line. The
`TICKET_ID` shape check SHALL run before the main checkout is resolved or any directory is
created, so a rejected `TICKET_ID` produces no filesystem side effect of any kind.

#### Scenario: Artifact is persisted to the main checkout, not the worktree
- **WHEN** `persist-evidence.sh TICKET-1 <path-to-a-file-inside-a-worktree>` is run
- **THEN** a copy of that file exists at
  `<main checkout>/.concertino/runs/TICKET-1/evidence/<path relative to the worktree's
  top-level>`, and the script prints `READY ref=<that absolute path>`

#### Scenario: The returned ref survives the worktree being removed
- **WHEN** `persist-evidence.sh` has persisted an artifact for a ticket, and the worktree it
  was copied from is subsequently deleted (as `cleanup.sh --phase4` does)
- **THEN** the path printed in the earlier `READY ref=` line still exists and is readable

#### Scenario: Missing source artifact fails without emitting a ref
- **WHEN** `persist-evidence.sh` is given a `SOURCE_PATH` that does not exist
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, and prints no `READY` line

#### Scenario: Re-persisting the same artifact is idempotent
- **WHEN** `persist-evidence.sh` is run twice in a row for the same ticket and source path, without
  `--no-clobber`
- **THEN** both runs succeed, resolve to the same destination path, and the destination file
  matches the source's current content after each run

#### Scenario: An invalid TICKET_ID fails before touching the filesystem
- **WHEN** `persist-evidence.sh` is given a `TICKET_ID` that does not match
  `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` (e.g. `../../../../escape`), even with a valid, readable
  `SOURCE_PATH`
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, prints no `READY` line, and
  creates no directory or file anywhere, including outside `.concertino/runs/`

#### Scenario: Two same-named artifacts from different directories persist to distinct destinations
- **WHEN** `persist-evidence.sh` is run for two source paths that share a basename but differ in a
  directory component above it (e.g. `specs/ticket-id-path-safety/spec.md` and
  `specs/evidence-telemetry/spec.md`, both named `spec.md`, within the same worktree)
- **THEN** both calls succeed, each prints a distinct `READY ref=` path, both destination files
  exist, and each resolves to its own source's content — neither overwrites the other

#### Scenario: A source path outside any git working tree fails rather than risking a collision
- **WHEN** `persist-evidence.sh` is given a `SOURCE_PATH` that exists and is readable but is not
  inside any git working tree (so no worktree-relative path can be derived)
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, and prints no `READY` line

### Requirement: verdict.ref is durable; evaluator and skeptic reports do not also emit a redundant evidence event
When the evaluator or skeptic emits its `verdict` event, `ref` SHALL be the path returned by
`persist-evidence.sh --no-clobber` for that report file, not the report's original (worktree
-relative) location. Reports are write-once, so the persist call uses `--no-clobber` (see the
`--no-clobber` requirement below) — a collision at this layer is itself evidence of a bug
elsewhere and SHALL fail loudly rather than silently overwrite a prior sub-run's persisted
evidence copy. If `persist-evidence.sh` fails for that report (for this reason or any other), the
`verdict` event SHALL still be emitted (a verdict is mandatory), but SHALL omit `ref` entirely
rather than falling back to the report's original worktree-relative path. Neither role SHALL emit
a separate `evidence` event for the same report — `verdict` already carries the reference, and a
second event pointing at the identical file adds no information the drill-down does not already
have.

#### Scenario: A verdict's ref survives cleanup
- **WHEN** the evaluator or skeptic emits a `verdict` event and the run's worktree is later
  removed by `cleanup.sh --phase4`
- **THEN** the path in that `verdict` event's `ref` field still exists and is readable

#### Scenario: No duplicate evidence event accompanies a verdict
- **WHEN** the evaluator or skeptic emits a `verdict` event for cycle N
- **THEN** the event log contains no `evidence` event whose `ref` points at that same cycle's
  report file

#### Scenario: A verdict is still emitted, without a ref, when persisting the report fails
- **WHEN** `persist-evidence.sh` fails to persist the evaluator's or skeptic's report for a
  cycle (e.g. the destination is unwritable, or a `--no-clobber` collision is detected)
- **THEN** the role still emits a `verdict` event with a `verdict=<PASS|FAIL|BLOCKER|CONFIRM|
  REFUTE>` field, and that event carries no `ref` field — never the report's raw
  `WORKTREE_PATH`-relative path

## ADDED Requirements

### Requirement: persist-evidence.sh --no-clobber refuses to silently overwrite differing content
When invoked with `--no-clobber` as a third argument, `persist-evidence.sh` SHALL, before copying,
check whether the computed destination path already exists. If it does not exist, the copy SHALL
proceed exactly as without the flag. If it does exist, the script SHALL compare its content to
`SOURCE_PATH`'s content: if identical, the call SHALL succeed as a no-op (printing the same
`READY ref=<path>` as any other success, without re-copying); if different, the script SHALL print
`FAIL <reason>` to stderr, print no `READY` line, exit non-zero, and leave the existing destination
file's content unmodified. Every existing caller, which does not pass `--no-clobber`, SHALL be
unaffected — its destination continues to be unconditionally overwritten on every call, exactly as
documented in the script's pre-existing "Idempotent/re-runnable" behavior.

#### Scenario: --no-clobber allows a genuine retry of the same content
- **WHEN** `persist-evidence.sh TICKET-1 <source> --no-clobber` is run twice in a row with the
  source's content unchanged between calls
- **THEN** both calls succeed and print the same `READY ref=<path>`, and the destination's content
  matches the source after each call

#### Scenario: --no-clobber refuses a collision with differing content
- **GIVEN** a destination file already exists at the path `persist-evidence.sh` would compute for
  a given `SOURCE_PATH`, with content that differs from `SOURCE_PATH`'s current content
- **WHEN** `persist-evidence.sh TICKET-1 <that SOURCE_PATH> --no-clobber` is run
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, prints no `READY` line, and the
  existing destination file's content is unchanged

#### Scenario: Omitting --no-clobber preserves today's unconditional-overwrite behavior
- **WHEN** `persist-evidence.sh TICKET-1 <source>` is run without `--no-clobber`, and a
  destination already exists at the computed path with different content
- **THEN** the call succeeds, prints `READY ref=<path>`, and the destination is overwritten with
  the source's current content — unchanged from this script's behavior before this requirement was
  added
