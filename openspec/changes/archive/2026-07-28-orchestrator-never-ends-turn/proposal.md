## Why

`core/roles/orchestrator.md` tells the orchestrator to spawn or resume the
executor/evaluator/skeptic and act on what they return, but never states that
it must not *end its turn* while one of those sub-agents is still
outstanding. Under `/concertino-deliver` the orchestrator is the top-level
session, so this omission is harmless — waiting is free, the session is still
there when the sub-agent finishes. But when the orchestrator role is itself
dispatched as a sub-agent (a fleet driver, a queue runner, or another
orchestrator invoking it), returning control while a child agent is still
running is fatal: a suspended sub-agent gets no completion notification, and
its own children do not survive its turn ending. CON-10 hit exactly this
twice in one delivery — the run went dead until a human noticed and
re-prompted it, which is exactly what the circuit-breaker design exists to
avoid. This needs fixing now, before CON-15's own orchestrator (which is
itself running as a sub-agent under a fleet-style dispatch) repeats it.

## What Changes

- `core/roles/orchestrator.md`: add an explanation of the top-level-session
  vs. sub-agent distinction to the "Harness resume model" section, and a
  short, concrete reminder at each point a sub-agent is spawned or resumed
  (Phase 1 skeptic design gate, Phase 2 cycle-1 executor/evaluator spawns,
  Phase 2 cycle 2+ resumes, and the final skeptic gate) so the rule survives
  paraphrase and is not stranded by compaction of a single preamble.
  Each reminder also states the fallback when the harness genuinely cannot
  wait inline: poll for the artefact the sub-agent was told to produce, or
  escalate — never return control speculatively.
- `bin/concertino`: update the generated Claude Code `harnessResume` block
  text (the source of the "Harness resume model" section actually rendered
  into `.claude/agents/concertino-orchestrator.md`) to carry the same
  explanation, since that block text — not prose directly in
  `core/roles/orchestrator.md` — is what ends up in front of a real
  orchestrator session.
- `adapters/codex/` (`header.md`, `prompt.md`) and the codex branch of the
  `harnessResume` block in `bin/concertino`: checked for the same gap. The
  default Codex flow already runs every role sequentially in one thread, so
  there is no spawn/suspend boundary to fix there — but the *optional*
  worker-dispatch path (`.codex/agents/*.toml`, `spawn_agents_on_csv`) that
  `docs/harness-capabilities.md` documents as available on richer Codex
  environments has the identical risk if the single orchestrating thread
  returns before a dispatched worker reports its result. Document that
  explicitly rather than leaving it implicit.
- `docs/harness-capabilities.md`: record the constraint (never end a turn
  with an outstanding sub-agent; harmless at the top level, fatal when
  nested) as a harness-behavior fact, alongside the existing capability
  matrix and Codex degraded-flow notes.

## Capabilities

### New Capabilities

- `orchestrator-turn-discipline`: the orchestrator role's contract that it
  never returns control while a sub-agent it spawned is outstanding —
  explained (not just asserted) at the point each spawn/resume happens, with
  a stated fallback when the harness can't wait inline, and the equivalent
  Codex-path check and `docs/harness-capabilities.md` record. This mirrors
  how `phase-telemetry` already tracks a role-doc requirement ("permitted
  phase values are stated at their point of use") alongside its code
  requirements — the requirement here is entirely role-doc/adapter-doc prose,
  with no accompanying code change.

### Modified Capabilities

(none — no existing `openspec/specs/*` capability spec's requirements
change.)

## Impact

- `core/roles/orchestrator.md` — prose only.
- `bin/concertino` — the `harnessResume` block-render function (both
  `claude-code` and `codex` string literals).
- `adapters/codex/header.md`, `adapters/codex/prompt.md` — prose only, if a
  gap is found.
- `docs/harness-capabilities.md` — new section documenting the constraint.
- No runtime script, gate, or schema changes; nothing here is enforceable by
  `npm test`. Verification is by inspection: does a fresh model reading the
  role actually behave correctly, per the ticket's own instruction to the
  evaluator/skeptic.
