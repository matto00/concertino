# CON-12: Dashboard needs a real visual design — bordered panes, focus highlighting, lazygit-grade polish

Priority: High
URL: https://linear.app/helioapp/issue/CON-12/dashboard-needs-a-real-visual-design-bordered-panes-focus-highlighting

## Description

The dashboard is functionally complete across six screens but visually rudimentary: flat text, no frames, no sense of which pane has focus, and section headings carrying all the structural weight. It reads as a printout rather than an interface.

The target is **lazygit**: bordered panes, an unmistakably highlighted active pane, consistent internal padding, and a layout that survives resizing without losing its shape.

### What this covers

* **Bordered panes.** Box-drawing frames around each region — fleet sections, the drill-down's timeline/gates/evidence panels, the launch pad's epic and ticket panes, the ticket viewer.
* **Focus.** The active pane is obvious at a glance — border colour or weight, not a subtle cue. Two-pane screens need this most; today nothing indicates whether `j`/`k` will move epics or tickets.
* **Selection vs focus** are different states and should look different: the selected row in an unfocused pane should stay visible but recede.
* **Consistent spacing** — padding inside frames, alignment of columns across screens, a shared set of separators rather than each screen inventing its own.
* **Colour with meaning.** `ROLE_COLOUR` already exists for the drill-down's role gutter. Extend that discipline: status colours consistent across screens, and nothing coloured purely for decoration.

### Constraints that make this harder than it looks

* **Everything must stay pure.** Screens are `render(state, opts) → string` with no I/O and no state. Borders and focus are computed from `opts`, not from terminal queries.
* **Width accounting is in visible columns.** `format.js`'s `truncate`/`padTo` already handle escape sequences as zero-width and CJK/emoji as double-width. Frames make this stricter, not looser — a border that drifts by one column is immediately obvious. Two bugs have already lived in this blind spot because `isTTY` is false under `node --test`, so no test has ever seen a colour.
* **Zero npm dependencies.** No TUI framework. Box drawing and colour by hand, as now.
* **Degradation must survive the redesign.** "no telemetry", "phase unknown", "no evidence recorded", "press r to fetch" are load-bearing, not filler — a prettier screen that hides them is a regression.
* **Narrow terminals still have to work.** The fleet view caps sections to fit the height and never lets `NEEDS YOU` scroll away. Frames cost rows; that guarantee has to hold.

## Acceptance Criteria

* A shared layout helper the screens draw through, rather than six independent implementations of the same box.
* Focus is visually unambiguous on every multi-pane screen.
* Snapshot tests at several widths and heights, including a case with wide characters, and at least one asserting that no rendered line exceeds the budget *in visible columns* with borders and colour both present.
* A test that forces `isTTY = true` so the colour path is actually exercised — the existing `format-colour.test.js` is the model.
* Every existing degradation message still appears.

## Notes

Worth doing as one coherent pass rather than per-screen, so the visual language is decided once. A screenshot or two in `docs/dashboard.md` would help, since the docs currently describe the dashboard entirely in prose.

## Orchestrator-added run constraints (from delivery instructions, not the ticket itself)

* Six screens exist: `fleet`, `escalation`, `drilldown`, `launchpad`, `ticketview`, `launchplan`.
* No Phase 4 cleanup for this run — stop after delivery (PR created, ticket updated, summary presented). The human is away; cleanup needs their merge confirmation.
* This is a visual change tests cannot fully judge — the final human-facing summary must include a rendered sample of the fleet screen and one two-pane screen at 100 columns.
