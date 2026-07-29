## ADDED Requirements

### Requirement: The drill-down header shows the ticket title
The drill-down screen (`lib/ui/screens/drilldown.js`) SHALL render the ticket's title in its
header, in addition to the ticket id and change name it already shows. When the ticket's title
cannot be resolved (see the ticket-text-resolution requirement below), the header SHALL render
the fallback text `ticket text unavailable`, styled the same way (`f.yellow`) as this screen's
other degradation strings (`no evidence recorded`, `no gate results recorded`), rather than an
empty or missing row.

#### Scenario: Ticket title renders in the header
- **WHEN** the drill-down renders a run whose ticket text has resolved to a title
- **THEN** the header includes that title, truncated to the terminal width if necessary

#### Scenario: Unresolvable ticket text renders the honest fallback in the header
- **WHEN** the drill-down renders a run whose ticket text could not be resolved from either
  source
- **THEN** the header shows `ticket text unavailable` in the same styling as the screen's other
  "nothing recorded" fallbacks, not an empty row

### Requirement: The drill-down shows the ticket description in a bounded TICKET panel
The drill-down screen SHALL render the ticket's description in a dedicated panel, drawn through
the same shared bordered-pane mechanism (`lib/ui/layout.js`) as its other panels, positioned
between the phase pipeline and the TIMELINE/GATES/EVIDENCE row. The panel's content SHALL be
rendered as plain text — markdown syntax (headings, list markers, emphasis, inline code, link
syntax) stripped rather than shown as raw markup — and SHALL pass through this screen's existing
final truncation pass, so control bytes are stripped the same way every other panel's content
already is.

#### Scenario: Description renders as plain text, not raw markup
- **WHEN** the resolved ticket description contains markdown syntax (e.g. `# heading`, `**bold**`,
  `` `code` ``, `[text](url)`)
- **THEN** the TICKET panel shows the underlying text with that syntax stripped, not the raw
  markup characters

#### Scenario: Missing ticket text degrades honestly
- **WHEN** the drill-down renders a run whose ticket text could not be resolved from either
  source
- **THEN** the TICKET panel shows `ticket text unavailable` (styled like this screen's other
  degradation strings) rather than an empty frame

### Requirement: A long description is bounded and truncated visibly, never displacing other panels
The TICKET panel's description body SHALL be capped at a fixed number of content rows,
independent of terminal height or the length of TIMELINE/GATES/EVIDENCE's own content. When the
wrapped description exceeds that cap, the panel SHALL show only the leading rows up to the cap,
followed by a dimmed `… N more lines` row (`N` being the count of rows not shown), rather than
either growing the panel to fit the full text or silently dropping the excess without
indication. The TIMELINE/GATES/EVIDENCE panels' widths and heights SHALL be computed exactly as
before this change, unaffected by the TICKET panel's own content length.

#### Scenario: A short description renders in full
- **WHEN** the resolved description, wrapped to the panel's width, is within the fixed row cap
- **THEN** every wrapped line renders, with no `… N more lines` row

#### Scenario: A long description is truncated with a visible count
- **WHEN** the resolved description, wrapped to the panel's width, exceeds the fixed row cap
- **THEN** only the leading rows up to the cap are shown, followed by a dimmed row reading
  `… N more lines` where `N` is the number of wrapped lines not shown

#### Scenario: A long description does not shrink or reposition the other panels
- **WHEN** the drill-down renders a run with a very long ticket description
- **THEN** the TIMELINE, GATES, and EVIDENCE panels render at the same width and height they
  would for a run with no ticket description at all

### Requirement: Ticket text is resolved from the persisted snapshot first, the launch pad cache second
Ticket text (title and description) for a run SHALL be resolved by first checking for a
persisted `ticket.md` at `.concertino/runs/<TICKET_ID>/evidence/ticket.md` in the main checkout,
and — only if that file is absent, unreadable, or its parsed title is blank once trimmed of
whitespace — falling back to the launch pad cache (`.concertino/cache/linear.json`), matched by
ticket identifier. If neither source yields text, resolution SHALL return an absent result
(rendered per the fallback requirements above), never a thrown error.

#### Scenario: The persisted ticket.md is preferred when present
- **WHEN** both a persisted `ticket.md` and a matching launch pad cache entry exist for a ticket
- **THEN** the drill-down shows the title and description from the persisted `ticket.md`

#### Scenario: The launch pad cache is used when no persisted copy exists
- **WHEN** no persisted `ticket.md` exists for a ticket but the launch pad cache has a matching
  entry
- **THEN** the drill-down shows the title and description from the cache entry

#### Scenario: Resolution degrades honestly when neither source has the ticket
- **WHEN** neither a persisted `ticket.md` nor a matching cache entry exists for a ticket
- **THEN** ticket text resolution returns an absent result, and the drill-down renders the
  `ticket text unavailable` fallback in both the header and the TICKET panel

### Requirement: Ticket text is resolved from the persisted copy, never the worktree, so it works after the worktree is destroyed
Resolving ticket text for the drill-down SHALL NOT read `ticket.md` from a run's worktree path at
any point — only from its persisted, main-checkout copy or the launch pad cache. This SHALL hold
regardless of whether the run's worktree currently exists.

#### Scenario: A finished run's ticket text still resolves after its worktree is removed
- **WHEN** a run has completed, its `ticket.md` was persisted during Planning, and its worktree
  has since been removed (as `cleanup.sh --phase4` does)
- **THEN** the drill-down still shows that run's ticket title and description, read from the
  persisted copy
