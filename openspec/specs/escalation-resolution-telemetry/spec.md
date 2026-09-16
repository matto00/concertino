# escalation-resolution-telemetry Specification

## Purpose
Defines the `escalation_id` / `resolution_channel` / `answer_source` field contract on the escalation event family, so a raise can be paired to the resolution that actually answered it by identity rather than by time order, and so a chat-resolved escalation is recorded as answered rather than as a timeout.

## Requirements

### Requirement: `escalation.raised` carries a stable, unique `escalation_id`

Every `escalation.raised` event written by `core/scripts/emit-event.sh` SHALL include an `escalation_id` field: a non-empty string, generated once at raise time, unique across every escalation raised for the same ticket — including two raises made in the same whole second, and concurrent raises from separate processes. The id SHALL be generated identically for the `--await` and `--raise-only` raise modes, since a `--raise-only` raise is resolved later by a different process than the one that wrote it. The id SHALL NOT be derived from the question text, the options, or the sub-question list, so that re-raising a byte-identical question yields a distinct id.

#### Scenario: A single-question raise carries an id
- **WHEN** an agent calls `emit-event.sh escalation --raise-only ticket=<ID> question="Approve?" options=yes,no`
- **THEN** the appended `escalation.raised` event line has a non-empty `escalation_id` field

#### Scenario: A multi-part raise carries one id for the whole escalation
- **WHEN** an agent raises an escalation with a `sub_questions` array of three entries
- **THEN** exactly one `escalation.raised` event is written, carrying exactly one `escalation_id` for the whole escalation, not one per sub-question

#### Scenario: Two raises in the same second get different ids
- **WHEN** two `escalation.raised` events for the same ticket are written within the same whole second
- **THEN** their `escalation_id` values differ

#### Scenario: A re-raised identical question gets a new id
- **WHEN** the same ticket raises a byte-identical `question`/`options` pair a second time
- **THEN** the second `escalation.raised` event's `escalation_id` differs from the first's

#### Scenario: A raise made via `--await` carries an id too
- **WHEN** an agent raises an escalation with `--await` rather than `--raise-only`
- **THEN** the `escalation.raised` event carries an `escalation_id` in exactly the same form as the `--raise-only` case

### Requirement: Every resolution event references the `escalation_id` it resolves

Every event that resolves, or reports on the resolution of, an escalation — `escalation.answered`, `escalation.timeout`, `escalation.answer_discarded`, and `escalation.malformed` — SHALL carry the `escalation_id` of the escalation it refers to, resolved by reading the most recent `escalation.raised` event for that ticket from the event log. This SHALL hold regardless of which path writes the event: `emit-event.sh`'s own `--await`/`--wait-only` poll loops, and `concertino answer`'s post-write emission. When no `escalation.raised` event exists for the ticket at all, the event SHALL still be written, with `escalation_id` omitted rather than written as an empty or placeholder value — a missing raise is a caller error that SHALL NOT suppress the resolution record.

#### Scenario: A dashboard-resolved answer references its raise
- **GIVEN** an escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** `answer.json` is written and `--await`'s poll loop resolves it
- **THEN** the emitted `escalation.answered` event carries `escalation_id` `X`

#### Scenario: A timeout references its raise
- **GIVEN** an escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** the escalation's real deadline is reached with no answer recorded
- **THEN** the emitted `escalation.timeout` event carries `escalation_id` `X`

#### Scenario: A CLI-resolved answer references its raise
- **GIVEN** an escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** `concertino answer CON-1 approve` resolves it
- **THEN** the emitted `escalation.answered` event carries `escalation_id` `X`

#### Scenario: A discarded stale answer references the raise it was checked against
- **GIVEN** an escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** the one-time stale-`answer.json` discard check fires and writes `escalation.answer_discarded`
- **THEN** that event carries `escalation_id` `X`

#### Scenario: A malformed answer file reports against the raise
- **GIVEN** a multi-part escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** a malformed `answer.json` causes `escalation.malformed` to be written
- **THEN** that event carries `escalation_id` `X`

#### Scenario: A resolution with no prior raise is still recorded
- **WHEN** a resolution event is written for a ticket whose log contains no `escalation.raised` event at all
- **THEN** the event is still appended, with no `escalation_id` field present, rather than being suppressed or written with an empty id

### Requirement: `escalation.answered` states the channel and the source of the answer

Every `escalation.answered` event SHALL carry a `resolution_channel` field whose value is exactly one of `dashboard`, `cli`, `chat`, or `self-approved`, identifying the path that collected the answer, and an `answer_source` field whose value is exactly one of `human` or `agent-default`. `answer_source` SHALL be `human` whenever a person supplied the decision (the `dashboard`, `cli` and `chat` channels) and `agent-default` only when the loop proceeded on its own default with no human decision (the `self-approved` channel). An answer resolved by `emit-event.sh`'s own poll loop observing `answer.json` SHALL be recorded as `dashboard`, since that file is the dashboard's write path.

#### Scenario: A dashboard answer is labelled
- **WHEN** `--await`'s poll loop observes a complete `answer.json` and emits `escalation.answered`
- **THEN** that event has `resolution_channel` `"dashboard"` and `answer_source` `"human"`

#### Scenario: A CLI answer is labelled
- **WHEN** `concertino answer CON-1 approve` resolves an escalation with no explicit channel selector
- **THEN** the emitted `escalation.answered` event has `resolution_channel` `"cli"` and `answer_source` `"human"`

#### Scenario: A chat answer is labelled
- **WHEN** an answer collected in chat is recorded through `concertino answer`'s chat channel selector
- **THEN** the emitted `escalation.answered` event has `resolution_channel` `"chat"` and `answer_source` `"human"`

#### Scenario: A self-approval is distinguishable from a human answer
- **WHEN** an `escalation.answered` event is recorded for a decision the loop took on its own default rather than from a human
- **THEN** that event has `resolution_channel` `"self-approved"` and `answer_source` `"agent-default"`

#### Scenario: An illegal channel value is refused rather than recorded
- **WHEN** a caller supplies a `resolution_channel` value outside the four legal values
- **THEN** the command fails with a non-zero exit and a message naming the legal values, and no `escalation.answered` event is appended

### Requirement: `escalation.timeout` means no human answered and carries no resolution channel

An `escalation.timeout` event SHALL continue to mean exactly "the escalation's own deadline was reached with no answer recorded", and SHALL NOT carry a `resolution_channel` field. A resolution that arrives after a timeout was already recorded SHALL be written as an ordinary `escalation.answered` carrying the same `escalation_id` and its own `resolution_channel` — the late answer SHALL NOT be suppressed, and the earlier `escalation.timeout` SHALL NOT be rewritten or retracted. The presence of both events against one `escalation_id` is therefore the structural record of "timed out on the dashboard, then answered elsewhere", distinguishable from a timeout that was never answered at all.

#### Scenario: A timeout carries no channel
- **WHEN** an `escalation.timeout` event is emitted
- **THEN** it has an `escalation_id` and no `resolution_channel` field

#### Scenario: A chat answer after a timeout is recorded, not suppressed
- **GIVEN** `escalation.timeout` was already recorded for `escalation_id` `X`
- **WHEN** the human's answer is subsequently collected in chat and recorded
- **THEN** an `escalation.answered` event carrying `escalation_id` `X` and `resolution_channel` `"chat"` is appended, and the earlier `escalation.timeout` event is left exactly as written

#### Scenario: An unanswered timeout is distinguishable from an answered-elsewhere one
- **WHEN** a consumer reads a run whose log has an `escalation.timeout` for `escalation_id` `X` and no `escalation.answered` for `X`
- **THEN** that escalation is identifiable as never answered, whereas a log that also has an `escalation.answered` for `X` is identifiable as answered off-dashboard

### Requirement: A chat-collected answer is recorded through the guarded authority, not a hand-written event

`concertino answer` SHALL accept an explicit channel selector that records a chat-collected answer as `resolution_channel` `"chat"`, so the chat path writes `answer.json` through `lib/ui/store.js`'s existing `writeAnswer`/`writeSubAnswer` guard and records `escalation.answered` through the same delegated emission every other channel uses. `core/roles/orchestrator.md` SHALL instruct the chat fallback to use that command rather than composing a raw `emit-event.sh escalation.answered` invocation by hand, so the chat path's record is produced mechanically rather than depending on prose being followed exactly. The command's existing first-write-wins refusal SHALL apply to the chat channel unchanged.

#### Scenario: A chat-answered run records an answer rather than a timeout
- **GIVEN** an escalation was raised for `CON-1` and no answer reached the dashboard
- **WHEN** the human answers in chat and that answer is recorded through the chat channel
- **THEN** the run's log contains an `escalation.answered` event for that escalation's `escalation_id` with `resolution_channel` `"chat"`

#### Scenario: The chat channel writes through the shared answer authority
- **WHEN** an answer is recorded through the chat channel
- **THEN** `answer.json` is written via `store.js`'s `writeAnswer`/`writeSubAnswer`, with the same atomicity and first-write-wins guarantees as a dashboard-given answer

#### Scenario: A chat answer losing a race to the dashboard is refused
- **GIVEN** an escalation for `CON-1` was already answered from the dashboard
- **WHEN** an answer is subsequently recorded through the chat channel for the same escalation
- **THEN** the command reports the existing "already answered" refusal and appends no second `escalation.answered` event

#### Scenario: The orchestrator role points the chat fallback at the command
- **WHEN** a reader reaches the chat-fallback handling in the rendered orchestrator role
- **THEN** it instructs recording the answer via `concertino answer` with the chat channel, rather than composing a raw `emit-event.sh escalation.answered` call by hand

### Requirement: Adding these fields preserves every existing escalation contract

Adding `escalation_id`, `resolution_channel` and `answer_source` SHALL NOT change `emit-event.sh`'s existing stdout contract on any path (the answer text printed by a resolving `--await`, one line per sub-answer in sub-question order for a multi-part resolution), its exit codes, the resolution semantics of `answer.json`'s `complete` field, or the number of events emitted for any escalation. A multi-part escalation SHALL continue to resolve with exactly one `escalation.answered` event. A telemetry failure while writing any of these fields SHALL NOT fail the calling script or change a delivery run's outcome.

#### Scenario: Resolving stdout is unchanged
- **WHEN** a single-question `--await` call is resolved by an answer
- **THEN** it prints exactly the answer text to stdout and exits 0, byte-for-byte as before this change

#### Scenario: Multi-part resolving stdout is unchanged
- **WHEN** a multi-part `--await` call is resolved by a complete `answer.json`
- **THEN** it prints one sub-answer per line in sub-question order and exits 0, exactly as before this change

#### Scenario: A multi-part escalation still resolves exactly once
- **WHEN** a three-sub-question escalation is fully answered
- **THEN** exactly one `escalation.answered` event is appended for it, carrying the full `sub_answers` array and the parent `escalation_id`

#### Scenario: An incomplete answer file still does not resolve
- **WHEN** `answer.json` for a multi-part escalation has `complete: false`
- **THEN** the poll loop keeps waiting and emits no `escalation.answered`, exactly as before this change

### Requirement: Consumers tolerate events that carry no `escalation_id`

Historical events SHALL NOT be rewritten or migrated. Every consumer of the escalation event family SHALL keep a defined, non-crashing behavior for an `escalation.raised` or resolution event that carries no `escalation_id`, so a log written before this change continues to render.

#### Scenario: A pre-change log still renders
- **WHEN** a consumer reads a run whose escalation events predate this change and carry no `escalation_id`
- **THEN** it renders that run's escalation history without error, using its documented id-less fallback behavior

#### Scenario: A mixed log renders
- **WHEN** a run's log contains both id-bearing and id-less escalation events
- **THEN** both are rendered, each by the path appropriate to it
