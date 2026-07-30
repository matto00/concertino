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

