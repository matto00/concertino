## Context

`lib/ui/linear.js#fetchTickets` pages through Linear's issues connection with
no ceiling on how many tickets it accumulates other than `MAX_PAGES = 200`
(at `PAGE_SIZE = 50`, a 10,000-ticket hard stop that exists only to keep a
broken API from spinning forever — not a real bound). `lib/ui/cache.js`
persists the result verbatim to `.concertino/cache/linear.json`, read wholesale
on every launch-pad open. `COMMENT_LIMIT = 50` per ticket was the only
size-motivated knob, and measurement (ticket.md) shows it does nothing: real
comment threads never come close to it, while ticket count and description
size dominate.

## Goals / Non-Goals

**Goals:**
- Bound the fetch by ticket count, sized against the measured data rather
  than a round number.
- Let a project with a large backlog exclude it from the fetch, since 266 of
  Helio's 267 open tickets were `backlog` — this is the actual lever on size
  for a real team, bigger than any per-fetch cap.
- Make a capped fetch visible in the UI rather than a silently short list.
- Stop `COMMENT_LIMIT`'s comment from claiming credit it doesn't deserve.

**Non-Goals:**
- Truncating or otherwise degrading ticket descriptions — the ticket
  explicitly rules this out; the description is the point of the cache.
- Making the ticket-count cap itself configurable. `COMMENT_LIMIT` is a plain
  constant with a justifying comment, not a config knob, and the proposal
  follows that precedent — `dashboard.launchPad.backlog` is the one dial a
  project actually needs, because it changes which tickets exist to be
  counted, not how many of them fit.
- An exact "showing 200 of 1,043" total. See Decision 3.
- Solving CON-4 (event log retention)'s unbounded-growth problem with the
  same mechanism — that data is append-only history worth keeping; this
  cache is a disposable mirror that can always be refetched from Linear.

## Decisions

### Decision 1: `MAX_TICKETS = 500`, justified against the measured data

The measured Helio Platform fetch (267 tickets, 740.1 KB) averages ~2.8 KB
per ticket, with descriptions (79%) and everything else (21%, comments 0.6%
of that) making up the total. 500 is chosen as:

- Roughly double the largest team actually measured (267), so the cap does
  not engage for any team observed so far — it exists for teams that grow
  past what's been seen, not to shrink today's usage.
- At ~2.8 KB/ticket, 500 tickets caps the worst case around 1.4 MB — well
  under half of the ~2.8 MB the ticket's own "1,000 tickets, extrapolated"
  example calls out as the unbounded-growth pain case.
- Combined with Decision 2 (the backlog opt-out), a team the size of Helio
  Platform that opts out of backlog tickets fetches roughly the 1 non-backlog
  open ticket seen in the measurement — nowhere near the cap. The cap is a
  backstop for the tickets `backlog: false` doesn't filter, not the primary
  size control.

Alternative considered: bound by a byte size (e.g. cap the cache at some KB
threshold) rather than ticket count. Rejected because it requires estimating
serialized size mid-fetch (awkward against a paginated GraphQL response) and
because ticket count is what the acceptance criteria name as "the candidate."

### Decision 2: `dashboard.launchPad.backlog` (default `true`)

A boolean under `dashboard.launchPad`, read by a new
`linear.stateTypesFromConfig(config)` that returns `OPEN_STATE_TYPES` unchanged
when `backlog !== false`, and `OPEN_STATE_TYPES` minus `'backlog'` when it is
exactly `false`. Default `true` preserves today's behaviour for every existing
project with no config change required — matching the acceptance criterion.

`fetchTickets` already accepts a `stateTypes` override (used by tests); this
change makes `lib/ui/watch.js#refreshLaunchPad` the one caller that derives it
from config, rather than adding a second parallel path.

### Decision 3: `truncated`, not an exact total

`fetchTickets` now tracks whether it stopped because `MAX_TICKETS` was hit
while there were more tickets than the cap kept. `truncated` is `true` when
**either** of two things happened on the page that crossed the cap: Linear's
`pageInfo.hasNextPage` was `true` (more pages remain), **or** that page's own
nodes pushed the accumulated count past `maxTickets` before slicing (Decision
5's overshoot case — real tickets were discarded even though Linear reported
no further page). It is `false` only when the accumulated count reaches
`maxTickets` exactly, with nothing sliced off and nothing left to fetch. This
travels through `cache.write`/`cache.read` unchanged and the launch pad's
header line renders it as a `(truncated — more available)` marker next to the
ticket count.

With the shipped constants (`MAX_TICKETS = 500`, `PAGE_SIZE = 50`, an exact
multiple), the overshoot case cannot occur — every page boundary lands exactly
on a multiple of 50. It is specified now anyway because design.md's own Risks
section anticipates either constant being revisited independently later,
without a matching revisit to the `truncated` rule. Defining `truncated` from
`hasNextPage` alone would silently under-report truncation the day
`PAGE_SIZE` and `MAX_TICKETS` stop being exact multiples — the same
silent-short-list failure mode the ticket exists to eliminate, just moved one
layer down.

This deliberately does not attempt an exact "of 1,043" total. Linear's issues
connection does not expose a cheap total count — getting one would mean either
walking every remaining page (defeating the point of the cap) or a second,
separate aggregate query with its own cost and staleness. A boolean
truncation flag with the count actually held satisfies the acceptance
criterion's real requirement — "a silently short list is worse than a visible
[...] "— without inventing a number the API doesn't cheaply provide. If Linear
later exposes a total-count field, upgrading the marker to an exact "N of M"
is a follow-up, not blocked by this change's data model (`truncated` and
`tickets.length` both remain meaningful).

### Decision 4: no cache schema version bump

`cache.js`'s `CACHE_SCHEMA_VERSION` exists so a stale cache is never
misread as if a field it lacks were real data with a healthy-looking default
(see CON-35 / Decision 1 there: an old cache's ticket rendering as
priority-0/None would be indistinguishable from a real "None"). `truncated`
does not have that failure mode: a cache written before this change was, in
fact, not truncated by `MAX_TICKETS` (the concept didn't exist yet), so
defaulting a missing `truncated` to `false` on read is simply true, not a
masked absence. No version bump needed; `read()` defaults `truncated` to
`false` exactly the way it already defaults `epics` to `[]`.

### Decision 5: `MAX_TICKETS` enforced as a hard slice, not "at least N"

When a page pushes the accumulated count to or past `MAX_TICKETS`,
`fetchTickets` stops paging and slices the array down to exactly
`MAX_TICKETS` (rather than keeping the last page's overshoot). This keeps the
bound a real ceiling on cache size regardless of `PAGE_SIZE`, rather than "N
plus up to one page."

## Risks / Trade-offs

- [Risk] A project with a genuinely large non-backlog open count (>500) still
  gets truncated even after opting out of backlog. → Mitigation: the
  truncation marker makes this visible rather than silent; `MAX_TICKETS` is a
  plain constant so a follow-up ticket can revisit the number if this proves
  common, same precedent as `COMMENT_LIMIT`.
- [Risk] No exact total in the truncation marker is a smaller UX win than the
  ticket's illustrative "of 1,043" phrasing might suggest. → Mitigation:
  Decision 3 explains why; the boolean-plus-count satisfies the acceptance
  criterion's actual test ("can the launch pad say so") without a fabricated
  number.

## Open Questions

None — the acceptance criteria and measured data fully determine the above
decisions.
