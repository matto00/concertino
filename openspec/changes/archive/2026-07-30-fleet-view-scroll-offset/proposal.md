## Why

The fleet view caps its FAILED/DONE sections (`MAX_FINISHED = 5`) and further
trims the whole frame to fit the terminal height, so a long-running session's
history never pushes the header or `NEEDS YOU` off the top. But `j`/`k`
selection still walks the full `runs` array, including rows that either cap
removed from the render. The selection marker (`▸`) can land on a row the
terminal is not displaying at all, so the operator loses track of what is
selected — `attach`/`open-drilldown` still work correctly (they resolve by
`runs[selected]`, not by anything visual), but the screen looks broken.

## What Changes

- `lib/ui/screens/fleet.js`'s `renderFleet` gains a scroll-window over its
  non-pinned selectable sections (`RUNNING`, `FAILED`, `DONE`): instead of a
  fixed bottom-anchored cap, the visible rows are a window that can be
  scrolled via a new `opts.scrollOffset` (an index into the same flat
  selectable-row space `selected` already lives in).
- `NEEDS YOU` is unaffected — it is already pinned and uncapped, and stays
  that way.
- `lib/ui/watch.js` gains a new piece of poll-loop state, `scrollOffset`,
  updated whenever the selection moves (or the underlying `runs` list
  changes shape) so the selected row is always inside the rendered window.
  The renderer itself stays a pure `(runs, opts) -> string` function; only
  `watch.js` decides *when* to scroll.
- The existing `MAX_FINISHED` cap becomes the **window size** for a
  scrollable section rather than a hard limit that permanently discards rows
  beyond it — rows beyond the window are still reachable by scrolling, they
  are simply not rendered on the current frame.
- Very short terminals (fewer rows available than sections) keep today's
  "collapse a section to a single `… and N more` line" behavior; scrolling
  composes with that instead of replacing it.
- The existing selection/marker-alignment test in `test/fleet.test.js` is
  extended to also cover scrolled offsets, plus a new small-terminal-height
  case.

## Capabilities

### New Capabilities
- `fleet-view-scroll`: scrolling behavior for the fleet view's selectable
  sections — when the view scrolls, how `NEEDS YOU` stays pinned, and how
  selection-index/marker alignment is preserved at every scroll offset and
  terminal height.

### Modified Capabilities
(none — `fleet-queue-visibility`'s row-index contract is preserved, not
changed: QUEUED remains unselectable and outside the index space this change
touches.)

## Impact

- `lib/ui/screens/fleet.js`: `renderFleet`'s section-height/trim logic, plus
  a new pure helper for computing/clamping the visible window (used both by
  the renderer and by `watch.js`'s scroll-adjustment logic).
- `lib/ui/watch.js`: new `scrollOffset` poll-loop variable, adjusted in the
  `move` action handler (and re-clamped every `draw()` alongside the
  existing `selected` clamp at line 466) and added to `currentState()` next
  to `selected`, so it reaches `fleet.js`'s `render(state, opts)` seam the
  same way `selected` already does (as `state.scrollOffset`, merged into the
  `opts` `renderFleet` itself receives by `render()`'s own wrapper — not
  literally part of the `{cols, rows, now, ...}` object `watch.js` passes to
  `router.render`).
- `test/fleet.test.js`: extend the existing marker-alignment test to
  scrolled states; add a small-terminal-height regression test.
- No changes to Linear/tmux/event-log integration, no new dependencies.
