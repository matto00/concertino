## ADDED Requirements

### Requirement: Exactly two DONE runs can be marked for comparison, shared across archive and fleet's DONE section

The dashboard SHALL maintain a single, shared selection of runs marked for comparison, capped at two entries, toggleable both from the run-archive screen's list zone (see `run-archive`) and from the fleet view's DONE section. Only DONE runs SHALL be markable. Toggling a marked run SHALL unmark it. Toggling an unmarked run while fewer than two are currently marked SHALL mark it. Toggling a third, unmarked run while two are already marked SHALL be a no-op — it SHALL NOT evict either existing selection.

#### Scenario: Marking two runs from fleet's DONE section
- **GIVEN** no run is currently marked
- **WHEN** the operator marks one DONE row in fleet's DONE section, then
  marks a second DONE row
- **THEN** both runs are marked, and their rows render the marked indicator

#### Scenario: Marking a third run while two are already marked is a no-op
- **GIVEN** two runs are already marked for comparison
- **WHEN** the operator attempts to mark a third, different DONE run
- **THEN** the selection is unchanged — the third run remains unmarked and
  neither of the first two is evicted

#### Scenario: Unmarking frees a slot
- **GIVEN** two runs are marked for comparison
- **WHEN** the operator toggles one of them again
- **THEN** that run becomes unmarked, and a third run can now be marked

#### Scenario: A non-DONE run cannot be marked
- **WHEN** the operator attempts to toggle marking on a RUNNING, FAILED, or
  QUEUED run, from either the archive screen or fleet's DONE section
- **THEN** nothing is marked

### Requirement: Opening the compare screen once two runs are marked

Once exactly two runs are marked for comparison, the operator SHALL be able to open a side-by-side comparison screen via a dedicated key, from either the archive screen's list zone or fleet's DONE section. With fewer than two runs marked, that key SHALL be a no-op.

#### Scenario: Opening compare with exactly two marked
- **GIVEN** exactly two runs are marked for comparison
- **WHEN** the operator presses the open-compare key
- **THEN** the compare screen opens, showing both marked runs

#### Scenario: Opening compare with fewer than two marked does nothing
- **GIVEN** zero or one run is marked for comparison
- **WHEN** the operator presses the open-compare key
- **THEN** no screen change occurs

### Requirement: The compare screen renders both runs' timelines, gates, and duration side by side

The compare screen SHALL render the two marked runs in two side-by-side columns, each column sized to roughly half the terminal width (accounting for a gutter/borders), showing that run's TIMELINE (event history) and GATES (per-gate status, duration, and first error when present) stacked within its column, using a rendering distinct from — and narrower than — the single-run drill-down's TIMELINE/GATES panels, so that both columns fit without truncating content mid-word on a normal-width terminal. The screen SHALL also display each run's total duration and the difference between the two durations.

#### Scenario: Both runs' timelines and gates are visible at once
- **GIVEN** the compare screen is open for two marked runs
- **WHEN** the operator views the screen
- **THEN** both runs' TIMELINE and GATES content are visible simultaneously,
  each in its own column, with no need to switch panels to see the other
  run's data

#### Scenario: Total duration and delta are shown
- **GIVEN** the compare screen is open for two DONE runs with different
  total elapsed durations
- **WHEN** the operator views the screen
- **THEN** each run's total duration is displayed, along with the
  difference between the two

#### Scenario: A gate's first error is shown when present
- **GIVEN** one of the two marked runs has a gate whose result recorded a
  first error
- **WHEN** the operator views that run's column
- **THEN** that gate's first error is displayed, consistent with how the
  single-run drill-down surfaces a gate's first error

### Requirement: `esc` from the compare screen returns to wherever it was opened from

The compare screen SHALL track whether it was opened from the archive screen or from the fleet view. Pressing `esc` while the compare screen is open SHALL return to that origin screen, not unconditionally to the fleet view.

#### Scenario: Escape returns to the archive screen when opened from there
- **GIVEN** the operator opened the compare screen from the archive screen
- **WHEN** the operator presses `esc`
- **THEN** the archive screen is shown, with its filters unchanged

#### Scenario: Escape returns to the fleet view when opened from there
- **GIVEN** the operator opened the compare screen from fleet's DONE
  section
- **WHEN** the operator presses `esc`
- **THEN** the fleet view is shown
