## 1. `fleet.js` — shared window arithmetic

- [x] 1.1 Factor `renderFleet`'s section-height/trim arithmetic (currently
      `sectionHeight`/`height`/the bottom-up trim loop) into a shared,
      exported pure helper (e.g. `visibleWindow(runs, opts)`) that, given
      `opts.scrollOffset` (default `0`) and `opts.selected`, returns
      `{ sections: [{ shown, startOffset, hidden }, ...],
      firstVisibleIndex, lastVisibleIndex, maxScrollOffset }`, per design.md
      Decisions 2-3's precise shape. The per-section walk explicitly skips
      `QUEUED` (same `!s.unselectable` guard the existing `index` counter
      already uses — design.md Decision 2).
- [x] 1.2 Update `renderFleet` to call this helper instead of its inline
      `shown[i] = Math.min(group.length, cap)` + bottom-trim logic, so
      `FAILED`/`DONE` (and, unaffected, `NEEDS YOU`/`QUEUED`) render exactly
      the window the helper computes, using each section's `startOffset` to
      slice `s.group` instead of always starting at `0` (design.md
      Decision 1).
- [x] 1.3 Ensure `NEEDS YOU` is excluded from the scroll offset accounting
      entirely — it must always compute as fully shown, matching today's
      `pinned`/`cap: Infinity` behavior (design.md Decision 4).
- [x] 1.4 Ensure `QUEUED` is unaffected — still `unselectable`, still capped
      by `MAX_FINISHED` exactly as today, outside the index space the new
      helper windows.
- [x] 1.5 Preserve the existing "… and N more" collapse line and its
      zero-shown single-line rendering for a section the height budget (or
      the scroll window) cannot fit any rows of.
- [x] 1.6 Implement the height-budget trim's selected-row protection rule
      (design.md Decision 3): when shrinking a section that contains
      `opts.selected` within its current `[startOffset, startOffset +
      shown)` window, trim from the edge of that window farther from
      `selected`'s position (grow `startOffset` or shrink the tail,
      whichever does not push `selected` outside the window) — never trim
      past the point where `selected` itself would fall outside the
      section's rendered slice. A section not containing `selected` still
      trims tail-first, exactly as today.
- [x] 1.7 Export the new helper from `fleet.js`'s `module.exports` for
      `watch.js` to call.

## 2. `watch.js` — stateful scroll position

- [x] 2.1 Add a new poll-loop variable `scrollOffset` (default `0`),
      declared alongside `selected` (design.md Decision 3).
- [x] 2.2 In the `move` action handler, after computing the new `selected`,
      call the exported window helper with the candidate `scrollOffset` and
      adjust it: scroll up if `selected < firstVisibleIndex`, scroll down if
      `selected > lastVisibleIndex`, otherwise leave unchanged.
- [x] 2.3 Re-clamp `scrollOffset` to `[0, maxScrollOffset]` on every
      `draw()`, mirroring the existing `if (selected >= runs.length)
      selected = ...` clamp, so a shrinking `runs` list or a resize can never
      leave `scrollOffset` pointing past the end.
- [x] 2.4 Add `scrollOffset` to `currentState()`'s returned object, next to
      `selected` — this is the actual mechanism `selected` itself uses to
      reach `fleet.js`: `router.render(currentState(), opts)` passes
      `scrollOffset` through `state`, and `fleet.js`'s own `render(state,
      opts)` wrapper merges it into the `opts` object it builds for
      `renderFleet` (exactly where `state.selected` is merged in today) —
      it is not part of the literal `{cols, rows, now, queuedTitles,
      ticketText}` object `watch.js`'s `draw()` passes to `router.render`.
- [x] 2.5 Reset `scrollOffset` to `0` whenever it would otherwise reference
      stale rows in a way `selected`'s own reset points already handle
      (e.g. anywhere `selected` is reset to `0`), so the two stay
      consistent with each other.

## 3. Tests

- [x] 3.1 Extend the existing "the selection marker points at reduce()'s run
      for every index" test in `test/fleet.test.js` to also cover a
      scrolled `scrollOffset` (not just index `0..runs.length-1` at
      `scrollOffset: 0`) — assert exactly one `▸` marker and that it matches
      `runs[selected]` for a representative range of scroll offsets on a
      `runs` list larger than one page.
- [x] 3.2 Add a test asserting `NEEDS YOU` always renders in full regardless
      of scroll offset, even when scrolled deep into `FAILED`/`DONE`.
- [x] 3.3 Add a test for the new exported window helper directly: given a
      `runs` list and a candidate `scrollOffset`, it returns the expected
      `firstVisibleIndex`/`lastVisibleIndex`/`maxScrollOffset`, including at
      the boundaries (`scrollOffset: 0`, `scrollOffset: maxScrollOffset`,
      and one past `maxScrollOffset` clamping down to it).
- [x] 3.4 Add a small-terminal-height regression test: `rows` smaller than
      the combined height of all non-empty sections, at a non-zero scroll
      offset, still renders the header + `NEEDS YOU` in full and collapses
      every section it cannot fit to its "… and N more" line without error.
- [x] 3.5 Add the combined scroll-plus-small-terminal marker-alignment test
      the design skeptic's round-1 report called for (design.md Decision 3's
      selected-row protection rule): construct a `runs` list and `rows`
      small enough to force the whole-frame height-budget trim to shrink the
      very section a non-zero `scrollOffset` has windowed mid-group (e.g.
      `FAILED` windowed to `group[10..15)` via `scrollOffset` with `selected`
      resolving to the row at `lastVisibleIndex`, then a `rows` budget that
      would otherwise force `shown` down further) — assert the `▸` marker
      for `runs[selected]` is still rendered, not silently trimmed away.
- [x] 3.6 Add a `watch.js`-level (or `watch-smoke.test.sh`, matching the
      project's existing precedent for asserting real keypresses reach
      private closures — see `lib/ui/watch.js`'s `applyAction`/`openLaunchPad`
      comment) test that repeated `j` past the visible window actually moves
      `scrollOffset` and keeps the marker aligned with a real keypress
      sequence, not just a direct call into `fleet.js`.

## 4. Verification

- [x] 4.1 Run the full test suite; all existing `fleet.test.js` assertions
      (unscrolled behavior, `scrollOffset` absent/`0`) must still pass
      byte-for-byte, per design.md's Migration Plan.
- [x] 4.2 Manually exercise the dashboard (`concertino watch`) against a
      fixture project with more than one page of `FAILED`/`DONE` runs at a
      few terminal heights, confirming `j`/`k` scroll rather than hide the
      marker, and that `NEEDS YOU` never moves.
