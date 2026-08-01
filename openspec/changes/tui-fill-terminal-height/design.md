## Context

`watch.js`'s poll loop (`lib/ui/watch.js:902`, `computeScreenRows()`) correctly
computes the terminal's real available rows and passes them as `opts.rows` to
every screen via `router.render()` (`watch.js:955-957`). Three screens already
consume that budget to grow their bottom-most box to fill it — the
"lazygit-layout pass" grow-to-fill pattern:

- `fleet.js:836-948` — the last rendered section's box height becomes
  `Math.max(naturalBoxHeight, budget - usedSoFar)`, where `budget = opts.rows > 0
  ? opts.rows - 1 : 0` (the `- 1` reserves the row the writer's trailing
  newline consumes — this is what keeps a full-budget frame from tripping the
  CON-17/CON-26 auto-scroll/flicker class of regression).
- `drilldown.js:558-576` — the TIMELINE panel is explicitly grown the same way.
- `launchpad.js:432-454` — the ticket-detail pane's `detailHeight` becomes
  `availableForDetail` (already reserving what's below it and the trailing-
  newline row), instead of being capped at its own natural content height.

Three other screens receive the identical `opts.rows` input but never adopted
this pattern — they size their one content box to `boxContent.length + 2`
(natural height) unconditionally:

- `escalation.js:187` — `const boxHeight = boxContent.length + 2;` (`opts.rows`
  is not read anywhere in this file at all).
- `launchplan.js:211-226` — `rows` IS read and already used to compute
  `ticketViewportRows` (a `belowBoxRows`-aware budget, so the ticket list
  windows/scrolls instead of overflowing when it's too long) — but `boxHeight`
  on line 226 is still `boxContent.length + 2`, ignoring that budget when
  content is shorter than it.
- `docview.js`'s `bodyBox()` (`docview.js:112-126`) — `height = content.length +
  BOX_BORDER_ROWS` unconditionally; its own comment (`docview.js:107-111`)
  states this is deliberate: "Content that fits within `viewportRows` renders
  ... at a box height sized to the content itself." This function is shared by
  `renderDocView` (the evidence reader, `docview.js:167-185`) and
  `ticketview.js:77` (the full-screen ticket viewer) — both full-screen
  consumers, so both currently under-fill.

**Live reproduction (ticket AC #1).** The static trace above was confirmed
against a real terminal, driven via `tmux` exactly the way this repo's own
`test/scripts/watch-smoke.test.sh` already drives `concertino watch` end to
end (a live tmux session + `bin/concertino watch --out=<workdir>` + real
keypresses + `tmux capture-pane`) — no live terminal was actually unavailable
in this environment; an earlier draft of this design incorrectly claimed
otherwise (round-1 skeptic design-gate finding, see
`skeptic-design-1.md`). Measured against a 100×30 terminal:

- **`escalation.js`**: opening a seeded escalation renders content through
  row 18 (the `a approve   d deny   t reply   ↵ attach   esc back` footer);
  rows 19-30 are genuinely blank — **12 unused rows**.
- **`launchplan.js`**: opening the launch plan for one selected ticket
  renders content through row 19 (the `↵ confirm & launch   c concurrency …`
  footer); rows 20-30 are genuinely blank — **11 unused rows**.
- **`docview.js`/`ticketview.js`**: opening a ticket's full-screen view
  (short description, no comments) renders content through row 13 (the `esc
  back` footer); rows 14-30 are genuinely blank — **17 unused rows**, the
  most extreme of the three since `bodyBox`'s content is shortest here.

All three matched the static diagnosis exactly: each screen's content simply
stops at its natural height and the remaining terminal rows are never
written to at all (confirmed via `tmux capture-pane`, not inferred). No
other screen (`fleet.js`, `drilldown.js`, `launchpad.js`) was found to
exhibit this gap in the same manual pass, consistent with them already
implementing the grow-to-fill pattern.

No screen writes a final "pad remaining rows" step after `router.render()`
runs (`watch.js`'s `draw()`, `watch.js:955-969`) — `buildFrame`
(`watch.js:199-246`) only blanks rows the *previous* frame occupied that the
*current* one doesn't (`blankTrailingRows`), it never pads a frame up to the
full budget on its own. So a screen that doesn't grow its own content leaves
genuinely empty, unwritten terminal rows below it — this is the reported gap.

## Goals / Non-Goals

**Goals:**
- `escalation.js`, `launchplan.js`, and `docview.js`'s `bodyBox`/`renderDocView`
  (covering `ticketview.js`) grow their content box to fill the terminal's
  available rows, mirroring the established `fleet.js`/`drilldown.js`/
  `launchpad.js` pattern exactly — same `rows - 1` reserved-row convention, same
  "only grows when a finite row budget is given, byte-identical to today's
  output when unbounded" contract.
- No screen ever renders more than its given row budget (no overflow/scroll
  regression of the CON-17/CON-26 class).

**Non-Goals:**
- No change to `fleet.js`, `drilldown.js`, `launchpad.js`'s inline detail pane,
  or `watch.js`'s `screenRows`/`bannerLines` computation — all already correct.
- No generic "pad every screen's output after render()" mechanism in
  `watch.js`. Growth stays a per-screen, per-box concern, exactly as the
  existing three screens already implement it — a generic post-hoc pad step
  was considered and rejected (see Decision 1).
- `docview.js`'s windowing/scrolling behavior for content that EXCEEDS the
  viewport is unchanged — this change only affects the case where content is
  SHORTER than the available budget.

## Decisions

### Decision 1: Per-screen grow-to-fill, not a generic post-render pad step

Considered adding one generic step in `watch.js`'s `draw()` that pads
`router.render()`'s output with blank lines up to `screenRows` after the fact.
Rejected: `watch.js`'s own `buildFrame` diffs the new frame against the
previous one row-by-row (`dashboard-render-loop` spec's "no full-screen
clear" contract) — appending screen-agnostic blank rows after render would
either (a) always show a footer floating above padding, wrong for screens
whose natural "last visual element" isn't meant to look pinned to the
terminal's bottom edge the same way every screen's footer already is via the
existing grow-to-fill pattern (fleet's footer, launchplan's hint line,
escalation's hint line, docview's footer are already the intended last row),
or (b) require re-deriving each screen's own reserved-last-row accounting
from outside the screen, duplicating logic each screen already owns. Growing
the LAST content box within each screen (the pattern `fleet.js`/`drilldown.js`/
`launchpad.js` already use) keeps the footer pinned to the true last row and
reuses each screen's own existing budget accounting.

### Decision 2: `escalation.js` — grow the one content box

`escalation.js` currently never reads `opts.rows`. Add the same
`budget = opts.rows > 0 ? opts.rows - 1 : 0` computation `fleet.js` uses, and
grow `boxHeight` (line 187) to `Math.max(naturalBoxHeight, budget -
usedSoFar)` where `usedSoFar` is `out.length` at the point the box is about to
be pushed (mirroring `fleet.js`'s `out.length + tail.length` — this screen has
no `tail` array, so `usedSoFar = out.length`) plus what's known to follow the
box (the meta/notice/footer lines) — reserved exactly the way
`launchplan.js`'s existing `belowBoxRows` already reserves its own trailing
content. When `opts.rows` is absent/0, `budget` is `0` and `boxHeight` is
unchanged (`naturalBoxHeight`) — byte-identical to today's output, matching
`fleet.js`'s own "unbounded" contract (see its `rows: 0` test).

### Decision 3: `launchplan.js` — grow to the budget already being computed

`launchplan.js` already computes `ticketViewportRows` (`launchplan.js:221`)
as a below-box-aware budget. Change line 226 from `boxContent.length + 2` to
`rows > 0 ? Math.max(boxContent.length, ticketViewportRows) + 2 :
boxContent.length + 2` — the box grows to the SAME budget that already
determines when the ticket list scrolls, so the two numbers can never
disagree (a short ticket list now grows the box instead of leaving budget
unused; a long one still windows exactly as it does today, unaffected).

### Decision 4: `docview.js`'s `bodyBox` — grow when a finite viewport is given

`bodyBox` is called by exactly two places, both full-screen consumers:
`renderDocView` (line 180) and `ticketview.js` (line 77) — `grep` confirms no
other caller exists. Since every existing caller is a full-screen composition
that wants to fill its viewport, growth is unconditional on `bodyBox` itself
(no new opt-in flag needed, unlike a function with mixed embedded/full-screen
callers): when `viewportRows` is finite (i.e. `opts.rows` was a positive
number by the time `computeViewportRows`/`ticketview.js`'s own
`computeViewportRows` produced it — an absent/0 `rows` already resolves to
`Infinity`, preserving the "unbounded" byte-identical case), `bodyBox`'s
`height` becomes `Math.max(content.length, viewportRows) + BOX_BORDER_ROWS`
instead of always `content.length + BOX_BORDER_ROWS`. `content` (post-
windowing) is capped at `viewportRows`, so `Math.max` only ever grows, never
shrinks, the already-windowed case.

### Decision 5: The reserved-last-row convention is preserved everywhere

Every grow computation above stays inside the existing `rows - 1` (or
equivalent, already-established per-screen) reserved-row convention, so a
grown frame reaches at most `rows - 1` content rows before the writer's own
trailing newline — never exactly `rows`. This is the specific invariant that
keeps CON-17/CON-26 (full-screen auto-scroll/flicker on a frame that exactly
fills the terminal) from regressing; it's already true of the three existing
grow-to-fill screens and this change does not touch that arithmetic, only
extends the same pattern to the three screens that lack it.

## Risks / Trade-offs

[Risk] A screen's grow computation double-reserves or under-reserves rows
relative to what actually follows the box, producing a frame that's off by
one row (either leaving one dead row, or reaching exactly `rows` and
regressing CON-17/CON-26) → Mitigation: each screen's `usedSoFar`/`belowBoxRows`
accounting is derived directly from that screen's own existing, already-
correct pre-box `out.length` and known fixed trailing lines (mirroring
`launchplan.js`'s own existing `belowBoxRows` pattern), and verified with a
`fleet.test.js`-style assertion (`lines.length <= rows - 1` and
`lines.length` close to the budget) per screen, plus an explicit assertion
that the footer/last line is still the frame's actual last line.

[Risk] Making `bodyBox`'s growth unconditional (Decision 4) is only safe
because both current callers want it — if a future caller needs an embedded,
non-growing `bodyBox` (like `launchpad.js`'s own detail pane, which doesn't
route through `bodyBox` at all), unconditional growth would silently break it
→ Mitigation: documented inline in `bodyBox`'s own comment (mirroring the
existing "content that fits ... renders at a box height sized to the content
itself" comment, updated to describe the new grow behavior and why it's safe
today), so a future embedded caller is flagged as a case requiring an opt-out
rather than discovered by a rendering bug.

## Migration Plan

No data migration. Purely a rendering change to three screen modules; no
config, storage, or event-schema changes. Rollback is a plain revert.

## Open Questions

None — the fix mirrors an established, already-shipped pattern in the same
codebase for all three affected screens.
