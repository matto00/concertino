# fleet-quick-start Specification

## Purpose
Defines the fleet view's always-visible QUICK START panel (`lib/ui/screens/fleet.js`) — a priority-sorted shortcut to the top open tickets across all epics, with a one-key add-to-queue action reusing `queue.createQueue`/`queue.tick`, so starting the next most urgent ticket never requires leaving the fleet view for the full launch pad.
## Requirements
### Requirement: QUICK START lists the top priority-ranked open tickets, flattened across all epics
When visible, the `QUICK START` section SHALL list up to 5 open tickets drawn from the on-disk ticket cache, sorted by the same priority rank `launchpad.js`'s `sortByPriority`/`priorityRank` already define (Urgent < High < Medium < Low < None < unknown), flattened across every epic rather than scoped to one. A ticket already showing `▲ running` per `launchpad.js`'s `isSelectable` (a live run exists for it in this fleet) SHALL be excluded. A ticket already present in the active queue's `pending` list or `inFlight` set (`queueState`, if any) SHALL also be excluded, regardless of whether it has a live run yet.

#### Scenario: The list is sorted by priority across epics
- **WHEN** the ticket cache contains open tickets from multiple epics with varying priorities
- **THEN** the QUICK START section lists up to 5 of them in the same Urgent-first order `sortByPriority` produces, without regard to which epic each belongs to

#### Scenario: An already-running ticket is excluded
- **WHEN** a ticket that would otherwise rank in the top 5 already has a live run in this fleet
- **THEN** it does not appear in the QUICK START list, and the next eligible ticket takes its place

#### Scenario: An already-queued ticket is excluded
- **WHEN** a ticket that would otherwise rank in the top 5 is already present in `queueState.pending` or `queueState.inFlight`
- **THEN** it does not appear in the QUICK START list, even though it has no live run yet

### Requirement: An empty or cold QUICK START list still renders an explanatory hint while visible
When `quickStartVisible` is `true`, the `QUICK START` section SHALL always render — never silently disappear — even when zero tickets are eligible. If the ticket cache has never been fetched, the section SHALL show a hint directing the operator to fetch it (e.g. via the launch pad's own refresh). If the cache has tickets but none are eligible (all filtered out by the exclusions above), the section SHALL show a distinct hint saying there is nothing left to quick-start, rather than an empty box or no section at all.

#### Scenario: A cold cache shows a fetch hint, not an empty section
- **WHEN** `quickStartVisible` is `true` and the on-disk ticket cache has never been fetched
- **THEN** the QUICK START section renders with a hint that no tickets are cached yet, rather than omitting the section

#### Scenario: A fully-filtered list shows a distinct "nothing to start" hint
- **WHEN** `quickStartVisible` is `true`, the ticket cache is populated, and every ticket is excluded by the running/already-queued filters
- **THEN** the QUICK START section renders with a hint that there is nothing left to quick-start, distinct from the cold-cache hint

### Requirement: QUICK START rows never perturb the row-index space a run selection resolves to
`QUICK START` rows SHALL NOT consume a slot in the flat, `runs[]`-indexed selection space `state.selected` resolves against, matching the same guarantee `fleet-queue-visibility`'s `QUEUED` section already provides. The section SHALL be built with the same `unselectable` shape `QUEUED` uses, and its own rows SHALL never be marked with the ordinary run-row selection marker.

#### Scenario: Selecting a row below a visible QUICK START section resolves the correct run
- **WHEN** the fleet view renders `RUNNING`, a visible `QUICK START` section, and `FAILED` together, and a row within `FAILED` is selected
- **THEN** the ticket resolved for that selection (via `runs[selected]`) is the same run that row displays, unaffected by how many rows QUICK START rendered above it

#### Scenario: QUICK START rows are never marked as the selected run row
- **WHEN** the fleet view renders with a visible `QUICK START` section and any valid value of `state.selected`
- **THEN** no row within the QUICK START section is ever rendered with the ordinary run-row selection marker

### Requirement: QUICK START has its own focus cursor, entered via digit-jump
`QUICK START` SHALL be reachable via the existing digit-key section-jump (numbered positionally over sections actually rendered this frame, per `fleet-section-jump`), emitting a focus action that sets `focus` to `'quickstart'` without altering `state.selected` or `state.scrollOffset`. While `focus` is `'quickstart'`: `j`/`k` (and their arrow-key aliases) SHALL move a local cursor (`quickStartFocus`) over the section's own rendered rows, clamped to their bounds, and the row currently under `quickStartFocus` SHALL render with a visual marker distinguishing it from the section's other rows (analogous to `QUEUED`'s own focused-row marker); bare Escape SHALL exit quickstart focus back to `'runs'`; `Enter`, `l`/right-arrow, `n`, and `N` SHALL be suppressed (no-ops) while this focus is active, exactly as they already are while `focus === 'queue'`.

#### Scenario: Digit-jump enters QUICK START focus without touching run selection
- **WHEN** the fleet view renders QUICK START among other sections and the operator presses the digit mapped to it
- **THEN** `focus` becomes `'quickstart'` and `state.selected`/`state.scrollOffset` are unchanged

#### Scenario: j/k move the QUICK START cursor while focused
- **WHEN** `focus` is `'quickstart'` and the operator presses `j` or `k`
- **THEN** `quickStartFocus` moves down or up within the rendered QUICK START rows, clamped to the first/last row, and the row now under `quickStartFocus` renders with the focused-row marker

#### Scenario: Escape exits QUICK START focus, section stays visible
- **WHEN** `focus` is `'quickstart'` and the operator presses bare Escape
- **THEN** `focus` returns to `'runs'`, and the `QUICK START` section remains visible exactly as before (it was never conditional on focus)

#### Scenario: Ordinary run-selection keys are suppressed while QUICK START is focused
- **WHEN** `focus` is `'quickstart'` and the operator presses Enter, `l`, `n`, or `N`
- **THEN** none of these keys perform their ordinary fleet-view action

### Requirement: `a` adds the highlighted QUICK START ticket to the queue, reusing existing queue primitives
While `focus` is `'quickstart'`, pressing `a` SHALL add the ticket currently under `quickStartFocus` to the queue, using only `queue.createQueue`/`queue.tick`'s existing data shape — never a second, independent queuing mechanism. If no queue is currently active (`queueState` is absent), a new queue SHALL be created for that one ticket with `maxConcurrent: 1`, using the same default launch command the plain single-ticket (`n`) launch path already uses. If a queue is already active, the ticket SHALL be appended to its existing `pending` list, preserving that queue's own `maxConcurrent` and `launchCommand` rather than starting a competing queue. A ticket already present in that queue's `pending` or `inFlight` SHALL NOT be added a second time.

#### Scenario: Adding a ticket with no active queue creates a new single-ticket queue
- **WHEN** `focus` is `'quickstart'`, no queue is currently active, and the operator presses `a` on the highlighted ticket
- **THEN** a new queue is created containing only that ticket, with `maxConcurrent: 1` and the default launch command, and it becomes visible as usual once non-empty (per `fleet-queue-visibility`)

#### Scenario: Adding a ticket with an active queue appends to it
- **WHEN** `focus` is `'quickstart'`, a queue is already active with its own `maxConcurrent`/`launchCommand`, and the operator presses `a` on a highlighted ticket not already in that queue
- **THEN** the ticket is appended to the active queue's `pending` list, and the queue's own `maxConcurrent`/`launchCommand` are unchanged

#### Scenario: Adding an already-queued ticket is a no-op
- **WHEN** `focus` is `'quickstart'` and the operator presses `a` on a ticket already present in the active queue's `pending` or `inFlight`
- **THEN** the queue is unchanged — the ticket is not duplicated into `pending`

### Requirement: QUICK START is always visible, unconditionally
The fleet view (`lib/ui/screens/fleet.js`) SHALL render a `QUICK START` section on every render, with no visibility flag gating it — the same way the `METRICS` section is unconditional. There SHALL be no key binding that hides or shows the section.

#### Scenario: QUICK START renders on the first frame with no user action
- **WHEN** the fleet view is rendered for the first time after the dashboard starts
- **THEN** a `QUICK START` section is present, with no keypress required to reveal it

#### Scenario: QUICK START remains visible across every subsequent render
- **WHEN** the fleet view re-renders on any later poll, regardless of what other sections are present or what focus is active
- **THEN** the `QUICK START` section is still present

