## 1. `lib/ui/screens/fleet.js` — always-visible section

- [x] 1.1 In `buildSections()`, remove the `if (o.quickStartVisible)` gate around the `QUICK START` entry — push it unconditionally (mirroring the `METRICS` entry's `if (o.metrics)` shape, but with no `opts` flag needed at all). Keep `quickStartTickets`/`forceRender`/`emptyHint`/`quickStartCold` handling exactly as-is.
- [x] 1.2 In `sectionJumpTargets()`, drop the `quickStartVisible` parameter and the `quickStartVisible` key passed into its internal `buildSections()` call — inclusion is now unconditional. Update its header comment (it currently explains why `quickStartVisible` must be threaded through explicitly; that reasoning no longer applies).
- [x] 1.3 In `handleKey()`, delete the `key === QUICK_START_TOGGLE_KEY` branch (the `'toggle-quickstart'` dispatch) and its surrounding comment block. Delete the `quickStartVisible` read at the top of `handleKey` if it becomes unused after this removal — check `sectionJumpTargets`' call site (task 1.2) no longer needs it passed in either.
- [x] 1.4 In `handleKey()`'s digit-jump branch, update the call to `sectionJumpTargets(...)` to match its new signature (task 1.2).
- [x] 1.5 Delete the `QUICK_START_TOGGLE_KEY` constant and its collision-avoidance comment block. Update the exports list at the bottom of the file to drop `QUICK_START_TOGGLE_KEY`.
- [x] 1.6 In the footer-hints builder (`buildHeadTail` or equivalent, ~line 774), remove `'Q quick start'` from the unconditionally-advertised hints array, and its now-stale comment explaining why `Q` is hinted unconditionally.
- [x] 1.7 In `render()`, stop forwarding `quickStartVisible: state.quickStartVisible` into `opts` — it is no longer read anywhere downstream.

## 2. `lib/ui/watch.js` — drop the visibility state

- [x] 2.1 Remove the `let quickStartVisible = false;` declaration and its header comment (~line 544-555). Keep `let quickStartFocus = 0;` — local focus navigation is unchanged.
- [x] 2.2 Remove `quickStartVisible` from `currentState()`'s returned object.
- [x] 2.3 Remove the `'toggle-quickstart'` case from `applyAction` (the block handling open/close/re-focus semantics — search for `case 'toggle-quickstart':`).
- [x] 2.4 In `draw()`, change `quickStartTickets`/`quickStartCold` computation from conditional on `quickStartVisible` to unconditional — always call `quickStartEligible()` and `cache.isCold(cache.read(root))`.
- [x] 2.5 Grep the rest of `watch.js` for any other `quickStartVisible` reference (e.g. resume/restore logic, session-state persistence) and remove it.

## 3. Documentation

- [x] 3.1 Grep `docs/dashboard.md` and any other user-facing docs for `Q` / "Quick Start" toggle language; confirm whether the toggle was ever documented there and remove any such text if present (it may already be undocumented — verify rather than assume).

## 4. Tests

- [x] 4.1 Update `test/fleet.test.js`'s import list to drop `QUICK_START_TOGGLE_KEY` (no longer exported).
- [x] 4.2 Rewrite or remove tests asserting `quickStartVisible`-gated behavior — in particular (line numbers approximate, current file):
  - `'the QUICK START section only appears when quickStartVisible is true'` → rewrite to assert it always appears (drop the `quickStartVisible: true` opt from fixtures since it's no longer read; verify passing it is harmless or remove it).
  - `'buildSections builds no QUICK START entry at all when quickStartVisible is falsy'` → remove (behavior no longer exists) or invert into a test asserting it's always built.
  - `'a hidden (quickStartVisible: false) QUICK START costs nothing — the frame is byte-identical either way'` → remove (no longer applicable — there is no hidden state).
  - `'sectionJumpTargets omits QUICK START entirely when quickStartVisible is false'` → remove.
  - `'Q returns the toggle-quickstart action regardless of current state...'` → remove.
  - `'digit-jump against quickStartVisible: false never reaches QUICK START, even with runs present'` → remove.
  - `'the footer always advertises the Q quick start hint'` → remove or rewrite to assert `Q` is no longer hinted.
  - The two force-start/quit-confirm interaction tests using `QUICK_START_TOGGLE_KEY` as the pressed key (~line 2284-2289) → rewrite to press a different key, or remove if they exist solely to test the toggle's interaction with those confirm gates.
- [x] 4.3 Sweep every other fixture/assertion across `test/fleet.test.js` that passes `quickStartVisible: true` merely to make `QUICK START` render (e.g. digit-jump numbering tests, sectionHeight tests, focus-cursor tests) — drop the now-meaningless opt, and confirm the section still renders and numbering still matches with it absent.
- [x] 4.4 Search `test/watch.test.js` (or wherever `applyAction`/`currentState` are tested) for `quickStartVisible`/`toggle-quickstart` references and update/remove analogously.
- [x] 4.5 **`sectionJumpTargets` signature change — audit every call site individually, not by keyword.** Task 1.2 drops `sectionJumpTargets`'s middle `quickStartVisible` parameter (old: `(runs, queueState, quickStartVisible, metricsVisible)` → new: `(runs, queueState, metricsVisible)`). Grep every test file for `sectionJumpTargets(` (not just ones naming `quickStartVisible` — a positional-argument shift breaks call sites regardless of what they name) and re-verify/re-derive each argument list against the new 3-parameter signature. In particular:
  - `test/fleet.test.js:2110`, `'sectionJumpTargets never throws when metricsVisible passes the bare {} stand-in...'`: currently calls `sectionJumpTargets([run({status:'running'})], null, false, true)` — under the old signature this is `(runs, queueState, quickStartVisible: false, metricsVisible: true)`; naively dropping the 3rd positional arg without also removing the now-stale `false` would silently turn `metricsVisible` into `false` and break the `kinds.includes('metrics')` assertion for reasons unrelated to quick start. Fix the call to `sectionJumpTargets([run({status:'running'})], null, true)`.
  - `test/fleet.test.js:2104`, `'sectionJumpTargets includes a forceRender-empty QUICK START when visible'`: its "when visible" premise no longer applies (QUICK START is now unconditionally visible) — it happens to keep passing by accident after the signature change, which would mask that its name/intent is now false. Rename/rewrite it to assert QUICK START is always included (fold into or pair with the always-visible coverage from task 4.2's first bullet), not left as a misleadingly-named passing test.
  - `test/fleet.test.js:2004, 2116` (and any other `sectionJumpTargets(` call site found by the grep) — re-check each against the new signature even if not explicitly named here.
- [x] 4.6 **`test/watch.test.js` — 5 end-to-end tests press the raw key `'Q'` to enter `quickstart` focus; a symbol-name grep will not find them.** Grep `test/watch.test.js` for `emit('data', 'Q')` (the literal keypress, not `quickStartVisible`/`toggle-quickstart` symbol names) — this currently matches 5 tests (`'quickstart-add with no active queue...'`, `'a second quickstart-add onto an already-active queue...'`, `'an already-queued ticket never appears in the QUICK START list...'`, `'an out-of-bounds quickstart-add index...'`, `'the eligible list excludes a ticket that already has a live run...'`, approximately lines 1771/1814/1856/1910/1941). Each uses `h.fakeStdin.emit('data', 'Q')` purely as the mechanism to enter `quickstart` focus before exercising `quickstart-add` via `'a'`. Rewrite each to enter `quickstart` focus via digit-jump instead (the digit that resolves to the QUICK START section in that fixture's section set, per `sectionJumpTargets`/`buildSections` ordering) — do not simply delete these tests, since `quickstart-add` itself is still in-scope behavior that must stay covered.
- [x] 4.7 Grep both `lib/ui/screens/fleet.js` and `lib/ui/watch.js` for every remaining comment referencing `quickStartVisible`/the `Q` toggle after the mechanical removals in sections 1-2 (e.g. `buildSections`' own header comment, `visibleWindow`'s comment, and `exit-quickstart-focus`'s comment, which currently reads "panel stays visible — only Q hides it") and update or delete each so no dead reference to the removed toggle remains.
- [x] 4.8 Run the full suite (`node --test`) and confirm green.

## 5. Verification

- [x] 5.1 Manually sanity-check (or add a scenario-driving test) that `QUICK START`'s local focus navigation (digit-jump entry, `j`/`k` cursor, `a` to add to queue, Escape to exit) still behaves identically to before — the ticket's own acceptance criteria requires this to be unchanged.
- [x] 5.2 Run project lint/typecheck if configured, and the full test suite, before committing.
