## ADDED Requirements

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
