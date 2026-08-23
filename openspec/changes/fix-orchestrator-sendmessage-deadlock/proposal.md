## Why

Orchestrators repeatedly end their turn holding for a sub-agent's report as
though a message could arrive later from it. No such channel exists:
`adapters/claude-code/agents.json` grants `SendMessage` to `orchestrator`
only. A sub-agent's result is always delivered synchronously, as the return
value of the `Agent`/`SendMessage` call that spawned or resumed it. This
misconception has caused five manual human nudges across four recent runs
(CON-133, CON-129, CON-128, HEL-805) where the orchestrator was already
holding the result but reasoned itself into waiting anyway.

## What Changes

- `core/roles/orchestrator.md`'s "Harness resume model" section gains an
  explicit statement that sub-agents have no `SendMessage` tool, cannot
  address the orchestrator, and that "waiting" for one means only that its
  spawn/resume call has not yet returned — never a separate notification to
  hold open-endedly for.
- The claude-code-specific `harnessResume` block text (rendered from
  `lib/cli/render.js`) is extended with the same clarification at the exact
  point that names `SendMessage`, since that block is what actually reaches
  the rendered `.claude/agents/concertino-orchestrator.md` on this harness.
- The Phase 2 Execution/Evaluation loop's spawn, resume, and final-gate
  skeptic-spawn steps are reworded to instruct consuming the tool call's
  return value directly, with artifact inspection (report file, new commit,
  `workflow-state.md`) as the explicit, mandatory fallback whenever the
  orchestrator is not already holding a result — not only when the harness
  "can't wait inline".

No intended behavior change for Codex/OpenCode: they already run
sequentially in a single thread with no spawn/suspend boundary on the
default path (documented separately in the `harnessResume` block's own
codex/opencode branches, which are untouched by this change). The shared
"Harness resume model" prose edited by this change does render into their
role docs too (it lives outside the harness-specific `{{block:harnessResume}}`
section), so it is deliberately worded without naming `SendMessage` and
without an unconditional "no inbound channel, ever" claim — see design.md
Decision 1 — so it stays true, including on codex's optional
worker-dispatch path, rather than merely "not making things worse" by
accident.

## Capabilities

### New Capabilities
- `orchestrator-subagent-result-delivery`: documents (and pins, via a
  render-time-checkable requirement) that a sub-agent's result on the
  ordinary spawn/resume path is the return value of the call that spawned or
  resumed it, and that the artifact-inspection fallback applies whenever the
  orchestrator is not already holding that result — plus a harness-safety
  requirement that no new SendMessage-shaped instruction leaks into the
  Codex/OpenCode renders. This is a thin capability wrapping a prose/role-doc
  correction, not a new runtime behavior contract.

### Modified Capabilities
(none — no existing capability's requirements changed)

## Impact

- `core/roles/orchestrator.md` (role source, renders into all harnesses)
- `lib/cli/render.js` (claude-code `harnessResume` block text)
- Rendered output: `.claude/agents/concertino-orchestrator.md` (and the
  Codex/OpenCode equivalents, unchanged in effect)
