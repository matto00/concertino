## Why

Measurement against real data (see `ticket.md`) shows the launch pad's ticket
cache is bounded by the wrong thing: `COMMENT_LIMIT = 50` was meant to keep
the cache small, but comments are 0.6% of a real 740 KB fetch while
descriptions are 79% and ticket count is unbounded. A 1,000-ticket backlog
would produce roughly 2.8 MB, re-fetched and re-parsed on every refresh, with
no way to shrink it and no visibility when a fetch is capped.

## What Changes

- Add `MAX_TICKETS` (500) to `lib/ui/linear.js` as the real bound on a fetch,
  replacing ticket count's previous unbounded-except-`MAX_PAGES`(10,000)
  ceiling. Justified against the measured 267-ticket/740 KB Helio fetch (see
  design.md).
- Add a `dashboard.launchPad.backlog` config flag (default `true`, preserving
  today's behaviour). When `false`, the fetch excludes `backlog`-state
  tickets, targeting the actual driver of Helio's oversized fetch (266 of 267
  open tickets were backlog).
- `fetchTickets` reports whether the cap cut the fetch short (`truncated`),
  the cache persists it, and the launch pad's header line shows it — a
  visible "truncated" marker rather than a silently short list.
- Correct `COMMENT_LIMIT`'s comment, which currently claims to be what keeps
  the cache small; it is now documented as cheap insurance against a single
  pathological thread, nothing more.
- Tests cover the new bound, the backlog opt-out, and the truncation flag
  with fixtures — no test touches the network.

## Capabilities

### New Capabilities
- `ticket-cache-bound`: the ticket-count cap on a launch-pad fetch, the
  `dashboard.launchPad.backlog` opt-out that lets a project exclude backlog
  tickets from the fetch, and the truncation signal that lets the launch pad
  say when a fetch was cut short rather than silently returning a partial
  list.

### Modified Capabilities
- (none — `launchpad-detail-pane` renders the ticket viewer itself and is
  unaffected; this change only bounds and labels what feeds it)

## Impact

- `lib/ui/linear.js`: `MAX_TICKETS` constant, `stateTypesFromConfig()`,
  `fetchTickets()` cap/truncation logic, corrected `COMMENT_LIMIT` comment.
- `lib/ui/cache.js`: persist/round-trip the `truncated` flag.
- `lib/ui/watch.js`: `refreshLaunchPad()` passes the config-derived state
  types into `fetchTickets`.
- `lib/ui/screens/launchpad.js`: header line shows the truncation marker.
- `config/concertino.schema.json`: new `dashboard.launchPad.backlog` boolean.
- `docs/dashboard.md`: document the new bound, opt-out, and truncation
  marker, and rewrite the existing "Comments are capped" section (it
  currently claims comments are "the only unbounded axis in the payload" —
  the same overclaim this change corrects in code — and cites a stale
  ticket-count/size figure).
- `test/linear.test.js`, `test/cache.test.js`: new fixture-based coverage.
