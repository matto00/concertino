## Purpose

Gives a Claude Code session that drives concertino runs a read-only Fleet pane: every run's lane, its agent's liveness and its escalations, without the tmux-based watch TUI.

## ADDED Requirements

### Requirement: Lanes correlated from the session's orchestrator Agent calls
The mod SHALL build one lane per run in `concertino fleet --json` and correlate each with the session's own `Agent` tool uses whose `subagent_type` is `concertino-orchestrator` and whose prompt carries `TICKET_ID` (`=` or `:`, optionally backtick-quoted), comparing tickets case-insensitively and letting the newest call win. Liveness SHALL be `running`, `external`, `stalled` or `ended`.

#### Scenario: Real prompt shapes
- **WHEN** an orchestrator prompt reads `TICKET_ID=HEL-1027. …`, ``TICKET_ID=`HEL-1027`. …`` or `TICKET_ID: HEL-1027 …`
- **THEN** the lane for `HEL-1027` is linked to that call's agentId

#### Scenario: Helper agents are ignored
- **WHEN** an `Explore` Agent call mentions `TICKET_ID=CON-1`
- **THEN** it is not correlated with any lane

### Requirement: Inspect-only pane with list and detail
The mod SHALL draw a Fleet pane listing each lane (ticket, display status, phase, cycle, gates, elapsed, agent) and a detail view (escalation, ticket excerpt, timeline, PR) for the selected lane, following the transcript's `view.agentId` when it matches a lane. A run whose status is `unknown` with a running agent SHALL display as `running`.

#### Scenario: Detail follows the viewed transcript
- **WHEN** the pane's `view.agentId` is a lane's agentId
- **THEN** the detail shows that lane regardless of the selection

### Requirement: Status line and escalation toast
The mod SHALL set a status line `fleet: <r> running[ · <i> idle][ · <n> needs you][ · <f> failed]` and toast each escalation once, keyed by `escalationId` or, when absent, by ticket and `raisedAt`.

#### Scenario: Toast once
- **WHEN** the same open escalation appears in consecutive polls
- **THEN** exactly one toast is shown

### Requirement: Read-only, opens once runs exist, polls with backoff
The mod SHALL NOT write files, call tools or register gating hooks. It SHALL open the pane unasked the first time a snapshot has at least one run (and `/fleet` SHALL open it any time), and SHALL poll every 2 s while runs exist and every 15 s when there are none or the CLI fails.

#### Scenario: Idle session
- **WHEN** a snapshot has no runs
- **THEN** no pane is opened and the next poll is 15 s later

### Requirement: Detail shows Linear metadata, description and comments
The mod SHALL pass the previous poll's shown lanes (plus, with `/fleet all` on, the detail lane) to `concertino fleet --json --tickets=…` on each poll, and the detail view SHALL render a metadata line (with ` · fetched N ago` when older than 60 s), a DESCRIPTION section (at most 12 wrapped rows, `(no description)` when empty, markdown links and heading marks stripped, falling back to the ticket excerpt) and a COMMENTS section (the newest 5 comments by `createdAt`, oldest first, at most 6 rows each, then `N more — <url>`). Toasts SHALL be raised only for shown lanes.

#### Scenario: Metadata line
- **WHEN** the selected lane has `ticket_meta`
- **THEN** the detail shows its state, assignee, priority, estimate and labels on one line

#### Scenario: Excerpt fallback
- **WHEN** `ticket_meta` is null or `ticket_meta_error` is set
- **THEN** DESCRIPTION shows the ticket excerpt and any error is shown dim

#### Scenario: Newest five comments with N more
- **WHEN** the ticket has more than five comments, in any order
- **THEN** the newest five by `createdAt` are shown oldest first, at most six rows each, followed by a wrapping `N more — <url>` line (`N+` when the list is truncated)

#### Scenario: Row caps
- **WHEN** a description is one 300-character line at 40 columns
- **THEN** DESCRIPTION shows exactly 12 rows, none longer than 40

#### Scenario: Empty description
- **WHEN** `ticket_meta` exists with an empty description
- **THEN** DESCRIPTION shows `(no description)`

#### Scenario: Stale marker
- **WHEN** `ticket_meta.fetchedAt` is more than 60 s old
- **THEN** the metadata line ends with `fetched <age> ago`

#### Scenario: Revealed lane detail
- **WHEN** `/fleet all` is on and the detail lane is hidden from the default list
- **THEN** its ticket is still requested from the CLI
