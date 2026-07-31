## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` in the worktree (commit `ca3d6f9`) — touches exactly `lib/ui/queue.js`, `lib/ui/screens/fleet.js`, `lib/ui/watch.js`, their three test files, and the `openspec/changes/fleet-quick-start-widget/*` planning artifacts. `lib/ui/screens/launchpad.js` and `lib/ui/router.js` are untouched (`git diff main...HEAD --stat -- lib/ui/screens/launchpad.js lib/ui/router.js` empty), matching `files-modified.md`'s claim of pure reuse — no scope creep.

- **Ticket + design + spec read directly**: `openspec/changes/fleet-quick-start-widget/ticket.md`, `design.md`, `specs/fleet-quick-start/spec.md` (note: this worktree's spec delta lives at `openspec/changes/fleet-quick-start-widget/specs/fleet-quick-start/spec.md`, not the top-level `openspec/specs/...` path — it hasn't been archived/promoted yet, which is expected pre-merge). Also read `tasks.md` (all sections 1-5 checked, 6 honestly left unchecked with a stated reason) and `skeptic-design-5.md`'s referenced "known open gap" (tasks.md 2.5/4.2, `quickStartCold`).

- **Full code read of the actual diff** (`git diff main...HEAD -- lib/ui/queue.js lib/ui/screens/fleet.js lib/ui/watch.js`), traced line-by-line against every Decision in design.md and every Requirement/Scenario in spec.md:
  - `queue.enqueueOne` matches Decision 5's exact shape (no-op on already-`pending`/`inFlight`, returns `null` for a falsy queue, `Object.assign` copy).
  - `buildSections`'s new `kind` field, `QUICK START` entry (`forceRender`/`emptyHint`, `cap: QUICK_START_COUNT`), all three previously-unforwarded `buildSections` call sites (`visibleWindow`, `renderFleet`, `sectionJumpTargets`) now correctly forward `opts`/`quickStartVisible` — verified against design.md Decision 4's explicit "none of buildSections' three call sites forward opts" list, all three fixed.
  - `renderFleet`'s per-row dispatch now branches on `s.kind` (`'queued'` → unchanged `renderQueuedRow`, `'quickstart'` → new `renderQuickStartRow` on ticket objects, not id strings) — matches Decision 4 mechanism step 5 exactly.
  - `handleKey`'s digit-jump branch switches on `target.section.kind` (`'queued'`→`focus-queue`, `'quickstart'`→`focus-quickstart`, default→`jump`) and the new `focus === 'quickstart'` block (sibling to, not folded into, `focus === 'queue'`) emits `move-quickstart-focus`/`quickstart-add`/`exit-quickstart-focus`, suppresses Enter/l/n/N — matches Decision 3.
  - **The "known open gap" resolution** (`quickStartCold`): `watch.js`'s `draw()` computes `const quickStartCold = quickStartVisible ? cache.isCold(cache.read(root)) : false;`, threads it through the `router.render(...)` opts alongside `quickStartTickets`, and `fleet.js`'s `buildSections` reads `o.quickStartCold` to pick `'no tickets cached yet — press N to fetch'` vs `'nothing left to quick-start'` — both strings match spec.md's two Scenarios verbatim. This is real, wired, end-to-end — not a stub.
  - `watch.js`'s `quickStartEligible()` (sortByPriority → isSelectable filter → not-already-queued filter → slice) matches Decision 4's pseudocode exactly; `quickstart-add`'s handler re-derives the list fresh and no-ops on an out-of-bounds index, matching Decision 5/3's "handleKey has no ticket data, watch.js resolves it" split.
  - Confirmed `cache.isCold`, `launchpadScreen.sortByPriority`/`isSelectable`/`priorityLabel`, `crypto`, all pre-exist and are correctly reused (`grep` against `lib/ui/cache.js`, `lib/ui/screens/launchpad.js`, `lib/ui/watch.js`'s existing requires) — no reimplementation.
  - Confirmed the ticket cache (`linear.js`'s `QUERY`) is already filtered server-side to open `state.type` values, so `quickStartEligible()`'s "open tickets flattened across all epics" requirement is satisfied for free by reusing the same cache `launchpad.js` uses — not a gap.

- **Every spec.md ADDED Requirement traced to real code + a real test**, not just asserted:
  1. Hidden-by-default + `Q` toggle → `watch.js` `quickStartVisible = false` default; `applyAction`'s `toggle-quickstart` case; tests `test('quickstart-add with no active queue creates...')` and fleet.test.js's `'Q returns the toggle-quickstart action...'`.
  2. Priority list flattened across epics, excluding running/queued → `quickStartEligible()`; watch.test.js's `'the eligible list excludes a ticket that already has a live run...'` and `'an already-queued ticket never appears in the QUICK START list at all...'` (both literally assert on rendered frame content, not just internal state).
  3. Empty/cold hint → fleet.test.js `'a cold cache shows the fetch hint, distinct from the fully-filtered hint'` matches spec text verbatim; watch.test.js `'an out-of-bounds quickstart-add index (empty eligible list) is a no-op...'` exercises the cold path through a real `watch()` instance end to end.
  4. Row-index safety → `unselectable: true`; fleet.test.js `'no QUICK START row is ever marked with the ordinary run-row ▸ selection marker'`.
  5. Own focus cursor via digit-jump/`Q` → fleet.test.js digit-jump discrimination tests (`quickstart` vs `queued` vs ordinary section).
  6. `a` reuses `queue.createQueue`/`queue.enqueueOne` → watch.test.js's two-press test proves both the create-fresh-queue branch AND the append-onto-active-queue branch (via a second press that resolves to a *different* ticket once the first is `inFlight`), asserting `maxConcurrent`/`launchCommand` preserved by comparing spawn command templates.

- **Re-ran the full test suite myself, fresh, in the worktree** (not trusting the evaluator's pasted output):
  ```
  npm test   →  exit 0
  node --test summary: "ℹ pass 841 / ℹ fail 0" (no `not ok` lines anywhere in the full log)
  ```
  Also ran the three changed unit-test files individually for a second, isolated confirmation:
  - `node --test test/watch.test.js` → 41 passed, 0 failed (includes all 5 new CON-40 integration tests, each independently re-verified above)
  - `node --test test/fleet.test.js` → 141 passed, 0 failed
  - `node --test test/queue.test.js` → 54 passed, 0 failed
  All shell suites (`test/scripts/*.test.sh`, including `check-merge-readiness.test.sh`, `watch-smoke.test.sh`) also passed in the same full run — no flakiness observed, ran twice.

- **UI/design judgment**: N/A per this project's configuration (no design standard file, no dev server for a terminal TUI). Confirmed `f.STATUS_COLOUR` (in `format.js`) has no `'quickstart'` key, so the QUICK START title falls back to uncoloured via the existing `|| ((x) => x)` fallback — the evaluator flagged this correctly as a non-blocking cosmetic gap; I confirm it is real but does not affect correctness (the fallback path is itself an existing, tested mechanism used elsewhere in this file).

### Non-blocking notes
- `f.STATUS_COLOUR` has no `quickstart` entry — the QUICK START title renders uncoloured while every sibling section (`needs-you`/`running`/`failed`/`done`/`queued`) has a distinct colour. Purely cosmetic; worth a one-line follow-up but not worth blocking this ticket on.
- `test/watch.test.js` has an explicit integration test for QUEUED's "jumping into focus, moving the cursor, and exiting leaves the run selection completely unchanged" invariant, but no directly-analogous one for QUICK START's `focus-quickstart`/`exit-quickstart-focus` actions. I traced the actual `applyAction` cases in `lib/ui/watch.js` by hand: neither `'focus-quickstart'` nor `'exit-quickstart-focus'` nor the open-branch of `'toggle-quickstart'` touches `selected`/`scrollOffset` anywhere in their bodies, so the invariant genuinely holds — this is a test-coverage gap, not a functional defect, and does not change the verdict.

### Verdict: CONFIRM

All acceptance criteria (the ticket's three design questions, resolved and formalized as spec.md's ADDED Requirements) trace to real, working code and to tests I independently ran and watched pass. The previously-flagged "known open gap" (`quickStartCold`) is genuinely resolved, not hand-waved. No scope creep, no regressions (full suite green), no second competing queuing mechanism introduced. Ships.
