## MODIFIED Requirements

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

## ADDED Requirements

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
