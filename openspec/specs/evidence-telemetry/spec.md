# evidence-telemetry Specification

## Purpose
Give every planning artifact, evaluation report, and skeptic report a durable
`ref` that the dashboard can still resolve after `cleanup.sh --phase4`
destroys the run's worktree, by copying each artifact into the main
checkout via `persist-evidence.sh` before it is referenced from an `evidence`
or `verdict` event.
## Requirements
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

### Requirement: The orchestrator emits one evidence event per planning artifact
The orchestrator SHALL, at the point it writes `workflow-state.md` transitioning out of
Planning, persist each planning artifact created that phase (`ticket.md`, `proposal.md`,
`design.md`, `tasks.md`, and any spec delta files) via `persist-evidence.sh`, and for each one
whose `persist-evidence.sh` call succeeds, emit `scripts/concertino/emit-event.sh evidence
ticket=<TICKET_ID> role=orchestrator ref=<persisted path> label=<artifact name>`.

#### Scenario: A successful planning phase emits evidence for its artifacts
- **WHEN** the orchestrator completes Phase 1 having written `ticket.md`, `proposal.md`,
  `design.md`, and `tasks.md`
- **THEN** the run's event log contains an `evidence` event for each of the four artifacts, each
  with a `ref` that resolves from the main checkout

#### Scenario: A failed persist does not produce a broken evidence event
- **WHEN** `persist-evidence.sh` fails for one planning artifact (e.g. it was never written
  because Planning escalated first)
- **THEN** no `evidence` event is emitted for that artifact, and the orchestrator's other
  telemetry calls are unaffected

### Requirement: verdict.ref is durable; evaluator and skeptic reports do not also emit a redundant evidence event
When the evaluator or skeptic emits its `verdict` event, `ref` SHALL be the path returned by
`persist-evidence.sh` for that cycle's report file, not the report's original (worktree-relative)
location. If `persist-evidence.sh` fails for that report, the `verdict` event SHALL still be
emitted (a verdict is mandatory), but SHALL omit `ref` entirely rather than falling back to the
report's original worktree-relative path. Neither role SHALL emit a separate `evidence` event for
the same report — `verdict` already carries the reference, and a second event pointing at the
identical file adds no information the drill-down does not already have.

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
  cycle (e.g. the destination is unwritable)
- **THEN** the role still emits a `verdict` event with a `verdict=<PASS|FAIL|BLOCKER|CONFIRM|
  REFUTE>` field, and that event carries no `ref` field — never the report's raw
  `WORKTREE_PATH`-relative path

### Requirement: The drill-down's EVIDENCE panel and its "no evidence recorded" fallback are unchanged
Emitting `evidence` events SHALL NOT require any change to `lib/ui/reducer.js` or
`lib/ui/screens/drilldown.js` — a run with no `evidence` events SHALL continue to render "no
evidence recorded", and a run with one or more SHALL continue to list them, exactly as already
implemented.

#### Scenario: A run with planning-artifact evidence lists them in the drill-down
- **WHEN** a run's event log contains `evidence` events emitted by the orchestrator
- **THEN** the drill-down's EVIDENCE panel lists each one and does not show "no evidence
  recorded"

#### Scenario: A run with no evidence events still degrades honestly
- **WHEN** a run's event log contains no `evidence` events
- **THEN** the drill-down's EVIDENCE panel shows "no evidence recorded"

