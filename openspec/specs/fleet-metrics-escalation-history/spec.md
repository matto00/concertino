# fleet-metrics-escalation-history Specification

## Purpose
Makes METRICS' recent-escalations list keyboard-navigable and scrollable
past whatever fits in the panel, and lets each row open a detail view — the
existing answerable escalation screen for a still-live entry, or a new
read-only historical rendering of that same screen for a resolved one.

## Requirements

### Requirement: `metricsFor()` pairs every raised escalation with its eventual resolution

`metricsFor()` SHALL compute a full, unbounded, newest-first history of every
`escalation.raised` event across `runs`, each paired with the
`escalation.answered` or `escalation.timeout` event that resolved it, if any
has occurred yet. Pairing SHALL be by `escalation_id` whenever both the raise
and the resolution carry one: a resolution SHALL close the entry whose
`escalation_id` it matches, regardless of how many other escalations were
raised in between. Pairing by event order within that run's own `events`
array SHALL remain in use only as the fallback for events that carry no
`escalation_id` (logs written before that field existed), closing the
most-recently-opened, still-open id-less entry. A resolution carrying an
`escalation_id` that matches no raised entry SHALL be ignored, exactly as an
id-less resolution with no open entry already is — never surfaced as a
decision with no question.

Each history entry SHALL carry: `ticket`, `role`, `question`, `options`,
`subQuestions`, `raisedAt`, `resolved` (boolean), `decision` (the answer
text, or the joined sub-answers for a multi-part escalation, or `null`),
`resolvedAt`, `timedOut`, and `resolutionChannel` (the resolving event's
`resolution_channel`, or `null` when it has none). An `escalation.raised`
with no resolution event yet SHALL have `resolved: false` and
`decision: null`.

`timedOut` SHALL be true only when the escalation's deadline passed and no
answer was ever recorded for it. When an `escalation.timeout` and a later
`escalation.answered` both reference the same `escalation_id`, the entry
SHALL report the answer — `resolved: true`, the answer's `decision`, its
`resolvedAt` and `resolutionChannel`, and `timedOut: false` — so an
escalation that timed out on the dashboard but was answered in chat is not
reported as having no answer.

#### Scenario: A resolved single-question escalation is paired
- **WHEN** a run's events contain an `escalation.raised` followed later by an
  `escalation.answered` with `answer: "approve"`
- **THEN** the corresponding history entry has `resolved: true`,
  `decision: "approve"`, and a non-null `resolvedAt`

#### Scenario: A timed-out escalation records no decision
- **WHEN** a run's events contain an `escalation.raised` followed later by an
  `escalation.timeout`, with no `escalation.answered` for the same escalation
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

#### Scenario: Interleaved escalations pair by id, not by order
- **GIVEN** a run raised escalation `X`, then raised escalation `Y`, and the
  answer to `X` arrived after `Y` was raised
- **WHEN** `metricsFor()` builds the history
- **THEN** `X`'s entry carries that answer as its decision and `Y`'s entry
  remains unresolved, rather than the answer closing `Y`

#### Scenario: An id-less log still pairs by event order
- **WHEN** a run's escalation events carry no `escalation_id` at all
- **THEN** each resolution closes the most-recently-opened still-open entry,
  exactly as before this change

#### Scenario: A resolution whose id matches no raise is ignored
- **WHEN** a run's events contain an `escalation.answered` whose
  `escalation_id` matches no `escalation.raised` entry (e.g. the raise was
  pruned by event-log retention)
- **THEN** it is ignored and no history entry is created for it

#### Scenario: An escalation answered in chat after timing out reports the answer
- **GIVEN** a run's events contain an `escalation.raised` for `escalation_id`
  `X`, then an `escalation.timeout` for `X`, then an `escalation.answered`
  for `X` with `resolution_channel: "chat"`
- **WHEN** `metricsFor()` builds the history
- **THEN** `X`'s entry has `timedOut: false`, the answer as its `decision`,
  and `resolutionChannel: "chat"`

#### Scenario: The resolving channel is exposed on each entry
- **WHEN** a history entry's escalation was resolved by an
  `escalation.answered` carrying `resolution_channel: "dashboard"`
- **THEN** that entry's `resolutionChannel` is `"dashboard"`

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
