## Context

Six screens (`lib/ui/screens/{fleet,escalation,drilldown,launchpad,ticketview,
launchplan}.js`) each render `(state, opts) -> string` with no I/O. Each
screen currently hand-rolls its own visual structure: `fleet.js` uses bare
section headings and blank-line separators; `drilldown.js` and `launchpad.js`
each build their own two-column layout (`twoCol` / the inline loop at the end
of `renderLaunchPad`) with a ` │ ` divider and no frame; `escalation.js`,
`ticketview.js` and `launchplan.js` are single flowing columns with no frame
at all. None of them share code for drawing a box.

`format.js` already solves the hard, previously-buggy part of this — visible-
column width accounting through ANSI and wide/zero-width code points
(`truncate`, `padTo`, `visibleLength`) — and doing this correctly for text is
a precondition for doing it correctly for borders: a border is exactly one
more column-accounted element per line, and it is *less* forgiving of an
off-by-one than a padded text row, because a `┃` in the wrong column is
visible instantly.

Two bugs already shipped past every test in this exact spot (`truncate`/
`padTo` miscounting a coloured or wide-character string) because
`process.stdout.isTTY` is `false` under `node --test`, so no snapshot test
before `format-colour.test.js` ever exercised the colour path. This change
adds a second colour-and-structure-dependent surface (borders, focus
weight) with the same blind spot, so it needs the same treatment: a test
file that forces `isTTY = true` before requiring the modules under test.

## Goals / Non-Goals

**Goals:**
- One shared layout module every screen draws its frames through, not six
  independent box implementations.
- Focus is visually unambiguous, and survives a terminal that renders bold
  but not colour (structural distinction, not purely chromatic).
- Selection and focus read as different states everywhere they coexist.
- Every existing degradation string, cap, and pinned-section guarantee
  (`NEEDS YOU` never scrolls away) survives unchanged.
- No new npm dependency; hand-rolled box-drawing and colour, as now.

**Non-Goals:**
- No change to state shape, keybindings, or the router/reducer/store/cache/
  control layers — this is a rendering-only pass over the six screens plus
  one new shared module.
- No terminal-capability detection beyond what `format.js` already does
  (`isTTY`). No 256-colour/truecolour upgrade — the existing 8-colour SGR
  codes in `format.js` are reused, not replaced.
- No redesign of *content* (what a screen says) — only of how it is framed,
  padded, and highlighted. Every string a screen prints today still prints;
  degradation messages are verbatim.

## Decisions

### 1. Shared layout helper, not six implementations

New module `lib/ui/layout.js`, pure (no I/O, no state), exporting:

- `box(contentLines, opts) -> string[]` — draws a single bordered pane.
  `opts`: `{ width, height, title, focused, padding = 1 }`. Returns an array
  of exactly `width`-visible-column lines: a top border (with `title` woven
  in if given — see the title-overflow rule below), exactly `height - 2`
  content rows, and a bottom border. If `height` is omitted, the box is
  exactly `contentLines.length + 2` lines tall (no vertical padding is added
  in that case either — see below).

  **Padding is horizontal-only.** `padding` (default 1) indents each content
  row by `padding` columns on each side — content is truncated/padded to
  `width - 2*padding - 2` (the `- 2` is the two vertical border characters) —
  and does **not** reserve any additional blank row above or below the
  content. Content rows are exactly `height - 2` (top border + bottom
  border), full stop; a screen that wants visual breathing room asks for it
  explicitly by passing a blank string as a content line, the same way every
  screen already pads today. This keeps the row-budget arithmetic in
  Decision 3 exact rather than padding-dependent. Overflow/underflow of
  content within those rows uses the same contract as everywhere else in
  this codebase: short content is blank-padded (`f.padTo`), long content is
  `…`-truncated (`f.truncate`).

  **Title overflow uses the same contract as content.** A `title` is woven
  into the top border via `f.truncate(title, availableTitleWidth)`, where
  `availableTitleWidth` is the border width minus the two corner characters
  and a fixed 2-column margin (` ─ title ─ ` style). This applies whether or
  not the title carries `STATUS_COLOUR`/role colour — `f.truncate` already
  treats ANSI escapes as zero-width, which is exactly the property that
  makes it safe to reuse here for a coloured, dynamic title (the fleet
  section headings, the drill-down's `TIMELINE ▲ N malformed` badge) rather
  than inventing a second, untested truncation path in the one place (a
  border) where a width miscount is most visible.
- `degrade(width, height)` — `true` when a bordered box would not have room
  to be legible (see Decision 3). Screens call this once per box and, when
  it returns `true`, render that box's content through the *same* padding
  convention but skip `box()` entirely (no frame drawn at all) rather than
  drawing a truncated/illegible frame.
- `hsplit(panes) -> string[]` — composes boxes that are already the same
  height side by side with a one-column gap, for the two-column screens
  (drill-down's TIMELINE | [GATES over EVIDENCE], launch pad's EPICS |
  TICKETS — see Decision 2 for why drill-down's right side is two stacked
  boxes, not one). Each entry in `panes` is a pre-rendered `box()` result
  plus its own width; `hsplit` zips them line-by-line. This keeps `box()`
  itself single-purpose (one frame, one job) and lets each screen decide its
  own width split (`drilldown.js` already sizes its right column from
  content, `launchpad.js` uses a fixed `EPICS_WIDTH`) without `layout.js`
  needing to know either policy.

Alternative considered: give every screen its own thin wrapper around raw
box-drawing characters, matching the "six implementations" the ticket
explicitly calls out. Rejected — it is exactly what already produced three
subtly different two-column layouts (`twoCol` in `drilldown.js`, the ad hoc
loop in `launchpad.js`, no shared frame anywhere else), and it duplicates the
one thing that is genuinely easy to get wrong (visible-column border
placement) six times instead of once.

Alternative considered: a stateful `Layout` class that accumulates panes and
renders once. Rejected — every screen in this codebase is a pure function
ending in one `.join('\n')`; a class with mutable internal state is a
different shape than everything around it for no benefit `box()`/`hsplit()`
(both pure, both stateless) do not already provide.

### 2. Focus vs. selection: two independently legible states

**The heavier/plain border distinction is reserved for screens that actually
route keyboard input to one of several panes.** Today exactly one screen
does that: `launchpad.js` (`lp.pane === 'epics' | 'tickets'`, switched by
Tab/←/→, and every keypress that moves selection or acts on a row is
interpreted differently depending on which pane is current). No other screen
has a pane-switch key:

- **`fleet.js`** has one selectable list (`selected` is a single index across
  all sections); `j`/`k`/`↵`/`l` always mean the same thing regardless of
  which section the selection is currently in. There is no second pane to
  contrast it against. **Decision: the four sections (NEEDS YOU / RUNNING /
  FAILED / DONE) each become their own `box()`, all drawn with the plain
  (unfocused) border set** — bordering them groups and separates them
  visually (the ticket's ask), but none of them is "the focused one" because
  there is nothing else on this screen to be focused *instead of*. The
  within-list selection marker (`▸`, bold on its row) is what indicates
  position, exactly as today, now inside a bordered section rather than a
  bare list.
- **`drilldown.js`** has no key that moves input between TIMELINE and
  GATES/EVIDENCE — `k`/`r`/`↵` act on the whole run, not on a specific
  pane, and neither panel scrolls independently. It is a two-*column*
  layout, not a two-*pane* (keyboard-focus) layout. **Decision: TIMELINE,
  GATES, and EVIDENCE (three separate boxes — GATES and EVIDENCE stacked in
  the right column rather than merged into one, matching the ticket's own
  "timeline/gates/evidence panels", plural, and letting "no gate results
  recorded" and "no evidence recorded" each independently lose their border
  under Decision 3 without the other) all render with the plain (unfocused)
  border set**, for the same reason as the fleet: there is no second target
  to contrast against.
- **`escalation.js`, `ticketview.js`, `launchplan.js`** are single-pane by
  construction (one body, no list to switch into); their one box also uses
  the plain border set.

This one rule — *the focused/heavier border set exists only where a pane
switch is a real, bound keypress* — is what resolves what would otherwise be
an arbitrary per-screen call: it is not that fleet/drill-down "don't need"
focus styling as an oversight, it is that a heavier border on a screen with
only one input target would be signalling a distinction (`this is focused,
implying something else isn't`) that does not exist in that screen's actual
key-handling, which is exactly the "coloured/styled for decoration alone"
the ticket and the spec's colour requirement both warn against.

- **Focus** (which pane `j`/`k`/arrows currently act on, on the launch pad —
  the only screen where this applies) is carried by `box()`'s `focused` flag
  and expressed as a **structural** change, not only a chromatic one: a
  focused box uses the heavier box-drawing set (`┏━┓┃┗━┛`) and, when `isTTY`,
  a bright/bold border colour (cyan, matching `ROLE_COLOUR.executor` for
  consistency — no new hue introduced solely for this). An unfocused box
  (the launch pad's other pane, and every box on every single-target screen
  above) uses the plain set (`┌─┐│└─┘`) with the border left uncoloured (or
  dim). Because the two states use *different characters*, focus still
  reads on a terminal that renders bold but not colour (the ticket's own bar
  for this) — a heavier line is visible with zero colour support at all, and
  `format.js`'s `wrap()` already no-ops when `!isTTY`, so this falls out of
  the existing colour-gating for free.
- **Selection** (the highlighted row within a pane) is orthogonal and applies
  everywhere a list exists, focused-pane concept or not: a selected row in
  the **focused** pane (launch pad only) or in the single pane of a
  single-target screen is bold with its marker (`▸`) in the pane's accent
  colour. A selected row in the launch pad's **unfocused** pane keeps the
  same marker so the row is still findable, but rendered `f.dim()` —
  visible, never bold, never coloured — so the two panes' selections cannot
  be confused for "both panes are active."
- This generalises `launchpad.js`'s existing (pre-change) `focused` boolean
  in `epicRow`/`ticketRow` (today expressed only as `f.bold(line)` for the
  entire row) to the pane's border itself, not just its row text. It is new
  for `fleet.js` (bordering four sections, none "focused") and `drilldown.js`
  (bordering three panels, none "focused") in the sense that boxes appear
  where none existed, but neither screen gains a focused/unfocused
  *distinction* — see above.

Alternative considered: reverse-video (background colour) for the selected
row, matching some other TUIs (including lazygit's own selection highlight).
Rejected for this codebase specifically: background SGR codes are exactly
the kind of "coloured purely for decoration" the ticket warns against when
they are the *only* signal, and they render unpredictably across terminal
themes (a light-background user's "highlight" can be illegible) in a way
foreground bold/colour does not; foreground-only keeps `format.js`'s existing
`wrap()` values (`bold`/`dim`/`red`/`green`/`yellow`/`blue`/`magenta`/`cyan`)
sufficient with no new SGR family to test.

### 3. What degrades first on a terminal that cannot afford frames

Borders cost columns (2 per box, for the side walls) and, naively, 2 rows per
box (top+bottom border) — but on the fleet screen specifically, that row
cost is **not** additive on top of today's layout, because the border
*replaces* rows that already existed rather than adding new ones alongside
them. Working through `fleet.js`'s current `sectionHeight()` exactly
(`fleet.js:190-193`): a populated, uncapped section today costs
`2 + 2*shown + moreFlag` — one row for the section title, one for the
trailing blank separator, plus two rows per run and an optional "…and N
more" row. Once each section is its own `box()`:

- the **top border** (with the section title woven into it, per Decision 1)
  replaces the old standalone title row — same 1 row, not an addition;
- the **bottom border** replaces the old trailing blank separator between
  sections — the border itself is now the visual break, so the blank line is
  dropped, not kept alongside the border;
- the run rows and the "…and N more" row are unchanged (`box()`'s
  `padding = 1` is horizontal-only, per Decision 1, so it adds no vertical
  rows here).

Net: `2 (border) + 2*shown + moreFlag` — **arithmetically identical to
today's total**, zero extra rows per section. This is why `layout.js` is
worth centralising: the visual upgrade (a frame around each section) is
free in the one budget (`fleet.js`'s NEEDS-YOU-never-trimmed guarantee) that
was already the tightest constraint on this screen, *provided* the old
inter-section blank line is dropped in favour of the border — which task 2.1
must do explicitly, not as a side effect.

Order of degradation, cheapest-to-lose first:

1. **Borders go first.** `layout.degrade(width, height)` trips below
   `MIN_BOX_WIDTH` (8 visible columns — enough for border+padding+`…`) or
   `MIN_BOX_HEIGHT` (3 rows — top border, one content row, bottom border).
   Below either threshold, a screen renders that box's content exactly as it
   does today (no frame, same text, and the pre-change title-line-plus-blank
   convention on the fleet specifically) rather than drawing a border that
   would itself have to be truncated into illegibility.
2. **Non-pinned content trims next**, exactly as today: `fleet.js`'s
   existing section-height trim loop (RUNNING/FAILED/DONE capped before
   NEEDS YOU) is unchanged in mechanism and, per the arithmetic above, in
   its per-section cost too — bordering does not make the loop's job any
   harder.
3. **`NEEDS YOU` is never trimmed and never loses its border** unless *no*
   box anywhere on the fleet view can afford one (i.e. the terminal is below
   `MIN_BOX_WIDTH`/`MIN_BOX_HEIGHT` outright) — in which case every section
   degrades to the current borderless rendering together, which is exactly
   today's behaviour and therefore never a regression.

This is a direct extension of `fleet.js`'s existing trim loop (see its own
`sectionHeight`/`height`/`budget` logic), not a replacement of it — and,
per the arithmetic above, not even a change to its numbers, only to what a
"section" visually looks like at the same cost.

The drill-down and launch pad have no equivalent hard row cap today (no
trim loop like fleet's) — both already end their render with the standard
`.map(l => f.truncate(l, cols))` safety net for columns, and neither
degrades rows at all today (a tall drill-down/launch-pad simply scrolls the
terminal, exactly as before this change); adding borders there costs 2 real
rows per box (drill-down: TIMELINE/GATES/EVIDENCE each gain 2; launch pad:
EPICS/TICKETS each gain 2) with no NEEDS-YOU-style guarantee at stake, so no
new row-budget mechanism is needed for them beyond `layout.degrade()`'s
width/height floor.

**Height reconciliation across `hsplit()`'s panes is the caller's job, and
the drill-down's asymmetry is worth naming explicitly.** `hsplit()` requires
its panes to already share a height (see Decision 1); the pre-change
`twoCol()` did this automatically by padding whichever side had fewer
content lines. Post-change, the drill-down's right column is two boxes
(GATES + EVIDENCE) whose combined border overhead (4 rows: 2 boxes × top+
bottom) exceeds the left column's single box (2 rows) — so the caller must
pad TIMELINE's own content by 2 extra blank rows (not just match the raw
content-line counts) before calling `hsplit()`, or the two columns' boxes
will visibly end at different heights. This is a mechanical consequence of
Decision 2's "two boxes, not one" choice for GATES/EVIDENCE, not a new
degree of freedom — task 3.1 accounts for it.

**A fully-collapsed fleet section stays a single unbordered line.** When a
section's `shown[i]` is `0` (every run in it is hidden behind "… and N more
{title}" — `fleet.js:219-222`), there is nothing to put a frame around: that
one summary line renders exactly as it does today, with no box drawn for it
at all. This is unchanged behaviour, stated here only to remove any
inference that a zero-content box should still draw a two-line empty frame
around nothing.

### 4. Colour vocabulary

`format.js` gains `STATUS_COLOUR` next to the existing `ROLE_COLOUR`:
`{ 'needs-you': yellow, running: dim, failed: red, done: dim, pass: green,
fail: red }`. Screens that today pick colours ad hoc for the same concepts
(`fleet.js`'s `sections[i].colour`, `drilldown.js`'s gate icon colour) are
switched to read from this table so "yellow means needs-attention" and "red
means failed" hold everywhere, not just per-screen. Existing `ROLE_COLOUR`
(role gutter, unrelated concept) is untouched.

## Risks / Trade-offs

- [Risk] A shared `box()` that is subtly wrong breaks all six screens at
  once instead of one. → Mitigation: `layout.test.js` gets the exhaustive
  width/height/wide-character/colour coverage the ticket asks for, and every
  screen's own snapshot tests still assert the final rendered string, so a
  regression is caught at both layers.
- [Risk] Adding border rows/columns could silently make a screen exceed its
  advertised `cols`/`rows` budget on a screen that was previously exactly at
  the limit. → Mitigation: every screen keeps its own final
  `.map(l => f.truncate(l, cols))` safety net (already present on all six
  screens today); `layout.test.js` additionally asserts no `box()`/`hsplit()`
  output line exceeds its requested width in visible columns, with border +
  colour both present, per the ticket's acceptance criteria.
- [Risk] The heavier/lighter box-drawing character distinction may not
  render identically across every terminal's font (some fonts kern `┏━┓`
  oddly). → Accepted: this is the same class of assumption the codebase
  already makes for `▪░▸✓✗●○▲` — box-drawing and the existing symbol set are
  both standard Unicode, and `charWidth()` already tables them as
  single-width, so no new width-accounting risk is introduced beyond what
  `format.js` already carries.
- [Trade-off] Foreground-only selection highlighting (Decision 2) is less
  visually loud than lazygit's own reverse-video selection. Accepted
  deliberately: it keeps the existing `format.js` colour primitives
  sufficient and avoids background-colour theme fragility; the border-weight
  distinction for focus is the primary "lazygit-grade" signal the ticket
  asks for, not the selection row itself.

## Migration Plan

Additive at the module level (`layout.js` is new) and a mechanical swap at
the screen level (each screen's own hand-rolled framing is replaced by calls
into `layout.js`); no data migration, no state-shape change, no keybinding
change. Land as one change (per the ticket's own note: "worth doing as one
coherent pass rather than per-screen, so the visual language is decided
once") rather than incrementally per-screen, specifically to avoid six
different interim visual languages existing across commits. Rollback is a
plain revert — no persisted state depends on the new rendering.

## Open Questions

None blocking. The one genuinely open call — reverse-video vs. foreground-
only selection highlighting — is resolved above (Decision 2) rather than
left open, since the ticket asks screens to be built against a single
decided interface, not for the interface itself to stay undecided into
execution.
