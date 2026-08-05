# dashboard-shared-widgets Specification

## Purpose
Defines `lib/ui/widgets/` — the pure, independently unit-tested confirm-dialog, text-input-line, footer-row-accounting, section-header, and empty-state functions shared across the dashboard's screens in place of each screen hand-rolling its own copy of these shapes.
## Requirements
### Requirement: A shared confirm-dialog widget governs every "are you sure" gate's rendered lines

`lib/ui/widgets/confirm.js` SHALL export a pure `confirmLines({ warning, confirmHint })` function returning exactly two lines: the caller-supplied `warning` text on its own line, and `confirmHint` wrapped in `f.dim` on the following line. Every existing confirm gate that renders a two-line "warning + y confirm / any other key cancel" pair (fleet's clear-queue, force-start, and quit gates; drilldown's kill/restart gate) SHALL render those two lines via this function rather than constructing them inline. This SHALL NOT change the wording of any gate's warning text, the confirm key bound to it, or `handleKey`'s existing gate-ordering/interception logic.

#### Scenario: Fleet's clear-queue confirm renders via the shared widget
- **WHEN** the fleet view renders with `clearQueueConfirm` set
- **THEN** the two rendered lines (dropped-ticket-count warning, `y confirm clear` hint) are produced by `confirm.confirmLines`, byte-identical to this screen's pre-this-change output

#### Scenario: Drilldown's kill confirm renders via the shared widget
- **WHEN** the drill-down renders with `confirm === 'kill'`
- **THEN** the two rendered lines (kill warning, `y confirm` hint) are produced by `confirm.confirmLines`, byte-identical to this screen's pre-this-change output

#### Scenario: The widget is pure
- **WHEN** `confirmLines` is called twice with the same arguments
- **THEN** it returns the same two-line array both times, with no dependency on ambient state

### Requirement: A shared text-input widget governs every label-prefixed input line's rendered lines

`lib/ui/widgets/textinput.js` SHALL export a pure `inputLines({ label, value, cols, error })` function returning one line (`'  ' + label + ' › ' + truncated value + '▏'`) or two lines (that line plus a `'  ' + f.red`-wrapped, width-truncated error line) when `error` is truthy. Every existing text-input field that renders this exact single-line shape (fleet's new-run prompt, `escalation.js`'s reply box, `banner.js`'s reply box) SHALL render its input+error line(s) via this function rather than constructing them inline. This SHALL NOT change any input field's label text, cursor/backspace key handling, or the action-type name(s) its `handleKey` emits. `ticketdraft.js`'s draft-field rendering (a wrapped multi-line textarea, not this single-line shape) is explicitly NOT a consumer of this widget.

#### Scenario: Fleet's new-run prompt renders via the shared widget
- **WHEN** the fleet view renders with an open `prompt` carrying a `value` and no `error`
- **THEN** the rendered input line is produced by `textinput.inputLines`, byte-identical to this screen's pre-this-change output

#### Scenario: An input field with an error renders two lines
- **WHEN** `inputLines` is called with a truthy `error`
- **THEN** the return value has exactly two lines: the input line, then the error line

#### Scenario: An input field with no error renders one line
- **WHEN** `inputLines` is called with no `error` (or a falsy one)
- **THEN** the return value has exactly one line

### Requirement: A shared footer widget owns its own rendered-row-count accounting

`lib/ui/widgets/footer.js` SHALL export a pure `footer({ hints, cols })` function returning `{ lines, rows }`, where `lines` is `f.hintLines(hints, cols)`'s own return value unchanged and `rows` is that array's length. The two screens verified to budget height around a duplicated re-derivation of this footer hint block (`drilldown.js`, `launchplan.js`) SHALL read the footer's row count from this widget's `rows` field rather than separately re-deriving `f.hintLines(...).length` at a second call site. `escalation.js`, `ticketview.js`, `docview.js`, and fleet build their footers from a fixed constant or a single already-computed value and are explicitly NOT consumers of this widget — they are unaffected by this requirement.

#### Scenario: The widget's row count matches its own line array's length
- **WHEN** `footer({ hints, cols })` is called with any `hints`/`cols`
- **THEN** the returned `rows` equals `lines.length`

#### Scenario: A screen's height budget reads rows from the widget, not a second computation
- **WHEN** drilldown.js computes its footer for its `evidenceFocused` or default branch
- **THEN** the row count used in its `belowRow` height-budget arithmetic is the `rows` field returned by `footer()` for that same branch, not an independently re-derived count

#### Scenario: A non-footer row count is not routed through the footer widget
- **WHEN** drilldown.js computes its `belowRow` height-budget arithmetic for its `confirm` branch
- **THEN** the row count used is derived from `confirmLines(...)`'s always-2-line output, not from `footer()` — the `confirm` branch has no `hints` array and is not a footer computation

### Requirement: A shared section-header widget composes an icon with a label

`lib/ui/widgets/header.js` SHALL export a pure `sectionHeader({ icon, label, colour })` function returning `icon + ' ' + label`, optionally wrapped in `colour` when given. This SHALL follow the `dashboard-iconography` capability's existing "icon + ' ' + label, additive, never a substitute" convention — `header.js` SHALL NOT introduce any new icon glyph itself; `icon` SHALL always be a value already exported by `lib/ui/icons.js`, or omitted (in which case `sectionHeader` returns `label` unchanged).

#### Scenario: A section header composes an existing icon with its label
- **WHEN** `sectionHeader({ icon: icons.description, label: 'DESCRIPTION' })` is called
- **THEN** the result is `icons.description + ' ' + 'DESCRIPTION'`

#### Scenario: Omitting the icon returns the label unchanged
- **WHEN** `sectionHeader({ label: 'SETTINGS' })` is called with no `icon`
- **THEN** the result is exactly `'SETTINGS'`

### Requirement: A shared empty-state widget governs "nothing to show" pane rendering

`lib/ui/widgets/empty.js` SHALL export a pure `emptyState({ icon, message })` function returning a small line array mirroring the codebase's existing dim-styled short-message "nothing to show" convention (e.g. `fleet/sections.js`'s `f.dim('  no active runs')`, `launchpad.js`'s `f.dim('no tickets cached yet — press r to fetch')`), optionally icon-prefixed via the `header.js` convention when `icon` is given. A pane that currently hand-rolls its own "nothing to show" text MAY be migrated to render via this widget without changing that pane's existing wording.

#### Scenario: An empty-state message renders dim-styled
- **WHEN** `emptyState({ message: 'no active runs' })` is called
- **THEN** the returned line(s) render the message text wrapped in `f.dim`, matching the existing hand-rolled convention

#### Scenario: An empty-state message can carry an icon prefix
- **WHEN** `emptyState({ icon: icons.ticket, message: 'no tickets' })` is called
- **THEN** the returned line's text includes both the icon and the unmodified message text

