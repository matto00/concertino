# CON-11: Escalations need surrounding context so a decision can be made without attaching

## Description

An escalation currently carries a question and a set of options. That is enough to *ask*, but rarely enough to *decide*.

In practice the human has to attach to the agent's session and read back through the chat to find what prompted the question — which defeats the point of being able to answer from the dashboard. The escalation screen should carry enough context that attaching is the exception, not the rule.

### What context

It varies by what triggered the escalation, which is why this should be gathered by the orchestrator at raise time rather than guessed at render time:

* **New external dependency** — which package and version, what it is for, which file would import it, whether a dependency already in the project could do the job.
* **Breaking API change** — the current signature, the proposed one, and the call sites affected.
* **Budget exhausted** — the cycle counter, the last evaluator or skeptic verdict, and the specific change request that survived being "fixed".
* **BLOCKER (environmental)** — the failing command, its exit code, and the first lines of its output.
* **Contradiction** — the two requirements that cannot both hold, quoted.

### Shape

Add a canonical script — `gather-escalation-context.sh` or similar — alongside the other procedure scripts, so context gathering is a committed procedure rather than prose the model improvises. It should take the escalation kind and the relevant identifiers and emit structured context, which `emit-event.sh escalation --await` carries on the `escalation.raised` event.

The escalation screen then renders it above the options.

## Acceptance Criteria

* `escalation.raised` carries a structured `context` payload alongside `question` and `options`.
* The orchestrator role gathers it via the script at the point it already raises the escalation — no new decision point for the model, consistent with how tier-3 telemetry was added.
* The escalation screen renders context above the options, degrading honestly when there is none rather than showing an empty frame.
* Context respects the 4000-byte event line cap. If it does not fit, it is truncated visibly — a silently clipped diff is worse than a short one. Consider whether large context should live beside the event log as a file the screen reads, the way evidence refs are meant to (see CON-10).
* Tests cover an escalation with context, one without, and one whose context is too large.

## Notes

The value is measurable: if answering an escalation from the dashboard still requires attaching, the control plane built in slice 2 has not actually paid for itself. Treat "could I decide from this screen alone?" as the acceptance bar.

Related: CON-10 (evidence refs — `persist-evidence.sh` copies artifacts into `<main checkout>/.concertino/runs/<TICKET>/evidence/`, which `cleanup.sh --phase4` never touches, and omits the ref entirely rather than emit one that dangles). Reuse that mechanism for any large context rather than inventing a second one.
