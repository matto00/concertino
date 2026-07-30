## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to code:**
  - Digit-key section jump, positional over visible sections: `sectionJumpTargets()` (`lib/ui/screens/fleet.js:634-645`) reuses the exact `buildSections(bucketRuns(runs), queueState)` call filtered to `group.length > 0`, and `handleKey` (`fleet.js:679-692`) resolves digits `1`-`9` against it, emitting `jump`/`focus-queue`. Confirmed by re-run test `a digit press jumps directly to a scrolled-past section and scrolls it back into view` (test/watch.test.js:785) and `fleet.test.js`'s "numbering skips empty sections" test — both pass.
  - QUEUED rows show speed/agent-merge: `renderQueuedRow` (`fleet.js:118-142`) takes `opts.speed`/`opts.agentMerge`, sourced once per render from `launchplan.parseLaunchCommand(queueState.launchCommand)` (`fleet.js:519-522`). Verified `parseLaunchCommand`'s regex (`launchplan.js:109-127`) matches exactly the token format/position `withAgentMergeFlag`/`withSpeedFlag` (`launchplan.js:78-102`) write — read both functions side by side, no drift.
  - Force-start bypassing `maxConcurrent` with a load-bearing `y`-gated warning: `queue.forceStart` (`lib/ui/queue.js:292-311`), `fleet.js`'s `forceStartConfirm` branch (`buildHeadTail`, ~line 295) rendering the exact "this will run N+1 concurrently, exceeding your maxConcurrent:N setting — proceed?" wording, `handleKey`'s `forceStartConfirm` interception checked *before* `quitConfirm` (`fleet.js:678-682`). Verified end-to-end by re-running `force-start: f opens a confirmation, any key cancels, y actually starts the ticket and persists the queue` (test/watch.test.js:983) — passes, and asserts the persisted `queue.json` record moves the ticket from `pending` to `inFlight`.
  - CON-29 interaction (persisted queue reconciliation): `forceStart`'s returned queue is shaped identically to `tick()`'s (`pending`/`inFlight`/`maxConcurrent`/`launchCommand`/`confirmed`/`restoredFrom`), so `queue-cache.js`'s write path and CON-29's restore/reconciliation logic apply unchanged — no new "manually started" state introduced.

- **Design.md Decision 4 (the orchestrator's specific concern) — verified directly in the diff:** `lib/ui/queue.js:292-311`'s `forceStart` sets `confirmed: queue.confirmed` (passthrough), explicitly *not* the hard-coded `confirmed: true` that `tick()` uses (`queue.js:148`, with its own comment explaining why that hard-code is safe only for `tick()` and not `forceStart`). Confirmed by reading the diff directly (not just the design doc's claim) and by re-running the two targeted unit tests:
  - `force-starting one ticket out of a queue with confirmed: false returns a queue whose confirmed is still false, and shouldTick stays false` (test/queue.test.js:443) — asserts `next.confirmed === false` and `shouldTick(next) === false` after force-starting one ticket out of an unconfirmed restored queue, with the rest of `pending` un-admitted. Passes.
  - `force-starting a ticket out of an already-confirmed: true queue returns confirmed: true unchanged` (test/queue.test.js:458) — passes.
  This is exactly the narrow, deliberate exception design.md Decision 4 specifies — not a shortcut, not a regression risk to CON-29's confirm gate for the rest of a restored batch.

- **Design.md Decision 1 (QUEUED-local cursor never perturbing `state.selected`) — verified directly:** `focus-queue` action (`watch.js`, `applyAction`'s `focus-queue` case) sets only `focus`/`queueFocus`, never touching `selected`/`scrollOffset`; `move-queue-focus` mutates only `queueFocus`; `jump` (runs-backed target) explicitly resets `focus = 'runs'`/`queueFocus = null` since it can never target QUEUED by construction. Re-ran the integration test `jumping into QUEUED focus, moving the cursor, and exiting leaves the run selection completely unchanged` (test/watch.test.js:882) — it drives the real poll loop end to end (moves selection to HEL-2, jumps into QUEUED focus, moves the QUEUED cursor, exits via Escape) and asserts the run-selection marker stays on HEL-2 throughout. Passes.

- **Gates re-run myself (fresh, not trusted from the evaluator's report):**
  - `npm test` — exit code 0, no `not ok` lines anywhere in the full output (804+ node tests across all suites, plus all 16 bash gate-script suites). Matches the evaluator's claimed count/shape.
  - Re-ran the four changed-area test files in isolation (`node --test test/queue.test.js test/fleet.test.js test/watch.test.js test/launchplan.test.js`) as a second, independent pass to rule out flakiness: 243/243 pass, 0 fail. Stable across both runs.
  - `grep -rn "TODO\|FIXME\|console.log\|debugger"` across the four changed `lib/ui/` files: no matches.

- **Scope/spec alignment:** `git diff main...HEAD --stat` touches exactly `lib/ui/queue.js`, `lib/ui/screens/fleet.js`, `lib/ui/screens/launchplan.js`, `lib/ui/watch.js`, their tests, and the planning/spec-delta artifacts — nothing else. Spec deltas (`fleet-section-jump`, `fleet-queue-force-start` ADDED, `fleet-queue-visibility` MODIFIED/ADDED) match the implemented behavior scenario-by-scenario; no drift found between design.md's five decisions and the actual code.

- **UI/design judgment:** N/A per gate instructions — no UI design standard is configured for this project, and `fleet.js` is a terminal (tmux) text UI, not a browser view; no dev-server/screenshot review applies.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what the evaluator already noted. The `forceStart`/`confirmed`-passthrough subtlety (Decision 4) and the QUEUED-local-cursor isolation (Decision 1) — the two areas the orchestrator specifically flagged for scrutiny — are both correctly implemented in the diff (not merely claimed) and each has a dedicated, currently-passing regression test that would catch a reversion (hard-coding `confirmed: true`, or `focus-queue`/`jump` touching `state.selected`).
