## ADDED Requirements

### Requirement: `metricsFor()` pairs every raised escalation with its eventual resolution

`metricsFor()` SHALL compute a full, unbounded, newest-first history of every
`escalation.raised` event across `runs`, each paired — by event order within
that run's own `events` array — with the `escalation.answered` or
`escalation.timeout` event that resolved it, if any has occurred yet. Each
history entry SHALL carry: `ticket`, `role`, `question`, `options`,
`subQuestions`, `raisedAt`, `resolved` (boolean), `decision` (the answer
text, or the joined sub-answers for a multi-part escalation, or `null`),
`resolvedAt`, and `timedOut` (true only when the resolution was
`escalation.timeout`). An `escalation.raised` with no resolution event yet
SHALL have `resolved: false` and `decision: null`. An `escalation.answered`/
`escalation.timeout` with no currently-open `escalation.raised` to close
(e.g. pruned by event-log retention) SHALL be ignored — never surfaced as a
decision with no question.

#### Scenario: A resolved single-question escalation is paired
- **WHEN** a run's events contain an `escalation.raised` followed later by an
  `escalation.answered` with `answer: "approve"`
- **THEN** the corresponding history entry has `resolved: true`,
  `decision: "approve"`, and a non-null `resolvedAt`

#### Scenario: A timed-out escalation records no decision
- **WHEN** a run's events contain an `escalation.raised` followed later by an
  `escalation.timeout`
- **THEN** the corresponding history entry has `resolved: true`,
  `decision: null`, `timedOut: true`

#### Scenario: A still-live escalation is unresolved
- **WHEN** a run's events contain an `escalation.raised` with no subsequent
  `escalation.answered`/`escalation.timeout`
- **THEN** the corresponding history entry has `resolved: false`,
  `decision: null`

#### Scenario: A multi-part escalation's answers are joined into one decision
- **WHEN** a run's events contain an `escalation.raised` with `sub_questions`
  followed later by an `escalation.answered` carrying `sub_answers`
- **THEN** the corresponding history entry's `decision` is a single string
  joining each sub-question with its sub-answer

### Requirement: METRICS' recent-escalations list is keyboard-navigable and windowed past its visible rows

The fleet view SHALL support a `focus === 'metrics'` mode, entered via
digit-jump onto the METRICS section, mirroring the existing `'quickstart'`/
`'queue'` focus modes. While focused, `j`/`k` SHALL move a selection cursor
over the full escalation history (not only the rows currently visible in the
METRICS box), and the visible window SHALL scroll to keep the selection
in view, exactly as the drill-down's EVIDENCE panel already windows its own
list via `layout.selectionWindow`. Escape SHALL exit the focus mode back to
the ordinary run selection, without hiding the METRICS panel. When
`focus !== 'metrics'`, the panel SHALL render exactly as before this
change — the leading entries up to the panel's available rows, with a
`'… N more'` indicator when truncated.

#### Scenario: Digit-jump focuses METRICS
- **WHEN** the operator presses the digit corresponding to the METRICS
  section
- **THEN** `focus` becomes `'metrics'` and the escalation-history cursor is
  set to its first entry

#### Scenario: Scrolling past the visible window
- **WHEN** focus is `'metrics'` and the operator presses `j` enough times to
  move the cursor past the last row currently rendered
- **THEN** the rendered window scrolls to keep the selected row visible,
  revealing history entries that were not shown before scrolling

#### Scenario: Escape exits focus without hiding the panel
- **WHEN** focus is `'metrics'` and the operator presses Escape
- **THEN** `focus` returns to `'runs'` and the METRICS panel continues
  rendering (its unfocused, leading-rows view)

### Requirement: Opening a historical escalation reuses the existing escalation screen

Pressing `↵` on the selected entry while focus is `'metrics'` SHALL open a
detail view for that entry. When the entry is still live
(`resolved: false`), this SHALL dispatch the exact same `'open-escalation'`
action the fleet view's existing `g`/`↵` bindings already use elsewhere —
the same answerable escalation screen, not a separate rendering. When the
entry is resolved, the same escalation screen module SHALL render a
read-only historical view: the full question and full option list, no
answer-key bindings, and the recorded decision (or an explicit "no answer
recorded" indication for a timed-out escalation) in place of the live
screen's answer controls.

#### Scenario: Opening a still-live historical-list entry routes to the live screen
- **WHEN** the operator presses `↵` on a history entry with `resolved: false`
- **THEN** the fleet view opens the same answerable escalation screen that
  `g`/`↵` open for that ticket's live escalation elsewhere, with its option
  keys and reply binding intact

#### Scenario: Opening a resolved entry shows its recorded decision
- **WHEN** the operator presses `↵` on a history entry with `resolved: true`
  and a non-null `decision`
- **THEN** the escalation screen renders the full question, full option
  list, and the recorded decision text, with no answer-key bindings

#### Scenario: Opening a timed-out entry shows "no answer recorded"
- **WHEN** the operator presses `↵` on a history entry with `resolved: true`
  and `timedOut: true`
- **THEN** the escalation screen renders an explicit "no answer recorded"
  indication in place of a decision
