# cross-screen-escalation Specification

## Purpose
Make a live escalation visible and answerable from every dashboard screen, not just the fleet and
the escalation's own dedicated screen, since a blocking escalation (e.g. a stuck base-branch
fast-forward) is a fleet-wide concern that outlives whichever screen happened to be open when it
was raised.
## Requirements
### Requirement: A live escalation renders as a banner on every dashboard screen
`lib/ui/watch.js` SHALL, on every poll, determine the set of live escalations across the whole
fleet (any run with `run.escalation` set and `run.escalationStale` false) and, when that set is
non-empty, render a banner naming the oldest one (by `raisedAt`) above the screen the router would
otherwise render — regardless of `state.mode` — except when the screen already on top is that
exact escalation's own dedicated screen. When more than one live escalation exists, the banner
SHALL also state how many additional ones there are.

#### Scenario: A live escalation shows while the fleet screen is open
- **WHEN** a run has a live escalation and the dashboard is showing the fleet screen
- **THEN** the rendered frame includes a banner naming that escalation, in addition to the
  fleet's own `NEEDS YOU` section

#### Scenario: A live escalation shows while a different run's screens are open
- **WHEN** a run has a live escalation and the dashboard is showing the drilldown, launch pad,
  ticket view, or launch plan screen (for any run, including a different one)
- **THEN** the rendered frame includes the banner naming that escalation

#### Scenario: A live escalation shows while a different run's escalation screen is open
- **WHEN** two runs each have a live escalation, and the dashboard is showing the escalation
  screen for one of them
- **THEN** the rendered frame includes the banner naming the *other* run's escalation

#### Scenario: The banner is suppressed on its own escalation's screen
- **WHEN** exactly one run has a live escalation and the dashboard is already showing that run's
  own escalation screen
- **THEN** no banner is rendered in addition to the escalation screen already showing it

#### Scenario: Multiple live escalations name the oldest and count the rest
- **WHEN** three runs each have a live escalation
- **THEN** the banner names the one with the earliest `raisedAt` and states that 2 more exist

#### Scenario: No banner when nothing is live
- **WHEN** no run has a live (non-stale) escalation
- **THEN** no banner is rendered on any screen

### Requirement: The banner offers a reachable reply path from any screen
A single reserved key SHALL open a reply box for the banner's targeted escalation from whatever
screen is currently on top, without navigating away from it. While that reply box is open,
keystrokes SHALL be routed to it rather than to the underlying screen's own key handling, exactly
as the dedicated escalation screen already routes keystrokes to its own reply box over its
per-option letter keys. Submitting a non-empty reply SHALL write it as that escalation's answer
through the same mechanism (`lib/ui/store.js`'s `writeAnswer`) the dedicated escalation screen
uses, keyed to the targeted run's ticket. Cancelling (Escape) SHALL close the reply box without
writing anything, returning control to the underlying screen exactly as it was.

#### Scenario: Opening the banner's reply box from a non-fleet, non-escalation screen
- **WHEN** the reserved key is pressed while a live escalation's banner is showing on, e.g., the
  drilldown screen
- **THEN** a reply box for that escalation opens, and the drilldown screen underneath is otherwise
  unaffected

#### Scenario: Typed keys go to the reply box, not the underlying screen
- **WHEN** the banner's reply box is open and the human types characters that would otherwise be
  bound to actions on the underlying screen
- **THEN** those keystrokes are appended to the reply box's value and do not trigger the
  underlying screen's bindings

#### Scenario: Submitting writes the answer for the targeted run
- **WHEN** the banner's reply box is open, targeting a specific run's ticket, and the human types
  a non-empty value and presses Enter
- **THEN** that value is written as the answer for that run's ticket via the same write path the
  dedicated escalation screen uses

#### Scenario: Cancelling leaves the underlying screen untouched
- **WHEN** the banner's reply box is open and the human presses Escape
- **THEN** the reply box closes with nothing written, and the screen underneath renders exactly as
  it did before the reply box was opened

### Requirement: The banner clears automatically once its escalation resolves
The banner SHALL stop rendering an escalation on the very next poll once it is answered or times
out (the same `escalation.answered`/`escalation.timeout` events and `reducer.js` handling that
already clear a run's `escalation` field), with no additional clearing logic beyond the existing
live-escalation computation re-running.

#### Scenario: The banner disappears once its escalation is answered
- **WHEN** a live escalation shown in the banner is answered (via the banner's own reply box, the
  dedicated escalation screen, or any other path that writes its answer)
- **THEN** the banner no longer shows that escalation on the next poll, and disappears entirely if
  no other escalation is live

#### Scenario: The banner disappears once its escalation times out
- **WHEN** a live escalation shown in the banner times out without being answered
- **THEN** the banner no longer shows that escalation on the next poll

