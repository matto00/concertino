## ADDED Requirements

### Requirement: docview exports a shared, bounded, scrollable box core
`lib/ui/screens/docview.js` SHALL export a pure `bodyBox(bodyLines, opts)` function — `bodyLines` an
array of already-wrapped content lines (the caller wraps to its own inner width; `docview.js` itself
does no markdown/wrap work) — that renders those lines inside a single bordered pane, through the
shared `lib/ui/layout.js` box mechanism with no `title:` option woven into the border (this
codebase's single-pane convention — see `escalation.js`/today's `ticketview.js` — as distinct from
the box-owns-its-title convention `drilldown.js`'s/`launchpad.js`'s multi-panel screens use), bounded
to the caller-supplied viewport row budget rather than growing to fit the full content.

#### Scenario: Content that fits the viewport renders in full, unscrolled
- **WHEN** `bodyBox` renders content whose line count is less than or equal to the available
  viewport rows
- **THEN** every line renders, and no scroll indicator is shown

#### Scenario: Content taller than the viewport is windowed, not truncated silently
- **WHEN** `bodyBox` renders content whose line count exceeds the available viewport rows
- **THEN** only a contiguous window of the content (sized to the viewport) renders at any one scroll
  position, and the render includes a visible indication that more content exists beyond the
  current window

### Requirement: docview exports a full-screen `{ title, body }` composition built on the same core
`docview.js` SHALL also export a pure `renderDocView({ title, body }, opts)` that composes one
plain-text title row, a `bodyBox()` call, and one footer row (`esc back`, plus a scroll indicator
when windowed) into a complete screen. `renderDocView` SHALL delegate its content rendering to
`bodyBox` rather than reimplementing box-drawing or windowing independently.

#### Scenario: The full-screen composition is windowed exactly like the shared core
- **WHEN** `renderDocView` renders a document whose body exceeds the available viewport rows
- **THEN** its rendered box content is identical to calling `bodyBox` directly with the same body and
  viewport

### Requirement: docview scrolling is keyboard-driven and clamped, shared by both exports
`docview.js` SHALL export a pure `clampScroll(bodyLineCount, viewportRows, scrollOffset)` helper that
bounds a proposed scroll offset to `[0, max(0, bodyLineCount - viewportRows)]`, and a pure
`scrollDelta(key)` helper that recognises `↑`/`k` and `↓`/`j` (one line) and page-up/page-down
(one viewport) as scroll inputs, returning `null` for any other key. Both `renderDocView`'s own
`handleKey` and any other caller windowing content through `bodyBox` (see the `ticketview` reuse
requirement below) SHALL use these same two functions rather than duplicating scroll-key
recognition or clamping logic.

#### Scenario: Scrolling down is clamped at the end of the document
- **WHEN** the scroll offset is already at `clampScroll`'s maximum for the current document and
  viewport, and a further "scroll down" key is pressed
- **THEN** the resulting offset is unchanged (still the maximum), not pushed past the end

#### Scenario: Scrolling up is clamped at the start of the document
- **WHEN** the scroll offset is `0` and a "scroll up" key is pressed
- **THEN** the resulting offset remains `0`, not negative

### Requirement: docview's exports are generic and reusable, not caller-specific
Neither `bodyBox` nor `renderDocView` SHALL contain any reference to tickets, evidence, or any other
caller-specific concept — their only inputs are content lines (or a `{ title, body }` pair) plus
viewport/scroll options, so either can be reused by any caller needing a bounded scrollable text
pane.

#### Scenario: Two independent callers share the same box-rendering core
- **WHEN** both the evidence reader (via `renderDocView`) and `ticketview.js`'s description/comments
  box (via `bodyBox` directly, keeping its own ticket-specific header rows and footer) render their
  respective content
- **THEN** both do so by calling into the same `bodyBox` core, not two separate box-drawing
  implementations
