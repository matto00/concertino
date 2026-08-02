## ADDED Requirements

### Requirement: `t` opens the ticket detail view for the focused/selected row in QUICK START, QUEUED, RUNNING, and DONE

The fleet view (`lib/ui/screens/fleet.js`) SHALL bind the `t` key so that,
when pressed while a row in QUICK START, QUEUED, RUNNING, or DONE is
focused/selected, it opens the full-screen ticket detail view
(`lib/ui/screens/ticketview.js`, routed via `router.js`) for that row's
ticket. For RUNNING and DONE this binding SHALL be additive to the existing
`l` / right-arrow → run-drilldown binding — `l` SHALL continue to open the
run drilldown (`lib/ui/screens/drilldown.js`) exactly as before this change,
unaffected by `t`'s addition.

#### Scenario: `t` on a RUNNING row opens the ticket detail view
- **WHEN** the fleet view's run selection (`focus === 'runs'`) is on a
  RUNNING row and the operator presses `t`
- **THEN** the ticket detail view opens, showing that row's ticket

#### Scenario: `t` on a DONE row opens the ticket detail view
- **WHEN** the fleet view's run selection is on a DONE row and the operator
  presses `t`
- **THEN** the ticket detail view opens, showing that row's ticket

#### Scenario: `t` on a QUEUED row opens the ticket detail view
- **WHEN** QUEUED is locally focused (`focus === 'queue'`) on a pending
  ticket and the operator presses `t`
- **THEN** the ticket detail view opens, showing that ticket

#### Scenario: `t` on a QUICK START row opens the ticket detail view
- **WHEN** QUICK START is locally focused (`focus === 'quickstart'`) on an
  eligible ticket and the operator presses `t`
- **THEN** the ticket detail view opens, showing that ticket

#### Scenario: `l` on a RUNNING/DONE row is unchanged by this addition
- **WHEN** the fleet view's run selection is on a RUNNING or DONE row and the
  operator presses `l` (or the right-arrow alias)
- **THEN** the run drilldown opens, exactly as it did before `t` existed —
  `t`'s presence does not alter `l`'s behavior

### Requirement: `t` on a row with no resolvable ticket identifier is a no-op

The fleet view SHALL NOT change its screen mode, crash, or render a blank screen when `t` is pressed while the focused/selected row has no ticket identifier resolvable at keypress time. This SHALL hold independent of which section (QUICK START, QUEUED, RUNNING, DONE) the unresolvable row belongs to.

#### Scenario: QUICK START focus with no eligible ticket at the focused index
- **WHEN** QUICK START is locally focused but the eligible-ticket list no
  longer has an entry at the focused index (e.g. the list shrank between
  render and keypress) and the operator presses `t`
- **THEN** the fleet view's screen mode is unchanged — no ticket detail view
  opens, no crash, no blank screen

#### Scenario: QUEUED focus with no pending ticket at the focused index
- **WHEN** QUEUED is locally focused but the pending queue no longer has an
  entry at the focused index and the operator presses `t`
- **THEN** the fleet view's screen mode is unchanged

#### Scenario: Run selection with no current run
- **WHEN** the flat run selection has no run at the currently selected index
  and the operator presses `t`
- **THEN** the fleet view's screen mode is unchanged

### Requirement: The ticket detail view's `esc` returns to the screen it was opened from

The ticket detail view (`ticketview.js`) SHALL return, on `esc`, to whichever
screen it was most recently opened from — the launch pad, when opened via
the launch pad's own `↵` binding, or the fleet view, when opened via `t`
from QUICK START, QUEUED, RUNNING, or DONE. This SHALL hold independent of
which of the two ticket detail view entry points was used most recently in
the current session.

#### Scenario: Opened from the fleet view, `esc` returns to the fleet view
- **WHEN** the ticket detail view was opened via `t` from a fleet-view row
  and the operator presses `esc`
- **THEN** the fleet view is shown

#### Scenario: Opened from the launch pad, `esc` returns to the launch pad
- **WHEN** the ticket detail view was opened via `↵` from the launch pad's
  tickets pane and the operator presses `esc`
- **THEN** the launch pad is shown

#### Scenario: Alternating entry points each return correctly
- **WHEN** the ticket detail view is opened from the launch pad, closed back
  to the launch pad, then separately opened via `t` from the fleet view
- **THEN** the second `esc` returns to the fleet view, not the launch pad —
  each visit's return destination reflects how that specific visit was
  entered, not a stale prior visit's destination
