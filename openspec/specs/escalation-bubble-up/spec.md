# escalation-bubble-up Specification

## Purpose
Defines how a raised escalation reaches the root's live chat channel immediately and, when raised by a `concertino-orchestrator` subagent, bubbles up (via `--raise-only`/`ESCALATION-PENDING`/`SendMessage` resume) to the true root of the spawn tree instead of only surfacing after the subagent's whole turn returns.
## Requirements
### Requirement: `emit-event.sh escalation` supports three composable modes
`scripts/concertino/emit-event.sh escalation` SHALL support three modes: `--await` (unchanged — write `escalation.raised`, including its existing one-time stale-`answer.json`-discard check, then block-poll to resolution), `--raise-only` (write `escalation.raised` plus that same one-time discard check — identical to `--await`'s own write step — then return immediately with exit 0 and no polling), and `--wait-only max_wait_sec=<n>` (skip both the write and the discard check — both already ran once, in whichever call raised the escalation — and poll an already-raised escalation identified by `ticket=` for up to `max_wait_sec` seconds). Every existing call site using `--await` directly (an `--inline` run, `cleanup.sh`) SHALL be unaffected by the addition of the other two modes.

#### Scenario: `--raise-only` writes and returns without blocking
- **WHEN** `emit-event.sh escalation --raise-only ticket=CON-1 question=... options=a,b` is called
- **THEN** an `escalation.raised` event is appended to `events.jsonl` with the same context-handling behavior `--await` already has, and the call returns exit 0 immediately with no polling

#### Scenario: `--wait-only` resolves an already-raised escalation
- **GIVEN** an `escalation.raised` event already exists for `ticket=CON-1` (e.g. from a prior `--raise-only` call)
- **WHEN** `emit-event.sh escalation --wait-only max_wait_sec=30 ticket=CON-1` is called and a human answers via the dashboard within that window
- **THEN** the call resolves exit 0 with the answer on stdout, and records `escalation.answered`, exactly as `--await` would have from the same `escalation.raised` event

#### Scenario: `--wait-only` returns exit 2 when neither resolved nor timed out
- **GIVEN** an `escalation.raised` event exists for `ticket=CON-1` and its real deadline (`raised_at` + `CONCERTINO_ESCALATION_TIMEOUT_MIN`) has not been reached
- **WHEN** `emit-event.sh escalation --wait-only max_wait_sec=30 ticket=CON-1` is called and no answer is written within those 30 seconds
- **THEN** the call exits 2 (still open — neither resolved nor timed out), records no `escalation.timeout`, and does not discard or remove any file

#### Scenario: `--wait-only` does not discard a dashboard answer written between two calls
- **GIVEN** a first `--wait-only` call for `ticket=CON-1` exits 2 (still open) with no answer present
- **WHEN** a human answers via the dashboard immediately afterward, and a second `--wait-only` call is then made for the same `ticket=CON-1`
- **THEN** the second call resolves exit 0 with that answer — it SHALL NOT treat the answer as stale leftover state from an earlier escalation and discard it

#### Scenario: Existing `--await` call sites are unaffected
- **WHEN** `emit-event.sh escalation --await ...` is called exactly as before this change (e.g. from an `--inline` run or `cleanup.sh`)
- **THEN** its write-then-poll-then-resolve behavior, exit codes, `TERM`/`INT` trap, and stdout contract are byte-for-byte unchanged

### Requirement: A signal killing a `--wait-only` call never records a terminal timeout on its own
`--wait-only` SHALL NOT install a kill-signal (`TERM`/`INT`) trap that writes `escalation.timeout`. A `--wait-only` process that receives `TERM`/`INT` SHALL simply terminate with no event written, leaving `answer.json` and the escalation's logged state exactly as they were immediately before that poll attempt began. Only the escalation's real deadline being reached (this requirement's sibling exit-code-1 behavior) SHALL ever record a terminal `escalation.timeout` for a `--wait-only`-driven wait.

#### Scenario: A killed `--wait-only` call leaves the escalation open
- **GIVEN** a `--wait-only` call is polling an escalation whose real deadline has not been reached
- **WHEN** the process receives `TERM` or `INT` (e.g. a harness restart or session eviction)
- **THEN** the process exits without writing `escalation.timeout` or any other event, and the escalation remains open exactly as it was before that call

#### Scenario: A subsequent `--wait-only` call resumes normally after a kill
- **GIVEN** a prior `--wait-only` call for the same ticket was killed mid-poll per the scenario above
- **WHEN** a new `--wait-only` call is made for the same still-open escalation
- **THEN** it polls and resolves normally (per this capability's other `--wait-only` requirements), exactly as if the killed call had never happened

#### Scenario: `--await`'s own kill-signal behavior is unchanged
- **WHEN** an `--await` call (not `--wait-only`) is killed with `TERM`/`INT` while polling
- **THEN** its existing `on_kill` trap still writes `escalation.timeout` exactly as before this change — this requirement applies only to `--wait-only`, never to `--await`

### Requirement: `--wait-only`'s real deadline is anchored to the persisted raise time, distinct from its own per-call budget
`--wait-only` SHALL compute the escalation's real resolution deadline as the `escalation.raised` event's own timestamp plus `CONCERTINO_ESCALATION_TIMEOUT_MIN`, read fresh from `events.jsonl` on each invocation, never from its own process start time — this is what governs exit code 1 (timed out). This SHALL be distinct from, and outlive, any single call's own `max_wait_sec` budget (which governs exit code 2 — not yet resolved, still open, try again), so the escalation's real deadline is correct regardless of how many separate `--wait-only` calls are made, or how much wall-clock time elapses between them.

#### Scenario: The real deadline survives being split across multiple short calls
- **GIVEN** an escalation was raised at time T with a 10-minute timeout
- **WHEN** the root makes several separate `--wait-only max_wait_sec=30` calls over the following minutes, each individually exiting 2, none of which individually runs for 10 minutes
- **THEN** the escalation is still correctly reported as timed out (exit 1, `escalation.timeout` recorded) once real wall-clock time reaches T + 10 minutes, and not before

### Requirement: A subagent orchestrator bubbles a raised escalation to its parent instead of blocking
When a `concertino-orchestrator` instance determines it is running as a Claude Code subagent (i.e. it was reached via an `Agent(subagent_type: concertino-orchestrator)` spawn, not via `--inline`), and it needs to raise an escalation, it SHALL: (1) call `--raise-only` instead of `--await`; (2) persist a `PENDING_ESCALATION` record in `workflow-state.md` capturing the question, options (or sub-questions), context reference, raised-at timestamp, and escalation kind; (3) return control to its parent with a result carrying this same information (`ESCALATION-PENDING`) and instructions for how to resume it (`SendMessage` to this same agent) once the escalation resolves. It SHALL only do this when it has no outstanding spawned child of its own at the moment of the return.

#### Scenario: A subagent orchestrator returns instead of blocking on an escalation
- **GIVEN** `concertino-orchestrator` is running as a spawned subagent (default, non-`--inline` topology) and needs to raise a Planning `ESCALATION`
- **WHEN** it reaches the point of raising that escalation
- **THEN** it calls `--raise-only`, persists `PENDING_ESCALATION` in `workflow-state.md`, and returns control to its parent carrying the question/options/context and resume instructions, rather than calling `--await` and blocking its own turn

#### Scenario: The bubble only happens with no outstanding spawned child
- **GIVEN** the orchestrator subagent has just received a verdict back from an executor/evaluator/skeptic/auditor it spawned (that child has already returned)
- **WHEN** it decides to raise an escalation based on that verdict
- **THEN** it may bubble per the requirement above, since no child of its own remains outstanding at that moment

### Requirement: A parent presented with `ESCALATION-PENDING` re-propagates unless it is the root
Any agent that receives an `ESCALATION-PENDING` result from a child it spawned (rather than raising an escalation of its own) SHALL apply the same topology test: if it has a parent of its own (it is itself a subagent), it SHALL immediately re-return the same `ESCALATION-PENDING` payload to its own parent, without presenting it or attempting to resolve it. Only an agent with no parent of its own — the top-level `/concertino-deliver` chat session — SHALL present the escalation and drive it to resolution.

#### Scenario: An intermediate agent relays without presenting
- **GIVEN** an orchestrator instance is itself a subagent of some other agent (e.g. a future fleet-driver role reusing this same protocol), and it receives an `ESCALATION-PENDING` result from a `concertino-orchestrator` child it spawned
- **WHEN** it processes that result
- **THEN** it re-returns the same `ESCALATION-PENDING` payload to its own parent rather than presenting it to any chat transcript or attempting to resolve it itself

#### Scenario: The root presents and resolves
- **GIVEN** the top-level `/concertino-deliver` session (no parent of its own) receives an `ESCALATION-PENDING` result, whether directly from `concertino-orchestrator` or relayed through intermediate hops
- **WHEN** it processes that result
- **THEN** it presents the question/options/context to the human in its own chat transcript immediately, and proceeds to resolve it (see the root's resolution requirement below)

### Requirement: The root presents immediately and resolves via both channels
The root SHALL, upon receiving `ESCALATION-PENDING`, present the question/options/context to the human in its own chat transcript before doing anything else, then resolve it by: polling for a dashboard answer using repeated short `--wait-only max_wait_sec=<n>` calls (looping again on exit code 2, stopping on exit 0 or exit 1), remaining able to accept a direct chat reply from the human between those calls, and writing a chat-given answer through `concertino answer` (see the `escalation-answer-cli` capability) the moment one is given. Whichever channel's answer is recorded first is authoritative. Per design.md Decision 4a (revised), `concertino answer` itself records `escalation.answered` when its write resolves the escalation — no additional confirming `--wait-only` call is made. The root branches directly on `concertino answer`'s own result: **refused** (the dashboard won — the root's own already-running or next `--wait-only` call is what observes and logs that competing answer, unchanged) vs. **successful and resolving** (a single-question answer, or the multi-part sub-answer that completed the last remaining slot — the root proceeds straight to resuming the orchestrator, since `escalation.answered` is already recorded) vs. **successful but not yet resolving** (a partial multi-part sub-answer — the root does not resume anything, and simply continues its normal polling loop for the remaining sub-questions).

#### Scenario: The question is visible in chat before any wait begins
- **WHEN** the root receives `ESCALATION-PENDING`
- **THEN** the question, options, and any context are presented in the root's own chat transcript before the root makes its first `--wait-only` call

#### Scenario: A dashboard answer resolves the wait
- **GIVEN** the root is polling via repeated `--wait-only` calls (each returning exit 2 so far)
- **WHEN** a human answers via the dashboard escalation screen
- **THEN** the next `--wait-only` call returns exit 0 with the answer, the root stops looping, and does not also attempt to write an answer of its own

#### Scenario: A chat answer resolves the wait immediately, with no confirming poll
- **GIVEN** the root is between `--wait-only` polls and no dashboard answer has landed yet, and the escalation is either single-question or a multi-part escalation whose only remaining unanswered slot is the one the human is about to answer
- **WHEN** the human replies directly in chat with a decision
- **THEN** the root writes that answer through `concertino answer`, which itself records `escalation.answered` on this same successful, resolving write — the root treats the escalation as resolved and proceeds to resume the orchestrator directly from `concertino answer`'s own result, with no further `--wait-only` call made

#### Scenario: A partial multi-part chat sub-answer does not resolve the wait
- **GIVEN** a multi-part (CON-46 wizard) escalation with more than one sub-question, none yet answered
- **WHEN** the human replies directly in chat answering only one of several sub-questions (`concertino answer <ticket> <value> --sub <index> --total <n>`, per the `escalation-answer-cli` capability), leaving at least one other sub-question unanswered
- **THEN** the write succeeds (`writeSubAnswer` returns `complete: false`) but `concertino answer` records no event (per `escalation-answer-cli`'s "records ... only when its write resolves the escalation" requirement) — this is expected, not an error — the root does **not** resume the orchestrator at this point, and instead continues its normal polling loop for the remaining sub-questions, answerable via either channel

#### Scenario: A chat-resolved escalation clears `run.escalation` on the dashboard
- **GIVEN** an escalation was resolved via a direct chat reply through `concertino answer`
- **WHEN** the dashboard next reads `events.jsonl`
- **THEN** `lib/ui/reducer.js` observes the `escalation.answered` event `concertino answer` itself recorded and clears `run.escalation` to `null` exactly as it would for a dashboard-resolved escalation — the run does not keep showing `needs-you` after the orchestrator has already resumed

#### Scenario: A losing write is reported, not silently dropped
- **GIVEN** the human answers via chat at nearly the same moment a dashboard answer is recorded
- **WHEN** the root's `concertino answer` write is refused because the escalation was already answered
- **THEN** the root reports to the human that the dashboard's answer was the one that took effect, rather than silently proceeding as if its own write had won

### Requirement: The root resumes the bubbled orchestrator with the resolution
Once an escalation raised via `PENDING_ESCALATION`/`ESCALATION-PENDING` is resolved (by either channel), the root SHALL `SendMessage` the waiting `concertino-orchestrator` subagent, carrying the question, the answer, which channel resolved it, and the timestamp, and SHALL wait for that agent's next result within the same turn before proceeding (this resume is an ordinary warm-resume, not a further bubble). If `SendMessage` is unavailable or the original agent cannot be resumed, the root SHALL fall back to a fresh cold spawn of `concertino-orchestrator` with a prompt beginning `RESUME — do not start over`, pointing it at `workflow-state.md`.

#### Scenario: A resumed orchestrator can state what was asked and answered
- **GIVEN** the root has resolved a bubbled escalation and resumes the orchestrator via `SendMessage`
- **WHEN** the orchestrator's resumed turn continues
- **THEN** it has the exact question, the answer, and which channel resolved it, and can state all three if asked, regardless of whether the dashboard or chat channel resolved it

#### Scenario: `SendMessage` unavailable falls back to cold resume
- **GIVEN** `SendMessage` cannot be used to resume the original orchestrator agent
- **WHEN** the root needs to deliver the resolution
- **THEN** it cold-spawns a fresh `concertino-orchestrator` with a prompt beginning `RESUME — do not start over`, which recovers the resolved `PENDING_ESCALATION` from `workflow-state.md`/the resolution it was given, and continues without re-raising the same question

### Requirement: An `--inline` run never bubbles
When `concertino-orchestrator`'s role is being carried out by the top-level session itself (`--inline`), it SHALL never use `--raise-only`/`ESCALATION-PENDING` — it SHALL present to chat immediately and then call `--await` directly, exactly as described in the `inline-orchestrator-mode` capability, since there is no subagent hop to bubble across.

#### Scenario: Inline mode presents then blocks, with no pending-escalation state
- **GIVEN** `--inline` is active
- **WHEN** the session needs to raise an escalation
- **THEN** it presents to its own chat transcript immediately, then calls `--await` directly; no `PENDING_ESCALATION` is written to `workflow-state.md` and no `ESCALATION-PENDING` result is ever returned

