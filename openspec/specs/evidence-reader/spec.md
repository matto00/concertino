# evidence-reader Specification

## Purpose
Lets a human select a run's persisted evidence artifact (proposal, design, evaluation/skeptic
report) directly from the drill-down's EVIDENCE panel and read it in place — via the shared
`docview` reader — instead of leaving the dashboard to find and open the file manually.
## Requirements
### Requirement: Selecting an evidence entry opens it in the shared doc reader
The drill-down (`lib/ui/screens/drilldown.js`) SHALL allow selecting one of the entries listed in
its EVIDENCE panel and opening it in the `docview` reader screen (see the `docview` capability),
reusing that shared screen rather than a duplicate rendering implementation.

#### Scenario: Opening a selected evidence entry
- **WHEN** an evidence entry is selected in the drill-down's EVIDENCE panel and the open key is
  pressed
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

