## MODIFIED Requirements

### Requirement: Any post-cleanup suggestion is raised through escalation, never bare chat
`core/roles/orchestrator.md` SHALL require that, once Phase 4 is genuinely
complete (per the definition above), any further suggestion, observation, or
question the orchestrator has for the human (e.g. "should I file a
follow-up ticket for X?") be raised through the "Triaging a suggested
follow-up" sub-procedure (`followup-triage` capability) — running
`triage-followup.sh` to compute a fold-in/standalone recommendation and
raising it as an `emit-event.sh escalation --await` call with that output as
`context=` and `options=fold-in,standalone,discard` — rather than as an
unstructured bare-chat question or a generic `question=`/`options=` call.
This escalation is one-shot: at most one such call is made per run, and it
does not count against, or interact with, any of the workflow's bounded
circuit-breaker counters.

#### Scenario: A follow-up observation goes through the triage sub-procedure, not bare chat
- **WHEN** the orchestrator has a follow-up suggestion after Phase 4 is
  genuinely complete
- **THEN** it runs the "Triaging a suggested follow-up" sub-procedure and
  raises the resulting escalation via `emit-event.sh escalation --await`
  (an `escalation.raised` event, dashboard-visible, carrying the triage
  recommendation as `context=`) instead of asking in plain chat or via a
  generic un-triaged question

#### Scenario: No suggestion means no escalation is raised
- **WHEN** the orchestrator has nothing further to suggest once Phase 4 is
  genuinely complete
- **THEN** it raises no escalation at all and proceeds directly to ending
  its turn

#### Scenario: A fold-in answer at this call site reopens Execution rather than ending the run
- **GIVEN** the human selects `fold-in` for the Phase 4 post-cleanup
  observation
- **WHEN** the orchestrator proceeds
- **THEN** it follows the `followup-triage` capability's fold-in requirement
  (plan revision, re-validation, fresh design-gate `CONFIRM`) and re-enters
  Execution for the added scope rather than treating the recorded answer
  alone as sufficient
