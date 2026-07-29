# CON-31: Stale-base warning at the delivery gate for long-running orchestrators

## Description

Follow-up carved out of CON-25.

CON-25 solved the stale-base problem from one end: after a run's PR merges, Phase 4 cleanup fast-forwards local `main` so the *next* run branches from a current base. The other end is still open, and `ROADMAP.md` still carries it as a near-term item.

### The gap

A long-running orchestrator branches from a base that was current at setup time. While it works — through planning, several execution/evaluation cycles, the skeptic gates — sibling runs merge and the base moves underneath it. Nothing tells it. It arrives at the delivery gate about to open a PR against a base it has never seen, and the first sign of trouble is a conflict on the PR (CON-8 vs CON-7, cited in CON-25).

CON-25's Phase 4 fast-forward does not help here: it runs *after* the merge, and the run in question is still mid-flight.

### The shape

A check at the delivery gate that compares the run's base against the fetched remote base and **warns, never blocks**. This is deliberately different from the Phase 4 behaviour:

* Phase 4 acts (fast-forwards) and escalates when it can't.
* The delivery gate only *informs* — a diverged base mid-run is normal and usually harmless, and stalling a finished run behind a human answer would be worse than the occasional rebase.

Consider whether the warning belongs on the PR body, the run's telemetry, the dashboard, or all three.

## Acceptance Criteria

* At the delivery gate, a run whose base has moved since setup surfaces a warning naming the commits it is behind by.
* The warning never blocks delivery and never raises a blocking escalation.
* A run whose base is current produces no output.
* Remove the corresponding near-term item from `ROADMAP.md` once shipped.

## Notes

Grows in importance alongside CON-24 (agent-merge) for the same reason CON-25 does: more frequent, less observed merges widen the window in which a mid-flight run's base is stale.
