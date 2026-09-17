## ADDED Requirements

### Requirement: role is validated on emit against a closed set

`core/scripts/emit-event.sh` SHALL validate the `role` it is about to record against a closed set, and SHALL refuse an unrecognised value with a non-zero exit and a message naming the legal values, appending no event. This prevents a misspelled role from being recorded, which silently splits every subsequent grouping by role.

The legal set SHALL comprise every role that legitimately emits events today: the five agent roles (`orchestrator`, `executor`, `evaluator`, `skeptic`, `auditor`), the `script` role that every procedure script emits under and which is the emitter's own default, and the `dashboard` role. A set restricted to the five agent roles SHALL NOT satisfy this requirement, because the procedure scripts' own emissions — including the `run.end` event that makes a run terminal — would then be refused, breaking the run.

#### Scenario: Each legitimate role is accepted
- **WHEN** an event is emitted with `role` set to any of `orchestrator`, `executor`, `evaluator`, `skeptic`, `auditor`, `script`, or `dashboard`
- **THEN** the event is appended carrying that role verbatim, and the command exits zero

#### Scenario: A misspelled role is refused
- **WHEN** an event is emitted with `role=orchestorator`
- **THEN** the command exits non-zero naming the legal values, and no event is appended

#### Scenario: The emitter's own default role is accepted
- **WHEN** an event is emitted by a procedure script that sets no explicit role, so the emitter's default applies
- **THEN** the event is appended with `role` recorded as `script`, and the command exits zero

#### Scenario: A terminal run.end from a procedure script is never refused
- **WHEN** `cleanup.sh` emits `run.end` under the `script` role
- **THEN** the event is appended and the run becomes terminal, exactly as before this change

### Requirement: Refusing an event for an invalid role never strands an auditor's teardown lease

A `verdict` invocation with `role=auditor` releases the auditor's script-owned Phase-4 teardown lease on recognition of the call shape. Because role validation can refuse an invocation, that refusal SHALL NOT occur before the lease release, so no refused invocation can strand a run behind a lease clearable only by a forced teardown. This extends the guarantee already required for a refused `category` to this new refusal.

#### Scenario: A refused invocation still releases the lease
- **WHEN** an invocation that would release the auditor's lease is refused by role validation
- **THEN** the lease is released exactly as it would be for an accepted event, and the command still exits non-zero

### Requirement: Historical events carrying out-of-set roles remain readable

Historical events SHALL NOT be rewritten, reordered, or backfilled to conform to the closed set. Every consumer SHALL keep a defined, non-crashing behaviour for an event whose recorded `role` is outside the set, so logs written before this change continue to render and continue to satisfy the checks that read them.

#### Scenario: A pre-change log containing a misspelled role still renders
- **WHEN** a consumer reads a run whose historical events include a `role` outside the closed set
- **THEN** it renders that run without error, and any check reading those events reaches the same outcome as before this change

#### Scenario: No migration is performed
- **WHEN** this change is applied
- **THEN** no existing event log file is rewritten, reordered, or backfilled
