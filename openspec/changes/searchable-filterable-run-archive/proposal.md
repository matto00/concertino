## Why

The dashboard's DONE section only ever shows "the most recent few, with `…
and N more` for the rest" (`docs/dashboard.md`). Finding a specific past run
— a ticket id from three weeks ago, or "what did we ship last Tuesday" —
today means grepping `.concertino/runs/*/events.jsonl` by hand, outside the
dashboard entirely. Every retained run's full event log already lives on
disk (bounded by `dashboard.retentionDays`) and is already read into memory
every poll (`lib/ui/watch.js`'s `S.runs = reduce(store.readAll(root, ...),
...)` — unbounded by the fleet view's own `MAX_FINISHED` rendering cap); the
gap is a screen to browse and filter it, not a new read path.

## What Changes

- Add a new fleet-view top-level key, `A`, that opens a dedicated
  **run-archive** screen listing every run currently in `S.runs` (i.e. every
  retained run under `.concertino/runs/`, not just the capped few DONE/FAILED
  shows), independent of live status.
- The archive screen supports live filtering as-you-type against ticket id
  and title substring (reusing `fleet-search`'s `matchesQuery`/`rowMatches`
  predicate — the one place "ticket id or title" is defined as a match), plus
  a harness filter and a date-range filter (against each run's `startedAt`).
- Selecting a run from the archive list opens the exact same run drill-down
  (`lib/ui/screens/drilldown.js` / `lib/ui/controllers/drilldown.js`,
  TICKET/TIMELINE/GATES/EVIDENCE panels) a live/recent run's `l` key already
  opens — no parallel rendering path.
- `esc` from the archive screen returns to the fleet, consistent with every
  other top-level screen's existing single-level "back always goes to fleet"
  navigation (sessions, settings, launch pad, drill-down all behave this
  way today — there is no navigation stack anywhere in the dashboard).
- Documents the new screen and its `A` key in `docs/dashboard.md`.

## Capabilities

### New Capabilities
- `run-archive`: the fleet-reachable, filterable screen listing every
  retained run and opening the existing drill-down for a selected one.

### Modified Capabilities
(none — `fleet-search`'s match predicate is reused, not modified; no
existing capability's requirements change)

## Impact

- `lib/ui/screens/fleet/keys.js`: bind `A` (new top-level key) to
  `open-archive`.
- New `lib/ui/screens/archive.js` (render + pure `handleKey`) and
  `lib/ui/controllers/archive.js` (action handling: open/filter/select),
  following the existing `sessions.js`/`settings.js` screen+controller split.
- `lib/ui/router.js`: register the new `'archive'` mode in the `SCREENS`
  map (the actual per-mode render/handleKey registry `watch.js` calls into
  uniformly via `router.render`/`router.handleKey`), alongside the existing
  `'sessions'`/`'settings'`/`'drilldown'` entries.
- `lib/ui/controllers/index.js`: register the new controller in the
  `CONTROLLERS` array so `applyAction` routes its actions.
- `lib/ui/screens/fleet/search.js`: no code change — `matchesQuery`/
  `rowMatches` are imported by the new archive screen, not modified.
- `docs/dashboard.md`: document the `A` key and the archive screen's
  filters.
- No new config, no new on-disk read path, no change to
  `dashboard.retentionDays` or the pruning/retention behavior it already
  governs (`event-log-retention`) — the archive screen's data source is the
  same `S.runs` the fleet view already holds each poll.
