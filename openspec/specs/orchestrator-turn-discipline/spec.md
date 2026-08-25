# orchestrator-turn-discipline Specification

## Purpose
Defines the orchestrator role's turn-boundary contract: it must never return control while a sub-agent it spawned is outstanding, why that is harmless at the top level but fatal when the orchestrator itself runs as a sub-agent, and where each harness (Claude Code, Codex) states and handles that constraint.
## Requirements
### Requirement: The orchestrator role states the top-level-vs-sub-agent turn distinction, explained rather than asserted
`core/roles/orchestrator.md`'s harness-resume guidance SHALL explain, not merely
assert, why the orchestrator must never return control while a sub-agent it
spawned is outstanding: a top-level `/concertino-deliver` session's own
process is not destroyed by a long-running blocking spawn/resume call — it
persists and resumes when that call returns — but if the orchestrator role
is itself dispatched as a sub-agent (a fleet driver, a queue runner, or
another orchestrator), returning control before that call resolves is fatal,
because a suspended sub-agent is never resumed by any external event and its
own children do not survive its turn ending either. This explanation SHALL
NOT state or imply that the top-level session "receives the sub-agent's
notification whenever it arrives" or otherwise describe an automatic wake
signal — the only way the top-level session's blocking call resolves is by
that same call returning, exactly as for a nested sub-agent; the difference
between the two cases is what happens to the *session* if it wrongly ends
its turn early, not how the result is delivered.

#### Scenario: A reader can explain why the rule exists, not just recite it
- **WHEN** a fresh model reads the "Harness resume model" section of the
  rendered orchestrator role
- **THEN** it can state, in its own words, both why a top-level session is
  not destroyed by waiting out a long blocking call and why the identical
  early return is fatal when the orchestrator is itself a sub-agent — not
  just recite "never end your turn" without the reasoning

#### Scenario: The explanation does not license an early return at the top level
- **WHEN** a reader checks whether the top-level-vs-sub-agent explanation
  could be read as permission to end the turn while a spawn/resume call is
  still outstanding, because the session "persists" either way
- **THEN** the text states plainly that "persists" describes the session
  surviving the wait, never a reason to end the turn before the call
  returns, and contains no language implying the result "arrives" via any
  channel other than that same call returning

### Requirement: The turn-discipline reminder is repeated at each spawn/resume point, not only in a preamble
`core/roles/orchestrator.md` SHALL restate a short, concrete form of the
turn-discipline rule immediately next to each instruction that spawns or
resumes a sub-agent — the Phase 1 skeptic design-gate spawn, the Phase 2
cycle-1 executor/evaluator spawns, the Phase 2 cycle-2+ executor/evaluator
resumes, and the final skeptic gate (including its executor resume on
REFUTE) — rather than relying solely on a single explanation stated once in
a preamble that a compacted session could strand.

#### Scenario: Each spawn instruction carries its own reminder
- **WHEN** a reader reaches any of the orchestrator role's spawn or resume
  instructions (skeptic design gate, cycle-1 executor/evaluator spawn,
  cycle-2+ resume, final skeptic gate)
- **THEN** that instruction itself states the orchestrator must wait for the
  spawned/resumed agent within its own turn before proceeding, without
  requiring the reader to still have the preamble in context

### Requirement: The role states an explicit fallback when the harness cannot wait inline
`core/roles/orchestrator.md` SHALL state what to do if the harness genuinely
cannot wait for a sub-agent inline: poll for the artefact the sub-agent was
told to produce (its evaluation report, a commit on the branch, a
skeptic-verdict file), or escalate — rather than leaving that case undefined.

#### Scenario: A harness without inline waiting still has a defined next step
- **WHEN** the orchestrator's harness cannot block on a spawned sub-agent
  inline
- **THEN** the role instructs it to poll for the sub-agent's expected
  artefact (or escalate) rather than returning control speculatively

### Requirement: The Codex adapter is checked for the same gap and the finding is recorded
The Codex adapter SHALL be checked for the same never-end-your-turn gap
(`adapters/codex/header.md`, `adapters/codex/prompt.md`, and the codex branch
of the rendered harness-resume text). Since the default Codex flow runs every
role sequentially in a single thread with no spawn/suspend boundary, the
adapter SHALL document that this is why the default flow does not reproduce
the gap, while also documenting the one place an equivalent risk could still
appear: the optional worker-dispatch path (`.codex/agents/*.toml` +
`spawn_agents_on_csv`) described in `docs/harness-capabilities.md`, which
carries the identical risk if a dispatching thread returns before the
dispatched worker reports its result.

#### Scenario: A Codex-path reader understands both why the default flow is safe and where the risk still exists
- **WHEN** a reader reviews the Codex adapter's flow description
- **THEN** it states plainly why the sequential single-thread default cannot
  hit the CON-10 failure mode, and separately calls out that the optional
  worker-dispatch path carries the same risk as Claude Code's sub-agent
  dispatch if used

### Requirement: `docs/harness-capabilities.md` records the turn-discipline constraint as a harness-behavior fact
`docs/harness-capabilities.md` SHALL document the never-end-your-turn
constraint as a fact about harness behavior (alongside the existing
capability matrix and Codex degraded-flow notes), distinguishing the
top-level-session case from the nested-sub-agent case, rather than leaving it
only as an instruction inside `core/roles/orchestrator.md`.

#### Scenario: The capabilities doc names the constraint independently of the role file
- **WHEN** a reader consults `docs/harness-capabilities.md` to understand
  Claude Code vs. Codex behavior differences
- **THEN** they find a section stating that a suspended agent cannot resume
  itself, that its children do not survive its turn ending, and that this
  makes waiting free for a top-level session but fatal for the same role
  dispatched as a sub-agent

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

### Requirement: A single, narrow exception permits ending a turn to bubble a pending escalation
`core/roles/orchestrator.md`'s "Harness resume model" section SHALL state exactly one exception to "never end your turn while artifacts of the current ticket are still incomplete": bubbling a `PENDING_ESCALATION` the orchestrator has just raised (via `--raise-only`) or received from a child it spawned, up to its own parent — and only once that escalation's full state is durably persisted in `workflow-state.md` so a cold re-spawn can reconstruct it. This exception SHALL be worded to state explicitly that it applies only when the orchestrator has no outstanding spawned child of its own at the moment of the return, and that it does not loosen the existing rule for any other case — most importantly, ending a turn while waiting on a spawned executor, evaluator, skeptic, or auditor remains exactly as forbidden as before.

#### Scenario: The exception's precondition is stated explicitly
- **WHEN** a reader reaches the turn-discipline exception in the rendered orchestrator role
- **THEN** it states plainly that the only permitted early return is to bubble a pending escalation, that this requires no outstanding spawned child at the moment of the return, and that `workflow-state.md` must already hold everything needed to reconstruct the pending escalation before the return happens

#### Scenario: The exception is distinguished from the CON-10/CON-15 failure mode
- **WHEN** a reader compares the new exception against the original "never end your turn while a sub-agent is outstanding" rule
- **THEN** the role doc explains why bubbling a pending escalation is not the same failure mode: nothing is orphaned by the return, because the escalation's full state is already persisted and the parent receiving the return is the one now responsible for resuming the orchestrator via `SendMessage`

#### Scenario: The exception does not cover returning while a spawned child is outstanding
- **WHEN** a reader checks whether the new exception permits returning while an executor, evaluator, skeptic, or auditor spawned by this orchestrator is still outstanding
- **THEN** the role doc states that it does not — that case remains forbidden exactly as it was before this change

### Requirement: The "waiting is free" statement does not contradict the never-end-your-turn rule
The **rendered** "Harness resume model" section SHALL NOT state or imply
that ending a turn while a spawn/resume call is outstanding is costless, or
that a sub-agent's result "will arrive" independent of that call returning
— "rendered" here meaning `core/roles/orchestrator.md`'s own text plus the
`{{block:harnessResume}}` template it interpolates for the Claude Code
harness. The section's existing accurate point — that a top-level session
is not destroyed by a long-running blocking call, unlike a nested sub-agent
session — SHALL be preserved, but reframed to describe session *persistence
across a blocking call*, never as permission to end the turn while that
call has not yet returned.

#### Scenario: The corrected text cannot be read as licensing an early return
- **WHEN** a reader reaches the "Harness resume model" section's discussion
  of why waiting is "free" at the top level
- **THEN** the text states this is a fact about the session persisting
  across the blocking call itself, not a reason to end the turn before that
  call returns, and does not use language implying an automatic arrival of
  the sub-agent's result

### Requirement: A closed enumeration of legitimate turn-ending conditions is stated beside the corrected contradiction, contrasted against an explicit waiting anti-pattern
`core/roles/orchestrator.md` SHALL state, directly beside the corrected
"waiting is free" text in the "Harness resume model" section, a closed list
of the only conditions under which the orchestrator may end its turn: (1)
the run is genuinely finished, per the existing Phase 4 "genuinely complete"
definition; (2) a decision is needed from the coordinator/human, raised as
an explicit escalation carrying both a stated question and a recommendation
— never a bare status report; (3) the existing CON-76 exception of bubbling
a `PENDING_ESCALATION` to a parent, only when no spawned child is
outstanding and full state is already persisted. Immediately beside this
list, the document SHALL name "ending a turn merely to report that a
sub-agent is in progress / working / will report back" as an explicit
anti-pattern that is never one of the three legitimate conditions.

#### Scenario: The enumeration and anti-pattern read as one contrast, next to the corrected text
- **WHEN** a reader reaches the corrected "waiting is free" passage in the
  rendered orchestrator role
- **THEN** the same passage states the three legitimate turn-ending
  conditions and names the waiting anti-pattern beside them, rather than
  requiring the reader to locate a separately-placed subsection

#### Scenario: A status-report-only turn end is identifiable as the anti-pattern
- **WHEN** a reader considers ending a turn with only a status update such as
  "the executor is now working on cycle 2, waiting for it to complete"
- **THEN** the role doc states this is never a legitimate turn-ending
  condition, and that the orchestrator must instead consume the blocking
  call's return value already in hand, or poll the sub-agent's artifact
  directly

### Requirement: The rendered role document contains no language implying an automatic completion notification
The **rendered** orchestrator role document SHALL NOT contain any language that can be read as implying a sub-agent completion notification arrives automatically, outside of the return value of the blocking spawn/resume call itself — "rendered" meaning `core/roles/orchestrator.md` **plus every `{{block:...}}` template it interpolates for the Claude Code
harness** (concretely: `harnessResume`, `ticketProvider`, `specScaffold`,
`specArtifacts`, `standaloneTicket`, `specArchive`,
`agentMergePermissionCheck`, `hygiene`, per `lib/cli/render.js`'s `block()`
function). This audit SHALL
check, across the source file and each interpolated block's Claude-branch
text, at minimum: `notif`, `report back`, `let me know`, `will send`, `wait
for it to`, the bare stem `wait`/`waiting`, `whenever it arrives`, `will
receive`, `costs nothing`, `free at the top level`, and `persists`. Any such
language found SHALL be corrected in place, without removing the document's
accurate mechanical explanations of why waiting is fatal for a nested
sub-agent (those explanations describe the *absence* of a wake signal, and
are not themselves implying-notification language). The Codex/OpenCode
branches of these same blocks, and `adapters/codex/header.md`, are out of
scope (CON-135).

#### Scenario: No sentence implies a notification will arrive unprompted
- **WHEN** the rendered orchestrator role document — source
  `core/roles/orchestrator.md` **plus its interpolated `{{block:...}}`
  templates' Claude-branch text** (per the enumeration above) — is read
  end-to-end, as it is actually assembled by `concertino sync` for the
  Claude Code harness
- **THEN** no sentence, in either the source text or any interpolated
  block's text, states or implies that the orchestrator will be notified,
  alerted, or woken automatically when a spawned sub-agent completes, other
  than by the spawn/resume call itself returning

### Requirement: The turn-discipline demonstration is orchestrator-owned and produces recorded artifact observations
A delivery run implementing this capability SHALL require the orchestrator
itself — not the executor — to demonstrate establishing a spawned/resumed
sub-agent's terminal state from artifacts alone (report file path, `git log`
commit SHA on the worktree branch, `workflow-state.md`) at least once during
its own Execution/Evaluation loop, and to record the concrete observations
(file path, commit SHA, timestamp) in the run's delivery notes. Consuming a
call's return value alone SHALL NOT be treated as satisfying this
requirement, since every prior failing run also did that.

#### Scenario: The demonstration record contains concrete, checkable observations
- **WHEN** a reader checks whether a delivery run satisfies this
  capability's demonstration requirement
- **THEN** they find, in that run's own notes, a recorded file path, commit
  SHA, and timestamp establishing a sub-agent's terminal state independent
  of the call's return value — not merely a claim that polling was possible

### Requirement: Executor and evaluator reports state what was and was not verified for this capability
Any executor or evaluator report addressing this capability's change SHALL
contain an explicit, separately-headed "What was verified / what was not
verified" section, stating plainly what evidence was actually produced and
what, if anything, could not be demonstrated end-to-end. A report MAY NOT
present a doc diff alone as sufficient evidence that the turn-discipline
behavior is fixed.

#### Scenario: A report without the required section is incomplete
- **WHEN** an executor or evaluator report for this change omits the "What
  was verified / what was not verified" section
- **THEN** the report does not satisfy this requirement, and the final-gate
  skeptic SHALL treat this as a defect requiring REFUTE

