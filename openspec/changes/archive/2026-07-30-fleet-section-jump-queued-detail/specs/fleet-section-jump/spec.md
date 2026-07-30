## ADDED Requirements

### Requirement: Digit keys jump to the first row of the Nth currently visible section
The fleet view (`lib/ui/screens/fleet.js`) SHALL bind digit keys `1` through `N` (where `N` is the number of sections actually rendered this frame) so that pressing digit `k` moves focus to the first row of the `k`th section in on-screen order. Numbering SHALL be computed from the sections actually rendered this frame (non-empty sections only) — a section with no entries this frame SHALL NOT consume a digit, and no fixed section-to-digit mapping SHALL be used. `j`/`k` single-row movement SHALL remain unaffected by this binding.

#### Scenario: Digit jump lands on the first row of the target section
- **WHEN** the fleet view renders NEEDS YOU, RUNNING, and FAILED (in that order, all non-empty) and the operator presses `3`
- **THEN** focus moves to the first row of FAILED, scrolled into view if necessary

#### Scenario: Numbering skips empty sections
- **WHEN** the fleet view renders RUNNING and DONE only (NEEDS YOU and FAILED currently empty) and the operator presses `2`
- **THEN** focus moves to the first row of DONE, since it is the second section actually rendered this frame, not the fifth

#### Scenario: An out-of-range digit is a no-op
- **WHEN** the operator presses a digit key greater than the number of sections currently rendered
- **THEN** no action is taken and the current selection/focus is unchanged

### Requirement: Jumping to a runs-backed section SHALL update `selected` and scroll it into view
Jumping to a section backed by `runs[]` entries (NEEDS YOU, RUNNING, FAILED, or DONE) SHALL set `state.selected` to that section's first row's global row index, using the identical scroll-into-view adjustment the `move` action already applies, so the jumped-to row is always rendered with the selection marker after the jump.

#### Scenario: Jumping into a scrolled-past section scrolls it into view
- **WHEN** DONE currently renders scrolled such that its first row is above the visible window, and the operator presses the digit mapped to DONE
- **THEN** the fleet view scrolls so DONE's first row is visible, with the selection marker on it

### Requirement: Jumping to QUEUED SHALL never perturb `state.selected` or the run row-index space
Jumping to the QUEUED section SHALL NOT modify `state.selected` or `state.scrollOffset` in any way. Instead it SHALL set a distinct, QUEUED-local focus cursor (see the companion `fleet-queue-force-start` capability), leaving the flat run row-index space `runs[state.selected]` callers depend on completely unaffected by having ever visited QUEUED.

#### Scenario: Visiting QUEUED and returning leaves the run selection unchanged
- **WHEN** the operator has `state.selected` pointing at a given run, jumps to QUEUED via its digit, then exits QUEUED focus (e.g. via Escape)
- **THEN** `state.selected` still points at the exact same run it did before the jump into QUEUED, unaffected by the round trip
