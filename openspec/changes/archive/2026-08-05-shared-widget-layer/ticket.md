# CON-71: UI/UX sharpening: shared widget layer and visual polish across all screens

## Description

Follow-on from the 2026-08-04 modularization batch (watch.js → controllers + launcher, fleet.js → package, bin/concertino → lib/cli). With the god files split, the remaining gap is *reuse and polish*: each screen still hand-rolls its own chrome, so visual conventions drift and every new screen re-invents layout plumbing.

## Scope

**Shared widget/component layer** (`lib/ui/widgets/` or similar):

* Extract the repeated per-screen patterns into reusable components: pane/box headers, section titles with icons, footer hint bars (already shared via `f.hintLines` — finish the job with a `footer()` widget owning its own height accounting), confirm dialogs (kill/clear-queue/force-start all hand-roll the same shape), scrollable viewports (fleet windowing, docview scroll, drilldown panel scroll, ticketview scroll are four implementations of one concept), and text-input fields (prompt, draft fields, reply, banner reply are four implementations).
* Every screen's height-budget math (`reservedBelow`/`belowBoxRows`/`belowRow`) is bespoke and has caused repeated off-by-one bugs (see the footer-wrapping fix, CON-43, CON-26). A single layout helper that owns "header + content viewport + footer" vertical accounting would eliminate the class.

**Visual sharpening:**

* Consistent color/emphasis language across screens (status colors, selection highlight, dim hierarchy) — currently per-screen judgment calls.
* Iconography pass (extends CON-42) so section/label/metadata icons are uniform on every screen, not just fleet.
* Consistent empty-state and error-state rendering (teamNotFoundMessage-style guidance everywhere a pane can be empty).

## Acceptance Criteria

* New widgets are pure functions with their own unit tests; screens shrink accordingly.
* No behavior change to key bindings or event semantics; existing screen tests keep passing (facade exports preserved).
* A new screen can be assembled from widgets + a controller without copying layout math from an existing screen.

## Grounding

Screens are pure `render(state, opts) -> string` + `handleKey` registered in `lib/ui/router.js`; that seam stays. See CON-58's audit notes and the modularization-batch commit messages for current module boundaries.

## References

* CON-43: TUI should occupy the terminal's full height
* CON-26: Trim phantom trailing blank row in dashboards per-poll redraw
* CON-42: Iconography for sections, labels, and metadata across the dashboard
* CON-58: Repo-wide audit and cleanup; introduce CONTRIBUTING.md, improve module boundaries
