## ADDED Requirements

### Requirement: The escalation screen's content box grows to fill available terminal height
`lib/ui/screens/escalation.js`'s `renderEscalation` SHALL, when given a positive `opts.rows`, grow
its one content box (the question/context/options block) to fill the terminal's available rows,
using the same `rows - 1` reserved-trailing-newline-row convention `fleet.js`'s grow-to-fill
computation already uses, rather than always sizing the box to its own natural content height. The
box SHALL still shrink below its natural height when the given budget is tighter than the content
needs, exactly as before this change; growth only ever adds blank rows below the content, never
removes or truncates content that was rendering before this change.

#### Scenario: A short escalation grows to fill a tall terminal
- **WHEN** the escalation screen renders a question with a short context block and `opts.rows` set
  to a value well above what the content naturally needs
- **THEN** the rendered frame's line count is close to `opts.rows - 1` (padded, not left short),
  and the footer hint line is still the frame's last line

#### Scenario: Unbounded rendering is unaffected
- **WHEN** the escalation screen renders with `opts.rows` absent or `0`
- **THEN** the rendered output is unchanged from this screen's behavior before this change — sized
  to the content's natural height, not padded to any default

#### Scenario: A tight budget still shrinks the box as before
- **WHEN** the escalation screen renders with `opts.rows` smaller than the content's natural height
- **THEN** the box renders at its shrunk/degraded height exactly as it did before this change, with
  no regression to the existing narrow-terminal degrade behavior

### Requirement: The launch-plan screen's ticket-list box grows to fill available terminal height
`lib/ui/screens/launchplan.js`'s `renderLaunchPlan` SHALL grow its ticket-list box to the same
`ticketViewportRows` budget it already computes for scrolling/windowing that list, rather than
sizing the box to the (possibly shorter) natural content height of the current ticket batch. A
ticket batch too long for `ticketViewportRows` SHALL continue to window/scroll exactly as before
this change; only a batch shorter than the budget changes behavior, growing the box to consume the
remaining budget instead of leaving it as unused terminal rows.

#### Scenario: A small batch grows to fill available height
- **WHEN** the launch plan renders a batch of tickets whose natural list height is well under
  `opts.rows`
- **THEN** the ticket-list box's rendered height grows to consume the available budget (bounded by
  the same reserved-rows accounting `ticketViewportRows` already uses), rather than stopping at the
  batch's own natural height

#### Scenario: A large batch still scrolls exactly as before
- **WHEN** the launch plan renders a batch of tickets whose natural list height exceeds
  `ticketViewportRows`
- **THEN** the ticket list windows/scrolls exactly as it did before this change, with no change to
  which tickets are visible at a given scroll offset

#### Scenario: Unbounded rendering is unaffected
- **WHEN** the launch plan renders with `opts.rows` absent or `0`
- **THEN** the ticket-list box's height is the batch's natural content height, unchanged from this
  screen's behavior before this change
