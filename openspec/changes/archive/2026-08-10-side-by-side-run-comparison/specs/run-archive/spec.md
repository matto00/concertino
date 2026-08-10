## ADDED Requirements

### Requirement: The archive list zone supports marking runs for side-by-side comparison

While the archive screen's results-list zone holds focus, the operator SHALL be able to toggle a DONE run under the cursor as "marked for comparison" via a dedicated key, independent of and without disturbing the existing `↵` (open drill-down) behavior. Marking SHALL be capped at two runs at a time, shared across both the archive screen and the fleet view's DONE section (a single selection set, not two independent ones) — see the `run-comparison` capability for the shared selection/cap/trigger semantics this requirement defers to. A marked run's row SHALL render a distinct visual marker, and only DONE runs SHALL be markable — toggling on a non-DONE row SHALL be a no-op.

#### Scenario: Marking a DONE run in the archive list
- **GIVEN** the archive screen's results list holds focus and the cursor is
  on a DONE run, with no run currently marked
- **WHEN** the operator presses the mark-for-comparison key
- **THEN** that run is marked (visually distinguished in the list) and
  counts toward the shared two-run cap

#### Scenario: Marking is a no-op on a non-DONE run
- **GIVEN** the archive screen's results list holds focus and the cursor is
  on a run that is not DONE (e.g. RUNNING or FAILED)
- **WHEN** the operator presses the mark-for-comparison key
- **THEN** nothing is marked, and the list is unchanged

#### Scenario: A run marked in fleet's DONE section shows as marked in archive too
- **GIVEN** a run was already marked for comparison from the fleet view's
  DONE section
- **WHEN** the archive screen opens and that same run is visible in the
  filtered list
- **THEN** that run's row renders the marked indicator, reflecting the
  single shared selection
