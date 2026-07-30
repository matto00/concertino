## ADDED Requirements

### Requirement: Moving selection past the visible edge scrolls the view
The fleet view SHALL scroll its selectable, non-pinned sections (`RUNNING`,
`FAILED`, `DONE`) when the `move` action would otherwise place `selected` on
a row outside the currently rendered window, rather than leaving the
selection marker on a row that is not rendered.

#### Scenario: Moving down past the last rendered row scrolls down
- **WHEN** the selection moves (`j` / down) onto a run whose row is below
  the currently rendered window
- **THEN** the fleet view scrolls so that run's row is rendered, with the
  `▸` marker on it

#### Scenario: Moving up past the first rendered row scrolls up
- **WHEN** the selection moves (`k` / up) onto a run whose row is above the
  currently rendered window
- **THEN** the fleet view scrolls so that run's row is rendered, with the
  `▸` marker on it

### Requirement: NEEDS YOU stays pinned and fully visible regardless of scroll position
The `NEEDS YOU` section SHALL always render in full, uncapped and
unaffected by the scroll offset, at every scroll position.

#### Scenario: Scrolled deep into FAILED/DONE, NEEDS YOU is still shown
- **WHEN** the fleet view is scrolled such that `RUNNING`'s rows are no
  longer visible
- **THEN** every run in `NEEDS YOU` still renders in full, at the top of the
  frame

### Requirement: Selection index and the rendered marker agree at every scroll offset
The fleet view SHALL render the `▸` marker on exactly one row, the row for
`runs[selected]`, for any valid `selected` index and any scroll offset it
reaches via ordinary `move` actions.

#### Scenario: Marker alignment holds while scrolled
- **WHEN** the fleet view renders with a non-zero scroll offset and any
  valid `selected` index
- **THEN** exactly one line carries `▸`, and that line is `runs[selected]`'s
  row

#### Scenario: Marker alignment holds when scrolling back to the top
- **WHEN** the selection moves back up until the scroll offset returns to
  zero
- **THEN** the rendered rows and marker match the unscrolled render exactly,
  byte for byte

### Requirement: Scrolling degrades sanely on very short terminals
The fleet view SHALL collapse a section it cannot fit into its existing
single "… and N more" summary line, rather than rendering a partial or
corrupted window, at every scroll offset, whenever fewer terminal rows are
available than there are sections to render.

#### Scenario: A terminal too short for every section still renders without error
- **WHEN** the fleet view renders with a terminal height smaller than the
  combined height of all non-empty sections, at a non-zero scroll offset
- **THEN** the output still includes the header and `NEEDS YOU` in full, and
  every section that does not fit collapses to its "… and N more" line
  instead of a partially rendered box
