## ADDED Requirements

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
