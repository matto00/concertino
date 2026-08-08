## ADDED Requirements

### Requirement: The launch pad's refresh-in-progress copy is provider-neutral
The launch pad SHALL NOT name a specific ticket provider in the message shown
while a refresh is in progress; the message SHALL be accurate regardless of
`ticketProvider.kind`.

#### Scenario: Refreshing under any provider
- **WHEN** the launch pad renders with `lp.refreshing` true, under any
  `ticketProvider.kind` (`linear`, `local`, or the deprecated `manual` alias)
- **THEN** the refresh-in-progress line does not mention "Linear" or any
  other specific provider name

### Requirement: A local ticket's status reads as a human label
`lib/ui/tickets/local.js`'s `parseTicket` SHALL set a parsed ticket's
`state.name` to a human-readable label derived from its `state.type`
(`backlog`→`Backlog`, `unstarted`→`Todo`, `started`→`In Progress`,
`completed`→`Done`, `canceled`→`Canceled`), matching the
`state.type`/`state.name` contract `lib/ui/linear.js` already documents
(`state.type` is what code branches on, `state.name` is what a human reads).
`state.type` itself SHALL remain the raw, unmapped value every existing
`state.type` consumer (`stateTypesFromConfig`, `inlineStatus`'s
`started`-override, `deriveEpics`'s open-state filtering) already relies on.

#### Scenario: A local ticket in the backlog state
- **WHEN** a local ticket file's frontmatter sets `state: backlog`
- **THEN** the parsed ticket's `state.type` is `"backlog"` and its
  `state.name` is `"Backlog"`

#### Scenario: A local ticket ready to start
- **WHEN** a local ticket file's frontmatter sets `state: unstarted`
- **THEN** the parsed ticket's `state.type` is `"unstarted"` and its
  `state.name` is `"Todo"`

#### Scenario: A local ticket in progress
- **WHEN** a local ticket file's frontmatter sets `state: started`
- **THEN** the parsed ticket's `state.type` is `"started"` and its
  `state.name` is `"In Progress"` (the launch pad's own `inlineStatus`
  additionally always renders `started` tickets as `In Progress`
  independent of `state.name`, unchanged by this requirement)

#### Scenario: A completed or canceled local ticket
- **WHEN** a local ticket file's frontmatter sets `state: completed` or
  `state: canceled`
- **THEN** the parsed ticket's `state.name` reads `"Done"` or `"Canceled"`
  respectively, while `state.type` remains the raw `completed`/`canceled`
  value
