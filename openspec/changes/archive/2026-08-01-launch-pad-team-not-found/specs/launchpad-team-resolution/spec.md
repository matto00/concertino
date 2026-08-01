## ADDED Requirements

### Requirement: A zero-ticket fetch distinguishes an empty team from an unresolved team key
The system SHALL resolve the configured team key against Linear, when a
launch pad refresh's ticket fetch returns zero tickets, to determine whether
the team exists (and legitimately has no open tickets) or whether no team
matches that key, rather than treating both cases identically.

#### Scenario: Real team with no open tickets
- **WHEN** a launch pad refresh fetches issues for a team key that Linear
  confirms exists, and the fetch returns zero tickets
- **THEN** the launch pad reports an empty backlog for that team, not an
  error

#### Scenario: Team key matches no team
- **WHEN** a launch pad refresh fetches issues for a team key that Linear
  confirms does not match any team, and the fetch returns zero tickets
- **THEN** the launch pad reports that the team key does not resolve,
  distinct from an empty-backlog report

#### Scenario: Non-empty fetch never triggers a team lookup
- **WHEN** a launch pad refresh's ticket fetch returns one or more tickets
- **THEN** the system does not need to perform a team-resolution lookup,
  since a non-empty result already proves the team exists

### Requirement: The launch pad screen states which zero-ticket case occurred
The launch pad's rendered header/status SHALL say which of the two
zero-ticket cases applies, using the team key so the message is actionable.

#### Scenario: Empty but real team
- **WHEN** the launch pad has fetched zero tickets for a team Linear confirms
  exists (team key `CON`)
- **THEN** the rendered screen shows a message equivalent to
  `no open tickets in CON`, without being styled or worded as an error

#### Scenario: Unresolved team key
- **WHEN** the launch pad has fetched zero tickets because the configured
  team key (e.g. `ABC`) matches no team
- **THEN** the rendered screen shows a message equivalent to
  `no team with key "ABC" — check ticketProvider.teamKey`, styled as an error
  exactly like any other refresh failure

### Requirement: Cold cache still prompts a fetch without contacting Linear
A launch pad opened with no cache yet (cold cache) SHALL continue to render
its existing "press r to fetch" prompt and SHALL NOT perform any team
resolution or ticket fetch until the user explicitly requests a refresh.

#### Scenario: Cold cache on first open
- **WHEN** the launch pad is opened and no ticket cache exists on disk yet
- **THEN** the screen renders "no tickets cached yet — press r to fetch" and
  no network request (ticket fetch or team-resolution lookup) is made

### Requirement: `concertino validate` warns when a launch-pad-enabled project has no explicit team key
When `dashboard.launchPad.enabled` is `true`, `concertino validate` SHALL
warn if `ticketProvider.teamKey` is absent, since the derived fallback
(inferred from `ticketProvider.idExample`) is a last-resort guess against a
value documented as a sample id, not a configured team key.

#### Scenario: Launch pad enabled, teamKey absent
- **WHEN** `concertino validate` runs against a config with
  `dashboard.launchPad.enabled: true` and no `ticketProvider.teamKey`
- **THEN** validate reports a warning naming `ticketProvider.teamKey` as
  unset, and does not fail validation (warning severity, not error)

#### Scenario: Launch pad enabled, teamKey present
- **WHEN** `concertino validate` runs against a config with
  `dashboard.launchPad.enabled: true` and a non-empty `ticketProvider.teamKey`
- **THEN** validate does not emit this warning

#### Scenario: Launch pad disabled
- **WHEN** `concertino validate` runs against a config with
  `dashboard.launchPad.enabled` not `true` (absent or `false`) and no
  `ticketProvider.teamKey`
- **THEN** validate does not emit this warning, since the launch pad's fetch
  path is unreachable
