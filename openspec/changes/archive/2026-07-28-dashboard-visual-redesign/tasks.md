## 1. Shared layout module

- [x] 1.1 Add `lib/ui/layout.js`: `box(contentLines, opts)`, `hsplit(panes)`,
      `degrade(width, height)`, exporting the focused/unfocused box-drawing
      character sets and `MIN_BOX_WIDTH`/`MIN_BOX_HEIGHT` — per design.md
      Decision 1. Pure, no I/O.
- [x] 1.2 Add `STATUS_COLOUR` to `lib/ui/format.js` next to the existing
      `ROLE_COLOUR` (needs-you/running/failed/done/pass/fail) — per design.md
      Decision 4. Export it alongside the existing exports.
- [x] 1.3 Add `test/layout.test.js`: box dimensions at several widths/heights
      (including one with wide CJK/emoji content), the focused-vs-unfocused
      character-set distinction, the `degrade()` threshold behaviour, and an
      assertion that no `box()`/`hsplit()` output line exceeds its requested
      width in visible columns.
- [x] 1.4 Add a colour-forced test (extend `test/format-colour.test.js` or add
      a sibling `test/layout-colour.test.js` following its exact pattern:
      force `isTTY = true`, clear the relevant `require.cache` entries before
      requiring) that exercises the focused/coloured border path.

## 2. Fleet screen

- [x] 2.1 Redraw `renderFleet` so the NEEDS YOU / RUNNING / FAILED / DONE
      sections are each their own `layout.box()` (title woven into the top
      border, all four using the plain/unfocused border set per design.md
      Decision 2 — the fleet has no second pane to contrast a "focused"
      style against), section colour from `STATUS_COLOUR`. Per design.md
      Decision 3's exact arithmetic: the bottom border replaces today's
      trailing blank separator (drop the blank, do not keep both) and the
      top border replaces today's standalone title row — net section cost
      is unchanged (`2 + 2*shown + moreFlag`), so `sectionHeight()`/
      `height()`/`budget` keep their current numbers unmodified. Do not add
      a border-row term to that math; if the new render's line count
      diverges from the existing formula, that is a bug in the box
      integration, not evidence the formula needs to grow.
- [x] 2.2 Apply the width/height degrade path (design.md Decision 3): below
      `layout.degrade()`'s threshold, sections render exactly as they do
      today (no frame).
- [x] 2.3 Update `test/fleet.test.js` for the new bordered output, keeping
      every existing assertion about degradation strings, the malformed
      banner, and NEEDS YOU never being trimmed.

## 3. Drill-down screen

- [x] 3.1 Replace `twoCol()`'s plain ` │ ` divider with `layout.hsplit()`
      driving three `layout.box()` panes: TIMELINE on the left, GATES and
      EVIDENCE as two separate stacked boxes on the right (per design.md
      Decision 2 — kept separate, not merged, so each can independently
      lose its border under `layout.degrade()` and so the ticket's own
      "timeline/gates/evidence panels", plural, are three legible panels
      rather than two). All three use the plain/unfocused border set — the
      drill-down has no pane-switch key, so there is no second state to
      contrast a "focused" style against (design.md Decision 2). Preserve
      `rightContentWidth()`'s content-driven sizing for the GATES/EVIDENCE
      column width. Per design.md Decision 3's height-reconciliation note,
      pad TIMELINE's content by 2 extra blank rows before calling
      `hsplit()` to absorb the right column's extra box-border overhead.
- [x] 3.2 (Resolved in design.md Decision 2 — no implementation-time
      decision needed here.) Confirm while implementing that no key in
      `drilldown.js`'s `handleKey` routes input differently based on a
      pane concept (it doesn't, as of this writing) before relying on the
      "all three boxes plain" rule; if a future change adds pane-switching
      here, that is a design-doc change, not a quiet code-comment call.
- [x] 3.3 Update `test/drilldown.test.js` for the new bordered output,
      preserving every degradation-string assertion ("no events recorded",
      "no gate results recorded", "no evidence recorded", the malformed
      count).

## 4. Launch pad screen

- [x] 4.1 Redraw the EPICS | TICKETS split through `layout.hsplit()` +
      `layout.box()`, with `lp.pane` driving which side gets the focused
      border set (per design.md Decision 2 — this already has a `focused`
      boolean threaded through `epicRow`/`ticketRow`; extend it to the pane
      border itself, not just the row text).
- [x] 4.2 Ensure the selected row in the non-focused pane still renders
      (dimmed marker), matching design.md Decision 2's "recedes, does not
      disappear" rule.
- [x] 4.3 Update `test/launchpad.test.js` for the new bordered output,
      preserving the cold-cache ("no tickets cached yet — press r to fetch"),
      refreshing, and error-message assertions.

## 5. Escalation, ticket viewer, launch plan screens

- [x] 5.1 Wrap the escalation screen's question/context/options block in a
      single `layout.box()` using the plain/unfocused border set, matching
      design.md Decision 2's single-pane rule (no second interactive surface
      exists on this screen for a "focused" style to be distinguished
      against — the same reasoning as the fleet's four sections and the
      drill-down's three panels).
- [x] 5.2 Wrap the ticket viewer's description/comments body in a
      `layout.box()` using the plain/unfocused border set (same rule as 5.1).
- [x] 5.3 Wrap the launch plan's ticket-list body in a `layout.box()` using
      the plain/unfocused border set (same rule as 5.1), preserving the
      pre-flight ports/mode/concurrency lines above it.
- [x] 5.4 Update `test/escalation.test.js`, `test/ticketview.test.js`,
      `test/launchplan.test.js` for the new bordered output, preserving every
      existing degradation/notice/confirm assertion.

## 6. Cross-cutting polish and docs

- [x] 6.1 Sweep all six screens for ad hoc colour choices that duplicate a
      `STATUS_COLOUR` concept (e.g. `fleet.js`'s `sections[i].colour`,
      `drilldown.js`'s gate icon colour) and switch them to read from the
      shared table.
- [x] 6.2 Add snapshot tests at several widths (e.g. 60/80/100/120 cols) and
      heights across at least two screens, including one case with wide
      (CJK) characters in ticket/epic titles, asserting the visible-column
      budget holds with borders and colour both present.
- [x] 6.3 Add a rendered example (fleet screen and one two-pane screen, both
      at 100 columns) to `docs/dashboard.md`, replacing prose-only
      description with an actual sample block.
- [x] 6.4 Run the full test suite (`node --test`) and fix any regression;
      confirm no screen's line ever exceeds its `cols` budget under a forced
      `isTTY = true` run.

## 7. Handoff

- [x] 7.1 Write `openspec/changes/dashboard-visual-redesign/files-modified.md`
      listing every file touched, for the evaluator/skeptic to review against.
