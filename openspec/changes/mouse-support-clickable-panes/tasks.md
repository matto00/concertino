## 1. Mouse-reporting lifecycle (`lib/ui/frame.js`, `lib/ui/watch.js`)

- [x] 1.1 Add `MOUSE_REPORT_ENTER` / `MOUSE_REPORT_EXIT` named constants to `lib/ui/frame.js` (SGR mouse mode `\x1b[?1000h\x1b[?1006h` / `\x1b[?1000l\x1b[?1006l`), exported alongside the existing `ALT_SCREEN_ENTER`/`CURSOR_HIDE` constants.
- [x] 1.2 Write `MOUSE_REPORT_ENTER` in `watch.js` at the same point raw mode is first enabled on startup.
- [x] 1.3 Write `MOUSE_REPORT_EXIT` at each of the three existing `setRawMode(false)` call sites in `watch.js` (`quit()`, and both directions of `doAttach`/`doAttachTarget`'s suspend-for-attach) — this is the complete existing set (verified: `grep -n "setRawMode(false)" lib/ui/watch.js`), not four sites.
- [x] 1.4 Re-enable mouse reporting on the restore-after-attach path, matching whatever the alt-screen restore already does at that same point.
- [x] 1.5 Add a new top-level `process.on('uncaughtException', handler)` in `watch.js` (design.md Decision 5) that restores full terminal state (`setRawMode(false)`, `ALT_SCREEN_EXIT + MOUSE_REPORT_EXIT + CURSOR_SHOW`) then re-throws/exits — this handler does not exist today. Guard it with the same re-entrancy flag `quit()` uses so a throw during shutdown cannot double-write the restore sequence.
- [x] 1.6 Hold a reference to the `handler` function from 1.5 and call `process.removeListener('uncaughtException', handler)` inside `quit()` (guarded by the same `quitting` flag, so removal happens exactly once). This is required so a second `watch()` call in the same process (as `test/watch.test.js` already does ~62 times sequentially) does not accumulate stale handlers — unlike the pre-existing, never-removed `process.stdout.on('resize', ...)` listener (a known, already-accepted, separate trade-off this task does not touch), an unmanaged `uncaughtException` handler risks an earlier call's stale handler firing `process.exit(1)` in response to a later, unrelated call's error.
- [x] 1.7 Add a unit test (`test/watch.test.js` or `test/frame.test.js`) that simulates an uncaught exception and asserts the full terminal-restore sequence (raw mode, alt-screen, mouse mode, cursor) is written exactly once. Add a second test asserting that after `quit()` runs, `process.listenerCount('uncaughtException')` returns to its pre-`watch()` count (no leaked handler) — following the same park/restore precedent `test/watch.test.js` already uses for the `resize` listener (e.g. lines 1657-1658, 3723-3724) if a similar isolation pattern is needed for this test. Also add a test asserting the enter/exit sequences are textually paired across the three normal exit paths, mirroring however the existing alt-screen pairing is already tested.

## 2. Mouse sequence parsing (`lib/ui/frame.js`)

- [x] 2.1 Add a pure `parseMouseClick(key) -> {row, col} | null` function next to `splitKeys`, matching a left-button-press SGR sequence (`^\x1b\[<0;(\d+);(\d+)M$`).
- [x] 2.2 Confirm (with a unit test) that `splitKeys` already yields a full SGR mouse sequence as a single token (it ends in `M`/`m`, within the existing CSI-final-byte range) — no change to `splitKeys` needed if so; add a regression test either way.
- [x] 2.3 Unit-test `parseMouseClick` against a left-click sequence, a release (`m`) sequence (must return `null` — only press is handled), and a non-mouse CSI sequence (must return `null`, falls through to keypress handling).

## 3. Fleet row bounding-box tracking (`lib/ui/screens/fleet/render.js`, `rows.js`)

- [x] 3.1 Extend the fleet render pass to also produce a `{ [terminalRow]: runsIndex }` map for the currently-visible run rows, consistent with the existing `visibleWindow`/`scrollOffset` math.
- [x] 3.2 Wire this map through to `watch.js`'s per-frame state (stored alongside `prevLines`), so it reflects the current, not stale, frame.
- [x] 3.3 Unit-test the row-index map against a representative rendered frame (including scrolled state) to confirm terminal rows map to the correct `runs[]` indices.

## 4. Click dispatch (`lib/ui/watch.js`)

- [x] 4.1 In the stdin `data` handler, try `parseMouseClick` on each split key before falling through to `router.handleKey`.
- [x] 4.2 On a matched click, resolve `(row, col)` against the fleet row-index map (only when `state.mode === 'fleet'`); if it resolves, dispatch `{ type: 'jump', index }` through the existing `applyAction` path — no new controller action type.
- [x] 4.3 A click that doesn't resolve to a mapped row is a no-op — verify no action is dispatched and no error is thrown.
- [x] 4.4 Add an integration-level test exercising a synthetic click chunk through the stdin handler end-to-end (selection changes to the clicked row).

## 5. Documentation

- [x] 5.1 Document the new click-to-select behavior in `docs/dashboard.md`: scope (fleet run-row list only, this pass), what a click does (select only, never opens drilldown), and the known tmux-compatibility caveat (deferred verification, follow-up ticket to be filed).

## 6. Verification

- [x] 6.1 Run the full test suite and existing verification gates; confirm no regression to keyboard-only interaction paths (`j`/`k`/digit-jump/Enter/`l` on the fleet screen).
- [x] 6.2 Manually confirm (or via test harness) that quitting/crashing leaves no mouse-reporting escape sequences visible in a real terminal.
