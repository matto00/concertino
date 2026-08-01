## Why

Several of the dashboard's section headers, panel titles, and metadata rows are plain text with no visual marker for what kind of thing they are — the drill-down's branch-name row (`lib/ui/screens/drilldown.js`, the `splitLine(run.branch || f.dim('(no branch yet)'), harnessText(run), cols)` row) is today indistinguishable, at a glance, from any other row of text, even though it is structurally a git branch. CON-42 adds a small, additive icon vocabulary to structural sections/labels/metadata across the dashboard so these are visually scannable without reading every word, while staying strictly additive polish — never load-bearing for understanding a screen, and never widening a row past its existing column budget.

## What Changes

- Add a new shared module, `lib/ui/icons.js`, exporting a small, curated table of single-column (narrow) Unicode glyphs for structural concepts used across the dashboard (branch, ticket, timeline, gates, evidence, description, comments, epics list, tickets list, quick start, queue, metrics, document). Every glyph is drawn from the same narrow BMP symbol classes (Geometric Shapes / Miscellaneous Symbols / Box Drawing) this codebase already uses for `✓`/`✗`/`○`/`●`/`▲` in `drilldown.js`/`fleet.js` — no glyph in the table is in `format.js`'s `WIDE` ranges, so each costs exactly 1 visible column, same as the characters it sits beside.
- Icons are prefixed onto existing text, never substituted for it — a terminal/font that cannot render a given glyph still shows the original label unchanged (an unrendered glyph reads as a stray/tofu character before legible text, not as missing information). This mirrors `layout.js`'s existing "structural distinction survives a colourless terminal" discipline: the icon is decoration on top of a label that remains fully readable on its own.
- Icons mark **structure** (what kind of section/row this is), deliberately never duplicating what `STATUS_COLOUR` already marks (**state** — needs-you/running/failed/done/pass/fail). Concretely: the fleet view's NEEDS YOU/RUNNING/FAILED/DONE section headings and the drill-down/gate status markers are explicitly *not* touched by this change (they already carry meaning via colour and the existing `✓`/`✗`/`○`/`●`/`▲` marks) — new icons are added only to sections that today carry no non-colour marker at all.
- Apply the new icons to:
  - The drill-down's branch-name row (the ticket's named example).
  - The drill-down's panel titles: `[1] TICKET`, `TIMELINE`, `GATES`, `EVIDENCE`.
  - The fleet view's non-status section headers: `QUICK START`, `QUEUED (...)`, `METRICS`.
  - The launch pad's `EPICS` pane title. (The right pane's title is the currently-selected epic's name, not a static "tickets" label — out of scope for this pass; see design.md's Non-Goals.)
  - `lib/ui/ticketDetail.js`'s shared `DESCRIPTION`/`COMMENTS` section headers — shared by both `ticketview.js` and the launch pad's inline detail pane, so both pick up the change from one source. (Per-field `metaLine` icons — state/assignee/estimate/epic/labels — are out of scope for this pass; see design.md's Non-Goals.)
  - The evidence reader's document title (`docview.js`'s `renderDocView`).
- No change to `lib/ui/format.js`'s `visibleLength`/`truncate`/`padTo`/`WIDE` tables — the glyph choices are deliberately constrained to already-1-column-safe characters so no width-budget code needs to change.

## Capabilities

### New Capabilities
- `dashboard-iconography`: the icon vocabulary module and the rule set governing where/how icons are applied — additive-only, narrow-glyph-only, never duplicating `STATUS_COLOUR`, never widening a row's budget.

### Modified Capabilities
- (none — `dashboard-visual-design`'s existing requirements around border/colour/width-budget are unchanged by this addition; this change only adds new rendered content within panels those requirements already govern)

## Impact

- New file: `lib/ui/icons.js`.
- Modified: `lib/ui/screens/drilldown.js`, `lib/ui/screens/fleet.js`, `lib/ui/screens/launchpad.js`, `lib/ui/ticketDetail.js`, `lib/ui/screens/docview.js`.
- No change to `lib/ui/format.js`, `lib/ui/layout.js`, or any wire/telemetry format — purely a rendering-layer addition.
- No new external dependencies.
