## 1. `core/roles/orchestrator.md` — Phase 4 completion + end-of-turn

- [x] 1.1 In Phase 4, add an explicit "genuinely complete" definition
      (cleanup.sh run + ticket Done/closing comment + hygiene check
      reported) immediately after the existing three numbered steps, scoped
      so it clearly does not apply to any earlier phase.
- [x] 1.2 Add a new terminal step: once genuinely complete, raise any
      further suggestion via `emit-event.sh escalation --await`
      (question=/options=, no gather-escalation-context.sh kind — generic
      call) instead of bare chat; skip this step entirely if there is
      nothing to raise. State this is one-shot (at most once per run) and
      does not count against any circuit breaker.
- [x] 1.3 Add the final instruction: once that one-shot escalation (if any)
      has resolved, emit a single terminal summary message and end the
      turn — no further tool calls, no further open-ended questions.
- [x] 1.4 Add a short cross-reference in the Guardrails section pointing at
      this new end-of-run requirement.

## 2. `docs/harness-capabilities.md` — record the never-linger fact

- [x] 2.1 Add a subsection (alongside the existing CON-15 "a suspended agent
      is never resumed" fact) stating the mirror-image fact: once Phase 4
      is genuinely complete, the orchestrator must actually end its turn,
      and why a lingering bare-chat prompt after `run.end` is invisible to
      the dashboard and to `window-reaping`'s conservative "never touch a
      live window" rule.

## 3. `lib/ui/reducer.js` — fix escalation staleness/status after `run.end`

- [x] 3.1 Change `escalationStale`'s computation so it is stale iff the
      window is confirmed not alive, or there is no window data at all —
      no longer forced stale merely because `run.endStatus` is set.
- [x] 3.2 Change `deriveStatus` to return `needs-you` when a non-stale
      escalation is present and the window is confirmed alive, checked
      before the `run.endStatus` done/failed short-circuit; leave every
      other branch's precedence unchanged.
- [x] 3.3 Re-verify by hand (per design.md's Decision 3 trace) that the
      three existing `test/reducer.test.js` escalation-staleness cases
      still pass unchanged under the new logic.

## 4. Tests

- [x] 4.1 `test/reducer.test.js`: add a case — `run.end` (delivered)
      followed by `escalation.raised`, window alive — asserting
      `escalationStale === false` and `status === 'needs-you'`.
- [x] 4.2 `test/reducer.test.js`: add a case — same as above, then
      `escalation.answered` — asserting `status` reverts to `done`.
- [x] 4.3 `test/reducer.test.js`: add a case — `run.end` followed by
      `escalation.raised`, no window data at all — asserting
      `escalationStale === true` (unchanged behavior, explicit regression
      guard).
- [x] 4.4 `test/fleet.test.js`: add/extend a bucketing case confirming a
      `run.end`-then-live-escalation run lands in the `NEEDS YOU` section,
      not `DONE`.
- [x] 4.5 Run the full test suite and confirm no existing test regresses.

## 5. Validation

- [x] 5.1 Re-render the rendered agent files via `concertino sync` (or
      confirm `bin/concertino`'s template renderer needs no block/var
      changes, since this is plain prose with no `{{block:}}`/`{{var:}}`
      additions) and spot-check the rendered
      `.claude/agents/concertino-orchestrator.md` contains the new text.
- [x] 5.2 `openspec validate` the change; run `node --test` across the
      touched test files.
