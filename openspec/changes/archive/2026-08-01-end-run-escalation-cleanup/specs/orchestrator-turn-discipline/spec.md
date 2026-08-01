## ADDED Requirements

### Requirement: The orchestrator role defines precisely when Phase 4 is genuinely complete
`core/roles/orchestrator.md` SHALL state a precise, three-part definition of
when the orchestrator's own work is "genuinely complete": (1)
`cleanup.sh --phase4` has run to completion (worktree removed, `run.end`
emitted as its side effect), (2) the ticket has been set to Done with a
closing comment posted, and (3) the hygiene check has been run and reported.
This definition SHALL be scoped narrowly enough that it cannot be read as
license to stop before any of Planning, Execution, Evaluation, or Delivery
have completed — the mirror-image hazard `orchestrator-turn-discipline`'s
existing "never end early" requirements already close off.

#### Scenario: A reader can state exactly which three conditions must all hold
- **WHEN** a fresh model reads the "genuinely complete" definition in the
  rendered orchestrator role
- **THEN** it can state all three required conditions (cleanup script run,
  ticket Done + closing comment, hygiene check reported) and explain that
  `run.end` alone (step 1's side effect) is not sufficient, since steps 2
  and 3 are still real, required work

#### Scenario: The definition does not license stopping early in an earlier phase
- **WHEN** a reader considers whether "genuinely complete" applies during
  Planning, Execution, Evaluation, or Delivery
- **THEN** the role states plainly that it does not — the rule applies only
  once all three Phase 4 conditions hold

### Requirement: Any post-cleanup suggestion is raised through escalation, never bare chat
`core/roles/orchestrator.md` SHALL require that, once Phase 4 is genuinely
complete (per the definition above), any further suggestion, observation, or
question the orchestrator has for the human (e.g. "should I file a
follow-up ticket for X?") be raised through the standard `emit-event.sh
escalation --await` mechanism already documented for in-workflow
escalations — using a generic `question=`/`options=` call, since no
`gather-escalation-context.sh` kind fits this case — rather than as an
unstructured bare-chat question. This escalation is one-shot: at most one
such call is made per run, and it does not count against, or interact with,
any of the workflow's bounded circuit-breaker counters.

#### Scenario: A follow-up observation goes through escalation, not chat
- **WHEN** the orchestrator has a follow-up suggestion after Phase 4 is
  genuinely complete
- **THEN** it raises that suggestion via `emit-event.sh escalation --await`
  (an `escalation.raised` event, dashboard-visible) instead of asking in
  plain chat with no telemetry

#### Scenario: No suggestion means no escalation is raised
- **WHEN** the orchestrator has nothing further to suggest once Phase 4 is
  genuinely complete
- **THEN** it raises no escalation at all and proceeds directly to ending
  its turn

### Requirement: The orchestrator ends its turn once Phase 4 and any follow-up escalation are settled
`core/roles/orchestrator.md` SHALL require that once Phase 4 is genuinely
complete and any one-shot follow-up escalation (if raised) has resolved —
answered, timed out and answered via the chat fallback, or timed out with no
further action — the orchestrator emits a single terminal summary message
(what shipped, the merged PR link, and the outcome of any follow-up
question) and then ends its turn: no further tool calls, no additional
open-ended questions, no continued conversation inviting a reply.

#### Scenario: The orchestrator stops after its terminal summary
- **WHEN** Phase 4 is genuinely complete and any follow-up escalation has
  resolved
- **THEN** the orchestrator's next and final action is a terminal summary
  message, after which it makes no further tool calls and asks no further
  open-ended question

#### Scenario: A resolved follow-up escalation does not spawn a second one
- **WHEN** a one-shot follow-up escalation has already resolved (answered or
  timed out)
- **THEN** the orchestrator does not raise a second follow-up escalation
  before ending its turn
