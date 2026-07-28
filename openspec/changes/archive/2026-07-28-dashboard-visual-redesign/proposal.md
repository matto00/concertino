## Why

The dashboard (`lib/ui/watch.js` + its six screens) is functionally complete but
visually rudimentary: flat text, no frames, no indication of which pane has
focus, section headings carrying all the structural weight. The user, on
seeing it, called it "very rudimentary" and asked directly for lazygit-grade
polish: bordered panes, an unmistakably highlighted active pane, consistent
padding, a layout that survives resizing.

## What Changes

- Add a shared layout module (`lib/ui/layout.js`) that draws bordered panes —
  single-line box-drawing frames, a visibly distinct focused-pane frame,
  title-in-border, internal padding — as a pure `(lines, opts) -> lines`
  helper, plus a side-by-side pane composer for the two-pane screens. Every
  screen draws through this module rather than inventing its own box.
- Redraw all six screens (`fleet`, `escalation`, `drilldown`, `launchpad`,
  `ticketview`, `launchplan`) to route their panels through the layout
  helper: bordered sections on the fleet view (NEEDS YOU / RUNNING / FAILED /
  DONE), bordered timeline/gates/evidence panels on the drill-down, bordered
  epic/ticket panes on the launch pad, a bordered body on the ticket viewer
  and launch plan, a bordered question panel on the escalation screen.
- Establish a focus-vs-selection visual language: the pane with keyboard
  focus gets a visually distinct border (colour AND weight, so it still reads
  under `bold`-only rendering); the selected row within the focused pane is
  highlighted; the selected row inside an unfocused pane recedes (dim) but
  never disappears.
- Extend the `ROLE_COLOUR` discipline in `format.js` to a small
  `STATUS_COLOUR` vocabulary reused across screens (needs-you/failed/pass →
  consistent colour everywhere; nothing coloured purely for decoration).
- Add a narrow/short-terminal degradation path: below a width/height
  threshold, borders are dropped before any content line is, and `NEEDS YOU`
  is still never allowed to scroll away.
- Preserve every existing degradation string verbatim ("no telemetry",
  "phase unknown", "no evidence recorded", "press r to fetch", the malformed-
  events banner, etc.) — the redesign changes presentation, never the
  presence of these signals.
- Add snapshot tests at several widths/heights (including a wide-character
  case) and one asserting no rendered line exceeds its column budget with
  borders + colour both present, plus a `format-colour.test.js`-style test
  that forces `isTTY = true` to exercise the coloured/focused border path.
- Add a couple of rendered examples to `docs/dashboard.md` so the docs are
  not entirely prose.

## Capabilities

### New Capabilities
- `dashboard-visual-design`: the layout contract governing bordered panes,
  focus/selection visual language, colour vocabulary, and the
  narrow-terminal degradation order across all six dashboard screens.

### Modified Capabilities
(none — this changes presentation only; the telemetry/gate/escalation-context
capabilities' own requirements are unchanged, and every degradation string
those specs govern must still appear verbatim)

## Impact

- New: `lib/ui/layout.js`, `test/layout.test.js`, a colour-forcing test for
  the new focus/border rendering (extending or sitting alongside
  `test/format-colour.test.js`).
- Modified: `lib/ui/format.js` (status-colour vocabulary only — `truncate`/
  `padTo`/`visibleLength` contracts unchanged), all six
  `lib/ui/screens/*.js`, their existing snapshot tests, `docs/dashboard.md`.
- No change to `reducer.js`, `store.js`, `cache.js`, `control.js`, `router.js`,
  or any telemetry/event-schema code — this is a rendering-only change; state
  shape and keybindings are unchanged except where a screen's own layout
  forced a coordinate change (none anticipated — `opts.selected`/`opts.pane`
  stay the same fields).
- Zero new npm dependencies (constraint from the ticket) — box-drawing and
  colour stay hand-rolled in `layout.js`/`format.js`.
