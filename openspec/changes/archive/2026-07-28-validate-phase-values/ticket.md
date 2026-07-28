# CON-3: A malformed phase value silently breaks the progress bar while claiming full telemetry

## Description

The phase vocabulary is coupled between three places by prose alone:

* `core/workflow-state.template.md` defines the enum: `Setup | Planning | Execution | Evaluation | Delivery | Cleanup`.
* `core/roles/orchestrator.md` instructs `emit-event.sh phase.enter ... phase=<Phase>`.
* `lib/ui/screens/fleet.js` has a `PHASE_ORDER` array that must match, and computes the progress bar from `indexOf`.

Nothing enforces the agreement. The orchestrator doc's own section headings read `## Phase 2: Execution`, so a model has a plausible reason to write `phase=Phase 2`. Bash then word-splits it, `phase` becomes `"Phase"`, `indexOf` returns `-1`, and the progress bar renders empty forever.

### Why it matters more than a cosmetic glitch

The run still reports `telemetry: full`, because a `phase.enter` event did arrive. So the dashboard shows a confidently-empty progress bar on a run it claims to fully understand — absent data rendering as healthy data, which is the one property the three-tier design exists to prevent.

## Acceptance criteria

* An unrecognised phase value is detected rather than silently producing `-1`, and renders as visibly unknown rather than as zero progress.
* `PHASE_ORDER` and the `workflow-state.template.md` enum cross-reference each other so a future edit to one is likely to prompt the other.
* The orchestrator role doc states the exact permitted values at the point it instructs the emit, rather than `<Phase>`.
* A reducer or fleet test covers an unrecognised phase value.

## Notes

Consider whether the reducer is the right place to validate, so the fleet screen receives something already known-good — that keeps the screen a pure renderer, consistent with how the rest of the pipeline is split.
