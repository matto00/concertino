## Context

CON-113 added a searchable/filterable run-archive screen (`lib/ui/screens/archive.js`
+ `lib/ui/controllers/archive.js`) because fleet's own DONE section caps at
`MAX_FINISHED = 5` rows (`lib/ui/screens/fleet/sections.js`). Archive lets a
user find any two DONE runs; there's still no way to look at two of them at
once. The single-run drill-down (`lib/ui/screens/drilldown.js`) already
renders TIMELINE and GATES panels plus a computed total duration
(`run.elapsedMs`, folded by `lib/ui/reducer.js`), but its panels are sized
for one run filling the terminal width — reusing them verbatim for two runs
side by side would truncate badly on a normal-width terminal, which is
exactly the "design decision to escalate" the ticket itself calls out.

That escalation was raised during Planning (`--await`, 10-minute timeout)
and went unanswered; per the ticket's own leaning text ("likely needs its
own narrower rendering of TIMELINE/GATES rather than reusing the
drill-down's panels verbatim") and the orchestrator's self-approval
authority for non-architectural planning decisions, this design proceeds
with a **new, narrower rendering**, not a truncated reuse.

CON-109 already established a precedent for capped/keyed row selection in
the fleet view (`S.multiSelect = { failed: new Set(), queued: new Set() }`,
keyed by ticket id so a row's position shifting between poll frames never
desyncs selection) — but it is unbounded (any number of rows) and scoped to
FAILED/QUEUED bulk actions, neither of which fits "select exactly two DONE
runs to compare." This design introduces a distinct, capped-at-2 selection
concept rather than overloading `multiSelect`.

## Goals / Non-Goals

**Goals:**
- Let a user mark exactly two DONE runs — from the archive screen's list, or
  from fleet's DONE section — and open a side-by-side comparison of their
  TIMELINE, GATES, and total duration.
- New, narrower TIMELINE/GATES rendering purpose-built for a two-column
  layout on a normal-width terminal (reusing the drill-down's underlying
  data-shaping functions where they're already width-parametric, not its
  panel layout).
- `esc` from the compare screen returns to wherever it was opened from
  (archive or fleet), following the existing `ticketviewReturnMode`
  precedent rather than drilldown's unconditional generic `back`.
- Document the new screen and keybindings in `docs/dashboard.md`.

**Non-Goals:**
- Comparing more than two runs at once.
- Comparing a running/queued/failed run — selection is DONE-only, since
  duration and gate history are only meaningful once a run has actually
  finished (an in-progress run's `elapsedMs` is still climbing, and its gate
  list may still be partial).
- New event kinds or backend/event-log changes — compare reads the same
  `state.runs` (via `lib/ui/reducer.js`'s existing fold) every other screen
  already reads.
- Persisting a selection across app restarts — selection is in-memory
  `S` state only.

  **Selection lifecycle, precisely** (resolving an internal contradiction
  the design-gate skeptic flagged in an earlier draft of this document):
  `S.compareSelection` is NOT reset on entry to, or on returning from, the
  compare screen — it persists across `esc` so re-opening compare after
  looking at something else (e.g. flipping back to archive to skim a third
  run, then re-opening the same two-run comparison) doesn't force
  re-marking. It changes only via explicit `toggle-compare-select` action
  (Decision 1) — mark, unmark, or the capped-no-op case. What IS reset on
  each entry/exit is the compare screen's own transient view state
  (`compareReturnMode`, and each column's independent scroll offset from
  Decision 2/tasks.md 4.6) — the same reset-every-field-on-entry discipline
  `open-drilldown` already applies (`lib/ui/controllers/drilldown.js`),
  scoped here to the screen's own rendering state, not to the
  cross-screen-shared selection set.

## Decisions

### 1. New capped-at-2 selection state, not an extension of `multiSelect`

Add `S.compareSelection` (an array of up to 2 ticket ids, insertion order
preserved for consistent left/right assignment) to `lib/ui/app-state.js`'s
`initialState()`, forwarded into `currentState()`'s snapshot alongside the
existing `multiSelect` fields. A dedicated action `toggle-compare-select`
(handled in both `lib/ui/controllers/archive.js` and
`lib/ui/controllers/fleet.js`, since selection can be toggled from either
screen and must be visible from both — e.g. marking one run in archive, then
switching to fleet's DONE section to mark the second):
- Toggling a ticket already in `compareSelection` removes it.
- Toggling a ticket not in `compareSelection` when it has fewer than 2
  entries appends it.
- Toggling a third ticket when 2 are already selected is a no-op (does not
  evict the oldest) — the user must deselect one first. This mirrors "you
  can't mark a 3rd row" being an explicit, visible state rather than a
  silent swap that could surprise the user about which two runs they're
  about to compare.
- Only DONE runs are toggleable; the key has no effect on a non-DONE row
  (mirrors CON-109's own section-scoping of `space`).

The mark/unmark key itself is `space` — the same key CON-109 already binds
for FAILED-row multi-select (`lib/ui/screens/fleet/keys.js:415`, gated on
`focus === 'runs' && runs[selected].status === 'failed'`). `space` is
unbound today for a DONE-status row in that same guard (the existing check
is `status === 'failed'` only) and unbound entirely in archive.js's list
zone, so reusing it for "toggle compare selection" on a DONE row extends an
existing, already-documented convention rather than introducing a new key
vocabulary for the same underlying gesture (mark/unmark a row).

**Alternative considered:** reuse `multiSelect` with a third `compare` key
and cap enforcement bolted on. Rejected — `multiSelect`'s Set-per-section
shape assumes selection is scoped to a single section (`failed` or
`queued`); compare selection must span both archive and fleet-DONE, and its
cap (2) and "open compare" trigger semantics are different enough from bulk
actions' "any number, then confirm a destructive action" shape that sharing
the field would need as much special-casing as a separate field, with the
downside of conflating two conceptually different features in one piece of
state.

### 2. New `compare` screen/controller, own narrower TIMELINE/GATES rendering

New `lib/ui/screens/compare.js` (render/routeHandleKey pair, following the
router seam every other screen uses) and `lib/ui/controllers/compare.js`
(registered in `lib/ui/controllers/index.js`'s `CONTROLLERS` array),
registered in `lib/ui/router.js`'s `SCREENS` map as `compare`.

Layout: two side-by-side columns (`layout.hsplit`, same primitive
drilldown.js already uses), each column holding a stacked
TIMELINE-over-GATES pane for one run, with a duration/delta header line
above both columns. Each column's width is `floor((termWidth - gutter) / 2)`.

Rather than calling drilldown.js's `timelineLines`/`gatesLines` directly (they
are already width-parametric — `timelineLines(run, width)` /
`gatesLines(run, width)` — so in principle they *could* be reused at a
narrower width), this design defines compare's own
`compareTimelineLines(run, width)` / `compareGatesLines(run, width)` in
compare.js, because the drill-down's line format bakes in a fixed
12-column role field and a duration column sized for one full-width run
(`fmtGateDuration`/`rightContentWidth`) that reads as cramped, not merely
narrower, at compare's roughly-half width on a normal terminal (e.g. 80
cols / 2 ≈ 38 minus borders/gutter). compare's variants drop the role
column to a compact 3-char abbreviation and reuse `fmtGateDuration` for gate
durations (unchanged — it's already compact) but format its own duration
header via `f.dur` (matching `elapsedText`'s existing convention, so the
compare screen's duration numbers read identically to the drill-down's).
`describeEvent(ev)` (event → label/detail text) is imported and reused
as-is from drilldown.js — only the line-assembly width/column budget
differs, not the event-to-text mapping itself, so a compare column always
describes the same event the same way a drill-down would.

**Alternative considered:** reuse `timelineLines`/`gatesLines` verbatim at a
narrower width and accept the truncation. Rejected per the ticket's own
explicit design-decision callout — a narrower purpose-built rendering was
the ticket author's stated lean, and mechanically truncating a
full-width-oriented line format produces worse legibility (mid-word cuts,
misaligned duration columns) than a rendering designed for the narrower
budget from the start.

### 3. Origin-aware `esc`, via a `compareReturnMode` field

Add `S.compareReturnMode` (`'archive' | 'fleet'`), set by the controller
handling `open-compare` based on `state.mode` at the moment compare was
opened (mirrors `S.ticketviewReturnMode`'s existing pattern exactly —
launchpad.js:178/196/213 sets it on entry, consumes it at :225 to route
`back` differently per origin). compare.js's `esc` dispatches a
screen-specific `back-to-origin-from-compare` action (not the bare generic
`back` drilldown uses) so its controller can route to `archive` or `fleet`
without drilldown's existing unconditional-to-fleet behavior needing to
change (out of scope for this ticket — drilldown's own return-tracking is a
separate, larger change the design explicitly leaves alone, per Non-Goals).

### 4. Compare is reachable only with exactly 2 selected; trigger key is `c`

Once `compareSelection.length === 2`, pressing `c` from either the archive
list zone or fleet's DONE-row cursor dispatches `open-compare`. With fewer
than 2 selected, `c` is a no-op (mirrors archive's existing precedent of
silently ignoring an action whose precondition isn't met, e.g. `↵` on an
empty filtered list). `c` was chosen over reusing `↵` (which already opens
a single-run drill-down from both origins) to keep "open one" and "open
comparison of two" as distinct, unambiguous keys rather than overloading
`↵`'s meaning based on incidental selection state.

`c` is already `CONFIRM_RESTORED_QUEUE_KEY` in fleet (`lib/ui/screens/fleet/sections.js`),
gated on a pending, unconfirmed restored queue (`queueState.confirmed === false`,
`lib/ui/screens/fleet/keys.js:203`) — a state that can coexist with exactly-2
compare selection. This is handled with the same precedence convention
`keys.js` already uses for `quitConfirm`/`prompt`/`search` (each intercepts
every key ahead of anything below it): the existing restored-queue-confirm
check keeps its precedence unchanged, and `c`'s new "open compare" handling
is placed immediately after it in `keys.js`'s fallthrough chain, so a pending
restored-queue confirmation shadows "open compare" for `c` exactly as it
already shadows every other binding beneath it — no new ambiguity, just one
more entry in an existing, already-documented precedence chain.

## Risks / Trade-offs

- [Two new selection affordances (archive + fleet-DONE) to keep in sync with
  `compareSelection`, doubling the surface that must correctly render the
  `✓` marker and handle the toggle key] → Both call through the exact same
  `toggle-compare-select` action/controller-side handling; the two screens
  differ only in how they render the marker (mirroring rows.js's existing
  per-section marker rendering for `multiSelect`), not in selection
  semantics — one code path, two render call sites.
- [A duplicated TIMELINE/GATES line-shaping implementation (compare's own
  vs. drilldown's) could drift out of sync over time — e.g. a future event
  kind added to `describeEvent` naturally covers both, but a future change
  to gate-icon coloring logic might only get made in one place] → `describeEvent`
  and `fmtGateDuration`/gate-icon-from-`f.STATUS_COLOUR` logic are imported
  and reused as-is from drilldown.js rather than re-implemented; only the
  column-width/line-assembly logic is compare-specific, minimizing the
  drift surface to layout, not content semantics.
- [Selecting two runs with very different event-count/gate-count could make
  one column much taller than the other, looking unbalanced] → Both columns
  scroll independently (reusing `docview.windowBody`, same as drilldown's
  existing per-panel scroll), each sized to the taller of the two initially,
  with independent scroll state so a short run's column doesn't force the
  whole screen to a cramped height.

## Migration Plan

Purely additive — new screen, new controller, new state fields (all
appended, none renamed/removed), one new keybinding (`c`) scoped to
contexts (archive list zone, fleet DONE rows) where it isn't already bound.
No data migration; no rollback concerns beyond reverting the commit.
