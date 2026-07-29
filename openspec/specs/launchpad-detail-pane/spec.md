# launchpad-detail-pane Specification

## Purpose
Defines the launch pad's inline third pane — showing the selected ticket's description and comments below the epics/tickets split via a renderer shared with the full-screen ticket view, degrading before the ticket list does on a short terminal.
## Requirements
### Requirement: Launch pad shows the selected ticket's detail inline
The launch pad SHALL render a third pane, positioned below the epics/tickets `hsplit` row and spanning the full render width, showing the currently-selected ticket's description and comments. The pane's content SHALL update whenever the tickets-pane selection (`lp.ticketIndex`) changes, without requiring navigation away from the launch pad.

#### Scenario: Moving the ticket selection updates the detail pane
- **WHEN** the tickets pane selection moves from one ticket to another (`j`/`k`/arrow keys)
- **THEN** the detail pane's rendered content reflects the newly-selected ticket's description and comments, not the previously-selected ticket's

#### Scenario: No ticket selected
- **WHEN** the tickets pane for the current epic is empty (no open tickets)
- **THEN** the detail pane renders a state that does not claim to be describing a ticket (e.g. an explicit "no ticket selected" message), not a blank or stale pane

### Requirement: Detail pane and full-screen ticket view share one renderer
The description/comments body rendering used by the inline detail pane and by the full-screen `ticketview.js` (reached via `↵`) SHALL be produced by one shared, pure function, not by two independent implementations. `ticketview.js` SHALL remain reachable and behaviorally unchanged as the full-screen read for long descriptions.

#### Scenario: Shared renderer produces identical body content
- **WHEN** the same ticket is rendered by the inline detail pane and by `ticketview.js`'s full-screen view
- **THEN** the description text, wrapping rules, and comment ordering/content produced by both come from the same underlying function (differences are limited to layout — box dimensions, surrounding chrome — not content)

#### Scenario: Full-screen ticket view is still reachable
- **WHEN** `↵` is pressed on a ticket in the tickets pane
- **THEN** the full-screen `ticketview.js` opens exactly as it did before this change

### Requirement: Empty description is stated explicitly
A ticket with no description (empty or all-whitespace) SHALL render an explicit message saying so in the detail pane, not a blank region.

#### Scenario: Ticket with an empty description
- **WHEN** the selected ticket's `description` is `''` or whitespace-only
- **THEN** the detail pane renders an explicit "(no description)"-style message in place of the description, rather than an empty area

### Requirement: Truncated comment threads stay visibly truncated in the inline pane
When the selected ticket's `commentsTruncated` is `true`, the inline detail pane SHALL surface that fact to the user, exactly as `ticketview.js` already does, rather than presenting the fetched subset as if it were the complete thread.

#### Scenario: Selected ticket has a truncated comment thread
- **WHEN** the selected ticket has `commentsTruncated: true`
- **THEN** the inline detail pane renders a visible indication that only a subset of comments is shown (not silently rendering only the fetched comments as if complete)

### Requirement: Detail pane degrades before the ticket list does
On a terminal too short to fit all three panes at a usable size, the detail pane SHALL be the one that collapses (omitted entirely below `layout.MIN_BOX_HEIGHT`), not the epics/tickets pane. `MAX_EPICS_VISIBLE` and `MAX_TICKETS_VISIBLE` SHALL NOT be reduced to make room for the detail pane.

#### Scenario: Short terminal collapses the detail pane, not the list
- **WHEN** the launch pad is rendered with a terminal height too short to fit the detail pane at or above `layout.MIN_BOX_HEIGHT`
- **THEN** the detail pane is omitted from the rendered output entirely, and the epics/tickets pane still renders at its normal (non-shrunk) row budget

#### Scenario: Detail pane renders at full height when space allows
- **WHEN** the launch pad is rendered with `opts.rows` unbounded (`0`, or absent — matching `fleet.js`'s "0 = unbounded" convention) or generous enough to fit all three panes
- **THEN** the detail pane renders at its normal content height, matching `ticketview.js`'s own unbounded-height content

