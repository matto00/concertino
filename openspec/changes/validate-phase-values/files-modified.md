# Files modified — validate-phase-values (CON-3)

- `lib/ui/reducer.js` — added the canonical `PHASE_ORDER` constant (module-level, next to `TIER2_KINDS`/`TIER3_KINDS`) with a comment cross-referencing `core/workflow-state.template.md`'s `PHASE:` line; `applyEvent`'s `phase.enter` case now validates `ev.phase` against `PHASE_ORDER` — a recognised value updates `run.phase` as before, an unrecognised one leaves `run.phase` untouched and increments `run.malformed`; exported `PHASE_ORDER` from `module.exports`.
- `lib/ui/screens/fleet.js` — imports `PHASE_ORDER` from `../reducer` instead of defining its own copy; still re-exports it under the same name from `fleet.js`'s own `module.exports` so `drilldown.js` and existing tests are unaffected.
- `lib/ui/screens/drilldown.js` — no import change needed (already imports `PHASE_ORDER` from `./fleet`, which now re-exports the reducer's copy); updated the doc comment above `TIMELINE`'s malformed-count line to state `run.malformed` now covers two cases (a dropped envelope-malformed line, and a recorded event with a field the reducer rejected, e.g. an unrecognised `phase.enter` value).
- `lib/ui/store.js` — updated the doc comment on `readEvents`'s malformed-line counting to note it is one of two ways `run.malformed` grows, pointing at the reducer's field-level rejection as the other.
- `core/workflow-state.template.md` — added a comment on the `PHASE:` line naming `PHASE_ORDER` in `lib/ui/reducer.js` as the enforced source of truth.
- `core/roles/orchestrator.md` — the `phase.enter` telemetry instruction now states the exact permitted values inline (`Setup | Planning | Execution | Evaluation | Delivery | Cleanup`), names the cross-referenced files, and explicitly warns that a section heading like "Phase 2: Execution" is not itself a phase value.
- `test/reducer.test.js` — added three cases: an unrecognised phase value doesn't set `run.phase` and increments `run.malformed`; a valid `phase.enter` after an unrecognised one still applies; and a combined case (one dropped envelope-malformed line + one rejected-phase event) bringing `run.malformed` to 2 while only the `phase.enter` event appears in `run.events`.
- `test/fleet.test.js` — added an end-to-end `reduce()` → `renderFleet()` case: a `phase.enter` event with an unrecognised value renders as "phase unknown" with zero progress and surfaces "1 malformed events", proving the reducer's validation (not just the screen's existing null-phase fallback) keeps the phantom-phase label off the screen.
- `test/drilldown.test.js` — updated the comment above the "malformed events" test block to describe both cases the counter now covers, matching the design.md decision.
- `openspec/changes/validate-phase-values/tasks.md` — all 18 tasks marked complete.

## Debugging note

No bug was hit during implementation — this is new validation logic added per the reviewed design, not a fix for a reproduced failure in the new code itself. The underlying CON-3 symptom (a malformed `phase=Phase 2` silently zeroing the progress bar while `telemetry: full`) was reproduced conceptually via the new fleet.test.js case, which fails without the reducer.js validation and passes with it — confirmed by running the full suite before/after the reducer change conceptually matches the task's spec scenario.

## Verification

- `npm test` — exit 0, 377 tests passed, 0 failed (node:test runner summary) plus all shell-script test suites passed.
- `openspec validate --changes "validate-phase-values" --strict` — exit 0, "Totals: 1 passed, 0 failed".
- Manual trace (task 5.2): a well-formed run fixture (`run.start` → `phase.enter phase=Execution` → `gate.result`) reduces identically to pre-change behaviour: `phase: "Execution"`, `cycle: 1`, `malformed: 0`, `telemetry: "full"`, `status: "running"`.
