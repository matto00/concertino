## ADDED Requirements

### Requirement: Shared layout helper draws every bordered pane
All six dashboard screens (`fleet`, `escalation`, `drilldown`, `launchpad`, `ticketview`, `launchplan`) SHALL draw bordered panes through a single shared module (`lib/ui/layout.js`) rather than each screen implementing its own box-drawing logic. The module SHALL remain pure: no I/O, no held state, no terminal queries — border and focus rendering are computed only from the arguments passed to it. A box's content row count SHALL be exactly `height - 2` regardless of its horizontal padding value (padding affects only left/right indentation, not row count), and a box's title, when it does not fit the border's available width, SHALL be truncated with the same ellipsis convention (`f.truncate`) used for content lines, including when the title carries ANSI colour.

#### Scenario: Every screen's frame comes from the shared module
- **WHEN** any of the six screens renders a bordered section
- **THEN** the border characters, padding, and title placement are produced
  by `lib/ui/layout.js`, not by screen-local box-drawing code

#### Scenario: Layout helper stays pure
- **WHEN** `lib/ui/layout.js`'s exported functions are called with the same
  arguments
- **THEN** they return the same output every time, with no dependency on
  `process.stdout`, the system clock, or any other ambient state

#### Scenario: Padding never changes a box's row count
- **WHEN** `box()` is called with a given `height` and two different
  `padding` values
- **THEN** both calls return the same number of lines, differing only in the
  horizontal indentation of their content rows

#### Scenario: An overlong coloured title is truncated, not overflowed
- **WHEN** `box()` is called with a `title` (optionally carrying a
  `STATUS_COLOUR`/role colour escape) wider than the border can accommodate
- **THEN** the rendered top border's visible length still equals the
  requested `width`, with the title ellipsis-truncated the same way an
  overlong content line would be

### Requirement: Focus is visually unambiguous on multi-pane screens
On every screen where more than one pane can independently receive keystrokes (currently only the launch pad's epics/tickets panes, switched via Tab or the left/right arrows), the pane currently receiving keystrokes SHALL be rendered with a structurally distinct border (a different box-drawing character set) from every other pane on the same screen, not solely a colour difference — so the distinction still holds on a terminal that renders bold text but not colour. A screen where every keypress is interpreted the same way regardless of which visual section the selection is in (the fleet view's four sections; the drill-down's timeline/gates/evidence panels, which have no pane-switch key) SHALL render all of its boxes with the same (plain) border set, since there is no second input target for a "focused" style to be distinguished from.

#### Scenario: Focused pane uses a heavier border
- **WHEN** the launch pad's `tickets` pane has focus (`lp.pane === 'tickets'`)
- **THEN** the tickets pane is rendered with the heavier/focused border
  character set and the epics pane is rendered with the plain/unfocused set

#### Scenario: Focus distinction survives a colourless terminal
- **WHEN** the launch pad is rendered with `isTTY` false (no colour emitted)
- **THEN** the focused pane's border characters still differ from the
  unfocused pane's border characters

#### Scenario: Single-input-target screens never claim a focused border
- **WHEN** the fleet view or the drill-down is rendered
- **THEN** every bordered section uses the same (plain) border character set,
  since neither screen has a keypress that routes to one section instead of
  another

### Requirement: Selection and focus are visually distinct states
A selected row within the currently focused pane SHALL render more prominently (bold and/or the pane's accent colour) than a selected row within an unfocused pane on the same screen; the latter SHALL remain visible (not identical to an unselected row) but SHALL NOT use the same emphasis as a selection in the focused pane.

#### Scenario: Selected row recedes in an unfocused pane
- **WHEN** the epics pane holds the previously-selected epic but keyboard
  focus has moved to the tickets pane
- **THEN** the epic row's selection marker is still present but rendered
  with less emphasis (e.g. dimmed) than the selected row in the tickets pane

### Requirement: Narrow or short terminals drop borders before content
When a pane's available width or height falls below the minimum needed to draw a legible border (border line plus at least one padded content column or row), the affected pane SHALL render its content without a frame rather than drawing a border that must itself be truncated into illegibility. Non-pinned content (e.g. the fleet view's RUNNING/FAILED/DONE sections) SHALL continue to be trimmed before any pinned content is. The fleet view's `NEEDS YOU` section SHALL never scroll off-screen, regardless of whether borders are drawn.

#### Scenario: Borders disappear before NEEDS YOU is trimmed
- **WHEN** the fleet view is rendered at a terminal height too short to fit
  bordered NEEDS YOU, RUNNING, FAILED, and DONE sections in full
- **THEN** borders are dropped (or non-pinned sections are trimmed further)
  before any row of the NEEDS YOU section is removed from the output

#### Scenario: A too-narrow pane still renders its content
- **WHEN** a pane's available width is below the layout helper's minimum
  bordered width
- **THEN** that pane's content still renders, left-aligned and padded as
  before this change, with no border drawn

### Requirement: Every existing degradation message still appears
The redesign SHALL NOT remove, rename, or hide any existing degradation string or indicator, including but not limited to: "no telemetry", "phase unknown", "no evidence recorded", "no gate results recorded", "press r to fetch" / "no tickets cached yet — press r to fetch", the malformed-events banner (`▲ N malformed events`), and the drill-down's own per-run malformed count.

#### Scenario: Telemetry-absent run still says so
- **WHEN** a run has `telemetry === 'none'`
- **THEN** the rendered fleet row and drill-down header still contain "no
  telemetry", rendered inside or alongside the new bordered layout rather
  than removed by it

#### Scenario: Malformed-event banner still renders
- **WHEN** one or more runs have a non-zero `malformed` count
- **THEN** the fleet view still renders the `▲ N malformed events` banner

### Requirement: Status colour is consistent across screens
A shared colour vocabulary (`STATUS_COLOUR` in `lib/ui/format.js`) SHALL govern the colour used for a given semantic status (needs-you, running, failed, done, gate pass, gate fail) everywhere that status is rendered, so the same status reads with the same colour on every screen it appears on. No element SHALL be coloured for decoration alone — every colour used SHALL correspond to an entry in `ROLE_COLOUR` or `STATUS_COLOUR`.

#### Scenario: Failed status is the same colour everywhere
- **WHEN** a run's status is `failed`
- **THEN** the fleet view's FAILED section heading and the drill-down's
  header both render that status with the same colour

### Requirement: No rendered line exceeds its visible-column budget
With borders and colour both present, no line produced by any of the six screens SHALL exceed its requested `cols` budget when measured in visible columns (`f.visibleLength`), including wide (CJK/emoji) characters and ANSI colour escapes.

#### Scenario: Bordered, coloured, wide-character row stays in budget
- **WHEN** a screen renders a bordered, focused pane containing a wide
  (CJK or emoji) ticket title under a forced-`isTTY` (coloured) render
- **THEN** every output line's `f.visibleLength` is less than or equal to the
  requested `cols`
