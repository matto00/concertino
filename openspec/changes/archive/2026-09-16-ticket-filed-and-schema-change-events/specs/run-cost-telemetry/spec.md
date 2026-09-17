## MODIFIED Requirements

### Requirement: ticket and role are identified without relying on `cwd`
`report-cost.sh` SHALL determine the `ticket` field for its `run.cost` event
from the `CONCERTINO_TICKET` environment variable, never from the hook
payload's `cwd` — every concertino-launched session's root process has
`CONCERTINO_TICKET` set unconditionally by `lib/ui/prompt.js`'s
`submitTicket()` (the one spawn entry point every launch path funnels
through) at spawn time, and that value is inherited by every descendant
process, including any subagent session's own hook invocation, by ordinary OS
environment-variable inheritance. `report-cost.sh` SHALL determine the `role`
field from the hook payload's `agent_type` field when present (stripping the
`concertino-` prefix Concertino's own agent definitions are named with, e.g.
`concertino-executor` -> `executor`), and SHALL default `role` to
`orchestrator` when `agent_type` is absent from the payload — which is always
the case for a `SessionEnd` firing (the root/orchestrator session's own
firing) and never the case for a `SubagentStop` firing.

The `role` value `report-cost.sh` emits SHALL always lie within the closed
role set enforced on emit (see the `emit-role-validation` capability). The
`SubagentStop` hook fires for EVERY Task-tool subagent of a concertino
session, not only Concertino's own `concertino-<role>` agents, so an
`agent_type` naming a non-Concertino subagent (for example a general-purpose
or exploratory agent spawned during the same session) would otherwise yield
an out-of-set `role` and have its `run.cost` event refused, silently losing
cost telemetry for exactly the sessions where such agents are most used.
When the stripped `agent_type` is not one of the five agent roles,
`report-cost.sh` SHALL therefore record a `role` drawn from the closed set
rather than the raw value, and SHALL preserve the raw `agent_type` verbatim
in a separate field that is not subject to role validation, so no
information is lost and no grouping key is polluted. Discarding the raw
value, or emitting it as `role`, SHALL NOT satisfy this requirement.

#### Scenario: Root orchestrator session ends
- **WHEN** `SessionEnd` fires for the orchestrator's own top-level session,
  whose hook payload carries no `agent_type` field
- **THEN** the emitted `run.cost` event's `role` field is `orchestrator`

#### Scenario: A subagent completes a turn
- **WHEN** `SubagentStop` fires for a Task-tool subagent whose hook payload
  carries `agent_type: "concertino-executor"`
- **THEN** the emitted `run.cost` event's `role` field is `executor`

#### Scenario: A non-Concertino subagent's cost is still recorded
- **WHEN** `SubagentStop` fires for a subagent whose `agent_type` does not
  name one of the five Concertino agent roles
- **THEN** the emitted `run.cost` event carries a `role` within the closed
  role set, preserves the raw `agent_type` in its own separate field, is
  appended rather than refused, and its token fields are unchanged

#### Scenario: Cost telemetry is never lost to role validation
- **WHEN** any `run.cost` event is emitted by `report-cost.sh`
- **THEN** it is never refused on account of an out-of-set `role`
