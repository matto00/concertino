## New files

- `lib/ui/compare-selection.js` — the shared, pure toggle/cap implementation for the run-comparison feature's capped-at-2 selection (design.md Decision 1), imported by both `controllers/archive.js` and `controllers/fleet.js`.
- `lib/ui/screens/compare.js` — the new `compare` screen: `compareTimelineLines`/`compareGatesLines` (narrower TIMELINE/GATES rendering per design.md Decision 2), the two-column layout, duration/delta header, and the router seam (`render`/`routeHandleKey`).
- `lib/ui/controllers/compare.js` — the compare screen's own controller: `back-to-origin-from-compare`, `switch-compare-focus`, `compare-scroll`.
- `test/compare.test.js` — render tests for the compare screen (timeline/gates line-shaping, duration/delta header, first-error rendering, degenerate "run no longer available" fallback, key handling).
- `test/controllers-compare.test.js` — controller tests for `back-to-origin-from-compare` (both origins, and the defensive default), `switch-compare-focus`, `compare-scroll`.
- `test/compare-selection.test.js` — unit tests for the shared `toggleCompareSelection` helper (mark/unmark, the 2-run cap, DONE-only, purity).

## Modified files

- `lib/ui/app-state.js` — added `compareSelection`/`compareReturnMode`/`compareLeftScroll`/`compareRightScroll`/`compareFocus` to `initialState()` and `currentState()`; defensive reset of the transient compare-view fields (not `compareSelection`, which persists) in `backToFleet()`.
- `lib/ui/router.js` — registered the `compare` screen in the `SCREENS` map.
- `lib/ui/controllers/index.js` — registered the `compare` controller in the `CONTROLLERS` array.
- `lib/ui/controllers/archive.js` — added `toggle-compare-select` and `open-compare` (sets `S.compareReturnMode = 'archive'`) handling.
- `lib/ui/controllers/fleet.js` — added `toggle-compare-select` and `open-compare` (sets `S.compareReturnMode = 'fleet'`) handling.
- `lib/ui/screens/archive.js` — `space` marks/unmarks the run under the cursor for comparison; `c` opens the compare screen once exactly two are marked; the list row/header rendering gained a marked-for-comparison `✓` column.
- `lib/ui/screens/fleet/keys.js` — extended the existing `space` guard (previously FAILED-only) to also dispatch `toggle-compare-select` for a DONE row; added `c` → `open-compare` positioned after the existing `CONFIRM_RESTORED_QUEUE_KEY` check so a pending restored-queue confirmation keeps precedence.
- `lib/ui/screens/fleet/rows.js` — `renderFinishedRow`'s multi-select marker slot now also lights up for a DONE row in `compareSelection` (`opts.compareSelected`).
- `lib/ui/screens/fleet/render.js` — threads `compareSelection` through `buildFleetOutput`/`mergeRenderOpts` and computes `compareSelected` for DONE rows.
- `docs/dashboard.md` — updated the `space`/`c` key-table rows, added marking/`c` rows to the run-archive screen's own key table, and added a new "Side-by-side run comparison" section.
- `test/archive.test.js`, `test/controllers-archive.test.js`, `test/fleet.test.js`, `test/controllers-fleet.test.js` — extended for the marking indicator, the `space`/`c` bindings, the 2-run cap, DONE-only marking, and the `c` vs. `CONFIRM_RESTORED_QUEUE_KEY` precedence interaction.
- `openspec/changes/side-by-side-run-comparison/tasks.md` — all tasks marked complete.

## Cycle 2 (skeptic-final-1.md, round 1 REFUTE — fixed)

- `lib/ui/screens/fleet/sections.js` — `buildHeadTail`'s hints array now advertises `space select` when a DONE section is on screen (a `hasDone` OR-gate, mirroring `hasFailed`/`hasQueued`) and `c compare` once `compareSelection.length === 2` — the gap the skeptic found (fleet's own footer, one of the ticket's two named entry points, never mentioned the new bindings).
- `lib/ui/controllers/fleet.js` — `scrollToShow`'s `winOpts` now also carries `compareSelection`, so its `buildHeadTail`-tail-length accounting can't drift from what `renderFleet` actually renders now that the hints array reads it (the same "every tail-lengthening field must be threaded to every opts-builder" discipline `bulkConfirm`/`bulkResult` etc. already follow here — CON-26/CON-43/skeptic-round-1-finding-2's own bug class).
- `lib/ui/watch.js` — `draw()`'s own `heightOpts` (the scrollOffset re-clamp's independent opts-builder) also now carries `compareSelection`, same reasoning as `scrollToShow` above.
- `test/fleet.test.js` — extended the existing `space select` hint-parity test to cover DONE, and added tests for the new `c compare` hint (present at exactly 2 marked, absent otherwise, absent when `compareSelection` is missing from opts entirely).
- `test/watch.test.js` — extended the two existing "every tail-lengthening opt" field-presence regression tests (`scrollToShow`'s `winOpts` and the scrollOffset re-clamp's `heightOpts`) to also require `compareSelection`.
