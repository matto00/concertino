## 1. Canonical PHASE_ORDER in the reducer

- [x] 1.1 Move `PHASE_ORDER` (`['Setup', 'Planning', 'Execution', 'Evaluation', 'Delivery', 'Cleanup']`) into `lib/ui/reducer.js` as a module-level constant, next to `TIER2_KINDS`/`TIER3_KINDS`, with a comment cross-referencing `core/workflow-state.template.md`'s `PHASE:` enum.
- [x] 1.2 Export `PHASE_ORDER` from `lib/ui/reducer.js`'s `module.exports`.
- [x] 1.3 Update `lib/ui/screens/fleet.js` to import `PHASE_ORDER` from `../reducer` instead of defining it locally; keep re-exporting it under the same name from `fleet.js`'s own `module.exports` so existing importers (`drilldown.js`, tests) are unaffected.
- [x] 1.4 Confirm `lib/ui/screens/drilldown.js`'s `require('./fleet')` import of `PHASE_ORDER` still resolves correctly (no change expected, verify only).

## 2. Validate phase.enter in the reducer

- [x] 2.1 In `lib/ui/reducer.js`'s `applyEvent`, change the `phase.enter` case so it only sets `run.phase = ev.phase` when `ev.phase` is a member of `PHASE_ORDER`.
- [x] 2.2 When `ev.phase` is present but not a member of `PHASE_ORDER`, leave `run.phase` unchanged and increment `run.malformed` by one.
- [x] 2.3 Leave the `cycle` handling in the same case untouched (cycle is not being validated by this change).
- [x] 2.4 Update the doc comment on `lib/ui/store.js`'s malformed-line counting (around the "a malformed line is skipped and counted, never thrown" comment) and the comment framing `run.malformed`/`TIMELINE ▲ N malformed` in `lib/ui/screens/drilldown.js` (around line 289) so both state the counter now covers two cases: an event-log line dropped before becoming an event, and an event that was recorded but had a field the reducer rejected (e.g. an unrecognised `phase.enter` value) — see design.md's "`run.malformed` deliberately broadens" decision.
- [x] 2.5 Update `test/drilldown.test.js`'s comment around line 70-71 ("reducer.js already counts malformed lines per run") the same way, for consistency with 2.4 (cosmetic, not behavior).

## 3. Cross-reference the enum at its prose sites

- [x] 3.1 Add a comment to `core/workflow-state.template.md`'s `PHASE:` line naming `PHASE_ORDER` in `lib/ui/reducer.js` as the enforced source of truth.
- [x] 3.2 Update `core/roles/orchestrator.md`'s `phase.enter` telemetry instruction to state the exact permitted values inline (`Setup | Planning | Execution | Evaluation | Delivery | Cleanup`) instead of `phase=<Phase>`.

## 4. Tests

- [x] 4.1 Add a `test/reducer.test.js` case: a `phase.enter` event with an unrecognised `phase` value does not set `run.phase` and increments `run.malformed`.
- [x] 4.2 Add a `test/reducer.test.js` case: a valid `phase.enter` following an unrecognised one still applies correctly (i.e. validation doesn't wedge subsequent valid events).
- [x] 4.2a Add a `test/reducer.test.js` case matching specs/phase-telemetry/spec.md's "A rejected-field event still appears in the timeline" scenario: one dropped envelope-malformed line plus one `phase.enter` event with an unrecognised value together bring `run.malformed` to 2, and only the `phase.enter` event (not the dropped line) appears in `run.events`.
- [x] 4.3 Add a `test/fleet.test.js` case that exercises `reduce()` end-to-end (raw events in, rendered string out — not a hand-built `run()` fixture with `phase: null`, which would just re-prove the existing "phase unknown" test at test/fleet.test.js:49-53): feed a `phase.enter` event with an unrecognised value through `reduce()`, then render the resulting run and assert it reads "phase unknown" with a zero-fill progress bar, proving the reducer's validation is what keeps the phantom-phase label from ever reaching the screen.
- [x] 4.4 Run the full suite (`npm test`) and confirm no regressions in existing `PHASE_ORDER`/phase-rendering tests.

## 5. Verification

- [x] 5.1 `openspec validate --change "validate-phase-values" --strict` passes.
- [x] 5.2 Manually trace one existing valid run's fixture through the updated reducer to confirm identical output (no behavioral change for well-formed runs).
