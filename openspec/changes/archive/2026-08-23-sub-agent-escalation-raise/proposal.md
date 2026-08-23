## Why

CON-76 delivered the orchestrator→root escalation bubble-up, but the hop below it —
executor/evaluator/skeptic/auditor → orchestrator — was never built. Per the ticket's corrected
framing (2026-08-22 comment): sub-agents already reach the orchestrator reliably today via their
**return value** (CON-133 validated this end-to-end). The real gap is narrower: **a sub-agent can
only speak by terminating its own turn.** A genuine decision-needing situation (a requirements
contradiction, an ambiguity the ticket doesn't settle, a design call outside the sub-agent's
authority) forces either an environmental `BLOCKER` (wrong category — `BLOCKER` is scoped to
environmental failures only, per every role doc), smuggling the question into a report verdict
(silent, easily missed), or unilateral judgment (the exact failure escalation exists to prevent).
What's missing is a **legitimate, documented, non-`BLOCKER` raise procedure** with a defined
resume path that avoids a wasteful cold re-spawn — "escalation without death," not a new
communication channel that didn't exist before.

## What Changes

- Grant `SendMessage` to `executor`, `evaluator`, `skeptic`, `auditor` in
  `adapters/claude-code/agents.json` `baseTools` (Claude Code only — this ticket's explicit scope
  boundary; Codex/OpenCode parity is CON-135).
- Define a new **`ESCALATION`** verdict/raise procedure in `core/roles/{executor,evaluator,
  skeptic}.md`, distinct from `BLOCKER`, usable for any genuine non-environmental decision the
  role cannot resolve within its own authority.
- Reconcile `auditor.md`'s existing `ESCALATE` verdict: it keeps its current meaning (a completed
  check found a real, unmergeable/unmet condition — a post-hoc finding). The new `ESCALATION`
  raise is additive, for a genuine ambiguity the auditor hits *before* it can even reach a verdict
  (distinct from, and rarer than, `ESCALATE`).
- Extend `core/roles/orchestrator.md`'s existing "How to raise one" / CON-76 relay machinery
  (**modified**, not duplicated) to cover escalations originating from a sub-agent: the
  orchestrator relays without deciding, using the exact same topology-aware
  `--await`/`--raise-only` procedure already defined for its own escalations — no new plumbing.
  This is what makes the sub-agent → orchestrator hop compose uniformly with CON-126 (not yet
  built): the TUI/topology decision already lives entirely in the orchestrator's one existing
  procedure, so sub-agents never need to know about `emit-event.sh` or TUI state at all.
- Define the raiser's yield/resume shape: the raising sub-agent's turn **does** end (an
  architectural fact of this harness's blocking `Agent()` spawn model — restated, not weakened,
  from CON-134/`orchestrator-subagent-result-delivery`), but the orchestrator resumes it **warm**
  (`SendMessage`, for executor/evaluator — already warm-resumable across cycles today) or a
  **fresh cold spawn carrying the resolved answer forward** (for skeptic, which is cold-only by
  design and loses nothing by design — it re-derives ground truth every time regardless). This is
  the concrete, implementable meaning of "escalation without death": never a wasted cold re-spawn
  that discards context that mattered, for the two roles that carry state across turns.
- Update `openspec/specs/orchestrator-subagent-result-delivery/spec.md`'s "no `SendMessage`
  tool... cannot address the orchestrator" requirement — now false on Claude Code — to instead
  state precisely what changed and what didn't: sub-agents can now call `SendMessage` to durably
  self-notify the orchestrator of a raise, but this still cannot be *observed* by the orchestrator
  before its blocking `Agent()` call returns (an architectural fact, not a design choice); a
  sub-agent's authoritative result is still, and remains, the return value of the call that
  spawned or resumed it — the `ESCALATION` verdict travels *in* that same return value, exactly
  like every other verdict.

## Capabilities

### New Capabilities
- `subagent-escalation-raise`: the `ESCALATION` verdict/raise procedure for
  executor/evaluator/skeptic/auditor, its distinctness from `BLOCKER`, the orchestrator's relay
  handling of it, and the warm/cold resume contract per role.

### Modified Capabilities
- `orchestrator-subagent-result-delivery`: the "no `SendMessage` tool, cannot address the
  orchestrator" requirement is now false on Claude Code and must be corrected to the precise,
  narrower true statement above.
- `escalation-bubble-up`: the "root presents; intermediate agents relay without deciding" rule is
  extended to cover escalations whose origin is a sub-agent, not only ones the orchestrator itself
  raises.

## Impact

- `adapters/claude-code/agents.json` (tool grants)
- `core/roles/executor.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md` (new raise
  procedure)
- `core/roles/auditor.md` (reconciliation section)
- `core/roles/orchestrator.md` (relay extension — no new escalation plumbing)
- `openspec/specs/orchestrator-subagent-result-delivery/spec.md`,
  `openspec/specs/escalation-bubble-up/spec.md` (delta specs)
- Rendered `.claude/agents/*.md` (via `concertino sync`) — verified via CON-134's render-diff
  proxy and a rendered-frontmatter assertion (source config edits alone are not proof, per
  CON-133's lesson)
