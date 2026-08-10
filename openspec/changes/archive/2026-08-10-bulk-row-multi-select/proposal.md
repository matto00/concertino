## Why

Every FAILED-row action (`a` address, `d` done — CON-98) and QUEUED's
force-start (`f` — CON-39) apply to exactly one selected row at a time. A
fleet with several FAILED runs after a bad batch, or several QUEUED tickets
to force-start together, has to be addressed/marked-done/force-started one
row at a time, with a confirmation for each.

## What Changes

- Add a `space` key that toggles a row into/out of a multi-select set,
  scoped per-section (FAILED and QUEUED, the two sections with existing
  row-level actions). Selection is marked with a dedicated marker (`✓`),
  visually distinct from the existing single-row `▸` run cursor / `»`
  QUEUED-local cursor, and persists across `j`/`k` movement (does not clear
  on cursor move — only on explicit toggle, action completion, or leaving
  the section).
- When one or more rows are multi-selected in a section, that section's
  existing action key (`a`/`d` for FAILED, `f` for QUEUED) applies to the
  full multi-selected set instead of just the cursor row, behind the same
  `y` confirmation pattern already used for the single-row action — but
  naming the row count (e.g. "mark 4 runs as done?") instead of one ticket
  id.
- A bulk action's confirmation is followed, on `y`, by a per-row result
  list (ticket id + outcome) if any row's action fails to apply (e.g. a
  tmux window creation error during bulk `a`) — mirroring the single-row
  path's inline-notice behavior, but itemized per row so a partial failure
  is never silently swallowed into a single pass/fail summary.
- `docs/dashboard.md`'s key tables document `space` and the new bulk
  variants of `a`/`d`/`f`.

Multi-select with nothing selected (0 rows toggled) behaves exactly as
today: pressing `a`/`d`/`f` acts on the cursor row alone, unchanged — this
change is additive, not a replacement of the existing single-row path.

## Capabilities

### New Capabilities

- `fleet-bulk-select`: the `space`-driven per-section multi-select
  mechanism — toggle marker, persistence across `j`/`k`, and the "empty
  selection falls back to single-row" rule — shared by FAILED and QUEUED
  rather than reimplemented per section.

### Modified Capabilities

- `fleet-failed-remediation`: `a`/`d` on the FAILED section, when one or
  more rows are multi-selected, apply to the full selection behind a
  count-naming `y` confirmation instead of just the cursor row, and report
  a per-row result list on partial failure.
- `fleet-queue-force-start`: `f` on the QUEUED section, when one or more
  rows are multi-selected, apply to the full selection behind a
  count-naming `y` confirmation instead of just the QUEUED-local cursor
  row.

## Impact

- `lib/ui/screens/fleet/keys.js`: new `space` binding, per-section
  multi-select state read/toggle, and the `a`/`d`/`f` resolution branching
  on whether a multi-select set is non-empty.
- `lib/ui/screens/fleet/rows.js`: multi-select marker rendering for FAILED
  rows (`renderFinishedRow`) and QUEUED rows (`renderQueuedRow`).
- `lib/ui/screens/fleet/sections.js`: bulk confirmation banner text (count,
  not a single ticket) and the post-confirmation per-row result list;
  footer hint for `space`.
- `lib/ui/watch.js`: new/extended action handlers —
  `toggle-multi-select`, `confirm-bulk-mark-done`, `confirm-bulk-force-start`,
  and the bulk branch of the existing `address-failure`
  handling — each iterating the multi-selected set instead of a single
  ticket, and clearing the set once the action (or its confirmation) is
  resolved. Also `onKey` (around line 1214, immediately before
  `router.handleKey` is called) gains the one-shot clear for
  `S.bulkResult`.
- `lib/ui/app-state.js`: `multiSelect`/`bulkConfirm`/`bulkResult` added to
  BOTH `createAppState()`'s initial state AND `currentState(S)`'s curated
  snapshot (line ~311) — the latter is the only state object
  `fleet/keys.js`'s `handleKey` and `fleet/screens/fleet/render.js`'s
  `mergeRenderOpts` ever receive, so omitting it there is a guaranteed
  `TypeError` on first `a`/`d`/`f`/`space` press, not merely an omission.
- `lib/ui/screens/fleet/render.js` (not `lib/ui/render.js`):
  `mergeRenderOpts` needs `bulkConfirm`, `bulkResult`, and `multiSelect`
  added alongside its existing `markDoneConfirm`/`forceStartConfirm`/
  `clearQueueConfirm`/`addressFailureNotice` fields.
- `lib/ui/controllers/fleet.js`'s `scrollToShow` (`winOpts`, line ~30-45)
  and `lib/ui/watch.js`'s separate `heightOpts` (line ~670-678) both need
  `bulkConfirm`/`bulkResult` added — both objects independently duplicate
  the same "every tail-lengthening field" list `mergeRenderOpts` builds,
  and both carry their own comments documenting that omitting a field here
  previously caused a real, shipped scroll-miscalculation bug (`fleet-
  metrics-grid final-fix 2`, and again for `markDoneConfirm` under CON-98).
- `docs/dashboard.md`: key table updates for FAILED and QUEUED.
