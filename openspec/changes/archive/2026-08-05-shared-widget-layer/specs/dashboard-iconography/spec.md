## MODIFIED Requirements

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
