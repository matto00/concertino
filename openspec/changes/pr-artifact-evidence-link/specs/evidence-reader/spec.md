## MODIFIED Requirements

### Requirement: Selecting an evidence entry opens it in the shared doc reader
The drill-down (`lib/ui/screens/drilldown.js`) SHALL allow selecting one of the entries listed in
its EVIDENCE panel and, for a file-based entry (an `evidence`-kind event), opening it in the
`docview` reader screen (see the `docview` capability), reusing that shared screen rather than a
duplicate rendering implementation. A PR entry (a `pr`-kind event) is selected the same way but
opens differently — see the `browser-link-open` capability and the "A PR entry opens in the OS
browser" requirement below, not the doc reader.

#### Scenario: Opening a selected file-based evidence entry
- **WHEN** a file-based (`evidence`-kind) entry is selected in the drill-down's EVIDENCE panel and
  the open key is pressed
- **THEN** the doc reader opens, showing that entry's persisted file content

## ADDED Requirements

### Requirement: The EVIDENCE panel includes a run's PR alongside file artifacts
`evidenceItems()` SHALL include both `evidence`-kind and `pr`-kind events from the run's event log,
in event order, as entries in the EVIDENCE panel — a run's PR appears in the same list as its
planning docs and phase reports once the `pr` event has been emitted, rather than in a separate
panel or not at all.

#### Scenario: A run's PR appears in the EVIDENCE panel once created
- **WHEN** a run's event log contains a `pr` event
- **THEN** the EVIDENCE panel's entry list includes that PR, interleaved with any file-based
  evidence entries in event order

#### Scenario: A run with no PR yet shows only its file-based evidence
- **WHEN** a run's event log contains `evidence` events but no `pr` event
- **THEN** the EVIDENCE panel shows exactly the file-based entries, with no PR entry and no error

### Requirement: A PR entry renders distinctly from file-based entries
`evidenceLines()` SHALL render a PR (`pr`-kind) entry with a distinguishing icon or label — visibly
different from a file-based entry's rendering — so it is clear, before the open key is pressed,
that opening it will leave the dashboard for the OS browser rather than opening the in-TUI doc
reader.

#### Scenario: A PR entry looks different from a file entry in the list
- **WHEN** the EVIDENCE panel renders a list containing both a file-based entry and a PR entry
- **THEN** the PR entry's rendered line is visibly distinguishable from the file-based entry's
  rendered line (e.g. a different leading icon)

### Requirement: A PR entry opens in the OS browser, not the doc reader
Pressing the open key on a selected PR (`pr`-kind) entry SHALL dispatch an action that opens that
entry's URL in the OS default browser (see the `browser-link-open` capability), instead of the
`open-evidence-doc` action file-based entries use, and SHALL NOT transition the dashboard into
`docview` mode.

#### Scenario: Opening a selected PR entry
- **WHEN** a PR entry is selected in the drill-down's EVIDENCE panel and the open key is pressed
- **THEN** the PR's URL opens in the OS default browser, and the dashboard does not transition to
  the doc reader

### Requirement: Opening existing file-based evidence entries is unaffected by the PR entry type
Adding PR entries to the EVIDENCE panel SHALL NOT change the behavior of selecting or opening an
existing file-based (`evidence`-kind) entry: selection, windowing/scrolling, the open key's
transition to `docview`, and `esc`'s return to the drill-down with the same entry still selected
all behave exactly as they did before this change.

#### Scenario: A file-based entry still opens the doc reader when a PR entry is also present
- **WHEN** the EVIDENCE panel contains both file-based entries and a PR entry, and a file-based
  entry is selected and the open key is pressed
- **THEN** the doc reader opens showing that file-based entry's content, exactly as it would if no
  PR entry were present
