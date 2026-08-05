# dashboard-iconography Specification

## Purpose
Defines the shared, narrow-glyph icon vocabulary (`lib/ui/icons.js`) used to mark structural sections, panel titles, and labels across the dashboard, additive to their existing text and never duplicating what `STATUS_COLOUR` already signals.
## Requirements
### Requirement: A shared icon vocabulary module governs every structural icon glyph

`lib/ui/icons.js` SHALL be the single source of every icon glyph used across the six dashboard screens — no screen SHALL inline a new structural icon glyph literal independently. Each exported glyph SHALL be a bare string carrying no colour/SGR escape of its own. Every exported glyph SHALL occupy exactly one visible column as measured by `lib/ui/format.js`'s `visibleLength`, and SHALL NOT carry Unicode's `Emoji_Presentation=Yes` property. Every screen that composes a static icon+label section/pane header SHALL do so via `lib/ui/widgets/header.js`'s `sectionHeader` rather than inlining `icon + ' ' + label` independently — this now covers `docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`, `launchplan.js`, `fleet/sections.js`'s QUICK START/QUEUED/METRICS titles, `drilldown.js`'s four panel titles (TICKET/TIMELINE/GATES/EVIDENCE), `ticketDetail.js`'s DESCRIPTION/COMMENTS headers, and `controllers/drilldown.js`'s evidence-reader `docTitle` composition. This requirement governs the icon+label PAIR itself; a title that appends further dynamic content after that pair (e.g. a cycle number, a malformed-event count, a comment count) continues to compose that suffix by ordinary string concatenation onto `sectionHeader`'s result, unchanged. Mid-row content that prefixes an icon onto a per-row dynamic value rather than a static section-header label (e.g. `drilldown.js`'s PR-artifact row prefix, its per-run branch-name row) is governed by the "Icons are additive to existing labels" requirement below instead, not by this one.

#### Scenario: A screen imports a named icon rather than inlining a glyph
- **WHEN** `drilldown.js`, `fleet.js`, `launchpad.js`, `ticketDetail.js`, `docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`, or `launchplan.js` renders a structural icon
- **THEN** the glyph is read from a named export of `lib/ui/icons.js`, not a literal Unicode character embedded at the call site

#### Scenario: Every exported icon measures as one visible column
- **WHEN** any glyph exported by `lib/ui/icons.js` is passed to `f.visibleLength`
- **THEN** the result is `1`

#### Scenario: An icon-and-label composition goes through the shared header widget
- **WHEN** any screen renders a section/pane header carrying a static icon+label prefix — including `drilldown.js`'s panel titles, `ticketDetail.js`'s DESCRIPTION/COMMENTS headers, and `controllers/drilldown.js`'s `docTitle`
- **THEN** the icon+label text is produced by `header.js`'s `sectionHeader`, not an inline `icon + ' ' + label` string built at the call site

#### Scenario: A dynamic suffix after the icon+label pair is unaffected
- **WHEN** `drilldown.js` renders its TIMELINE title with a malformed-event-count suffix, its GATES title with a cycle-number suffix, or `ticketDetail.js` renders its COMMENTS header with a comment-count suffix
- **THEN** the base icon+label pair comes from `sectionHeader`, and the dynamic suffix is appended after it by ordinary string concatenation, exactly as before this requirement's `sectionHeader` migration

#### Scenario: A dynamic per-row icon prefix is not required to use the header widget
- **WHEN** `drilldown.js` renders its PR-artifact row prefix (`icons.pr`) or its per-run branch-name row (`icons.branch`)
- **THEN** these remain governed by the "Icons are additive to existing labels" requirement, not this one — they are not section/pane header titles

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

