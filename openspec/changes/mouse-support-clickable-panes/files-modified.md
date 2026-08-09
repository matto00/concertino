# Files modified — CON-112 (mouse-support-clickable-panes)

- `lib/ui/frame.js` — added `MOUSE_REPORT_ENTER`/`MOUSE_REPORT_EXIT` named
  SGR-mouse-mode constants (paired like `ALT_SCREEN_ENTER`/`ALT_SCREEN_EXIT`)
  and the pure `parseMouseClick(key) -> {row, col} | null` left-button-press
  recognizer, next to `splitKeys`; both re-exported.
- `lib/ui/app-state.js` — added `fleetRowMap: null` to `createAppState()`'s
  initial shape (documents the new per-frame click hit-test field watch.js's
  draw() rebuilds every poll; not part of `currentState()`'s own snapshot).
- `lib/ui/screens/fleet/render.js` — factored the existing `renderFleet`
  body into a shared `buildFleetOutput(runs, opts) -> { text, rowMap }` so
  the string-returning `renderFleet` contract stays byte-for-byte unchanged
  for its ~150 existing call sites, while a new `renderFleetRowMap(runs,
  opts)` (and its `state`-level counterpart `renderRowMap(state, opts)`,
  sharing the same `mergeRenderOpts` merge `render()` itself now uses)
  exposes the `{ [terminalRow]: runsIndex }` map for the currently-rendered
  NEEDS YOU/FAILED/RUNNING/DONE run rows. Grid mode contributes an empty map
  (out of scope this pass — design.md's explicit scope decision).
- `lib/ui/screens/fleet.js` — re-exports `renderFleetRowMap`/`renderRowMap`
  from the facade alongside the existing `renderFleet`/`render`.
- `lib/ui/watch.js` — writes `MOUSE_REPORT_ENTER`/`MOUSE_REPORT_EXIT` at the
  same points raw mode itself is toggled (startup, `quit()`, and both
  directions of `doAttach`/`doAttachTarget`'s suspend-for-attach); adds a
  new top-level `process.on('uncaughtException', ...)` handler (none existed
  before this change) that restores the full terminal state and exits,
  removed inside `quit()` (and, defensively, by itself) so it never
  accumulates across repeated `watch()` calls in one process; hoists the
  `quitting` re-entrancy flag so both `quit()` and the new handler share it;
  computes `S.fleetRowMap` every `draw()` (fleet mode only, `null`
  otherwise) from `fleetScreen.renderRowMap`, shifted into absolute terminal
  rows; and intercepts a recognized mouse click in `onKey` (before any
  other key routing, so it can never be typed as garbage into an open text
  field) to dispatch the existing `jump` action when the click resolves
  against the current frame's row map.
- `docs/dashboard.md` — new "Mouse support (fleet run rows only)" section:
  scope, what a click does, known limitations (non-SGR terminals, the
  tmux-compatibility deferral).
- `test/fleet.test.js` — unit tests for `renderFleetRowMap`: basic mapping
  (including a 2-line RUNNING row), border/title/blank lines excluded,
  scrolled-window correctness, QUEUED/QUICK START/hidden-summary rows
  excluded, and grid mode returning an empty map.
- `test/watch.test.js` — pure-function tests (mouse-report constants,
  `splitKeys`/`parseMouseClick`); integration tests via the existing
  `withWatchHarness` for mouse-report enable/disable pairing (startup/quit,
  attach suspend/restore including the throwing-attach path), click-to-select
  end to end, a click outside any rendered row, an unrecognized (release)
  sequence falling through harmlessly, a click while any non-fleet screen is
  on top; and two dedicated tests for the new `uncaughtException` handler
  (full terminal-restore-exactly-once + no double-write, and listener-count
  parity across a `watch()` call via `quit()`).
- `test/scripts/watch-smoke.test.sh` — added a comment explaining why this
  file's `esc_count` checks never assert on the mouse-report sequences
  (every scenario here pipes/redirects stdin, so `stdin.isTTY` is always
  false and mouse reporting — gated on the same check raw mode itself is —
  is never written at all); the TTY-gated pairing is covered instead by
  `test/watch.test.js`'s own CON-112 tests.
