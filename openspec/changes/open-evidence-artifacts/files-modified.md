## Files modified

- `lib/ui/screens/docview.js` (new) — the shared, pure document-reader core: `bodyBox(bodyLines, opts)`
  (box-only, no title/footer — the generalisation of `ticketview.js`'s old `pane()` helper) and
  `renderDocView({ title, body }, opts)` (the full-screen composition the evidence reader uses), plus
  `clampScroll`/`scrollDelta` and the module's own router-facing `render`/`routeHandleKey` (registered
  as `mode = 'docview'`).
- `lib/ui/screens/ticketview.js` — refactored `renderTicketView` to delegate its box-drawing/windowing
  to `docview.bodyBox` instead of its own `pane()` helper (removed), threading a `rows`/`scrollOffset`
  through `render`/a new `routeHandleKey` (kept alongside the pre-existing, unchanged `handleKey`, whose
  `esc → back-to-launchpad` routing stays hardcoded and untouched). Exports a new `computeViewportRows`.
- `lib/ui/screens/drilldown.js` — added `evidenceItems`/`evidenceWindow`/`EVIDENCE_MAX_VISIBLE` and
  extended `evidenceLines()` with a `{ focused, selectedIndex }` cap-and-scroll-follows-selection
  windowing (mirrors CON-6's `fleet.js` `visibleWindow` principle, adapted to a flat list). Extended
  `handleKey`/`render`/`routeHandleKey` with `\t`-gated EVIDENCE focus, `j`/`k` selection, and `↵` →
  `open-evidence-doc`; extended the footer to show evidence-selection/open hints only while EVIDENCE is
  focused, and the default `↵ attach`/`k kill`/`r restart` hints only while it is not.
- `lib/ui/router.js` — registered `docview` in the `SCREENS` map, wrapping `docview.render`/
  `docview.routeHandleKey`.
- `lib/ui/watch.js` — added `drillFocus`/`drillEvidenceIndex`, `docTitle`/`docBody`/`docScroll`/
  `docViewportRows`, and `ticketviewScroll`/`ticketviewViewportRows`/`ticketviewBodyLineCount` to the
  poll loop's own state, included in `currentState()` and reset by `backToFleet()`/`open-drilldown`.
  Added `applyAction` cases: `switch-drill-focus`, `move-drill-evidence`, `open-evidence-doc` (the
  impure `fs.readFileSync` + `markdown.toPlainText` + `textwrap.wrap` read, try/catch, degrading to a
  "file not found" body on failure), `doc-scroll`, `back-to-drilldown-from-doc`, `ticketview-scroll`.
  `draw()` now recomputes `docViewportRows`/`ticketviewViewportRows`/`ticketviewBodyLineCount` and
  re-clamps `drillEvidenceIndex`/`docScroll`/`ticketviewScroll` every poll (mirroring the existing
  `selected`/`scrollOffset` re-clamp), so a terminal resize while either reader is open can never leave
  a scroll position or selection index out of range.
- `test/docview.test.js` (new) — unit tests for `clampScroll`, `scrollDelta`, `bodyBox` (short content
  unwindowed/byte-identical to the unbounded case; overflowing content windowed with a position
  indicator; never exceeds its own row budget), `renderDocView` (composes `bodyBox` unchanged; footer;
  width discipline), `computeViewportRows`, the core `handleKey`, and the router-facing
  `render`/`routeHandleKey` seam.
- `test/drilldown.test.js` — added tests for `evidenceItems`, the `\t` focus toggle (including "inert
  with no evidence"), footer hint sets per focus state, `j`/`k` selection and `↵` → `open-evidence-doc`
  (including the no-selection defensive case), the `EVIDENCE_MAX_VISIBLE` cap with its "… N more" row,
  scroll-follows-selection windowing, the focused-selection marker, the focused border style, and the
  `render(state, opts)` seam threading `drillFocus`/`drillEvidenceIndex` through.
- `test/ticketview.test.js` — added tests for byte-identical short-ticket output with/without a `rows`
  budget, a long description becoming scrollable rather than overflowing, `computeViewportRows`
  (unbounded fallback; the URL row's extra reservation), and the new `routeHandleKey`'s scroll-key
  wiring (esc priority, clamped scroll, clamping at the document's end, no-op for unbound keys).

## Design note (not a deviation — an implementation-level clarification)

`design.md`/`tasks.md` describe `scrollDelta(key)` with a one-argument signature but also specify its
return value as `{ lines: ±viewportRows }` for page-up/page-down — which requires knowing `viewportRows`
at the call site. Implemented as `scrollDelta(key, viewportRows)` (two arguments) to make that literally
possible; behavior matches every description in design.md/tasks.md/spec.md exactly (arrow/`j`/`k` = one
line, page keys = one viewport, everything else = `null`), only the parenthetical arg-count mention in
the prose was imprecise. Flagging explicitly per the run's own instructions rather than silently
diverging.

Also: `bodyBox`'s own "more above/below" indicator started as two independently-reserved rows (per
task 1.7's literal "more below/above" phrasing) but that made the indicator's own row-reservation
inconsistent with `clampScroll`'s max-offset arithmetic at the very end of a document (either silently
dropping the document's true last line, or showing a spurious "more below" for content that didn't
exist). Resolved by reserving exactly one row, unconditionally, once a document is windowed at all,
rendering a single "showing X-Y of N" position line instead of directional arrows — still an explicit,
visible "there is more" indication (satisfying spec.md's scenario), just self-consistent at every scroll
position. See `docview.js`'s own `windowBody` comment for the full reasoning.
