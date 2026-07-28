# CON-15 — Orchestrator role must never end its turn waiting for a sub-agent

## Description

`core/roles/orchestrator.md` tells the orchestrator to spawn the executor and
evaluator and act on what they return, but never says it must not *end its
turn* while waiting for one.

Under `/concertino-deliver` that omission is harmless: the orchestrator is the
top-level session, so waiting costs nothing and it will still be there when
the sub-agent returns.

Dispatched as a **sub-agent** — which is how a fleet driver, a queue runner,
or another orchestrator would invoke it — the same behaviour ends the run. A
suspended sub-agent receives no notifications, and its children do not
survive its turn ending.

### Observed

CON-10 hit this twice in one delivery. The orchestrator returned control with
a message reading *"The executor is working on cycle 2 in the background.
I'll pause here and wait for its completion notification before
proceeding"* — and simply stopped. `workflow-state.md` stayed at
`PHASE: Execution, CYCLE: 2`, no events were emitted, and the run sat dead
until it was externally resumed. The second occurrence was identical, after
its executor had already finished and committed.

The run recovered only because `workflow-state.md` and the event log are
durable — the same property that carried it through four host-process
crashes in the same delivery. But recovery needed a human noticing and
re-prompting, which is exactly what the circuit-breaker design exists to
avoid.

## Acceptance criteria

- The orchestrator role states plainly that it must drive every phase to
  completion **within its own turn**, and must never return control while a
  sub-agent it spawned is outstanding.
- The distinction is explained rather than merely asserted, so the
  instruction survives paraphrase: as a top-level session waiting is free, as
  a sub-agent it is fatal.
- If the harness cannot wait for a sub-agent inline, the role says what to do
  instead — poll for the artefact the sub-agent was to produce, or escalate
  — rather than leaving it undefined.
- The equivalent Codex path in `adapters/codex/` is checked for the same gap,
  since its degraded flow already runs the roles sequentially in one thread.
- `docs/harness-capabilities.md` records the constraint, since it is a
  harness-behaviour fact rather than a workflow preference.

## Notes

This is prose, not code, so it cannot be enforced by a test — which argues
for stating it at the point of use, next to each spawn instruction, rather
than once in a preamble that compaction can strand. The tier-3 telemetry
additions took the same approach and stuck.
