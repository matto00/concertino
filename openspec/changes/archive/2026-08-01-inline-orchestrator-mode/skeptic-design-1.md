## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts in full**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/inline-orchestrator-mode/spec.md`, `workflow-state.md`
  (PHASE: Planning, CYCLE: 0 — consistent with a design-gate review).

- **Escalation decision is faithfully reflected, not silently self-decided**, across
  all four artifacts:
  - `proposal.md:26` — Impact section: "Escalation resolved during planning: the
    tool-scope gap ... is real but accepted as-is for this change, with one
    guardrail: the rendered command file's inline-mode branch must explicitly
    instruct the session to use only the orchestrator role's tool list ... even
    though broader tools remain available to it."
  - `design.md:7` (Context) — "Constraint from Planning escalation
    (human-decided, `add_guardrail`): inline mode's rendered instructions must
    explicitly tell the session to use only the orchestrator role's tool list..."
  - `design.md:33-36` (Decision 2) — dedicated decision on *where* the guardrail
    text lives (`command.md`'s "What to do" section, not
    `core/roles/orchestrator.md`, with reasoning for why the Codex-shared role
    file must stay free of this Claude-Code-only concern) and an
    "Alternatives considered" entry showing the rejected option was weighed.
  - `specs/inline-orchestrator-mode/spec.md:36-41` — a dedicated ADDED
    Requirement, "Inline mode instructs the session to self-limit to the
    orchestrator role's tool list," with its own scenario.
  - `tasks.md:5` (task 1.3) — concrete implementation task wiring the guardrail
    into the rendered file.
  This is a coherent, non-contradictory thread from ticket → proposal → design →
  spec → tasks; no artifact decided the tool-scope question unilaterally.

- **Tool list accuracy cross-checked against ground truth**: the guardrail text
  specified in `tasks.md:5` and `spec.md:37` (`Read, Write, Edit, Bash, Grep,
  Glob, Agent, SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList` + ticket-
  provider MCP tools) matches `adapters/claude-code/agents.json`'s
  `roles.orchestrator.baseTools` exactly (lines 26, 28-31) — not a fabricated or
  drifted list.

- **Non-goals verified against the actual role file**: `design.md`'s Non-Goals
  claims `core/roles/orchestrator.md` needs no change because it "already
  distinguishes top-level-session-vs-sub-agent behavior throughout." Confirmed
  directly: `core/roles/orchestrator.md:32-52` ("Harness resume model" section)
  explicitly separates "As the top-level `/concertino-deliver` session" from
  "if this orchestrator role is itself running as a sub-agent," which is exactly
  the distinction `--inline` toggles. The claim holds up under direct
  inspection, not just assertion.

- **Existing command.md read in full** (`adapters/claude-code/command.md`):
  confirmed the existing Arguments-section parsing pattern (`--agent-merge`/
  `--no-agent-merge` and `fast`/`slow` as independently-optional trailing
  tokens) that Decision 1 and the spec's first Requirement claim to mirror for
  `--inline` — the precedent is real, not invented.

- **Codex no-op claim checked against `core/roles/orchestrator.md`**: line
  ~371-378 states Codex's orchestration is "sequential in a single thread" with
  no per-spawn model override, corroborating Decision 3's premise that there is
  no subagent-spawn step for `--inline` to skip under Codex.

- **Checked for placeholders/hand-waving**: none found — no `TODO`/`TBD` in any
  artifact; every task in `tasks.md` (8 items across 4 sections) is concrete and
  independently actionable, including a self-verification task (3.3: trace the
  rendered output against each spec requirement) and an explicit
  check-don't-assume task (4.1: only touch `docs/harness-capabilities.md` if it
  actually documents flags — verified against the real file, which lists
  agent-merge topology but no per-flag doc, so "skip if none does" is the
  correct branch, not vague hedging).

- **Checked for scope drift**: the change touches only
  `adapters/claude-code/command.md` and `adapters/codex/prompt.md`, matching the
  ticket's stated ground-truth-checked files; `core/roles/orchestrator.md`,
  `bin/concertino`, `agents.json`, and `scripts/concertino/*` are explicitly and
  correctly declared out of scope with reasoning, not silently ignored.

- **Checked for contradictions**: proposal/design/tasks/spec agree on: flag
  name, independent-trailing-token parsing model, guardrail placement and
  wording source, Codex no-op behavior, and scope boundaries. No artifact
  contradicts another.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md`'s Risks section already flags future drift between the
  guardrail's hardcoded tool list and `agents.json`'s `baseTools` if the latter
  changes later, with an explicit "not needed for this change" call — reasonable
  to defer, noting it here only so a future reader isn't surprised it wasn't
  templated.
