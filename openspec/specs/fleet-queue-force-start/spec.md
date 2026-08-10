# fleet-queue-force-start Specification

## Purpose
Defines the QUEUED-local focus cursor and the force-start action it enables: letting an operator pick a specific pending ticket and, after an explicit confirmation naming the resulting `maxConcurrent` overage, start it immediately — bypassing `queue.tick()`'s normal admission order without corrupting the queue's own pending/in-flight bookkeeping or its CON-29 restore-confirmation state.
## Requirements
### Requirement: A QUEUED-local focus cursor SHALL let the operator select a specific pending ticket
While focus is on QUEUED (entered via the `fleet-section-jump` capability's digit binding), `j`/`k` SHALL move a QUEUED-local cursor among `queueState.pending`'s entries, clamped to `[0, pending.length - 1]`, and SHALL NOT modify `state.selected` or `state.scrollOffset`. The fleet view SHALL render a marker on the focused queued row, distinct in appearance from the ordinary run-selection `▸` marker used for `state.selected`. Pressing Escape SHALL return focus to the ordinary run selection, leaving `state.selected` unchanged and clearing the QUEUED-local cursor.

#### Scenario: j/k move the QUEUED-local cursor while focused on QUEUED
- **WHEN** focus is on QUEUED and the operator presses `j`
- **THEN** the QUEUED-local cursor advances to the next pending ticket, and `state.selected`/`state.scrollOffset` are unchanged

#### Scenario: The QUEUED-local cursor is visually distinct from the run selection marker
- **WHEN** focus is on QUEUED and a queued row is focused
- **THEN** that row renders with a marker that is not the ordinary `▸` run-selection marker

#### Scenario: Escape exits QUEUED focus without side effects
- **WHEN** focus is on QUEUED and the operator presses Escape
- **THEN** focus returns to the ordinary run selection, `state.selected` is unchanged from before QUEUED was entered, and the QUEUED-local cursor is cleared

### Requirement: Force-start SHALL require an explicit confirmation naming the resulting concurrency overage
While focus is on QUEUED and a pending ticket is focused, pressing the force-start key SHALL show a confirmation warning stating the resulting concurrent-run count against the configured `maxConcurrent` (e.g. "this will run N+1 concurrently, exceeding your maxConcurrent:N setting — proceed?"). The ticket SHALL only be force-started if the very next keypress is the dedicated confirm key (`y`); any other key SHALL cancel the confirmation without starting anything and without altering the queue.

#### Scenario: Force-start shows the overage warning before doing anything
- **WHEN** a pending ticket is focused and the operator presses the force-start key
- **THEN** a confirmation warning appears naming the resulting concurrent count against `maxConcurrent`, and no ticket has started yet

#### Scenario: Confirming force-start starts the ticket
- **WHEN** the force-start confirmation is showing and the operator presses `y`
- **THEN** the focused ticket is submitted to run immediately, regardless of the current in-flight count against `maxConcurrent`

#### Scenario: Any other key cancels the confirmation
- **WHEN** the force-start confirmation is showing and the operator presses any key other than `y`
- **THEN** the confirmation is dismissed, no ticket is started, and the queue is unchanged

### Requirement: A force-started ticket SHALL be admitted with the same queue bookkeeping `tick()` uses, bypassing only the `maxConcurrent` gate
Confirming force-start SHALL remove the target ticket from `queue.pending` and add it to `queue.inFlight` — the identical mutation `queue.tick()`'s own admission loop performs per admitted ticket — without checking `inFlight.size < maxConcurrent`. `tick()`'s subsequent regular passes SHALL NOT re-admit a force-started ticket (it is no longer in `pending`) and SHALL correctly count it against `maxConcurrent` for admitting any other pending ticket (it is already in `inFlight`). The persisted queue file (`.concertino/cache/queue.json`) SHALL reflect the force-started ticket as an ordinary in-flight entry, indistinguishable in shape from a normally-admitted one, so a dashboard restart reconciles it exactly as `fleet-queue-visibility`'s restore requirements already describe for any other in-flight ticket.

#### Scenario: A force-started ticket is not double-admitted by the next tick
- **WHEN** a ticket is force-started and the queue's next regular `tick()` pass runs
- **THEN** that ticket is not among `toLaunch` again, and it is not present in the resulting queue's `pending` list

#### Scenario: A force-started ticket correctly occupies a concurrency slot for subsequent admissions
- **WHEN** a ticket is force-started, putting `inFlight.size` at or above `maxConcurrent`, and the next regular `tick()` pass runs with other tickets still pending
- **THEN** `tick()` admits no further ticket until enough in-flight tickets (including the force-started one) reach a terminal state to free a slot

#### Scenario: A force-started ticket persists as in-flight, not pending
- **WHEN** a ticket is force-started and the queue is next persisted to `.concertino/cache/queue.json`
- **THEN** the ticket's id appears in the persisted record's in-flight list and not in its pending list

#### Scenario: A restart after a force-start reconciles the ticket as an ordinary in-flight entry
- **WHEN** the dashboard restarts after a force-started ticket was persisted as in-flight and is still live
- **THEN** startup restore reconstructs it into the restored queue's `inFlight` set exactly as it would for any other still-live in-flight ticket, with no distinct "manually started" state anywhere in the reconciliation

### Requirement: Force-start on a ticket no longer in the queue SHALL be a no-op
If the QUEUED-local cursor's ticket is no longer present in `queue.pending` by the time force-start is confirmed (e.g. it was admitted by an ordinary `tick()` pass, or dropped, between the confirmation appearing and being confirmed), confirming SHALL NOT start a second run for it, error, or mutate the queue.

#### Scenario: A ticket that left the queue before confirmation is not double-started
- **WHEN** the force-start confirmation is showing for a ticket, and that ticket is admitted by an ordinary `tick()` pass or otherwise leaves `queue.pending` before the operator presses `y`
- **THEN** pressing `y` does not submit a second run for that ticket and does not alter the queue beyond what already happened

### Requirement: `f` applies to the full QUEUED multi-select set, when non-empty, instead of just the QUEUED-local cursor row

When `state.multiSelect.queued` is non-empty, pressing `f` while `focus === 'queue'` SHALL resolve to `{ type: 'open-bulk-force-start-confirm', tickets: [...state.multiSelect.queued] }` instead of the existing single-ticket `open-force-start-confirm`. When `state.multiSelect.queued` is empty, `f` behaves exactly as before this change (resolving against `queueState.pending[queueFocus]` alone).

#### Scenario: `f` with a non-empty QUEUED multi-select set opens the bulk force-start confirm
- **GIVEN** `focus === 'queue'` and `state.multiSelect.queued` contains 2
  tickets
- **WHEN** the operator presses `f`
- **THEN** the resolved action is `{ type: 'open-bulk-force-start-confirm',
  tickets: [...those 2 tickets] }`, not the single-ticket
  `open-force-start-confirm`

#### Scenario: `f` with an empty QUEUED multi-select set behaves exactly as before
- **GIVEN** `focus === 'queue'`, a pending ticket is focused via
  `queueFocus`, and `state.multiSelect.queued` is empty
- **WHEN** the operator presses `f`
- **THEN** the resolved action is the existing single-row
  `{ type: 'open-force-start-confirm', ticket }`

### Requirement: A bulk force-start confirmation names the row count and the resulting concurrency overage

`sections.js`'s `buildHeadTail` SHALL render a confirmation banner for
`state.bulkConfirm = { section: 'queued', kind: 'force-start', tickets }`
stating both `tickets.length` and the resulting concurrent-run count against
`maxConcurrent` (`inFlight.size + tickets.length`), e.g. "force-start 3
queued tickets — this will run N+3 concurrently, exceeding your
maxConcurrent:N setting — proceed?" — extending the existing single-ticket
force-start warning's "name the exact resulting count, never a vague
are-you-sure" discipline to the bulk count. Any key other than `y` cancels
without starting anything and without altering the queue, clearing
`state.multiSelect.queued` per the `fleet-bulk-select` capability.

#### Scenario: The bulk force-start confirm names both the count and the overage
- **GIVEN** `state.bulkConfirm = { section: 'queued', kind: 'force-start',
  tickets: [t1, t2, t3] }` and `queueState.inFlight.size === 1` with
  `maxConcurrent: 2`
- **WHEN** the fleet screen renders
- **THEN** the confirmation banner states 3 tickets and a resulting
  concurrent count of 4 against `maxConcurrent:2`

#### Scenario: Any key but `y` cancels the bulk force-start confirm without starting anything
- **GIVEN** `state.bulkConfirm` (`kind: 'force-start'`) is set
- **WHEN** the operator presses any key other than `y`
- **THEN** no ticket is started and the queue is unchanged

### Requirement: Confirming bulk force-start admits each ticket with the same per-ticket bookkeeping `queue.forceStart` already uses, reporting a per-row result

On `y`, for each ticket in `state.bulkConfirm.tickets`, the dashboard SHALL
call the existing `queue.forceStart` logic exactly as the single-row path
already does (removing it from `pending`, adding it to `inFlight`,
launching it via the ticket's per-ticket spec if one exists), applied one
ticket at a time in list order so each ticket's admission is reflected in
`inFlight`/`maxConcurrent` bookkeeping before the next ticket's admission is
attempted. A ticket no longer present in `pending` by the time it is
processed (already admitted by an ordinary `tick()` pass, or by an earlier
ticket in this same bulk operation, or otherwise no longer queued) SHALL be
a no-op for that ticket specifically, recorded in `state.bulkResult.results`
as `ok: false` with a stale/no-longer-queued reason, without affecting any
other ticket in the batch. Every ticket's outcome SHALL be recorded in
`state.bulkResult.results`, rendered as a per-row result list, mirroring
`fleet-failed-remediation`'s equivalent bulk requirement.

#### Scenario: A fully-successful bulk force-start admits every ticket
- **GIVEN** `state.bulkConfirm = { section: 'queued', kind: 'force-start',
  tickets: [t1, t2, t3] }`, all three still pending
- **WHEN** the operator presses `y`
- **THEN** all three tickets move from `pending` to `inFlight` and are
  launched
- **AND** `state.bulkResult.results` contains an `ok: true` entry for each

#### Scenario: A ticket already force-started or admitted elsewhere mid-batch is reported, not double-started
- **GIVEN** `state.bulkConfirm.tickets` includes a ticket that left
  `pending` (admitted by an ordinary `tick()` pass) between the
  confirmation opening and `y` being pressed
- **WHEN** the bulk force-start runs
- **THEN** that ticket is not started a second time
- **AND** it appears in `state.bulkResult.results` with `ok: false` and a
  stale/no-longer-queued reason
- **AND** every other ticket in the batch is processed normally

