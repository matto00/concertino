# fleet-queue-visibility Specification

## Purpose
Defines how the dashboard's fleet view (`lib/ui/screens/fleet.js`) renders the launch pad's in-memory queue as a visible, trimmable QUEUED section, and guarantees that doing so never perturbs the row-index contract `watch.js` uses to resolve a selected row to a run.
## Requirements
### Requirement: A non-empty queue renders a QUEUED section on the fleet view
The fleet view (`lib/ui/screens/fleet.js`) SHALL render a `QUEUED` section
whenever `queueState.pending` is non-empty, positioned after `RUNNING` and
before `FAILED`. The section title SHALL include the count of pending
tickets and the queue's concurrency cap (e.g.
`QUEUED (3, running 1 at a time)`). The section SHALL NOT render when
`queueState` is absent or `queueState.pending` is empty.

#### Scenario: A queued batch renders its own section
- **WHEN** the fleet view renders with `queueState.pending` containing one
  or more ticket ids
- **THEN** the output includes a `QUEUED` section positioned after `RUNNING`
  and before `FAILED`, titled with the pending count and
  `queueState.maxConcurrent`

#### Scenario: No queue, no section
- **WHEN** `queueState` is `null`, or `queueState.pending` is empty
- **THEN** no `QUEUED` section is rendered, and the rest of the fleet view is
  unaffected

### Requirement: A queued row shows only data that actually exists
Each queued row SHALL render as exactly one line: its 1-based position in
the queue, the ticket id, and the ticket's title if present in the on-disk
ticket cache. A queued row SHALL NOT show a status, phase, elapsed time, or
progress bar, since none of that data exists for a ticket that has not
started.

#### Scenario: A queued row with a cached title
- **WHEN** a pending ticket's id is present in the ticket-title lookup
  passed to the fleet screen
- **THEN** its queued row shows the queue position, the ticket id, and the
  title, on a single line

#### Scenario: A queued row with no cached title
- **WHEN** a pending ticket's id has no entry in the ticket-title lookup
- **THEN** its queued row shows the queue position and the ticket id only,
  with no fabricated title, status, or progress indicator

### Requirement: QUEUED respects the existing height-budget and cap machinery
The `QUEUED` section SHALL participate in the same trimming machinery as
`RUNNING`/`FAILED`/`DONE` — the section's shown-row count SHALL be reduced
under the same terminal-height budget as the other capped sections, and a
trimmed `QUEUED` section SHALL show a `… and N more queued` line identical
in form to the existing capped sections' overflow line. `QUEUED` SHALL NOT
be `pinned`; `NEEDS YOU` SHALL remain the only pinned section.

#### Scenario: A long queue is trimmed like FAILED/DONE
- **WHEN** the terminal height budget forces the fleet view to trim
  sections and `QUEUED` has more pending tickets than its capped display
  count
- **THEN** `QUEUED` is trimmed to its cap and shows a
  `… and N more queued` line, exactly as `FAILED`/`DONE` do today

#### Scenario: NEEDS YOU remains the only pinned section
- **WHEN** the trimming loop reduces section row counts under a height
  budget
- **THEN** `NEEDS YOU` is never trimmed, and `QUEUED` is trimmed like any
  other non-pinned section

### Requirement: Inserting QUEUED never perturbs the row-index a selection resolves to
Queued rows SHALL NOT consume a slot in the row-index space used to resolve
`state.selected` to a run. The row index that advances once per
run-corresponding row (rendered or hidden-under-cap) SHALL skip advancement
entirely for the `QUEUED` section, so that any row rendered in `FAILED` or
`DONE` below a non-empty `QUEUED` section resolves to the exact same run it
would have resolved to had `QUEUED` not been rendered at all.

#### Scenario: Selecting a row below a non-empty QUEUED section resolves the correct run
- **WHEN** the fleet view renders `RUNNING`, a non-empty `QUEUED` section,
  and `FAILED` sections together, and a row within `FAILED` is selected
- **THEN** the ticket resolved for that selection (via `runs[selected]`) is
  the same run that row displays, unaffected by how many rows `QUEUED`
  rendered above it

#### Scenario: Queued rows are never marked as the selected row
- **WHEN** the fleet view renders with a non-empty `QUEUED` section and any
  value of `state.selected` valid for the current `runs` array
- **THEN** no row within the `QUEUED` section is ever rendered with the
  selection marker

