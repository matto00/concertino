# evidence-reader Specification

## Purpose
Lets a human select a run's persisted evidence artifact (proposal, design, evaluation/skeptic
report) directly from the drill-down's EVIDENCE panel and read it in place — via the shared
`docview` reader — instead of leaving the dashboard to find and open the file manually.
## Requirements
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

### Requirement: Evidence-panel selection and its open key are focus-gated
The EVIDENCE panel's selection cursor and its open key SHALL only be active, and only advertised in
the drill-down's footer hint, while the EVIDENCE panel holds input focus. A focus-switch key SHALL
toggle between the drill-down's default focus (where `↵` attach / `k` kill / `r` restart behave
exactly as they did before this change) and EVIDENCE focus. No footer hint for evidence-selection
or evidence-open SHALL appear while EVIDENCE is not focused, and no hint for `↵` attach / `k` kill /
`r` restart SHALL claim to open evidence.

#### Scenario: Default focus behaves exactly as before this change
- **WHEN** the drill-down is opened and EVIDENCE is not focused
- **THEN** `↵` attaches to the run, `k`/`r` behave exactly as before this change, and no
  evidence-selection or evidence-open key is shown in the footer

#### Scenario: Evidence focus exposes selection and open, not attach/kill/restart
- **WHEN** the focus-switch key is pressed and the EVIDENCE panel has at least one entry
- **THEN** the footer shows the evidence-selection and evidence-open keys, and the EVIDENCE panel's
  border renders in this screen's focused style

#### Scenario: Focus switch is inert when there is nothing to select
- **WHEN** the EVIDENCE panel shows "no evidence recorded" (no entries)
- **THEN** the focus-switch key does not move focus to EVIDENCE, and no evidence-selection or
  evidence-open key is ever shown in the footer for that run

### Requirement: The EVIDENCE panel's selectable list is bounded and follows the selection into view
The EVIDENCE panel SHALL cap the number of entries rendered at once to a fixed row budget
(mirroring `timelineLines`'s existing `MAX_TIMELINE` cap and its `… N earlier events` convention).
While EVIDENCE is not focused, the panel SHALL show the leading entries up to that cap, followed by
a `… N more` row when entries are hidden. While EVIDENCE is focused, the visible window SHALL
instead follow `drillEvidenceIndex` — scrolling as needed so the currently-selected entry is always
within the visible window, the same "selection never scrolls out of view" principle already
established for the fleet view's own selection (CON-6).

#### Scenario: An EVIDENCE list within the cap needs no windowing
- **WHEN** the number of evidence entries is less than or equal to the row cap
- **THEN** every entry renders, with no `… N more` row and no scrolling needed to reach any entry

#### Scenario: An unfocused, over-cap EVIDENCE list shows a truncation count
- **WHEN** EVIDENCE is not focused and the number of entries exceeds the row cap
- **THEN** only the leading entries up to the cap render, followed by a `… N more` row

#### Scenario: Moving the selection past the visible window scrolls it into view
- **WHEN** EVIDENCE is focused and `drillEvidenceIndex` is moved to an entry currently outside the
  visible window
- **THEN** the visible window scrolls so that entry becomes visible, rather than leaving the
  selection off-screen and unconfirmable

### Requirement: esc from the doc reader returns to the drill-down with the same entry selected
The doc reader SHALL, when `esc` is pressed while it is on screen (having been opened from the
drill-down's EVIDENCE panel), return to the drill-down with the EVIDENCE panel still focused and
the same entry still selected as before the reader was opened.

#### Scenario: Returning from the reader preserves the selection
- **WHEN** an evidence entry is opened and `esc` is pressed from the reader
- **THEN** the drill-down renders again with EVIDENCE still focused and the same entry highlighted

### Requirement: A missing evidence file degrades honestly inside the reader
The doc reader SHALL still open, showing an explicit message that the file could not be found,
rather than an empty pane, a thrown error, or refusing to open at all, when the file at an evidence
entry's persisted `ref` path cannot be read (missing, or any other read failure) at the point it is
opened.

#### Scenario: Opening an entry whose file has been pruned or removed
- **WHEN** an evidence entry is opened whose `ref` path no longer resolves to a readable file
- **THEN** the doc reader opens and shows an explicit "file not found" message in place of the
  document body

### Requirement: Evidence document bodies render as plain text with control bytes stripped
The doc reader SHALL render an evidence file's content as plain text — markdown syntax stripped via
the same `lib/ui/markdown.js` stripper the TICKET panel already uses — and SHALL have control bytes
stripped via this codebase's existing single render-time choke point (`lib/ui/format.js`'s
`f.truncate`), not a second, independent sanitization path.

#### Scenario: Markdown syntax in a report renders as plain text
- **WHEN** an opened evidence file's content contains markdown syntax (headings, emphasis, list
  markers, links)
- **THEN** the doc reader shows the underlying text with that syntax stripped, not raw markup
  characters

#### Scenario: Control bytes in a report do not reach the terminal
- **WHEN** an opened evidence file's content contains raw control bytes
- **THEN** the doc reader's rendered output has those control bytes stripped, consistent with every
  other screen's free-text handling

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

