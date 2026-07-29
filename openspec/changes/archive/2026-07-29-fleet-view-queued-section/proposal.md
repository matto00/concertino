## Why

The fleet view (`lib/ui/screens/fleet.js`) only ever draws sections derived
from `reducer.reduce()` — NEEDS YOU, RUNNING, FAILED, DONE — all of which
require a run to already have started (a run directory, a tmux window, an
event log). A ticket sitting in the launch pad's in-memory queue
(`queueState.pending`, see `lib/ui/queue.js`) has none of that, so it renders
as nothing at all. After confirming a multi-ticket batch, the dashboard shows
only the first `maxConcurrent` tickets; the rest of the batch is real and
will launch, but is completely invisible until it starts. This violates the
project's governing property — "absent data must never render as healthy
data" — because a queued-but-not-yet-started batch reads identically to no
batch having been queued at all.

## What Changes

- Add a `QUEUED` section to the fleet view, positioned after `RUNNING` and
  before `FAILED` (queued items are live/pending, not finished, but are not
  yet actionable — nothing to attach to).
- Each queued row is a single line (not the two lines a run row uses):
  1-based queue position, ticket id, and the ticket's title if the on-disk
  ticket cache (`lib/ui/cache.js`) has it — no status, elapsed time, or phase
  is fabricated for a ticket that has not started.
- The section title surfaces `maxConcurrent`
  (`QUEUED (3, running 1 at a time)`) so "why is only one running?" has a
  visible answer.
- `QUEUED` participates in the existing height-budget/trim machinery
  (`sectionHeight`, `cap`, the `… and N more` line) exactly like
  RUNNING/FAILED/DONE, and is never `pinned` — NEEDS YOU stays the only
  pinned section.
- **Row-index safety (the primary constraint of this change):** queued rows
  carry no `run` object, so they must never consume a slot in the row-index
  space that `handleKey`'s `move` action and `watch.js`'s `runs[selected]`
  both rely on. Queued rows are made structurally unselectable — the shared
  render loop that walks `sections` and increments the row index is the one
  and only place that index is touched, and it is changed to skip index
  advancement for any section marked `unselectable`, `QUEUED` being the only
  one so marked. A regression test selects a row in FAILED/DONE below a
  non-empty QUEUED section and asserts the resolved run is unaffected by
  QUEUED's presence.
- `f.STATUS_COLOUR` gets a `queued` entry (dim, matching RUNNING/DONE's
  understated treatment — nothing queued is actionable yet).

## Capabilities

### New Capabilities
- `fleet-queue-visibility`: renders the dashboard's in-memory launch queue as
  a visible, trimmable fleet section, and guarantees that inserting it never
  perturbs the row-index contract `watch.js` uses to resolve a selected row
  to a run.

### Modified Capabilities
(none — no existing capability's requirements change; `dashboard-visual-design`'s
box/degradation contract is reused unchanged, not modified)

## Impact

- `lib/ui/screens/fleet.js`: new QUEUED section (`unselectable: true`,
  `linesPerRow: 1`, `statusKey: 'queued'`), a generalized `linesPerRow`
  field read by `sectionHeight`/`height`/the trim loop (replacing the
  hardcoded 2-lines-per-row assumption), index-skip logic for unselectable
  sections, a single-line queued-row renderer, and title formatting using
  `queueState.maxConcurrent` (already available — no new config plumbing).
- `lib/ui/format.js`: `STATUS_COLOUR.queued` entry.
- `lib/ui/watch.js`: build a ticket-id -> title lookup (`queuedTitles`, from
  `cache.read(root)`) in `draw()` when the queue is non-empty, and pass it
  into the fleet screen's render opts alongside the existing `queueState`.
  No new `cfg.maxConcurrent` plumbing is needed — see design.md Decision 4.
- `test/fleet.test.js`: new coverage for the QUEUED section's rendering,
  trimming, and the row-index regression test described above.
- No API, persistence, or spec-level behavior changes outside the fleet
  screen's own rendering contract.
