# launchpad-queue-status Specification

## Purpose
Defines the launch pad's per-ticket IN QUEUE status display and its single-ticket "add to queue" action (`lib/ui/screens/launchpad.js`), so a ticket already pending or in flight in the fleet-wide queue is visibly distinct from an untouched ticket, and can be queued directly from the tickets pane without the full multi-select launch-plan flow.
## Requirements
### Requirement: The launch pad shows a distinct queued status for a ticket already in the queue
`inlineStatus()` (`lib/ui/screens/launchpad.js`) SHALL accept the active `queueState` and, for a ticket present in `queueState.pending` or `queueState.inFlight` that has no live run in `runs`, SHALL return a status distinct from every other status the function can return (`⏳ queued`), rendered in a colour distinct from `▲ running`'s. A ticket that both has a live run in `runs` and is present in `queueState.inFlight` SHALL still render as `▲ running` — a live run always takes precedence over queue membership.

#### Scenario: A pending ticket shows a queued status
- **WHEN** the tickets pane renders a ticket whose identifier is present in `queueState.pending`, and no live run for it exists in `runs`
- **THEN** its status column reads `⏳ queued`, rendered in a colour distinct from `▲ running`'s

#### Scenario: An in-flight ticket with no live run entry yet still shows queued
- **WHEN** the tickets pane renders a ticket whose identifier is present in `queueState.inFlight`, and no matching entry exists yet in `runs`
- **THEN** its status column reads `⏳ queued`, not its plain Linear status

#### Scenario: A running ticket takes precedence over queue membership
- **WHEN** the tickets pane renders a ticket that has a live (non-`done`/`failed`) run in `runs` and is also present in `queueState.inFlight`
- **THEN** its status column reads `▲ running`, not `⏳ queued`

#### Scenario: A ticket absent from the queue is unaffected
- **WHEN** the tickets pane renders a ticket whose identifier is present in neither `queueState.pending` nor `queueState.inFlight`
- **THEN** its status column is computed exactly as it was before this change (live-run check, then Linear state)

### Requirement: An already-queued ticket cannot be selected into a new batch
`isSelectable()` SHALL refuse a ticket already present in `queueState.pending` or `queueState.inFlight`, exactly as it already refuses an already-`▲ running` ticket. `selectableIdentifiers()` and every caller that gates admission into `lp.selected` or into a new `queue.createQueue()` call — `toggle-select`, `select-all`, `open-launchplan`'s re-check, and `confirm-launch`'s own "third and final refusal" re-check immediately before `queue.createQueue()` fires — SHALL honor this refusal by threading `queueState` through to `isSelectable`.

#### Scenario: A queued ticket cannot be toggled into selection
- **WHEN** the operator presses `space` on a ticket already present in `queueState.pending` or `queueState.inFlight`
- **THEN** the ticket is not added to `lp.selected`

#### Scenario: Select-all skips already-queued tickets
- **WHEN** the operator presses `a` (select-all) while the current epic's tickets include one already present in `queueState.pending`
- **THEN** that ticket is excluded from the tickets added to `lp.selected`, exactly as an already-`▲ running` ticket would be

#### Scenario: An already-selected ticket that becomes queued in the interim is dropped at confirm time
- **WHEN** a ticket was selected earlier, is subsequently added to the active queue by some other action, and the operator then presses `L` to open the launch plan
- **THEN** that ticket is excluded from the launch plan's ticket list, the same re-check `▲ running` already receives

#### Scenario: A ticket that becomes queued between opening and confirming the launch plan is not duplicated
- **WHEN** a ticket is included on the launch plan screen (having passed `open-launchplan`'s own re-check), is subsequently added to the active queue by some other action (e.g. another operator action, or the new `q` add-to-queue key on the launch pad) before the operator presses Enter to confirm, and the operator then confirms
- **THEN** `confirm-launch`'s own re-check excludes that ticket from the tickets handed to `queue.createQueue()`, so it is not queued a second time

#### Scenario: Deselecting an already-queued ticket is still allowed
- **WHEN** the operator presses `space` on a ticket that is both already selected (from before it became queued) and now present in `queueState.pending`
- **THEN** the ticket is removed from `lp.selected` (deselection is never refused, only new selection)

### Requirement: A dedicated key adds only the highlighted ticket to the queue
The tickets pane SHALL bind a dedicated key (`q`) that adds only the currently-highlighted ticket (`currentTicket(lp)`) to the queue, without requiring the multi-select -> launch plan -> confirm flow. The action SHALL route through the existing `queue.createQueue`/`queue.enqueueOne` primitives exactly as the fleet view's QUICK START `a` action and `watch.js`'s `quickstart-add` case already do — no second, independent queuing mechanism SHALL be introduced. Pressing `q` on a ticket that is not currently selectable (already running or already queued, per the requirement above) SHALL be a no-op.

#### Scenario: Adding a ticket with no active queue creates a new single-ticket queue
- **WHEN** the operator highlights an eligible ticket in the tickets pane, no queue is currently active, and presses `q`
- **THEN** a new queue is created containing only that ticket, with `maxConcurrent: 1` and the default launch command, using `queue.createQueue`

#### Scenario: Adding a ticket with an active queue appends to it
- **WHEN** the operator highlights an eligible ticket not already in the active queue and presses `q`, and a queue is already active
- **THEN** the ticket is appended to the active queue's `pending` list via `queue.enqueueOne`, preserving the queue's own `maxConcurrent`/`launchCommand`

#### Scenario: Pressing q on an ineligible ticket is a no-op
- **WHEN** the operator presses `q` while the highlighted ticket is already `▲ running` or already `⏳ queued`
- **THEN** the queue is unchanged

### Requirement: The hints line advertises the add-to-queue key only when it would do something
The tickets-pane hints line SHALL include a `q add to queue` hint only when the currently-highlighted ticket is eligible (selectable per the requirement above), matching the existing "only hint a key that currently does something" discipline already applied to `L` (only shown when `lp.selected.size > 0`) and the clear-queue hint.

#### Scenario: Hint shown for an eligible highlighted ticket
- **WHEN** the tickets pane's currently-highlighted ticket is eligible to be queued
- **THEN** the hints line includes `q add to queue`

#### Scenario: Hint omitted for an ineligible highlighted ticket
- **WHEN** the tickets pane's currently-highlighted ticket is already `▲ running` or already `⏳ queued`
- **THEN** the hints line does not include the `q add to queue` hint

