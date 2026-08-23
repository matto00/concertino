# subagent-escalation-raise Specification

## Purpose
Defines the `ESCALATION`/`ESCALATION-RAISE` mid-flight raise procedure that lets executor, evaluator, skeptic, and auditor surface a genuine non-environmental decision to the orchestrator without proceeding on unilateral judgment, distinct from the environmental-only `BLOCKER` signal.
## Requirements
### Requirement: executor/evaluator/skeptic each document an `ESCALATION` raise procedure
`core/roles/executor.md`, `core/roles/evaluator.md`, and `core/roles/skeptic.md` SHALL each
document an `ESCALATION` raise procedure, distinct from `BLOCKER`, usable for any genuine
non-environmental decision the role cannot resolve within its own authority (a requirements
contradiction, an ambiguity the ticket/spec doesn't settle, a decision outside the role's
authority). `BLOCKER`'s existing environmental-only meaning SHALL be unchanged in each of these
files.

#### Scenario: Executor documents ESCALATION distinct from BLOCKER
- **WHEN** `core/roles/executor.md` is read
- **THEN** it documents an `ESCALATION` raise procedure separate from any `BLOCKER`/environmental
  handling, usable for a non-environmental decision the executor cannot resolve on its own

#### Scenario: Evaluator's ESCALATION does not touch BLOCKER's scope
- **WHEN** `core/roles/evaluator.md` is read
- **THEN** it retains language stating `BLOCKER` is for environmental failures only, and separately
  documents `ESCALATION` as a distinct, non-`BLOCKER` verdict for non-environmental decisions

#### Scenario: Skeptic's ESCALATION does not touch BLOCKER's scope
- **WHEN** `core/roles/skeptic.md` is read
- **THEN** it retains language stating `BLOCKER` is for environmental failures only, and separately
  documents `ESCALATION` as a distinct, non-`BLOCKER` verdict for non-environmental decisions

### Requirement: A raising sub-agent's turn ends by returning `ESCALATION`, not by blocking on a reply
The `ESCALATION` raise procedure SHALL instruct the raising sub-agent to end its own current turn
by returning a structured `ESCALATION` result (question/options/context) — the same mechanism by
which it already returns any other verdict — rather than waiting inline for a reply. It SHALL NOT
instruct the sub-agent to poll, sleep, or otherwise block waiting for an answer before returning.

#### Scenario: The raise procedure ends in a return, not a wait loop
- **WHEN** the `ESCALATION` raise procedure in any of `executor.md`/`evaluator.md`/`skeptic.md` is
  read
- **THEN** its terminal step is returning the structured `ESCALATION` result; no step instructs the
  agent to poll or wait inline for a human or orchestrator reply before returning

### Requirement: Raising sub-agents self-notify the orchestrator via SendMessage before returning (Claude Code only)
On Claude Code, immediately before returning an `ESCALATION` result, the raising sub-agent SHALL
call `SendMessage` to the orchestrator (addressed via an `ORCHESTRATOR_AGENT_REF` input the
orchestrator supplies at spawn time), carrying the same question/options/context as its return
value, as a durable, independently-timestamped record of the raise. This step SHALL be
harness-guarded — omitted entirely for Codex/OpenCode, where no equivalent tool exists.

#### Scenario: A Claude Code raise includes a SendMessage self-notify step
- **WHEN** the `ESCALATION` raise procedure is rendered for the `claude-code` harness
- **THEN** the rendered role file's raise procedure references sending a message to the
  orchestrator (via the harness-specific block) before returning the `ESCALATION` result

#### Scenario: A Codex/OpenCode raise has no SendMessage step
- **WHEN** the `ESCALATION` raise procedure is rendered for `codex` or `opencode`
- **THEN** the rendered role file's raise procedure contains no reference to `SendMessage` or any
  equivalent tool call

### Requirement: SendMessage self-notify does not block the sub-agent's own return
The `SendMessage` self-notify step SHALL be fire-and-forget from the raising sub-agent's
perspective: the sub-agent SHALL NOT wait for delivery confirmation or any reply before proceeding
to return its `ESCALATION` result. This is what keeps the raise CON-15-safe from the sub-agent's
own side: it never enters a wait-for-inbound-message state it can never exit, mirroring the
constraint CON-15 places on the orchestrator from the other direction.

#### Scenario: The self-notify is immediately followed by the return, not a wait
- **WHEN** the raise procedure's `SendMessage` step (Claude Code) is read
- **THEN** the very next instruction is returning the structured `ESCALATION` result, with no
  intervening instruction to wait for a reply to that message

### Requirement: `SendMessage` is granted to executor/evaluator/skeptic/auditor on Claude Code only
`adapters/claude-code/agents.json` SHALL include `SendMessage` in `baseTools` for `executor`,
`evaluator`, `skeptic`, and `auditor`. No equivalent grant SHALL be made for Codex or OpenCode
adapters (out of scope — CON-135).

#### Scenario: Rendered Claude Code agent files carry the new tool
- **WHEN** `concertino sync` renders `.claude/agents/concertino-executor.md`,
  `concertino-evaluator.md`, `concertino-skeptic.md`, and `concertino-auditor.md`
- **THEN** each rendered file's frontmatter `tools:` list includes `SendMessage`

### Requirement: The orchestrator relays a sub-agent `ESCALATION`/`ESCALATION-RAISE` without deciding it
`core/roles/orchestrator.md` SHALL document that an `ESCALATION` verdict from
executor/evaluator/skeptic, or an `ESCALATION-RAISE` verdict from auditor, is raised through the
orchestrator's own existing topology-aware raise procedure (the same `--await`/`--raise-only`
machinery already defined for the orchestrator's own escalations), tagging the event with
`role=<raiser>` rather than `role=orchestrator`, and never deciding the substance of the question
itself.

#### Scenario: A sub-agent ESCALATION reuses the existing raise procedure
- **WHEN** `core/roles/orchestrator.md`'s escalation handling for a sub-agent `ESCALATION`/
  `ESCALATION-RAISE` verdict is read
- **THEN** it references reusing the existing `--await`/`--raise-only` procedure (not a new,
  separate mechanism) and instructs tagging the raised event with the originating role

#### Scenario: The orchestrator never substitutes its own judgment
- **WHEN** the orchestrator receives an `ESCALATION`/`ESCALATION-RAISE` verdict from a sub-agent
- **THEN** its documented handling is to relay the question to the human, not to answer it itself

### Requirement: The orchestrator's new sub-agent-escalation prose stays harness-guarded in `orchestrator.md`
New `core/roles/orchestrator.md` text for this capability naming `SendMessage` SHALL be harness-guarded.
This covers the resume-warm mechanism and the `ORCHESTRATOR_AGENT_REF` spawn-input note, routed through
a harness-guarded `{{block:...}}` mechanism (the existing `{{block:harnessResume}}` claude-code
branch, or an equivalent sibling block), identically to the constraint already placed on
`executor.md`/`evaluator.md`/`skeptic.md`/`auditor.md`. It SHALL NOT be written as bare shared
prose that would render unchanged into the `codex`/`opencode` outputs.

#### Scenario: New orchestrator.md SendMessage-naming text is harness-guarded
- **WHEN** the new resume-warm and `ORCHESTRATOR_AGENT_REF` text added to
  `core/roles/orchestrator.md` for this capability is located
- **THEN** it is inside a `{{block:...}}` placeholder resolved differently per harness in
  `lib/cli/render.js`, not bare text in the shared body

#### Scenario: codex/opencode renders of orchestrator.md gain zero new SendMessage occurrences
- **WHEN** `core/roles/orchestrator.md` is rendered for `codex` and for `opencode`, before and
  after this change
- **THEN** the count of `SendMessage` occurrences in each rendered file is unchanged (it may be
  nonzero already, from pre-existing `{{block:harnessResume}}` text — the criterion is a delta of
  zero, not an absolute count of zero)

### Requirement: Sub-agents never call `emit-event.sh` or reason about TUI/topology state
The `ESCALATION` raise procedure in `executor.md`/`evaluator.md`/`skeptic.md`/`auditor.md` SHALL
NOT instruct the sub-agent to invoke `emit-event.sh` directly, or to make any decision based on
TUI presence or topology — that decision SHALL remain solely the orchestrator's, made in its one
existing procedure, so the behavior composes uniformly regardless of which role raised the
question and independent of whatever CON-126 (TUI detection, not built here) eventually decides.

#### Scenario: No sub-agent role doc references emit-event.sh for a raise
- **WHEN** the `ESCALATION` raise procedure in each of `executor.md`/`evaluator.md`/`skeptic.md`/
  `auditor.md` is read
- **THEN** none of them instructs the agent to call `scripts/concertino/emit-event.sh` as part of
  raising

### Requirement: Executor/evaluator are resumed warm after an `ESCALATION`; skeptic/auditor are re-spawned cold carrying the answer forward
The orchestrator SHALL, once a sub-agent `ESCALATION` (or, for the auditor, `ESCALATION-RAISE`) is
resolved, resume the raising executor or evaluator warm (via `SendMessage`, its existing
resumability), supplying the human's answer as new input, preserving the agent's prior context.
For a raising skeptic or auditor — always spawned fresh/cold by design — the orchestrator SHALL
instead perform a fresh cold spawn that includes the resolved answer as an explicit additional
input, so the re-spawned agent does not need to re-derive or re-ask the same question.

#### Scenario: An escalating executor is resumed warm
- **GIVEN** an executor raised an `ESCALATION` and the orchestrator has the human's answer
- **WHEN** the orchestrator continues the executor's work
- **THEN** it resumes the same executor agent via `SendMessage` with the answer as new input,
  rather than spawning a fresh executor

#### Scenario: An escalating skeptic is re-spawned cold with the answer
- **GIVEN** a skeptic raised an `ESCALATION` and the orchestrator has the human's answer
- **WHEN** the orchestrator continues the gate
- **THEN** it spawns a fresh skeptic (consistent with skeptic always being cold), passing the
  resolved answer as an explicit additional input

#### Scenario: An escalating auditor is re-spawned cold with the answer
- **GIVEN** an auditor raised `ESCALATION-RAISE` and the orchestrator has the human's answer
- **WHEN** the orchestrator continues the merge check
- **THEN** it spawns a fresh auditor (consistent with auditor always being cold, one-shot), passing
  the resolved answer as an explicit additional input, and this does not consume the auditor's
  "one attempt, no retry" circuit-breaker entry (that entry governs `ESCALATE`/`BLOCKER` outcomes
  reached after a completed pass, not this pre-verdict raise)

### Requirement: `auditor`'s existing `ESCALATE` verdict is reconciled via a distinctly-named raise, not a bare `ESCALATION`
`core/roles/auditor.md` SHALL retain `ESCALATE`'s existing meaning (a completed check found a
real, unmergeable/unmet condition, returned after the auditor's one-shot pass) and SHALL
separately document a new `ESCALATION-RAISE` verdict — never a bare `ESCALATION` — usable only for
a genuine ambiguity encountered **before** the auditor can reach any of `MERGE`/`ESCALATE`/
`BLOCKER`. `ESCALATION-RAISE` is used instead of `ESCALATION` specifically for the auditor because
`ESCALATE`/`ESCALATION` are a one-token-apart pair in the same `Verdict:` slot, unsafe to rely on
for a value parsed from LLM-generated prose given the two route to materially different
orchestrator behavior. The two (`ESCALATE`, `ESCALATION-RAISE`) SHALL remain distinguishable in the
role doc and SHALL NOT be merged into one verdict.

#### Scenario: Auditor doc keeps ESCALATE and ESCALATION-RAISE distinct
- **WHEN** `core/roles/auditor.md` is read
- **THEN** it documents `ESCALATE` with its existing post-hoc-finding meaning unchanged, and
  separately documents `ESCALATION-RAISE` (not a bare `ESCALATION`) as a pre-verdict raise for a
  genuine ambiguity, with an explicit statement that the two are different signals

#### Scenario: The orchestrator's Signal Types table distinguishes ESCALATE from ESCALATION-RAISE
- **WHEN** `core/roles/orchestrator.md`'s Signal Types table is read
- **THEN** it lists `ESCALATE` (auditor, post-hoc finding) and `ESCALATION-RAISE` (auditor,
  pre-verdict raise) as separate rows with distinguishing text, alongside the plain `ESCALATION`
  row used by executor/evaluator/skeptic

### Requirement: `ESCALATION`/`ESCALATION-RAISE` is an ordinary verdict value — the "a verdict must always be emitted" rule is unweakened
`ESCALATION`/`ESCALATION-RAISE` SHALL be an ordinary verdict value, never a carve-out. Each role's
existing "a verdict must always be emitted" rule (`evaluator.md`, `skeptic.md`, `auditor.md`)
remains unweakened, and `ESCALATION` (or, for the auditor, `ESCALATION-RAISE`) is an ordinary
member of that role's `verdict=` vocabulary, written and persisted as a report via
`persist-evidence.sh` and emitted via the role's normal `emit-event.sh verdict` call exactly like
any other verdict. `BLOCKER` and `ESCALATION`/`ESCALATION-RAISE` SHALL be distinguishable in
reports and telemetry simply as two different values of that same `verdict=` field — no new event
kind, and no additional caller-supplied field (e.g. a `kind=` parameter), is introduced for this
purpose. Separately, and in addition to this normal verdict emission, the orchestrator SHALL raise
the human-facing relay via its existing `escalation.raised`/`escalation.answered` events (tagged
`role=<raiser>`), per the `escalation-bubble-up` capability.

#### Scenario: An ESCALATION verdict is emitted like any other verdict
- **GIVEN** an evaluator raises `Overall: ESCALATION`
- **WHEN** it reaches its report/emit step
- **THEN** it writes and persists a report exactly as it would for `PASS`/`FAIL`/`BLOCKER`, and
  calls `emit-event.sh verdict verdict=ESCALATION ref=<path>` exactly like any other verdict — the
  "a verdict must always be emitted" rule is not carved out or weakened

#### Scenario: BLOCKER and ESCALATION are distinguished only by verdict value
- **GIVEN** one sub-agent turn returns `BLOCKER` and another returns `ESCALATION`
- **WHEN** their `verdict=` events are inspected in `events.jsonl`
- **THEN** they are distinguishable solely by the `verdict=` field's value (`BLOCKER` vs.
  `ESCALATION`), with no other structural difference in how they were emitted

#### Scenario: The orchestrator's human-facing relay is additional, not a substitute
- **GIVEN** the orchestrator has received an `ESCALATION`/`ESCALATION-RAISE` verdict from a
  sub-agent
- **WHEN** it processes that result
- **THEN** it both observes the already-emitted `verdict=` event (unchanged mechanism) and
  separately raises `escalation.raised` (per `escalation-bubble-up`) to relay the question to the
  human — the human-facing relay does not replace or suppress the ordinary verdict emission

### Requirement: A sub-agent never proceeds on its own judgement instead of escalating
Each of `executor.md`/`evaluator.md`/`skeptic.md`/`auditor.md` SHALL state explicitly, as a
guardrail, that a genuine non-environmental decision the role cannot resolve within its own
authority must be raised via `ESCALATION`, never resolved by unilateral judgment or silently
absorbed into a report/verdict.

#### Scenario: Guardrail is present in each role doc
- **WHEN** each of the four role docs is read
- **THEN** it contains an explicit guardrail against proceeding on unilateral judgment in place of
  raising an `ESCALATION`

