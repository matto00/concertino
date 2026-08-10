## 1. Shared selection state

- [x] 1.1 Add `S.compareSelection` (array, max 2 ticket ids) and
      `S.compareReturnMode` (`'archive' | 'fleet' | null`) to
      `lib/ui/app-state.js`'s `initialState()`, and forward both into
      `currentState()`'s returned snapshot.
- [x] 1.2 Add a `toggle-compare-select` action handled identically wherever
      dispatched (archive controller and fleet controller both call the same
      shared toggle helper): unmark if already marked; mark if fewer than 2
      marked; no-op if 2 already marked and this ticket isn't one of them;
      no-op if the target run isn't DONE.
- [x] 1.3 Add a shared helper (e.g. `lib/ui/compare-selection.js`) for the
      toggle logic in 1.2, imported by both controllers, so the cap/DONE-only
      rules live in exactly one place.

## 2. Archive screen: marking + trigger

- [x] 2.1 Bind `space` as the mark-for-comparison key in the archive list
      zone's key handling (`lib/ui/screens/archive.js`), dispatching
      `toggle-compare-select` for the run under the cursor (see design.md
      Decision 1 — `space` mirrors CON-109's existing FAILED-row
      multi-select key, unbound today in archive.js).
- [x] 2.2 Render a marked indicator on a row in the archive list whose
      ticket is in `compareSelection` (distinct from the existing cursor
      marker).
- [x] 2.3 Bind `c` in the archive list zone: when `compareSelection.length
      === 2`, dispatch `open-compare`; otherwise no-op.
- [x] 2.4 `lib/ui/controllers/archive.js`: handle `open-compare` by setting
      `S.mode = 'compare'` and `S.compareReturnMode = 'archive'`.

## 3. Fleet DONE section: marking + trigger

- [x] 3.1 Bind `space` as the mark-for-comparison key for DONE rows in
      `lib/ui/screens/fleet/keys.js` (extend the existing `space` guard at
      keys.js:415, which today only fires for `status === 'failed'`, to also
      fire for `status === 'done'`, dispatching `toggle-compare-select`
      instead of `toggle-multi-select` for a DONE row). Bind `c` (open
      compare) positioned after the existing `CONFIRM_RESTORED_QUEUE_KEY`
      (`'c'`) check so a pending restored-queue confirmation keeps its
      existing precedence over the new "open compare" binding for `c` (see
      design.md Decision 4).
- [x] 3.2 Render a marked indicator on a DONE row in
      `lib/ui/screens/fleet/rows.js` whose ticket is in `compareSelection`.
- [x] 3.3 Bind `c` for DONE rows: when `compareSelection.length === 2`,
      dispatch `open-compare`; otherwise no-op (and otherwise falls through
      to existing `CONFIRM_RESTORED_QUEUE_KEY` / no-op behavior).
- [x] 3.4 `lib/ui/controllers/fleet.js`: handle `open-compare` by setting
      `S.mode = 'compare'` and `S.compareReturnMode = 'fleet'`.

## 4. Compare screen: rendering

- [x] 4.1 Create `lib/ui/screens/compare.js` exporting `render(state, opts)`
      and `routeHandleKey(key, state)`, following the router seam.
- [x] 4.2 Implement `compareTimelineLines(run, width)` and
      `compareGatesLines(run, width)`, reusing `describeEvent` and
      `fmtGateDuration` imported from `lib/ui/screens/drilldown.js`, with
      their own narrower column layout (compact role abbreviation, no
      full-width-oriented spacing) per design.md Decision 2.
- [x] 4.3 Lay out two columns via `layout.hsplit`, each column's width
      `floor((termWidth - gutter) / 2)`, each column stacking that run's
      timeline lines over its gates lines.
- [x] 4.4 Render a header above both columns showing each run's total
      duration (`f.dur(run.elapsedMs)`, matching drilldown's `elapsedText`
      convention) and the delta between them.
- [x] 4.5 Render each gate's first error line (when present) beneath its
      gate line, matching the drill-down's existing indented-error
      convention.
- [x] 4.6 Give each column independent scroll state, reusing
      `docview.windowBody` for the scrollable region, keyed so scrolling one
      column doesn't move the other.
- [x] 4.7 Handle `esc`: dispatch a screen-specific `back-to-origin-from-compare`
      action (not the generic `back` drilldown uses).

## 5. Compare screen: controller

- [x] 5.1 Create `lib/ui/controllers/compare.js`, registered in
      `lib/ui/controllers/index.js`'s `CONTROLLERS` array.
- [x] 5.2 Handle `back-to-origin-from-compare`: route to `S.mode =
      'archive'` when `S.compareReturnMode === 'archive'`, else `S.mode =
      'fleet'`; reset `S.compareReturnMode` to `null` and each column's
      scroll offset (4.6) on exit. Leave `S.compareSelection` intact — it is
      NOT cleared on entry or exit, only via explicit `toggle-compare-select`
      (see design.md Non-Goals, "Selection lifecycle, precisely," which
      resolves an earlier draft's contradiction on this exact point).
- [x] 5.3 Handle column-scroll actions from 4.6.

## 6. Router registration

- [x] 6.1 Register `compare` in `lib/ui/router.js`'s `SCREENS` map.

## 7. Documentation

- [x] 7.1 Add a new "Side-by-side run comparison" section to
      `docs/dashboard.md`, mirroring the existing "The run-archive screen"
      section's shape: how it's reached (mark two DONE runs, then `c`, from
      either the archive screen or fleet's DONE section), the marking
      key(s), the compare screen's own key table (scroll, `esc` origin-aware
      return), and what it renders.

## 8. Tests

- [x] 8.1 `test/compare.test.js`: render tests for
      `compareTimelineLines`/`compareGatesLines`, header duration/delta
      formatting, first-error rendering, `esc` handling.
- [x] 8.2 `test/controllers-compare.test.js`: `open-compare`,
      `back-to-origin-from-compare` (both origins), scroll action handling.
- [x] 8.3 Extend `test/archive.test.js` / `test/controllers-archive.test.js`
      for the marking indicator, `c` open-compare trigger, and the 2-run cap
      no-op.
- [x] 8.4 Extend `test/fleet.test.js` / `test/controllers-fleet.test.js` for
      DONE-row marking, the `c` precedence-vs-`CONFIRM_RESTORED_QUEUE_KEY`
      interaction, and non-DONE rows being unmarkable.
- [x] 8.5 Add a shared-selection test (e.g. in
      `test/compare-selection.test.js` or alongside 1.3's helper) covering:
      marking from archive shows as marked in fleet and vice versa; marking
      a third run while two are already marked is a no-op and evicts
      neither.

## 9. Manual verification

- [x] 9.1 Run the dashboard against real `.concertino/runs/` data with at
      least two DONE runs of noticeably different duration/gate counts;
      confirm the compare screen renders legibly at a normal terminal width
      (e.g. 80 columns) with no mid-word truncation.
- [x] 9.2 Confirm `esc` returns to archive when opened from archive, and to
      fleet when opened from fleet's DONE section.
