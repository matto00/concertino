## Context

`lib/ui/screens/fleet.js`'s `renderFleet(runs, opts)` is a pure function.
Runs are bucketed into `NEEDS YOU` / `RUNNING` / `QUEUED` / `FAILED` / `DONE`
sections, each rendered as its own bordered box. Two independent trims
already exist:

1. A per-section hard cap, `MAX_FINISHED = 5`, applied to `FAILED`/`DONE`
   (and separately to `QUEUED`) before anything else — `shown[i] =
   Math.min(group.length, cap)`.
2. A whole-frame height budget (`rows - 1`), applied afterwards by trimming
   `shown[i]` further, from the bottom section upward, skipping any section
   flagged `pinned` (only `NEEDS YOU` today).

A single `index` counter walks every *selectable* row (i.e. every section
except `QUEUED`, which sets `unselectable: true`) in section order —
`NEEDS YOU`, `RUNNING`, `FAILED`, `DONE` — and this is exactly the index
space `watch.js`'s `selected` lives in (`runs[selected]` is what `attach`
and `open-drilldown` resolve against). Selection can walk this full `index`
range even though sections 1 and 2 above may have already removed some of
those rows from the actual rendered output, which is the bug.

`watch.js` already owns exactly this kind of stateful, poll-loop-scoped
bookkeeping for `selected` — clamped once per `draw()` (`if (selected >=
runs.length) selected = ...`) and updated in the `move` action handler. The
renderer never sees or mutates it directly; it only receives `opts.selected`.
`scrollOffset` is designed to be the same shape of thing.

`lib/ui/screens/launchpad.js` already solved an analogous problem
(`MAX_EPICS_VISIBLE`/`MAX_TICKETS_VISIBLE`) with a *stateless*, recomputed-
every-render `windowStart(index, total, max)` that centers the current
selection in a fixed-size window. That approach does not fit here, by the
ticket's own explicit instruction: scroll position must be stateful, owned by
`watch.js`, not re-derived from `selected` on every frame (a `windowStart`-
style recentre would make the fleet view's scroll position jump around on
every keypress, and the ticket asks for a `j`/`k`-scrolls-the-view model, not
a centred-viewport one).

## Goals / Non-Goals

**Goals:**
- Every row `watch.js` can select is reachable and, once selected, rendered
  with the `▸` marker on some frame.
- `NEEDS YOU` never scrolls and is never capped — unchanged from today.
- The renderer (`renderFleet`) stays a pure `(runs, opts) -> string`
  function; `scrollOffset` is a plain input on `opts`, exactly like
  `selected`.
- Sane, non-crashing behavior when fewer terminal rows are available than
  there are sections (today's "collapse to one line" behavior is preserved
  and composes with scrolling).

**Non-Goals:**
- Changing `QUEUED`'s own rendering or its `MAX_FINISHED` cap — it is
  `unselectable` and out of the index space this change touches; the ticket
  does not ask for queue scrolling.
- A mouse-wheel or page-up/page-down input model — this change reuses the
  existing `j`/`k` (and their arrow-key aliases) `move` action; scrolling is
  a side effect of moving selection past the visible edge, not a new
  keybinding.
- Persisting scroll position across a full dashboard restart — it is
  in-memory poll-loop state, same lifetime as `selected`.

## Decisions

### Decision 1 — `MAX_FINISHED` becomes a window size, not a hard cap

`FAILED`/`DONE` (the two sections `MAX_FINISHED` already gates) keep a
bounded number of *simultaneously rendered* rows — `MAX_FINISHED` still
caps how many rows of a section can be on screen at once — but which
`MAX_FINISHED`-sized slice of the section is shown is now a function of
`scrollOffset` rather than always "the first `MAX_FINISHED`". Rows beyond
the window are still counted in the section's own "… and N more" collapse
line (worded identically to today), they are just no longer permanently
unreachable.

Alternative considered: drop `MAX_FINISHED` entirely and let the whole-frame
height budget be the only trim. Rejected — `MAX_FINISHED` also bounds how
much work `renderRun` does per frame independent of terminal height (a
piped/unbounded `rows: 0` render, used by tests and `--once` output, has no
height budget at all and would otherwise render unbounded FAILED/DONE
history on every poll).

### Decision 2 — One `scrollOffset`, expressed in the shared selectable-`index` space

`scrollOffset` is a single integer counted in the same flat index space as
`selected` and `index` (the counter `renderFleet` already walks across
`NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` rows). It means "hide this many
selectable rows from the start of the scrollable region" — the scrollable
region being everything *after* `NEEDS YOU` (which is pinned and always
fully shown, so it is never part of the offset). A single shared offset
(rather than one per section) matches the ticket's framing of scrolling "the
view", not an individual section, and mirrors how a real terminal scrollback
behaves — moving down past `RUNNING`'s last visible row scrolls `FAILED`
into partial view exactly like a continuous list, rather than jumping to a
per-section offset of its own.

Concretely: `renderFleet` computes each section's window by walking the
sections **in render order, explicitly skipping `QUEUED`** (it is
`unselectable` and stays out of this accounting exactly as it already stays
out of the `index` counter — same guard, same reason), subtracting each
walked section's row count from a running "remaining rows to skip" counter
seeded from `scrollOffset`. A section entirely before the offset renders
nothing but still contributes to the "hidden" count of the first section the
offset actually lands inside; a section straddling the offset renders from
that mid-group `startOffset` up to `MAX_FINISHED` further rows; every
section after that renders from its own start (`startOffset: 0`), subject to
`MAX_FINISHED`. The whole-frame height budget is then applied on top of
this scroll-windowed result — see Decision 3's protection rule below for
exactly how, since applying it naively (today's always-trim-the-tail rule)
would cut off the very row scrolling just revealed.

Per-section, this walk produces `{ shown, startOffset, hidden }`: `shown` is
how many rows of the section render this frame, `startOffset` is the
section-local index of the first rendered row (`0` for every section except
the one `scrollOffset` straddles), and `hidden` is the count folded into
that section's "… and N more" line (everything before `startOffset` plus
everything from `startOffset + shown` onward).

Alternative considered: a `Map`/array of per-section offsets. Rejected as
both more state than `watch.js` needs to track (three counters instead of
one) and a worse match for `j`/`k`'s "move one row" semantics — a per-section
model would have to decide which section's offset a bare "move down" even
adjusts, reintroducing the same ambiguity this decision avoids.

### Decision 3 — `watch.js` clamps `scrollOffset`; the height-budget trim must never evict the selected row

A new pure export, `visibleWindow(runs, opts)` (used internally by
`renderFleet` and exported for `watch.js`), returns
`{ sections: [{ shown, startOffset, hidden }, ...], firstVisibleIndex,
lastVisibleIndex, maxScrollOffset }` for a given `(runs, opts)` — the same
section/cap/height-budget arithmetic `renderFleet` already performs,
factored out so both call sites share one implementation rather than two
that could drift.

`watch.js`'s `move` action handler computes the new `selected` exactly as it
does today, then calls `visibleWindow` (with the *candidate* `scrollOffset`
already in state) and adjusts `scrollOffset`: scroll up if `selected <
firstVisibleIndex`, scroll down if `selected > lastVisibleIndex`, otherwise
leave it unchanged. Every `draw()` also re-clamps `scrollOffset` to `[0,
maxScrollOffset]` (mirroring the existing `if (selected >= runs.length)
selected = ...` clamp immediately above it) so a `runs` list that shrinks
(a run finishes and rolls out of `FAILED`/`DONE` faster than a human
scrolls, or the terminal is resized shorter) can never leave `scrollOffset`
pointing past the end.

**The height-budget trim must never remove the row holding `opts.selected`.**
This is the fix for the gap the design skeptic's round-1 report identified:
today's trim loop always shrinks `shown[i]` from the tail of whatever a
section is currently displaying, which is safe when every section renders
from its own start (`startOffset: 0` — the dropped rows are always the
section's lowest-priority ones, never the selected one, since `selected`'s
own section is `RUNNING`/`FAILED`/`DONE` at whatever it index happens to be,
and this project's UX has never let you select a row and then have the
*global* budget-trim silently disagree). But `visibleWindow` now lets a
section's window start mid-group (`startOffset > 0`), and the row
`scrollOffset` was JUST adjusted to reveal (`selected`, sitting at
`lastVisibleIndex` immediately after a downward scroll, or at
`firstVisibleIndex` after an upward one) is exactly the row an unmodified
tail-trim would remove first. So: when the budget trim needs to shrink a
section that contains `selected` within its current `[startOffset,
startOffset + shown)` window, it trims from whichever edge of that window is
**farther** from `selected`'s position — growing `startOffset` (dropping
rows off the top) if `selected` is nearer the window's tail, or shrinking
`shown` from the bottom if `selected` is nearer the window's head — and
never shrinks past the point where `selected` itself would fall outside
`[startOffset, startOffset + shown)`. A section that does not contain
`selected` is trimmed exactly as today (tail-first), since there is no
selected row in it to protect.

If the whole-frame budget is small enough that this protection itself cannot
be satisfied (not even one row fits below `NEEDS YOU`/`QUEUED`), the section
collapses to its existing "… and N more" single line (Decision 4) — the
selected row is then named only in that count, not rendered with a marker,
which is the same accepted degraded case the ticket's own framing already
allows for “very small terminal heights” (a terminal that cannot show even
one row of anything is a display limit, not a re-introduction of the
alignment bug: there is nothing this change can render a marker onto that
does not exist on screen at all).

This keeps `renderFleet` itself free of any "what should scrollOffset be"
decision — it only ever reads the value `opts.scrollOffset` already holds,
same as `opts.selected` today; the protection rule above is part of
`visibleWindow`'s own pure computation (driven by the `opts.selected` it is
already given), not a second, separate decision `watch.js` has to make.

### Decision 4 — Small-terminal-height behavior is unchanged in kind

When the height budget cannot fit even one row of a scrollable section
below `NEEDS YOU`, that section already collapses to its single "… and N
more" line (today's `shown[i] === 0` path) — this change does not alter that
collapse, it only changes *which* rows count toward the "N more" (the ones
outside the current scroll window, rather than always "everything past the
first `MAX_FINISHED`"). A terminal too short even for `NEEDS YOU` plus one
line of header/footer is already an accepted degraded case today (`NEEDS
YOU` is never trimmed, per the existing `pinned` skip in the trim loop) and
is unaffected by this change.

## Risks / Trade-offs

- **[Risk]** Factoring the section-window arithmetic out of `renderFleet`
  into a shared `visibleWindow` helper risks the two call sites (render, and
  `watch.js`'s scroll-clamp) drifting if only one is updated later.
  → **Mitigation**: `renderFleet` calls the *same* exported function
  `watch.js` calls, not a re-implementation; a single change to one
  function updates both call sites by construction.
- **[Trade-off]** A single shared `scrollOffset` (Decision 2) means scrolling
  down through `RUNNING` and into `FAILED` feels like one continuous list,
  but a section whose rows have all scrolled out of view still keeps
  rendering its own title/box (per today's non-collapsed behavior) — it is
  not indistinguishable from "no such section". Accepted: the acceptance
  criteria ask for the selection and marker to stay aligned and visible,
  not for a specific visual treatment of a fully-scrolled-past section, and
  keeping section boundaries visible is more legible than hiding them.

## Migration Plan

No data migration. `scrollOffset` defaults to `0` (today's behavior,
byte-for-byte) whenever it is absent from `opts`, so every existing caller
of `renderFleet` (tests, `--once` output) that does not pass it is
unaffected until `watch.js` starts threading it through.

## Open Questions

None outstanding — the design gate is the place to raise any.
