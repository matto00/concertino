## Files modified

- `lib/ui/format.js` — added `queued: dim` to `f.STATUS_COLOUR` so the QUEUED
  section's title can be coloured via the shared status-colour table
  (statusKey `'queued'`).
- `lib/ui/screens/fleet.js` — added the QUEUED section (positioned after
  RUNNING, before FAILED; `unselectable: true`, `linesPerRow: 1`,
  `statusKey: 'queued'`, `cap: MAX_FINISHED`, title
  `QUEUED (<n>, running <maxConcurrent> at a time)` from
  `queueState.maxConcurrent`); generalized `linesPerRow` on every section
  entry and `sectionHeight()`'s height formula (replacing the hardcoded
  `2 *` multiplier); made the shared row-index counter in the per-row render
  loop skip advancement entirely for `unselectable` sections (the row-index
  safety property the ticket calls out as its primary hazard); added the new
  `renderQueuedRow(ticket, position, title, width)` single-line row renderer
  and branched the per-row loop on `s.unselectable` to call it instead of
  `renderRun` for QUEUED's items; forwarded a new `queuedTitles` opt through
  `render(state, opts)` into `renderFleet`.
- `lib/ui/watch.js` — `draw()` now builds a `Map<identifier, title>`
  (`queuedTitles`) from `cache.read(root).tickets` whenever
  `queueState.pending` is non-empty, and passes it to `router.render` as a
  new opt alongside `cols`/`rows`/`now`, per design.md Decision 3 (no new
  `cfg.maxConcurrent` plumbing — `queueState.maxConcurrent` is read directly
  by fleet.js).
- `test/fleet.test.js` — new coverage: QUEUED section rendering (title,
  count, `maxConcurrent`, colouring), per-row content (cached title vs.
  id-only fallback, no fabricated status/phase/elapsed/bar), trimming under
  the height budget identical to FAILED/DONE (and never pinned), a
  height-budget regression test with all five sections (including a
  populated QUEUED) populated together, a row-index regression test proving
  a non-empty QUEUED section never perturbs which run a FAILED/DONE
  selection resolves to (with and without QUEUED present, and against a
  real `reduce()`-produced fleet), and a check that no queued row is ever
  rendered with the `▸` selection marker.

## Task-tracking files updated (not source, no test coverage expected)

- `openspec/changes/fleet-view-queued-section/tasks.md` — all tasks checked
  off as completed.
