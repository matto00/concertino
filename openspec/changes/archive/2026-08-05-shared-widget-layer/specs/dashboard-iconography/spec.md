## MODIFIED Requirements

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
