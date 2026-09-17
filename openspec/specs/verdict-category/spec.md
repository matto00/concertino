# verdict-category Specification

## Purpose
Defines the required four-value `category` enum on every `verdict` telemetry event, so the recorded gate chain states what KIND of objection each review raised rather than only its pass/refute outcome, and so the objection profile of a reviewing role can be counted over time instead of argued about.

## Requirements

### Requirement: Every verdict event carries a category from a closed enum

Every `verdict` event emitted by `core/scripts/emit-event.sh` SHALL carry a `category` field whose value is exactly one of `mechanical`, `spec-divergence`, `design-judgment`, or `intent-mismatch`. A `verdict` invocation with a `category` outside that set, or with no `category` at all, SHALL be refused with a non-zero exit and a message naming the legal values, and SHALL append no `verdict` event. The enum SHALL be closed: no free-text reason field is accepted in its place, because classifying free text would require a model and is therefore unauditable.

#### Scenario: Each legal category is accepted
- **WHEN** a `verdict` event is emitted with `category` set to `mechanical`, `spec-divergence`, `design-judgment`, or `intent-mismatch`
- **THEN** the event is appended carrying that `category` value verbatim, and the command exits zero

#### Scenario: An unknown category is refused
- **WHEN** a `verdict` event is emitted with a `category` value outside the four legal values
- **THEN** the command exits non-zero with a message naming the legal values, and no `verdict` event is appended

#### Scenario: A missing category is refused
- **WHEN** a `verdict` event is emitted with no `category` argument
- **THEN** the command exits non-zero with a message naming the legal values, and no `verdict` event is appended

#### Scenario: Category is required only for verdict events
- **WHEN** an event of any kind other than `verdict` is emitted with no `category` argument
- **THEN** it is appended exactly as before this change, and the command exits zero

#### Scenario: A category on a non-verdict event is still validated
- **WHEN** an event of a kind other than `verdict` is emitted with a `category` value outside the four legal values
- **THEN** the command exits non-zero rather than recording a meaningless category, and no event is appended

### Requirement: Refusing a verdict never strands an auditor's teardown lease

A `verdict` invocation with `role=auditor` releases the auditor's script-owned Phase-4 teardown lease on recognition of the call shape. That release SHALL still occur when the invocation is subsequently refused for a missing or illegal `category`, so a refused auditor verdict can never strand a run behind a lease clearable only by a forced teardown.

#### Scenario: A refused auditor verdict still releases the lease
- **WHEN** a `verdict` event with `role=auditor` is emitted with a missing or illegal `category` and is refused
- **THEN** the auditor's teardown lease is released exactly as it would be for an accepted verdict, and the command still exits non-zero

### Requirement: The verdict-emitting roles state the enum and when each value applies

Each role definition that emits a `verdict` event — `core/roles/evaluator.md`, `core/roles/skeptic.md`, and `core/roles/auditor.md` — SHALL state the four legal category values, SHALL state when each applies, and SHALL pass `category=` on its own verdict emission. A role definition that does not emit `verdict` events SHALL NOT be required to state the enum.

#### Scenario: A verdict-emitting role states the enum
- **WHEN** a reader reaches the verdict-emission step of the rendered evaluator, skeptic, or auditor role
- **THEN** that step passes a `category=` argument, and the role states all four legal values and when each applies

#### Scenario: A role that emits no verdicts is unaffected
- **WHEN** a reader reads the rendered executor role
- **THEN** it neither emits a `verdict` event nor is required to state the category enum

### Requirement: Historical uncategorized verdict events remain readable

Historical events SHALL NOT be rewritten or migrated. Every consumer of `verdict` events SHALL keep a defined, non-crashing behavior for a `verdict` event that carries no `category`, so event logs written before this change continue to render and continue to satisfy the gate checks that read them.

#### Scenario: A pre-change log still renders
- **WHEN** a consumer reads a run whose `verdict` events predate this change and carry no `category`
- **THEN** it renders that run without error, and any gate check reading those verdicts reaches the same outcome as before this change

#### Scenario: A mixed log still renders
- **WHEN** a run's log contains both categorized and uncategorized `verdict` events
- **THEN** both are rendered, and neither is discarded as malformed

#### Scenario: No migration is performed
- **WHEN** this change is applied
- **THEN** no existing `.concertino/runs/**/events.jsonl` file is rewritten, reordered, or backfilled
