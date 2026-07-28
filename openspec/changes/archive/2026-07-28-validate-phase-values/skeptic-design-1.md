# Skeptic Report — design gate (round 1)

Verdict: REFUTE

## What I verified (with evidence)
- Ticket (CON-3) fetched via mcp__linear__get_issue and cross-checked against ticket.md in the CON-3 worktree — verbatim match, 4 ACs plus a "Notes" hint about reducer-side validation.
- Read proposal.md, design.md, specs/phase-telemetry/spec.md, tasks.md in full.
- Read the real code: lib/ui/reducer.js, lib/ui/screens/fleet.js, lib/ui/screens/drilldown.js, core/workflow-state.template.md, core/roles/orchestrator.md.
- Read test/reducer.test.js, test/fleet.test.js, plus test/store.test.js, test/drilldown.test.js, lib/ui/store.js for the malformed-count question.
- Circular-import check: reducer.js has zero require calls today (pure module) and nothing requires reducer.js from a screen. Moving PHASE_ORDER into reducer.js and having fleet.js require('../reducer') cannot create a cycle; drilldown.js's existing require('./fleet') for PHASE_ORDER is preserved via re-export. Confirmed no circular-import risk.
- Regression-test risk check: every phase.enter fixture across test/reducer.test.js and test/fleet.test.js uses a valid phase value (Execution, Evaluation, Delivery, Planning). No existing test asserts behavior for an unrecognised phase string, so the plan cannot silently break current coverage.
- AC-by-AC trace: AC1 (unrecognised value detected, renders "unknown" not zero-progress-with-a-label) — traced against fleet.js's real phaseFraction/statusLine; since run.phase never becomes the invalid string under this plan, phaseFraction returns 0 and statusLine prints "phase unknown". AC2 (cross-reference comments) — straightforward, matches. AC3 (orchestrator inline values) — confirmed current text is literally phase=<Phase> at core/roles/orchestrator.md:50, and confirmed the phase vocabulary isn't templated/variable elsewhere in core/, so a static inline list is safe. AC4 (test coverage) — tasks 4.1-4.3 cover it.

## The one substantive design problem
Reusing run.malformed for an unrecognised phase.enter value conflates two different failure modes, and the plan does not reconcile the documentation that currently defines the narrower one.

- lib/ui/store.js:35-58: a line is only counted malformed when unparseable JSON or missing t/kind — and in both cases the event is dropped, never reaching run.events. Comment: "A malformed line is skipped and counted, never thrown."
- lib/ui/screens/drilldown.js:289-295: the comment explicitly frames the counter for the human reader as covering gaps — a run with gaps in its own log renders as a clean, merely-short history — absent data reading as healthy data is what the counter exists to prevent.
- The plan's new use (design.md Decisions, tasks.md 2.2, spec.md's second scenario) increments run.malformed for a phase.enter event that is not dropped — applyEvent still does run.events.push(ev) unconditionally, so the offending event stays fully visible in TIMELINE (via describeEvent, rendering literally as `phase -> Phase 2`).

After this change, the same "N malformed" indicator (fleet-wide and per-run) means two different things with no way to tell which: "N events are gone, you can't see them" (today's meaning, genuinely alarming) vs. "N events are sitting right there in the timeline with a bad field" (self-diagnosing, lower severity). design.md's Risks section acknowledges a version of this and defends it on discoverability grounds, but nothing in tasks.md updates drilldown.js:289-295's comment, which will remain in the codebase describing the counter purely in terms of dropped/gap events — no longer an accurate account of everything it counts once this ships.

## Change Requests
1. Reconcile the run.malformed semantics. Either (a) explicitly broaden and document the counter's meaning — add a task to update the comment at lib/ui/screens/drilldown.js:289-295 (and lib/ui/store.js:35's comment if it also asserts the narrower meaning) to state that "malformed" now covers both dropped envelope lines and recorded-but-semantically-invalid field values, and promote this from a "Risk" to an explicit "Decision" in design.md; or (b) if that conflation is judged unacceptable, keep run.malformed scoped to its current envelope-only meaning and surface the unrecognised-phase count as its own small fact (e.g. run.badPhase) shown next to "phase unknown" rather than folding it into the existing indicator. Either way, tasks.md currently has no task for whichever path is chosen.

## Non-blocking notes
- tasks.md 4.3's planned test/fleet.test.js case is likely to duplicate the existing test at test/fleet.test.js:49-53 ("a partially instrumented run says so instead of inventing a phase") — fleet.js's render logic is agnostic to why run.phase is null. It should exercise reduce() end-to-end (raw events in, rendered string out) to actually prove something new, rather than a hand-built run() fixture with phase: null.

Files read (ground truth): openspec/changes/validate-phase-values/{ticket.md,proposal.md,design.md,tasks.md,specs/phase-telemetry/spec.md}, lib/ui/reducer.js, lib/ui/screens/fleet.js, lib/ui/screens/drilldown.js, lib/ui/store.js, core/workflow-state.template.md, core/roles/orchestrator.md, test/reducer.test.js, test/fleet.test.js, test/store.test.js, test/drilldown.test.js.
