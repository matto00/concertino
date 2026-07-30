## Files modified

- `lib/ui/screens/fleet.js` — factored `renderFleet`'s section-list/head-tail/
  height-budget-trim arithmetic into shared pure helpers (`bucketRuns`,
  `buildSections`, `buildHeadTail`, and the newly exported `visibleWindow`),
  and rewrote `renderFleet` to render exactly the window `visibleWindow`
  computes instead of its own inline cap/trim logic. `visibleWindow`
  implements the scroll-window (`opts.scrollOffset`, design.md Decision 1-2)
  and the height-budget trim's selected-row protection rule (design.md
  Decision 3). `render(state, opts)` now also threads `state.scrollOffset`
  through to `renderFleet`.
- `lib/ui/watch.js` — added the `scrollOffset` poll-loop variable (next to
  `selected`), threaded it through `currentState()`, adjusted it in the
  `move` action handler (scrolling by exactly the overshoot when the new
  `selected` lands outside the currently visible window, via
  `fleetScreen.visibleWindow`), and re-clamped it to `[0, maxScrollOffset]`
  on every `draw()` alongside the existing `selected` clamp. Factored the
  banner-aware available-rows computation out of `draw()` into
  `computeScreenRows()` so the `move` handler and `draw()` share the exact
  same "what's actually visible" arithmetic.
- `test/fleet.test.js` — added scroll-offset coverage: marker alignment at
  every reachable scroll offset, byte-for-byte parity at `scrollOffset: 0`,
  NEEDS YOU always fully visible while scrolled, `visibleWindow`'s own
  boundary values, the height-budget-trim selected-row-protection scenario,
  a small-terminal-plus-scroll regression, and a regression test for the bug
  found during manual verification (see below).
- `test/watch.test.js` — added a real-keypress-sequence test that repeated
  `j` past the visible window actually scrolls `watch.js`'s own
  `scrollOffset` and keeps the marker aligned, plus a second real-keypress
  regression test for the bug found during manual verification (see below).
  Both tests' cleanup is structured so `fakeStdin.emit('end')`/`await
  donePromise` always runs in a `finally`, even if an assertion throws —
  otherwise a failing assertion leaks the poll loop's `setInterval` and
  hangs the whole suite instead of just failing that one test.

## Bug found and fixed during implementation (task 4.2, manual verification)

- **Root cause:** `visibleWindow`'s `firstVisibleIndex`/`lastVisibleIndex`
  were computed as the union of the first and last *selectable* section with
  `shown > 0`, including the pinned NEEDS YOU section. Since NEEDS YOU is
  always fully shown (index 0..) regardless of scroll position, this made
  the reported "visible range" appear to span from NEEDS YOU's own index all
  the way to wherever the scrolled window happened to land — silently
  papering over any section scrolled entirely out of view in between (e.g. a
  short RUNNING section, once scrolled past). `watch.js`'s `move` handler
  then never triggered a scroll adjustment for a `selected` value that fell
  in that gap, so the row rendered with no marker anywhere on screen —
  reproducing the exact defect the ticket describes, just via the scroll fix
  itself rather than the original bug.
- **Probe:** a real `concertino watch` session (tmux, 80x24, a fixture with
  1 NEEDS YOU + 1 RUNNING + 12 DONE runs) — 8 `j` presses to scroll deep into
  DONE, then 7 `k` presses back up to land exactly on the RUNNING row: no
  `▸` marker rendered anywhere in the captured pane. Reduced to an automated
  probe (`visibleWindow(...).firstVisibleIndex` for the scrolled-past
  RUNNING row) confirming `firstVisibleIndex` was `0` (NEEDS YOU's own
  index) rather than a value greater than RUNNING's index — i.e. the
  algorithm believed the scrolled-past row was in range.
- **Fix + lock:** `visibleWindow` now excludes pinned (NEEDS YOU) sections
  from the `firstVisibleIndex`/`lastVisibleIndex` computation entirely (see
  the comment at that computation in `fleet.js`), with a sentinel fallback
  (`[0, runs.length - 1]`) for the degenerate case where nothing in the
  scrollable region rendered at all. Regression tests added at both layers:
  `test/fleet.test.js`'s `visibleWindow`-level test and
  `test/watch.test.js`'s real-keypress-sequence test — both confirmed to
  fail against the pre-fix code and pass against the fix.
