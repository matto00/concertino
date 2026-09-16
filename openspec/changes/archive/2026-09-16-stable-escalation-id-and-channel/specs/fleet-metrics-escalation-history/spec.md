## MODIFIED Requirements

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
