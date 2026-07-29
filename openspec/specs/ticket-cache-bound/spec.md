# ticket-cache-bound Specification

## Purpose
Bounds the launch pad's Linear ticket fetch by ticket count (`MAX_TICKETS`) rather than by comment count, lets a project exclude backlog-state tickets from the fetch via `dashboard.launchPad.backlog`, and makes a capped fetch visible via a `truncated` flag instead of silently returning a partial list.
## Requirements
### Requirement: The launch pad fetch is bounded by ticket count
`lib/ui/linear.js#fetchTickets` SHALL stop accumulating tickets once the
running total reaches `MAX_TICKETS` (500), regardless of how many further
pages Linear reports as available, and SHALL return exactly `MAX_TICKETS`
tickets in that case rather than the current page's overshoot.

#### Scenario: A fetch under the cap is unaffected
- **GIVEN** a team with fewer than 500 open tickets
- **WHEN** `fetchTickets` runs
- **THEN** every open ticket is returned and `truncated` is `false`

#### Scenario: A fetch at the cap stops paging
- **GIVEN** a team with more than 500 open tickets
- **WHEN** `fetchTickets` runs
- **THEN** exactly 500 tickets are returned
- **AND** no further pages are requested past the one that reached the cap

### Requirement: A capped fetch is reported, not silently returned
`fetchTickets` SHALL return a `truncated` boolean that is `true` when the cap
was reached and either (a) Linear reported a further page still available on
the page that crossed the cap, or (b) that page's own nodes pushed the
accumulated count past `maxTickets`, so tickets were sliced off even though
no further page remained. `truncated` SHALL be `false` only when the
accumulated count reaches `maxTickets` exactly with nothing sliced off and no
further page available. `lib/ui/cache.js#write` and `#read` SHALL persist and
round-trip this flag; a cache file written before this flag existed SHALL
read `truncated` as `false`.

#### Scenario: Truncated fetch is flagged (more pages remained)
- **GIVEN** a team with more open tickets than `MAX_TICKETS`
- **AND** Linear reports a further page available once the cap is crossed
- **WHEN** `fetchTickets` runs
- **THEN** the result's `truncated` field is `true`

#### Scenario: Truncated fetch is flagged (cap-crossing page overshoots)
- **GIVEN** the page that crosses `MAX_TICKETS` contains more nodes than fit
  under the cap
- **AND** Linear reports no further page after that one
- **WHEN** `fetchTickets` runs
- **THEN** the result's `truncated` field is `true`
- **AND** exactly `MAX_TICKETS` tickets are returned, not the overshoot count

#### Scenario: Exactly-at-the-cap fetch with nothing left is not flagged
- **GIVEN** a team whose open ticket count exactly equals `MAX_TICKETS`
- **AND** Linear reports no further page after the last one
- **AND** the last page's nodes land exactly on the cap with no overshoot
- **WHEN** `fetchTickets` runs
- **THEN** the result's `truncated` field is `false`

#### Scenario: A pre-existing cache file without the flag reads as not truncated
- **GIVEN** a cache file on disk written before `truncated` existed
- **WHEN** `cache.read` loads it
- **THEN** `truncated` is `false`

### Requirement: A project can exclude backlog tickets from the fetch
`dashboard.launchPad.backlog` in `concertino.config.json` SHALL control
whether backlog-state tickets are included in the launch pad's fetch. When
absent or not exactly `false`, backlog tickets SHALL be included (today's
behaviour, unchanged). When exactly `false`, the fetch SHALL request only
`unstarted` and `started` tickets.

#### Scenario: Default preserves today's behaviour
- **GIVEN** `dashboard.launchPad.backlog` is absent from config
- **WHEN** the launch pad fetches tickets
- **THEN** backlog, unstarted, and started tickets are all requested

#### Scenario: Opting out excludes backlog tickets
- **GIVEN** `dashboard.launchPad.backlog` is `false`
- **WHEN** the launch pad fetches tickets
- **THEN** only unstarted and started tickets are requested

### Requirement: COMMENT_LIMIT is documented as insurance, not the size control
Both `lib/ui/linear.js`'s `COMMENT_LIMIT` comment and `docs/dashboard.md`'s "Comments are capped" section SHALL describe the constant as a bound against a single pathological comment thread rather than as what keeps the cache small, naming the ticket-count cap and backlog opt-out as the mechanisms that actually bound cache size.
`docs/dashboard.md` SHALL cite figures consistent with `ticket.md`'s
measurement (7 tickets / 15.5 KB for Concertino) rather than the stale
numbers it carries today.

#### Scenario: Code comment reflects measured reality
- **WHEN** `lib/ui/linear.js` is read
- **THEN** the comment above `COMMENT_LIMIT` does not claim comments drive
  cache size

#### Scenario: Docs reflect measured reality
- **WHEN** `docs/dashboard.md`'s launch-pad section is read
- **THEN** it does not claim comments are "the only unbounded axis in the
  payload" or otherwise imply comments drive cache size
- **AND** any ticket-count/size figures it cites match `ticket.md`'s
  measurement

