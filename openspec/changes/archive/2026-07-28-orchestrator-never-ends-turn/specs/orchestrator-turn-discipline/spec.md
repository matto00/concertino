## ADDED Requirements

### Requirement: The orchestrator role states the top-level-vs-sub-agent turn distinction, explained rather than asserted
`core/roles/orchestrator.md`'s harness-resume guidance SHALL explain, not merely
assert, why the orchestrator must never return control while a sub-agent it
spawned is outstanding: waiting is free when the orchestrator is the
top-level `/concertino-deliver` session (it persists and receives the
sub-agent's notification whenever it arrives), but fatal when the
orchestrator role is itself dispatched as a sub-agent (a fleet driver, a
queue runner, or another orchestrator), because a suspended sub-agent
receives no notifications and its own children do not survive its turn
ending.

#### Scenario: A reader can explain why the rule exists, not just recite it
- **WHEN** a fresh model reads the "Harness resume model" section of the
  rendered orchestrator role
- **THEN** it can state, in its own words, both why waiting is harmless at
  the top level and why the identical wait is fatal when the orchestrator is
  itself a sub-agent — not just recite "never end your turn" without the
  reasoning

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
