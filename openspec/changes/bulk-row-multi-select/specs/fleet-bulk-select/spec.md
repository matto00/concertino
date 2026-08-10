## ADDED Requirements

### Requirement: `space` toggles the cursor row's ticket in its section's multi-select set

`lib/ui/screens/fleet/keys.js`'s `handleKey` SHALL bind `space` (`key ===
' '`) in the same two locations `a`/`d`/`f` are already bound: at the
top-level FAILED-row site (`focus === 'runs'` AND `runs[selected]` present
AND `runs[selected].status === 'failed'`), resolving to `{
type: 'toggle-multi-select', section: 'failed', ticket:
runs[selected].ticket }`; and inside the `focus === 'queue'` block,
resolving to `{ type: 'toggle-multi-select', section: 'queued', ticket }`
where `ticket = queueState.pending[queueFocus]` (mirroring `f`'s own
resolution, no-op if unresolved). `space` SHALL be a no-op everywhere
neither condition holds. Toggling adds the ticket to
`state.multiSelect[section]` if absent, or removes it if present.

#### Scenario: `space` on a FAILED selected row toggles it into the FAILED multi-select set
- **GIVEN** `focus === 'runs'`, `runs[selected].status === 'failed'`, and the
  ticket is not currently in `state.multiSelect.failed`
- **WHEN** the operator presses `space`
- **THEN** the ticket is added to `state.multiSelect.failed`

#### Scenario: `space` again removes the ticket from the FAILED multi-select set
- **GIVEN** the ticket from the scenario above is now in
  `state.multiSelect.failed`
- **WHEN** the operator presses `space` again on the same row
- **THEN** the ticket is removed from `state.multiSelect.failed`

#### Scenario: `space` on a focused QUEUED row toggles it into the QUEUED multi-select set
- **GIVEN** `focus === 'queue'` and a pending ticket is focused via
  `queueFocus`
- **WHEN** the operator presses `space`
- **THEN** that ticket is added to (or, on a second press, removed from)
  `state.multiSelect.queued`

#### Scenario: `space` is a no-op outside a bulk-able section
- **GIVEN** `focus === 'runs'` and `runs[selected].status` is not `'failed'`
  (or `focus === 'quickstart'`)
- **WHEN** the operator presses `space`
- **THEN** `handleKey` returns `null` and no multi-select set changes

### Requirement: A multi-selected row renders with a marker distinct from both the ordinary cursor and the QUEUED-local focus marker

FAILED rows (`renderFinishedRow`) and QUEUED rows (`renderQueuedRow`) SHALL
render a dedicated multi-select marker (`✓`) for any row whose ticket is
present in the matching `state.multiSelect[section]` set, distinguishable
from the existing `▸` (run-selection cursor) and `»` (QUEUED-local focus)
markers — a row may show both its cursor/focus marker AND the multi-select
marker at once, since cursor position and multi-select membership are
independent.

#### Scenario: A multi-selected FAILED row shows the dedicated marker
- **GIVEN** a FAILED run's ticket is present in `state.multiSelect.failed`
- **WHEN** the fleet screen renders that row
- **THEN** the row shows the dedicated multi-select marker, whether or not
  it is also the currently selected (cursor) row

#### Scenario: A non-multi-selected row shows no multi-select marker
- **GIVEN** a FAILED or QUEUED row's ticket is absent from its section's
  multi-select set
- **WHEN** the fleet screen renders that row
- **THEN** no multi-select marker is shown for that row

### Requirement: Multi-select persists across `j`/`k` cursor movement within its section

Moving the run-selection cursor (`j`/`k` while `focus === 'runs'`) or the QUEUED-local cursor (`j`/`k` while `focus === 'queue'`) SHALL NOT modify either `state.multiSelect.failed` or `state.multiSelect.queued` — a row toggled into a multi-select set stays marked as the cursor moves away from and back to it, until explicitly toggled again or cleared per the clearing requirement below.

#### Scenario: Moving the cursor away from a multi-selected row leaves it selected
- **GIVEN** a FAILED row's ticket is in `state.multiSelect.failed` and the
  cursor is currently on that row
- **WHEN** the operator presses `j` to move the cursor to the next row
- **THEN** the ticket remains in `state.multiSelect.failed`

### Requirement: A section's multi-select set clears when its bulk action resolves or when focus leaves that section

`state.multiSelect.failed` SHALL be cleared whenever a bulk FAILED action
(`open-bulk-address-confirm`/`open-bulk-mark-done-confirm`'s resulting
confirmation) resolves — by `y` confirming or by any other key cancelling —
and whenever `focus` transitions away from `'runs'` (i.e. `focus-queue`/
`focus-quickstart`). `state.multiSelect.queued` SHALL be cleared whenever a
bulk QUEUED action (`open-bulk-force-start-confirm`'s resulting
confirmation) resolves, and on `exit-queue-focus`. Neither set is cleared
by anything else (in particular, not by an ordinary cursor move, and not by
opening — only by resolving — a bulk confirmation).

#### Scenario: Confirming a bulk action clears that section's multi-select set
- **GIVEN** `state.multiSelect.failed` has 3 tickets and a bulk mark-done
  confirmation is showing
- **WHEN** the operator presses `y`
- **THEN** `state.multiSelect.failed` is empty afterward

#### Scenario: Cancelling a bulk confirmation also clears the multi-select set
- **GIVEN** `state.multiSelect.failed` has 2 tickets and a bulk confirmation
  is showing
- **WHEN** the operator presses any key other than `y`
- **THEN** `state.multiSelect.failed` is empty afterward

#### Scenario: Leaving the FAILED section's focus clears its multi-select set
- **GIVEN** `state.multiSelect.failed` has 1 ticket and `focus === 'runs'`
- **WHEN** the operator enters QUEUED focus (digit-jump to QUEUED)
- **THEN** `state.multiSelect.failed` is empty afterward

#### Scenario: Exiting QUEUED focus clears the QUEUED multi-select set
- **GIVEN** `state.multiSelect.queued` has 1 ticket and `focus === 'queue'`
- **WHEN** the operator presses Escape to exit QUEUED focus
- **THEN** `state.multiSelect.queued` is empty afterward

### Requirement: The footer hint advertises `space` only while a bulk-able section is actually rendered this frame

`sections.js`'s footer-hint construction SHALL advertise `space select`
following the same "only advertise a key that currently does something"
discipline `a address`/`d done`/`f force-start` already follow — shown
whenever a FAILED or QUEUED section is rendered this frame.

#### Scenario: No FAILED or QUEUED section on screen means no `space` hint
- **GIVEN** the fleet screen has no FAILED runs and no QUEUED section this
  frame
- **WHEN** the footer hints are built
- **THEN** the hint text does not include `space select`
