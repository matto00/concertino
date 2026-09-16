# escalation-answer-cli Specification

## Purpose
Defines `concertino answer <ticket> <value>`, the chat-channel counterpart to the dashboard's escalation-answering controller: a thin CLI wrapper over `lib/ui/store.js`'s `writeAnswer`/`writeSubAnswer` that also self-records `escalation.answered` whenever its own write resolves the escalation, so a chat-given answer and a dashboard-given answer share one authoritative resolution.

## Requirements

### Requirement: `concertino answer` writes through the same authority as the dashboard
`bin/concertino answer <ticket> <value>` SHALL call `lib/ui/store.js`'s `writeAnswer(root, ticket, value)` — the exact function `lib/ui/controllers/escalation.js`'s dashboard write path already calls — rather than constructing `answer.json` independently. A second, `--sub <index> --total <n>` form SHALL call `writeSubAnswer(root, ticket, index, value, total)` for answering one step of a multi-part (wizard) escalation.

#### Scenario: A chat-given single-question answer is written through the shared authority
- **WHEN** `concertino answer CON-1 approve` is run against a standing escalation for `CON-1`
- **THEN** `answer.json` is written via `writeAnswer`, identical in shape and atomicity guarantees to a dashboard-given answer for the same escalation

#### Scenario: A chat-given multi-part sub-answer is written through the shared authority
- **WHEN** `concertino answer CON-1 rename --sub 1 --total 2` is run against a standing multi-part escalation
- **THEN** `answer.json` is updated via `writeSubAnswer` exactly as the dashboard wizard's own sub-answer write would

### Requirement: A second answer to an already-resolved escalation is refused, not applied
`concertino answer` SHALL surface `writeAnswer`/`writeSubAnswer`'s existing `reason: 'answered'` refusal (rather than swallowing it or reporting success) when the targeted escalation was already resolved by another writer (the dashboard, or a race with another `concertino answer` invocation).

#### Scenario: A losing `concertino answer` call reports the refusal
- **GIVEN** an escalation for `CON-1` was already answered via the dashboard
- **WHEN** `concertino answer CON-1 deny` is subsequently run for the same escalation
- **THEN** the command reports that the escalation was already answered and does not exit as if its own value had been recorded

### Requirement: `concertino answer` is a thin CLI wrapper over `store.js` for `answer.json` itself
`lib/cli/answer.js` (dispatched from `bin/concertino answer`) SHALL contain no independent logic for constructing or locking `answer.json` — all read-modify-write and atomicity behavior for that file SHALL remain solely in `lib/ui/store.js`'s existing exports. (This does not extend to event-log writing — see the following requirement — which is a distinct concern delegated to `emit-event.sh`'s own existing, unmodified mechanism, not reimplemented either.)

#### Scenario: The implementation delegates entirely to `store.js` for `answer.json`
- **WHEN** `lib/cli/answer.js` is read
- **THEN** its only interaction with `answer.json` is via calling `store.js`'s exported `writeAnswer`/`writeSubAnswer` — no separate file-write, lock, or JSON-shape logic for that file is duplicated

### Requirement: `concertino answer` records `escalation.answered` when, and only when, its write resolves the escalation
Per design.md Decision 4a (revised), `concertino answer` SHALL, immediately after a successful (non-refused) `writeAnswer`/`writeSubAnswer` call, invoke `emit-event.sh`'s existing generic non-blocking event-write path (`emit-event.sh escalation.answered ticket=<id> answer=<value>`, or `sub_answers=<array>` for a multi-part completion — no `--await`/`--raise-only`/`--wait-only` flag, the same generic write-one-event-and-exit mechanism every other event kind already uses) — but only when that write actually resolves the escalation: unconditionally for a single-question answer, and only when `writeSubAnswer`'s own returned `complete` is `true` for a multi-part sub-answer. `concertino answer` SHALL contain no independent JSON-line-writing or `events.jsonl`-appending logic of its own — this event write, like the `answer.json` write, is delegated to an existing canonical implementation (`emit-event.sh`), not duplicated.

That emission SHALL additionally carry the resolution-provenance fields defined by the `escalation-resolution-telemetry` capability: the `escalation_id` of the escalation being resolved, read back from the most recent `escalation.raised` event for that ticket (the same event this command already reads to learn the escalation's real multi-part shape, so no second source of truth is introduced); a `resolution_channel`; and an `answer_source`. The command SHALL accept an explicit channel selector choosing among the legal `resolution_channel` values, defaulting to `cli` when none is given, so that an answer collected in chat is recorded as `chat` rather than being indistinguishable from an operator-typed CLI answer. An unrecognized channel value SHALL be refused with a non-zero exit before any write occurs.

#### Scenario: A resolving single-question answer records `escalation.answered`
- **WHEN** `concertino answer CON-1 approve` succeeds against a single-question escalation
- **THEN** `events.jsonl` gains an `escalation.answered` event for `CON-1` carrying `answer: "approve"`, written by `concertino answer` itself, immediately following the successful `answer.json` write

#### Scenario: A completing multi-part sub-answer records `escalation.answered` with the full set of sub-answers
- **GIVEN** a multi-part escalation with `total=2`, one sub-question already answered
- **WHEN** `concertino answer CON-1 rename --sub 1 --total 2` succeeds and makes `writeSubAnswer`'s returned `complete` `true`
- **THEN** `events.jsonl` gains an `escalation.answered` event for `CON-1` carrying the full `sub_answers` array (both slots), not just the value of this last sub-answer

#### Scenario: A partial multi-part sub-answer records nothing in `events.jsonl`
- **GIVEN** a multi-part escalation with `total>1`, at least one sub-question still unanswered after this write
- **WHEN** `concertino answer CON-1 rename --sub 0 --total 2` succeeds but `writeSubAnswer` returns `complete: false`
- **THEN** `answer.json` reflects the new sub-answer, but `events.jsonl` gains no new event from this command — the escalation remains open

#### Scenario: A refused write records nothing in `events.jsonl`
- **GIVEN** an escalation for `CON-1` was already answered
- **WHEN** `concertino answer CON-1 deny` is subsequently run and refused (`reason: 'answered'`)
- **THEN** `events.jsonl` gains no new event from this command — only the write that actually won the race ever causes an event to be recorded by this path

#### Scenario: The recorded event references the escalation it resolved
- **GIVEN** an escalation was raised for `CON-1`, yielding `escalation_id` `X`
- **WHEN** `concertino answer CON-1 approve` succeeds
- **THEN** the emitted `escalation.answered` event carries `escalation_id` `X`

#### Scenario: A CLI answer defaults to the `cli` channel
- **WHEN** `concertino answer CON-1 approve` succeeds with no channel selector given
- **THEN** the emitted `escalation.answered` event has `resolution_channel` `"cli"` and `answer_source` `"human"`

#### Scenario: A chat-collected answer is recorded as the `chat` channel
- **WHEN** `concertino answer CON-1 approve` is run with the channel selector set to chat, against a standing escalation
- **THEN** the emitted `escalation.answered` event has `resolution_channel` `"chat"` and `answer_source` `"human"`

#### Scenario: An unrecognized channel is refused before any write
- **WHEN** `concertino answer CON-1 approve` is run with a channel selector value outside the legal set
- **THEN** the command exits non-zero naming the legal values, and neither `answer.json` nor `events.jsonl` is modified
