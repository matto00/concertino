## MODIFIED Requirements

### Requirement: persist-evidence.sh copies an artifact into the main checkout and returns a durable ref
`core/scripts/persist-evidence.sh <TICKET_ID> <SOURCE_PATH> [--no-clobber]` SHALL copy
`SOURCE_PATH` into `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/`, preserving
`SOURCE_PATH`'s path relative to the top-level of the git working tree that contains it (creating
whatever intermediate directories that relative path implies, as needed), resolving the main
checkout the same way `emit-event.sh` does, regardless of whether the script is invoked from
within a worktree. The copy SHALL preserve `SOURCE_PATH`'s modification time (mtime) — the
destination file's mtime SHALL equal the source's mtime at the moment of copy, not the time of
the copy operation itself. On success it SHALL print `READY ref=<absolute destination path>` to
stdout and exit 0. On failure — `TICKET_ID` does not match `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`, the
source is missing or unreadable, `SOURCE_PATH` is not inside any git working tree, the copy
cannot be written, or (see the `--no-clobber` requirement below) a no-clobber collision is
detected — it SHALL print `FAIL <reason>` to stderr and exit non-zero, and SHALL NOT print a
`READY` line. The `TICKET_ID` shape check SHALL run before the main checkout is resolved or any
directory is created, so a rejected `TICKET_ID` produces no filesystem side effect of any kind.

#### Scenario: Artifact is persisted to the main checkout, not the worktree
- **WHEN** `persist-evidence.sh TICKET-1 <path-to-a-file-inside-a-worktree>` is run
- **THEN** a copy of that file exists at
  `<main checkout>/.concertino/runs/TICKET-1/evidence/<path relative to the worktree's
  top-level>`, and the script prints `READY ref=<that absolute path>`

#### Scenario: The returned ref survives the worktree being removed
- **WHEN** `persist-evidence.sh` has persisted an artifact for a ticket, and the worktree it
  was copied from is subsequently deleted (as `cleanup.sh --phase4` does)
- **THEN** the path printed in the earlier `READY ref=` line still exists and is readable

#### Scenario: The persisted copy's mtime matches the source, not the copy time
- **GIVEN** a source file whose mtime has been deliberately set to a timestamp well in the past
  (e.g. via `touch -d`)
- **WHEN** `persist-evidence.sh TICKET-1 <that source>` is run
- **THEN** the destination file's mtime equals the source's mtime at the moment of the call, and
  differs from the wall-clock time the copy actually ran

#### Scenario: Missing source artifact fails without emitting a ref
- **WHEN** `persist-evidence.sh` is given a `SOURCE_PATH` that does not exist
- **THEN** it prints `FAIL <reason>` to stderr, exits non-zero, and prints no `READY` line

#### Scenario: Re-persisting the same artifact is idempotent
- **WHEN** `persist-evidence.sh` is run twice in a row for the same ticket and source path, without
  `--no-clobber`
- **THEN** both runs succeed, resolve to the same destination path, and the destination file
  matches the source's current content and mtime after each run

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

## ADDED Requirements

### Requirement: Evaluator and skeptic persist raw screenshot/measurement evidence, not only their final report
When the evaluator or skeptic captures raw artifact-level evidence during a review — a Playwright
before/after screenshot, a byte-size or content-hash measurement dump — that is offered in the
report as load-bearing for a claim, the role SHALL persist that raw artifact via
`persist-evidence.sh` at the point it is captured (not deferred to end-of-review), using the same
`TICKET_ID` as the role's own report persist call. The report SHALL reference the persisted
(main-checkout) path for such artifacts rather than their original worktree-relative path,
exactly as it already does for its own report via `verdict.ref`. This closes the gap that
previously required a manual post-hoc "rescue move" of such evidence out of the worktree before
`cleanup.sh --phase4` destroyed it.

#### Scenario: A before/after screenshot pair is persisted before the worktree is removed
- **WHEN** the evaluator or skeptic captures a before/after screenshot pair during review and
  cites it in the report as evidence
- **THEN** both screenshots are persisted via `persist-evidence.sh` before the run reaches Phase
  4, and the report cites their persisted (main-checkout) paths

#### Scenario: No manual rescue move is needed for cited screenshot evidence
- **WHEN** a run completes and its worktree is removed by `cleanup.sh --phase4`
- **THEN** every screenshot/measurement artifact the evaluator's or skeptic's report cited as
  evidence remains readable at its persisted path, with no separate rescue step having been
  performed by the orchestrator or a human

### Requirement: Role docs state that temporal and positional evidence is fragile across relocation
The evaluator and skeptic role docs SHALL state explicitly that a claim resting on file mtime
ordering or on directory placement (e.g. "the BEFORE screenshot is older than the AFTER") does not
survive being copied or moved, and that self-authenticating evidence (content diffs, byte-size
deltas, checksums, cited line numbers) SHALL be preferred wherever the underlying claim allows it.

#### Scenario: A report discloses reliance on temporal evidence
- **WHEN** a report's argument depends on the relative mtimes of two or more files
- **THEN** the report states that dependency explicitly, rather than presenting mtime ordering as
  self-evidently reliable

### Requirement: A gate that accepts disclosed-unsound mtime evidence at face value is a recorded gate defect
If a report explicitly discloses that its evidence directory's mtimes are unsound (e.g. a prior
relocation rewrote them), and the evaluator or skeptic gate nonetheless accepts an mtime-ordering
claim from that same evidence at face value without independent corroboration, that acceptance
SHALL be recorded as a gate defect — regardless of what verdict (PASS/FAIL/CONFIRM/REFUTE) the
gate reaches.

#### Scenario: A gate defect is recorded for accepting known-unsound mtime evidence
- **WHEN** a report discloses that its evidence directory's mtimes are unsound, and a
  reviewing gate's verdict nonetheless treats an mtime-ordering claim drawn from that same
  directory as reliable, without independent corroboration
- **THEN** that acceptance is recorded as a gate defect, independent of the gate's PASS/FAIL/
  CONFIRM/REFUTE outcome
