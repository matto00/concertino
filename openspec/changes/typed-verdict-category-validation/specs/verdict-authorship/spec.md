## Purpose

Defines which role may author a `verdict` telemetry event and how two log entries recorded for a single review are made mechanically distinguishable, so the gate chain a driver audits before a merge counts one entry per review and an orchestrator-written verdict cannot pass as a reviewer's own.

## ADDED Requirements

### Requirement: The orchestrator never emits verdict events

`core/roles/orchestrator.md` SHALL state plainly and unconditionally that the orchestrator never emits a `verdict` event for any role, gate, or outcome. This prohibition SHALL NOT be scoped to representing an owner override of a budget-exhausted final gate; that narrower existing statement is widened to the general rule. The orchestrator's own accounting of a verdict SHALL remain what it already is — recording the returned verdict in `workflow-state.md` — never an additional log entry.

#### Scenario: The orchestrator role states the general prohibition
- **WHEN** a reader reaches the verdict-handling guidance in the rendered orchestrator role
- **THEN** it states that the orchestrator never emits a `verdict` event, not merely that it must not emit one to represent an override

#### Scenario: Recording a verdict in workflow state is still required
- **WHEN** a gate returns a verdict to the orchestrator
- **THEN** the orchestrator still records it in `workflow-state.md`, and emits no `verdict` event of its own

### Requirement: A skeptic verdict states which gate it belongs to

Every `verdict` event emitted with `role=skeptic` SHALL carry a `gate` field whose value is exactly one of `design` or `final`, identifying which of the two skeptic gates the verdict resolves. A skeptic `verdict` invocation with a missing or illegal `gate` SHALL be refused with a non-zero exit and a message naming the legal values, and SHALL append no event. This makes two entries recorded for one review detectable as a duplicate of the same ticket, role, and gate, rather than distinguishable only by the incidental presence or absence of a field.

#### Scenario: A design-gate skeptic verdict states its gate
- **WHEN** a `verdict` event is emitted with `role=skeptic` and `gate=design`
- **THEN** the event is appended carrying `gate` `"design"`, and the command exits zero

#### Scenario: A final-gate skeptic verdict states its gate
- **WHEN** a `verdict` event is emitted with `role=skeptic` and `gate=final`
- **THEN** the event is appended carrying `gate` `"final"`, and the command exits zero

#### Scenario: A skeptic verdict with no gate is refused
- **WHEN** a `verdict` event is emitted with `role=skeptic` and no `gate` argument
- **THEN** the command exits non-zero with a message naming the legal values, and no event is appended

#### Scenario: A skeptic verdict with an illegal gate is refused
- **WHEN** a `verdict` event is emitted with `role=skeptic` and a `gate` value outside `design` and `final`
- **THEN** the command exits non-zero with a message naming the legal values, and no event is appended

#### Scenario: Other roles' verdicts are not required to state a gate
- **WHEN** a `verdict` event is emitted with `role=evaluator` or `role=auditor` and no `gate` argument
- **THEN** the event is appended exactly as before this change, and the command exits zero

#### Scenario: A duplicate record for one review is detectable
- **WHEN** a run's log contains two `verdict` events sharing the same ticket, `role=skeptic`, and `gate` value for a single review
- **THEN** a consumer counting reviews can identify them as duplicate records of one review rather than as two distinct reviews

### Requirement: Authorship is enforced by instruction and detectability, not by an emitter identity check

The `role` field on a `verdict` event is asserted by the caller, and `core/scripts/emit-event.sh` has no access to the identity of the process invoking it. The emitter SHALL therefore NOT claim to verify that a verdict was authored by the role it names, and this capability SHALL NOT be described as preventing a forged verdict. Enforcement is the role-definition prohibition above, plus the duplicate-detectability the required `gate` field provides.

#### Scenario: An emitter-side author check is not claimed
- **WHEN** a reader reads this capability or the emitter's own documentation
- **THEN** neither claims that `emit-event.sh` verifies the authoring role, and both locate enforcement in the role prohibition and in duplicate detectability

#### Scenario: A caller-asserted role is still recorded verbatim
- **WHEN** a `verdict` event is emitted with any `role` value
- **THEN** that value is recorded verbatim, since the emitter cannot and does not adjudicate it
