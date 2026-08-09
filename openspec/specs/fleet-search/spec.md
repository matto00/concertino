# fleet-search Specification

## Purpose
Defines the fleet view's `/` search prompt: typing filters/highlights matching rows across every section already rendered this frame, `↵` jumps to the first match in render order, and `esc` cancels with no state change — a row-level complement to the existing `1`-`9` section-jump.
## Requirements
### Requirement: `/` opens a fleet-wide search prompt
The fleet view (`lib/ui/screens/fleet.js`) SHALL bind `/` to open a search
prompt, reachable regardless of the current `focus` value (`'runs'`,
`'queue'`, or `'quickstart'`), except while any confirmation gate
(`quitConfirm`, `forceStartConfirm`, `clearQueueConfirm`, `markDoneConfirm`)
or the `n` new-run prompt is already open — in either of those cases `/`
SHALL NOT open search (mirroring how the existing gates already intercept
every other key ahead of it). Opening search SHALL NOT itself change
`selected`, `scrollOffset`, or `focus`.

#### Scenario: `/` opens the search prompt
- **WHEN** the fleet view is on screen with no confirmation gate or `n`
  prompt open and the operator presses `/`
- **THEN** a search input line is rendered (the shared text-input widget),
  and `selected`/`scrollOffset`/`focus` are unchanged from immediately
  before the keypress

#### Scenario: `/` does nothing while the `n` prompt is open
- **WHEN** the `n` new-run prompt is currently open
- **THEN** pressing `/` types the character `/` into the prompt's value,
  exactly as any other printable key would, and no search prompt opens

### Requirement: Typing filters/highlights matching rows live, scoped to what is already rendered
While the search prompt is open, every keystroke SHALL update the search
query and SHALL be reflected immediately (no additional confirmation step)
in which rows are highlighted. A row is a **match** when the typed query is
a case-insensitive substring of that row's ticket id, or of its title
(a run row's `changeName`, a QUEUED row's looked-up ticket title, or a QUICK
START row's ticket title). An empty query SHALL match nothing.

Matching SHALL be scoped to exactly the rows the fleet view's own
section-building already assembles this frame from `runs[]`, `queueState`,
and the QUICK START eligible-ticket list — the identical universe the
existing `1`-`9` digit-jump (`fleet-section-jump`'s `sectionJumpTargets`)
already walks (each included section's full group: NEEDS YOU/FAILED/
RUNNING/DONE's bucketed run objects, QUEUED's pending ticket ids, QUICK
START's eligible ticket objects). Matching SHALL NOT originate any new
query against the run store, the ticket cache, or any other data source not
already passed into this frame's render — it never reaches further than a
section's own current bucket, regardless of `MAX_FINISHED` capping or
current scroll position within that section.

A matching row SHALL render with its ticket-id/title token visually
highlighted; every other row (matching or not, search open or not) SHALL
render exactly as it would with no search active — no row is removed from
its section, and no section's rendered row count or height budget changes
because of an active search query.

#### Scenario: Typing highlights a matching run row
- **WHEN** the search prompt is open and RUNNING contains a run with ticket
  id `CON-42` and the operator types `42`
- **THEN** that row's ticket-id token renders highlighted, and every other
  row (including other RUNNING rows) renders unchanged

#### Scenario: Query matches a title, not just an id
- **WHEN** a DONE row's `changeName` contains the substring the operator has
  typed, but its ticket id does not
- **THEN** that row is still highlighted as a match

#### Scenario: Query matching only a capped/off-window row still highlights it
- **WHEN** a FAILED section has more entries than `MAX_FINISHED` and the
  matching row is beyond what the current scroll position currently paints
  on screen, but the row is still part of the FAILED bucket this frame
  assembled
- **THEN** the row is still considered a match (available to `↵`, per the
  requirement below) even though it is not the literal pixels on screen at
  the moment of the keystroke

#### Scenario: Query does not reach beyond this frame's assembled rows
- **WHEN** a run exists in `.concertino/runs/` history but is not part of
  `runs[]`/any section this frame's render already assembled (e.g. it was
  never loaded into the current fleet snapshot)
- **THEN** no query, however typed, can match or highlight it — searching
  never triggers a new store/cache read

#### Scenario: An empty query highlights nothing
- **WHEN** the search prompt is open with no characters typed
- **THEN** no row is highlighted

### Requirement: `↵` jumps to the first match in render order
Submitting the search query (`↵`) SHALL jump the selection to the first
matching row, walked in the fleet view's own section render order (NEEDS
YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE — `buildSections`' existing
order) and, within a section, that section's own group order. The jump
SHALL use the same action each section kind's own existing jump mechanism
already uses: a NEEDS YOU/FAILED/RUNNING/DONE match sets `selected` to that
row's index (scrolled into view, identical to digit-jump's own
scroll-into-view treatment) and returns `focus` to `'runs'`; a QUEUED match
sets the QUEUED-local focus cursor to that row without touching `selected`/
`scrollOffset`; a QUICK START match sets the QUICK-START-local focus cursor
the same way. After a successful jump, the search prompt SHALL close.

If no row matches the current query, `↵` SHALL be a no-op: the search
prompt SHALL remain open with its current value unchanged, so the query can
be corrected.

#### Scenario: Enter jumps to the first matching run
- **WHEN** the query matches one row in FAILED and one row in DONE (FAILED
  rendering before DONE this frame) and the operator presses `↵`
- **THEN** `selected` moves to the FAILED row (scrolled into view if
  necessary), `focus` is `'runs'`, and the search prompt closes

#### Scenario: Enter jumps into QUEUED without disturbing the run selection
- **WHEN** the first match in render order is a QUEUED row
- **THEN** `focus` becomes `'queue'` with the QUEUED-local cursor set to
  that row's position, `selected`/`scrollOffset` are unchanged, and the
  search prompt closes

#### Scenario: Enter with no match leaves the prompt open
- **WHEN** the typed query matches no row currently assembled this frame
  and the operator presses `↵`
- **THEN** nothing is selected/focused differently than before the
  keypress, and the search prompt remains open with the same value

### Requirement: `esc` cancels with no state change
Pressing `esc` while the search prompt is open SHALL close it and SHALL
leave `selected`, `scrollOffset`, and `focus` exactly as they were
immediately before the search prompt was opened (typing into the query, by
itself, never mutates any of the three — only a successful `↵` jump does).

#### Scenario: Escape cancels a typed-but-not-submitted query
- **WHEN** the search prompt is open with a non-empty, unsubmitted query and
  the operator presses `esc`
- **THEN** the search prompt closes and `selected`/`scrollOffset`/`focus`
  are identical to their values from immediately before `/` was first
  pressed

