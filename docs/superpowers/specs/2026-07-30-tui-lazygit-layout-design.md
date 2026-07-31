# Concertino TUI — lazygit-style layout pass

**Status:** design approved, not yet implemented
**Date:** 2026-07-30

A layout redesign of every existing dashboard screen (fleet, launch pad, launch
plan, drill-down, escalation, ticket viewer, doc/evidence viewer, and the
cross-screen escalation banner), taking cues from lazygit's chrome: a persistent
top status bar, a persistent bottom command bar pinned to the terminal's actual
last row, a panel grid with numbered jump keys, dense glanceable content, and
scrolling that behaves the same way in every panel that can overflow its
viewport. This is a layout and interaction pass on existing screens — no new
navigation model, no new screens beyond one new fleet panel (METRICS).

---

## Why

Every screen already renders its control hints as the last line of output, but
because each screen's content is variable-height (a fleet with 2 runs vs. 20;
a short ticket description vs. a long one), that footer just floats wherever
the content happens to end. A short frame leaves the bottom half of the
terminal blank; a tall frame is fine until it isn't. There is no terminal-edge
anchoring anywhere in the codebase today.

Separately, scrolling is inconsistent across screens by historical accident,
not design:

- `docview.js` has a real, shared free-scroll implementation
  (`scrollDelta`/`clampScroll`/`bodyBox`) — used by the evidence reader and
  `ticketview.js`.
- `fleet.js`, `launchpad.js`, and `drilldown.js`'s EVIDENCE panel each have
  their own, independently-written selection-driven scroll (`visibleWindow`'s
  `scrollOffset`, `windowStart`, `evidenceWindow`) that do the same conceptual
  thing three different ways.
- `drilldown.js`'s TICKET panel (capped at 5 lines), TIMELINE panel (capped at
  the trailing 14 events), and `launchplan.js`'s ticket list (uncapped, could
  overflow a real terminal for a large batch) have **no scroll at all** — just
  a hard cut with an unreachable "+N more," or no cap whatsoever.
- `escalation.js`'s context block truncates each line independently, with no
  wrap and no scroll — long context from `gather-escalation-context.sh` is
  lossy today.

Finally, `fleet.js` already established a numbered-jump convention (CON-39's
`1-9` digit keys across sections) that nothing else in the app follows —
`drilldown.js` has four panels (TICKET/TIMELINE/GATES/EVIDENCE) but only
EVIDENCE is focusable at all, via `\t`.

## Non-goals

Deliberately out of scope for this pass:

- **Restructuring navigation/routing.** The screen-router model
  (`lib/ui/router.js`, `mode`-based screen switching in `watch.js`) is
  unchanged. A lazygit-style single always-on panel grid across screens (the
  rejected Approach C) is a separate, much larger project if ever pursued.
- **New features beyond the fleet METRICS panel.** An ACTIVITY panel
  (cross-run event timeline) was discussed and is a good future direction,
  but nothing in the codebase aggregates events across runs today — it is
  noted here as a later project, not built in this pass.
- **Narrow-terminal-first design.** The target is a generous terminal
  (100+ cols, 30+ rows) with `layout.degrade()`'s existing flat-fallback
  behaviour handling anything smaller, matching how every screen already
  degrades today. No new narrow-terminal affordances are added.
- **Changing what any keybinding DOES.** This is a layout/rendering pass —
  every existing action, gate, and confirmation flow keeps its current
  semantics. The only interaction additions are: panel focus/jump keys where
  none existed (drill-down), and scroll keys on panels that had none.

---

## Architecture

### The shared shell

Every screen's render output gains a consistent three-part vertical
structure:

```
[ top bar — 1 line, always present ]
[ banner — 0-3 lines, only when a live escalation exists elsewhere in the fleet ]
[ screen content — grows to fill whatever rows remain ]
[ bottom bar — 1-2 lines, pinned to the terminal's actual last row ]
```

**Top bar** (new): `concertino · <project>  ·  <SCREEN NAME>  ·  N runs · M
needs you · queue status`. Present on every screen, always the first line.
Every screen's `render(state, opts)` already receives the full `state`
(`runs`, `queueState`, etc.) — no new data plumbing required, just a shared
`lib/ui/topbar.js` (or a `layout.js` addition) building this one line and each
screen prepending it. Each screen's own existing header content (drill-down's
5 header rows, escalation's ticket/change-name line, launch pad's `NEW RUN ·
project` line, ...) is unchanged and renders directly below this — that is
per-screen context, not the persistent part.

**Banner**: `lib/ui/banner.js`'s cross-screen escalation notice moves into
this same fixed region, directly below the top bar — its entire reason to
exist is "always visible regardless of what screen is on top," which is
exactly the top bar's own guarantee. `banner.suppressedOnOwnScreen` is
unchanged.

**Bottom bar**: every screen's existing hint line(s) (`f.dim('  ...')`,
already always the last thing printed) become the pinned bottom bar. The
mechanism: each screen's render function already computes a row budget
against `opts.rows` (fleet.js's `visibleWindow` height-trim loop is the most
developed example). That budget gains a symmetric **grow** path: when actual
content is *shorter* than the available budget, the last/primary panel's
`layout.box()` call is given an explicit `height` larger than its content
needs — `box()` already blank-pads missing content rows (see `layout.js`'s
existing `contentRows`/padding logic), so this reuses existing machinery
rather than adding a new one. The **trim** path (content taller than budget)
is unchanged — fleet.js already does this; other screens gain it where a
panel newly becomes scrollable (see below).

Confirmation states that already flex the bottom region (fleet's
`clearQueueConfirm`/`forceStartConfirm`/`quitConfirm`, each 1-2 lines) are
unaffected — the budget calculation already treats `tail.length` as dynamic.

### Scrolling, unified into exactly two patterns

1. **Selection-driven** — for panels showing a list of selectable items
   (fleet's runs, launch pad's epics/tickets, drill-down's EVIDENCE). One
   shared helper in `layout.js`, e.g.
   `layout.selectionWindow(total, selectedIndex, maxVisible, currentOffset) →
   { start, count, offset }`, replaces the three independent
   implementations (`fleet.js`'s `visibleWindow` scroll math,
   `launchpad.js`'s `windowStart`, `drilldown.js`'s `evidenceWindow`). Same
   keys everywhere: `j`/`k` (and arrow aliases) move the selection; the
   viewport follows.

2. **Free-scroll** — for read-only text/lists with no per-row action.
   `docview.js`'s existing `scrollDelta`/`clampScroll`/`bodyBox` becomes the
   one implementation, extended to:
   - `drilldown.js`'s TICKET panel (replacing the `TICKET_MAX_LINES` hard cap)
   - `drilldown.js`'s TIMELINE panel (replacing the `MAX_TIMELINE` hard cap)
   - `drilldown.js`'s GATES panel (defensive — gate counts are small in
     practice, but no longer silently unbounded)
   - `launchplan.js`'s ticket list (currently fully unbounded)
   - `escalation.js`'s context block (currently truncated per-line, no wrap)

   Same keys everywhere: `j`/`k` scroll one line, `\x1b[5~`/`\x1b[6~`
   (page up/down) scroll one viewport.

`ticketview.js` and the evidence reader (`docview.js`'s own
`renderDocView`) already use free-scroll correctly — no scrolling change
needed there, only the shell wrapper (top bar, pinned bottom).

### Panel grid + jump keys

Fleet's existing digit-jump (`1`-`9` across NEEDS YOU / RUNNING / QUICK START
/ QUEUED / FAILED / DONE) is extended to drill-down: TICKET / TIMELINE /
GATES / EVIDENCE become panels `1`-`4`, focusable by digit or by `\t`
(cycling), with the focused panel rendered in `layout.js`'s existing
`focused` border style (`┏┓┗┛`, already used by `launchpad.js`'s pane-switch
and drill-down's own EVIDENCE-focus today — now applied to all four panels
uniformly).

**Panel numbering is shown in the title bar itself** — e.g. `[1] TICKET`,
`[2] TIMELINE` — on both drill-down's new panels and (retrofit) fleet's
existing sections, so the digit-jump binding is discoverable on screen, not
only in the footer hint text.

Single-pane screens (escalation, ticket viewer, doc viewer, launch plan) keep
exactly one interactive surface and gain no jump keys — there is nothing to
jump between. Launch pad keeps its existing Tab/arrow pane-switch (EPICS ↔
TICKETS) without adding numbered jump — two panes don't need a third way in.

---

## Per-screen changes

### Fleet view

- Top bar added above the existing project/run-count header line.
- Sections grow to fill available height (the DONE/last-rendered section's
  box height is padded up to the row budget rather than leaving blank
  terminal below the footer).
- **DONE and FAILED rows collapse from 2 lines to 1** (`CON-40  quick-start-
  widget          delivered · 8m  ▼`) — a finished run's progress bar/phase/
  gates detail isn't live information anymore, so collapsing it roughly
  doubles how much history fits on screen. NEEDS YOU and RUNNING stay 2-line
  — the bar/phase/gates there is live and worth the space.
- Section titles gain `[N]` numbering (see above).
- **New METRICS panel**, positioned after DONE: avg delivery time (reusing
  the already-computed `avgDoneMs` from the delivery-time-arrow feature),
  tickets delivered today/this week, and escalation count — all roll-ups of
  data the reducer already produces (`run.elapsedMs`, `run.status`,
  `run.escalation`), no new data collection. Not selectable, no jump-key slot
  of its own beyond the existing section-jump numbering (it participates
  like any other section).
- QUICK START (CON-40) and QUEUED sections, Clear Queue, and the delivery-
  time arrows are all unaffected functionally — this pass only touches how
  they're laid out, not what they do.

### Launch pad

- Top bar added above the existing `NEW RUN · project` header line.
- EPICS/TICKETS panes and the inline detail preview grow to fill available
  height (today capped tightly to `MAX_EPICS_VISIBLE`/`MAX_TICKETS_VISIBLE`
  with dead space below on a tall terminal).
- No numbered jump added (Tab already covers 2 panes).
- Inline detail preview stays capped, not scrollable — reading the full
  ticket is `ticketview.js`'s job (Enter); giving the preview its own scroll
  would blur that distinction.

### Launch plan

- Top bar added above "LAUNCH PLAN".
- The ticket-list box gains real scroll (free-scroll — it's a read-only
  preview, not a selectable list) instead of being fully unbounded.
- Box grows to fill height when the batch is small.

### Drill-down

- Top bar added above the existing 5-row header.
- TICKET/TIMELINE/GATES/EVIDENCE become a real 4-panel grid: numbered `1`-`4`,
  `\t` still cycles, focused panel gets the heavy border.
- TICKET and TIMELINE gain free-scroll (replacing their hard caps). GATES
  gains free-scroll defensively. EVIDENCE keeps its existing selection-driven
  scroll (its rows are actionable — Enter opens the doc).
- TIMELINE is the flex panel that grows to absorb leftover height (the
  naturally variable-length one; GATES/EVIDENCE stay sized to their own
  content).
- Layout shape unchanged: TICKET full-width on top (description text wants
  full width), TIMELINE | GATES+EVIDENCE below.

### Escalation

- Top bar added above the existing ticket/change-name line.
- Context block gains wrap + free-scroll when it overflows (currently
  truncates each line independently with no way to read the rest).
- Box grows to fill height. No jump keys (one interactive surface).

### Ticket viewer / doc-evidence viewer

- Already use the shared free-scroll primitive — no scrolling change.
- Top bar added; box grows/pins like every other screen.

### Escalation banner

- Moves into the shell's fixed top region (top bar, then banner if a live
  escalation exists), rather than being composed ad hoc above whichever
  screen is on top. `suppressedOnOwnScreen` logic unchanged.

---

## Testing

- `layout.js`'s new `selectionWindow` helper: unit-tested directly (clamping
  at both ends, selection-follows behaviour), then `fleet.js`/`launchpad.js`/
  `drilldown.js`'s own scroll tests are rewritten against it rather than
  their bespoke implementations — same property, one shared proof.
- `docview.js`'s scroll primitives already have their own test coverage;
  each new caller (drill-down's TICKET/TIMELINE/GATES, launch plan's ticket
  list, escalation's context) gets its own scenario tests the same way
  `ticketview.js`'s existing tests do (page up/down, clamping, "showing X-Y
  of N" indicator).
- The shell's grow-to-fill-height behaviour: pure render-function tests
  asserting the bottom bar line index equals `rows - 1` across a range of
  content heights (short content, tall content, content exactly at budget),
  mirroring `fleet.js`'s existing height-budget test style
  (`visibleWindow`'s trim tests).
- METRICS panel: pure function tests against fixture `runs` arrays (avg
  delivery time computation reuses the existing `avgDoneMs` logic already
  tested in `test/fleet.test.js`).
- Full-app integration coverage (a real `watch()` loop, fake tmux/stdin) for
  at least one grow-to-fill scenario and one new-scroll scenario, mirroring
  `test/watch.test.js`'s existing CON-27 resize/redraw tests.

## Implementation surface

- `lib/ui/layout.js` — new `selectionWindow` helper; `box()` unchanged
  (already supports the padding this needs).
- `lib/ui/topbar.js` (new) — the shared top-bar line builder.
- `lib/ui/docview.js` — no interface change; more callers.
- `lib/ui/screens/fleet.js` — row density, `[N]` title labels, METRICS
  section, grow-to-fill.
- `lib/ui/screens/launchpad.js`, `launchplan.js`, `drilldown.js`,
  `escalation.js`, `ticketview.js`, `docview.js` — shell wrapper, scroll
  wiring where noted above.
- `lib/ui/banner.js` — no logic change; new call site (shell's fixed region
  instead of ad hoc per-screen composition).
- `lib/ui/watch.js` — drill-down's new panel-focus state (`drillFocus`
  extended from binary EVIDENCE-only to one of 4 panel names), METRICS data
  computation.

## Build order

1. `layout.js`'s `selectionWindow` + `topbar.js` (shared primitives, no
   screen changes yet).
2. Fleet view (highest-traffic screen; validates grow-to-fill + `[N]`
   labels + METRICS end to end).
3. Drill-down (the biggest single change — 4-panel grid).
4. Launch pad, launch plan (straightforward shell + scroll wiring).
5. Escalation, ticket viewer, doc viewer, banner (smallest, most mechanical).
