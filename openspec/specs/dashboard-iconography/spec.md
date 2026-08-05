# dashboard-iconography Specification

## Purpose
Defines the shared, narrow-glyph icon vocabulary (`lib/ui/icons.js`) used to mark structural sections, panel titles, and labels across the dashboard, additive to their existing text and never duplicating what `STATUS_COLOUR` already signals.
## Requirements
### Requirement: A shared icon vocabulary module governs every structural icon glyph

`lib/ui/icons.js` SHALL be the single source of every icon glyph used across the six dashboard screens — no screen SHALL inline a new structural icon glyph literal independently. Each exported glyph SHALL be a bare string carrying no colour/SGR escape of its own. Every exported glyph SHALL occupy exactly one visible column as measured by `lib/ui/format.js`'s `visibleLength`, and SHALL NOT carry Unicode's `Emoji_Presentation=Yes` property. `docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`, and `launchplan.js` — the six screens gaining icon-prefixed headers in this change — plus `fleet/sections.js`'s three migrated QUICK START/QUEUED/METRICS titles SHALL compose their icon+label headers via `lib/ui/widgets/header.js`'s `sectionHeader` rather than inlining `icon + ' ' + label` independently. This is a convention established for that consumer set, not yet a codebase-wide invariant: `drilldown.js`'s four panel titles (TICKET/TIMELINE/GATES/EVIDENCE), `ticketDetail.js`'s DESCRIPTION/COMMENTS headers, and `controllers/drilldown.js`'s evidence-reader `docTitle` composition remain pre-existing inline `icon + ' ' + label` call sites, deliberately out of this change's scope (design.md Decision 4) — migrating them is a natural fast-follow, not a defect in this change.

#### Scenario: A screen imports a named icon rather than inlining a glyph
- **WHEN** `drilldown.js`, `fleet.js`, `launchpad.js`, `ticketDetail.js`, `docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`, or `launchplan.js` renders a structural icon
- **THEN** the glyph is read from a named export of `lib/ui/icons.js`, not a literal Unicode character embedded at the call site

#### Scenario: Every exported icon measures as one visible column
- **WHEN** any glyph exported by `lib/ui/icons.js` is passed to `f.visibleLength`
- **THEN** the result is `1`

#### Scenario: An icon-and-label composition goes through the shared header widget, for this change's consumer set
- **WHEN** `docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`, `launchplan.js`, or `fleet/sections.js`'s QUICK START/QUEUED/METRICS titles render a section/pane header carrying an icon prefix
- **THEN** the icon+label text is produced by `header.js`'s `sectionHeader`, not an inline `icon + ' ' + label` string built at the call site
- **NOTE** this scenario does not (yet) cover `drilldown.js`'s panel titles, `ticketDetail.js`'s DESCRIPTION/COMMENTS headers, or `controllers/drilldown.js`'s `docTitle` — see the requirement text above

### Requirement: Icons are additive to existing labels, never a substitute for them

Every icon application SHALL prefix an existing, already-rendered label (`icon + ' ' + label`) rather than replacing any portion of that label's text. A rendered line that would have been legible without its icon SHALL remain equally legible with the icon removed or rendered as an unsupported glyph (e.g. a replacement/tofu character) — no icon SHALL be the sole conveyor of information a screen needs to be understood.

#### Scenario: The drill-down branch row keeps its text with an icon prefix
- **WHEN** the drill-down renders a run with a known `run.branch`
- **THEN** the rendered row contains both the branch icon and the full, unmodified branch name text

#### Scenario: A run with no branch still renders its existing fallback text, with the icon
- **WHEN** the drill-down renders a run with `run.branch` unset
- **THEN** the rendered row still contains the existing `(no branch yet)` dim fallback text, prefixed with the branch icon exactly as the populated case is

### Requirement: Icons never duplicate what STATUS_COLOUR already signals

No icon introduced by this capability SHALL be applied to the fleet view's NEEDS YOU, RUNNING, FAILED, or DONE section headings, nor to the drill-down's existing gate-status (`✓`/`✗`/`○`) or phase-pipeline (`✓`/`●`/`○`) markers — these already carry a non-colour distinction and are governed by `STATUS_COLOUR`, unchanged by this capability.

#### Scenario: A status-governed section heading carries no new icon
- **WHEN** the fleet view renders its NEEDS YOU, RUNNING, FAILED, or DONE section heading
- **THEN** the heading text is unchanged from its pre-this-change rendering (no new icon glyph prefixed)

### Requirement: Icon-prefixed titles stay within the existing width budget

A box title carrying a new icon prefix SHALL be truncated by the same `f.truncate` ellipsis convention `layout.js`'s `box()` already applies to every title, and the rendered top border's visible length SHALL still equal the requested width, exactly as for a title with no icon.

#### Scenario: An icon-prefixed title that overflows is truncated, not overflowed
- **WHEN** `layout.box()` is called with an icon-prefixed `title` wider than the border can accommodate
- **THEN** the rendered top border's visible length still equals the requested `width`, with the icon-prefixed title ellipsis-truncated the same way an overlong unprefixed title would be

