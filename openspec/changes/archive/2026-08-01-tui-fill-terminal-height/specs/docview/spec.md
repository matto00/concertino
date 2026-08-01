## MODIFIED Requirements

### Requirement: docview exports a shared, bounded, scrollable box core
`lib/ui/screens/docview.js` SHALL export a pure `bodyBox(bodyLines, opts)` function — `bodyLines` an
array of already-wrapped content lines (the caller wraps to its own inner width; `docview.js` itself
does no markdown/wrap work) — that renders those lines inside a single bordered pane, through the
shared `lib/ui/layout.js` box mechanism with no `title:` option woven into the border (this
codebase's single-pane convention — see `escalation.js`/today's `ticketview.js` — as distinct from
the box-owns-its-title convention `drilldown.js`'s/`launchpad.js`'s multi-panel screens use), bounded
to the caller-supplied viewport row budget rather than growing beyond it to fit content taller than
the viewport. When `opts.viewportRows` is finite (a positive `rows` was supplied by the caller),
`bodyBox`'s rendered box height SHALL grow to fill that viewport — `Math.max(content.length,
viewportRows)` content rows, plus the box's own border rows — rather than always sizing to the
(possibly shorter) natural content height, so a document shorter than the viewport still fills it.
When `opts.viewportRows` is unbounded (`Infinity`, i.e. the caller passed an absent/`0` `rows`), the
box height remains the content's natural height exactly as before this change.

#### Scenario: Content that fits the viewport renders in full, unscrolled
- **WHEN** `bodyBox` renders content whose line count is less than or equal to the available
  viewport rows
- **THEN** every line renders, and no scroll indicator is shown

#### Scenario: Content shorter than a finite viewport grows to fill it
- **WHEN** `bodyBox` renders content whose line count is less than a finite `viewportRows`
- **THEN** the rendered box's height is `viewportRows` plus the box's border rows, not merely the
  content's own natural height — the box is blank-padded to fill the viewport

#### Scenario: Content taller than the viewport is windowed, not truncated silently
- **WHEN** `bodyBox` renders content whose line count exceeds the available viewport rows
- **THEN** only a contiguous window of the content (sized to the viewport) renders at any one scroll
  position, and the render includes a visible indication that more content exists beyond the
  current window

#### Scenario: An unbounded viewport does not grow the box
- **WHEN** `bodyBox` renders with `opts.viewportRows` unbounded (`Infinity`)
- **THEN** the rendered box's height is the content's natural height, unchanged from this function's
  behavior before this change
