## MODIFIED Requirements

### Requirement: The orchestrator triages a suggested follow-up before escalating, via one shared sub-procedure
`core/roles/orchestrator.md` SHALL define a single named sub-procedure
("Triaging a suggested follow-up") that: states a `description`/`files` for
the suggestion; states its own `ac_relevant`/`effort` judgment; runs
`triage-followup.sh` and captures its stdout; raises
`emit-event.sh escalation --await` with that output as `context=` (falling
back to raising without `context=` if the script fails, per the existing
`gather-escalation-context.sh` fallback convention — never blocking the
escalation itself on a failed triage call) and `options=fold-in,standalone,discard`.
All three of the workflow's follow-up-surfacing points — Phase 3
Delivery's presentation of non-blocking evaluator/skeptic suggestions that
name discrete additional work, Phase 4 step 4's post-cleanup observation,
and Phase 1 Planning's per-question triage for a design ticket (see the
`design-ticket-type` capability) — SHALL invoke this sub-procedure by name
rather than duplicating its steps.

#### Scenario: A reader finds one shared procedure, not three reimplementations
- **WHEN** a reader compares the Phase 3 delivery-time suggestion handling,
  the Phase 4 post-cleanup step, and design-ticket Planning's per-question
  triage in the rendered orchestrator role
- **THEN** all three reference the same named "Triaging a suggested
  follow-up" sub-procedure rather than each containing its own copy of the
  triage steps

#### Scenario: A failed triage call still lets the escalation proceed
- **WHEN** `triage-followup.sh` fails for any reason during the triage
  sub-procedure
- **THEN** the orchestrator still raises the escalation, with
  `options=fold-in,standalone,discard`, but without a `context=` field

#### Scenario: Design-ticket Planning triages with files=unknown
- **WHEN** the orchestrator triages a design ticket's answered question
  during Planning, before any code exists for the change
- **THEN** it invokes the sub-procedure with `files=unknown`, exactly as
  the existing `triage-followup.sh` contract already supports for a
  suggestion naming no discrete files
