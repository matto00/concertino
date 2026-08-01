## REMOVED Requirements

### Requirement: QUICK START is hidden by default and toggled by a dedicated key
**Reason**: The toggle added friction to the exact workflow QUICK START exists to speed up — starting the next most urgent ticket without leaving the fleet view. QUICK START is now always shown; there is no visibility state left to toggle.
**Migration**: No action needed. The `Q` key is no longer bound to anything; the section is simply always present. Any code or docs referencing `quickStartVisible`, `QUICK_START_TOGGLE_KEY`, or the `'toggle-quickstart'` action should be removed rather than updated.

The fleet view (`lib/ui/screens/fleet.js`) SHALL maintain a `quickStartVisible` flag, `false` by default, and SHALL render a `QUICK START` section only when it is `true`. A dedicated key (`Q`) SHALL toggle it: pressing `Q` while `quickStartVisible` is `false` SHALL set it `true` and simultaneously enter QUICK START focus (see the companion focus requirement below); pressing `Q` while QUICK START is focused SHALL set `quickStartVisible` back to `false` and return focus to `'runs'`. The `QUICK START` section SHALL NOT render at all while `quickStartVisible` is `false`, regardless of how many eligible tickets exist.

#### Scenario: Q opens and focuses QUICK START in one keypress
- **WHEN** the fleet view is rendered with `quickStartVisible: false` and the operator presses `Q`
- **THEN** the next render shows a `QUICK START` section and focus is `'quickstart'`

#### Scenario: Q closes QUICK START from within its own focus
- **WHEN** `quickStartVisible` is `true` and focus is `'quickstart'`, and the operator presses `Q`
- **THEN** the next render shows no `QUICK START` section, `quickStartVisible` is `false`, and focus is `'runs'`

#### Scenario: QUICK START never renders while hidden
- **WHEN** `quickStartVisible` is `false`
- **THEN** no `QUICK START` section appears in the rendered fleet view, independent of how many tickets would otherwise be eligible

## ADDED Requirements

### Requirement: QUICK START is always visible, unconditionally
The fleet view (`lib/ui/screens/fleet.js`) SHALL render a `QUICK START` section on every render, with no visibility flag gating it — the same way the `METRICS` section is unconditional. There SHALL be no key binding that hides or shows the section.

#### Scenario: QUICK START renders on the first frame with no user action
- **WHEN** the fleet view is rendered for the first time after the dashboard starts
- **THEN** a `QUICK START` section is present, with no keypress required to reveal it

#### Scenario: QUICK START remains visible across every subsequent render
- **WHEN** the fleet view re-renders on any later poll, regardless of what other sections are present or what focus is active
- **THEN** the `QUICK START` section is still present

## MODIFIED Requirements

### Requirement: QUICK START has its own focus cursor, entered via digit-jump
Since `QUICK START` is now always visible, `QUICK START` SHALL be reachable via the existing digit-key section-jump (numbered positionally over sections actually rendered this frame, per `fleet-section-jump`), emitting a focus action that sets `focus` to `'quickstart'` without altering `state.selected` or `state.scrollOffset`. While `focus` is `'quickstart'`: `j`/`k` (and their arrow-key aliases) SHALL move a local cursor (`quickStartFocus`) over the section's own rendered rows, clamped to their bounds, and the row currently under `quickStartFocus` SHALL render with a visual marker distinguishing it from the section's other rows (analogous to `QUEUED`'s own focused-row marker); bare Escape SHALL exit quickstart focus back to `'runs'`; `Enter`, `l`/right-arrow, `n`, and `N` SHALL be suppressed (no-ops) while this focus is active, exactly as they already are while `focus === 'queue'`.

#### Scenario: Digit-jump enters QUICK START focus without touching run selection
- **WHEN** the fleet view renders QUICK START among other sections and the operator presses the digit mapped to it
- **THEN** `focus` becomes `'quickstart'` and `state.selected`/`state.scrollOffset` are unchanged

#### Scenario: j/k move the QUICK START cursor while focused
- **WHEN** `focus` is `'quickstart'` and the operator presses `j` or `k`
- **THEN** `quickStartFocus` moves down or up within the rendered QUICK START rows, clamped to the first/last row, and the row now under `quickStartFocus` renders with the focused-row marker

#### Scenario: Escape exits QUICK START focus, section stays visible
- **WHEN** `focus` is `'quickstart'` and the operator presses bare Escape
- **THEN** `focus` returns to `'runs'`, and the `QUICK START` section remains visible exactly as before (it was never conditional on focus)

#### Scenario: Ordinary run-selection keys are suppressed while QUICK START is focused
- **WHEN** `focus` is `'quickstart'` and the operator presses Enter, `l`, `n`, or `N`
- **THEN** none of these keys perform their ordinary fleet-view action
