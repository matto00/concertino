# ticket-id-path-safety Specification

## Purpose
Guard every procedure script that builds a filesystem path from a ticket id against path
traversal, by validating the id against the shared `looks_like_ticket` pattern before the path is
used, and degrading the way each script's existing failure contract already does — silently for
telemetry, `FAIL`/non-zero for evidence persistence — never by writing somewhere unintended.
## Requirements
### Requirement: emit-event.sh validates TICKET before building a path from it
`core/scripts/emit-event.sh` SHALL check `TICKET` against `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` (the
same pattern already carried by `assert-phase.sh`, `start-servers.sh`, and `cleanup.sh`) before
computing `RUN_DIR` or performing any filesystem operation. If `TICKET` does not match, the script
SHALL create no directory, write no line, and exit 0 — the same silent-drop degradation already
used when `TICKET` is empty. This check applies identically on the `--await` (escalation) path.

#### Scenario: A traversal-shaped ticket id writes nothing
- **WHEN** `emit-event.sh` is invoked with `ticket=../../../../escape` and any event kind
- **THEN** no file or directory is created outside `.concertino/runs/`, no line is appended
  anywhere, and the script exits 0

#### Scenario: A well-formed ticket id is unaffected
- **WHEN** `emit-event.sh` is invoked with a ticket id matching
  `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` (e.g. `CON-14`)
- **THEN** the event is appended to `.concertino/runs/CON-14/events.jsonl` exactly as before this
  change

#### Scenario: An invalid ticket id degrades the same way an empty ticket already does
- **WHEN** `emit-event.sh` is invoked with a `ticket` value that fails the shape check (e.g.
  `../escape`, or one containing a shell metacharacter)
- **THEN** the script's behavior is indistinguishable from the existing empty-`ticket` early
  return: exit 0, nothing written

### Requirement: persist-evidence.sh validates TICKET_ID before building a path from it
`core/scripts/persist-evidence.sh` SHALL check `TICKET_ID` against
`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` immediately after argument parsing, before resolving the main
checkout or touching the filesystem. If `TICKET_ID` does not match, the script SHALL print
`FAIL <reason>` to stderr, print no `READY` line, create no directory, copy nothing, and exit
non-zero — the same failure shape already used for a missing/unreadable source or an unwritable
destination.

#### Scenario: A traversal-shaped ticket id copies nothing outside the runs directory
- **WHEN** `persist-evidence.sh` is invoked with `TICKET_ID=../../../../escape` and a valid,
  readable `SOURCE_PATH`
- **THEN** no file is created outside `.concertino/runs/`, the script prints `FAIL <reason>` to
  stderr, prints no `READY` line, and exits non-zero

#### Scenario: A well-formed ticket id is unaffected
- **WHEN** `persist-evidence.sh` is invoked with a ticket id matching
  `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` and a valid, readable `SOURCE_PATH`
- **THEN** the artifact is persisted under `.concertino/runs/<TICKET_ID>/evidence/` and the
  script prints `READY ref=<path>` exactly as before this change

### Requirement: The pattern stays byte-identical across every shell copy
`test/scripts/ticket-pattern.test.sh` SHALL extract and byte-compare the `looks_like_ticket`
bracket expression from every shell script that carries a copy of it, including
`emit-event.sh` and `persist-evidence.sh` in addition to the three scripts it already checked.

#### Scenario: All five shell copies agree
- **WHEN** `test/scripts/ticket-pattern.test.sh` is run
- **THEN** it reports the pattern extracted from `emit-event.sh` and `persist-evidence.sh` as
  byte-identical to the pattern already extracted from `assert-phase.sh`, `start-servers.sh`, and
  `cleanup.sh`

### Requirement: emit-event.sh canonicalises ticket case before building a path from it

`core/scripts/emit-event.sh` SHALL canonicalise a `TICKET` value's letters to uppercase,
immediately after it passes the shared `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` shape check, before the
value is used to compute `RUN_DIR` or written into any event's `ticket` field. This canonicalisation
SHALL be unconditional — applied on every call, not only when a differently-cased run directory is
already found to exist — so that a lowercase or mixed-case ticket id can never address a different
run directory than its uppercase form would.

#### Scenario: A lowercase ticket id is canonicalised to uppercase

- **WHEN** `emit-event.sh` is invoked with `ticket=con-79` and any event kind
- **THEN** the event is appended to `.concertino/runs/CON-79/events.jsonl`, and the event's own
  `ticket` field is `"CON-79"`

#### Scenario: A mixed-case ticket id is canonicalised to uppercase

- **WHEN** `emit-event.sh` is invoked with `ticket=Con-79`
- **THEN** the event is appended to `.concertino/runs/CON-79/events.jsonl`

#### Scenario: An already-uppercase ticket id is unaffected

- **WHEN** `emit-event.sh` is invoked with `ticket=CON-79`, as before this change
- **THEN** the event is appended to `.concertino/runs/CON-79/events.jsonl` exactly as before this
  change

#### Scenario: Two invocations differing only by ticket case converge on one run directory

- **WHEN** `emit-event.sh` is invoked once with `ticket=CON-79` and once with `ticket=con-79`
  (e.g. because one call site was told the canonical id explicitly and another inferred it from a
  lowercase-suffixed worktree basename)
- **THEN** both events are appended to the same `.concertino/runs/CON-79/events.jsonl`, and no
  `.concertino/runs/con-79/` directory is created

#### Scenario: Case canonicalisation never changes which values are accepted

- **WHEN** `emit-event.sh` is invoked with a `ticket` value that fails the existing shape check
  (e.g. `../escape`)
- **THEN** the existing degradation (silent drop, or a loud warning for `run.end`) applies exactly
  as it did before this change — canonicalisation happens only to values that already passed the
  shape check, and never widens what is accepted

