## Context

`lib/ui/linear.js`'s `fetchTickets` queries `issues(filter: { team: { key: {
eq: $teamKey } }, ... })`. Linear's `issues` connection filters silently:
querying for a `team.key` that matches no team returns `{ nodes: [], pageInfo:
{ hasNextPage: false } }` — the identical shape a real team with zero open
issues would return. `refreshLaunchPad` in `lib/ui/watch.js` writes whatever
`fetchTickets` returns straight to the cache; `renderLaunchPad` in
`lib/ui/screens/launchpad.js` then shows `0 open` with no further comment
either way.

`teamKeyFromConfig` already documents the risk: its third fallback (deriving
a key from `ticketProvider.idExample`) is called out in its own comment as a
last-resort guess against a value that's documented as a sample id, not a
real team key. That fallback is exactly how the shipped `ABC` placeholder
produced a silently-empty launch pad during this project's own development.

`launchPadStatus` already solved an adjacent problem (gate-not-passed) by
returning `{ enabled, reason, message }` instead of a boolean, so the caller
always has a specific, renderable reason. This change extends the same
pattern one layer deeper, into the fetch itself.

## Goals / Non-Goals

**Goals:**
- Distinguish, after a fetch returns zero tickets, "this team exists and has
  no open tickets" from "no team matches this key" — and say so on screen.
- Warn at `concertino validate` time when `dashboard.launchPad.enabled` is
  `true` but `ticketProvider.teamKey` is absent, since that combination is
  exactly the shape of the bug this change fixes.
- Leave the cold-cache (`press r to fetch`) path, the feature gate
  (`launchPadStatus`), and a successful non-empty fetch entirely unchanged.

**Non-Goals:**
- `concertino init` prompting for `teamKey` during interactive setup (the
  ticket's own "Notes" section flags this as a *follow-up*, not part of this
  change's acceptance criteria).
- Any change to `teamKeyFromConfig`'s three-way fallback order (env → config
  → `idExample`-derived) — this change only makes the *result* of using a bad
  key visible, not the resolution order itself.
- Changing what counts as "open" (`OPEN_STATE_TYPES`) or any other filter.

## Decisions

### Decision 1: Resolve the team before fetching issues, via a separate lookup

Linear's schema exposes team lookup by key through the `teams` connection's
own filter (`teams(filter: { key: { eq: $teamKey } })`), independent of the
`issues` query. Add a small `resolveTeam(transport, apiKey, teamKey)` helper
in `lib/ui/linear.js` that runs this lookup and returns `{ found: boolean }`
(true when `teams.nodes` is non-empty for that key).

Alternatives considered:
- **Infer from the `issues` result alone** (e.g. treat zero nodes across
  every state type, including closed, as "team missing"): rejected — a real
  team can legitimately have zero issues in *any* state (a brand new team),
  which would misreport a genuinely-empty-but-real team as missing. The
  ticket's own acceptance criteria explicitly calls for looking the team up,
  not inferring from ticket counts.
- **Fold the lookup into the existing `issues` query as a second aliased
  field in one request**: rejected for this change — it would touch `QUERY`
  and its variable contract, and the two calls (team lookup, then issues
  fetch) are only made once per refresh, not once per ticket, so the extra
  round trip's cost is negligible next to the fetch itself. A future change
  is free to combine them; this one keeps the diff to an additive helper.

### Decision 2: Only look up the team when the ticket fetch itself returns zero results

`resolveTeam` is only called from `refreshLaunchPad` *after* `fetchTickets`
comes back with `tickets.length === 0` — not on every refresh. A non-empty
fetch already proves the team exists (Linear cannot return issues for a team
it has no record of), so the extra request would be pure overhead on the
common case (a real team with open tickets).

Alternatives considered:
- **Always resolve the team first, before fetching issues**: rejected —
  doubles the network round-trips on every refresh for no benefit in the
  overwhelmingly common case where the team is fine and has open tickets.

### Decision 3: Carry the distinction as a new `lp.error`-shaped field, not a new top-level `lp` field

`refreshLaunchPad` already has exactly one channel for "something about this
refresh needs explaining to the user": `lp.error` (a string,
`renderLaunchPad`'s existing `f.red(...)` line). Zero-tickets-because-empty
is not an error and must not populate `lp.error` (that would turn a correct
empty backlog red); zero-tickets-because-team-missing is an error in the
same sense a rejected API key is. So:
- Team resolves, zero tickets: `lp.error` stays `null`; the *header* line
  changes to say `no open tickets in <TEAM>` instead of bare `0 open`.
- Team does not resolve: `lp.error` is set to
  `no team with key "<KEY>" — check ticketProvider.teamKey`, exactly like
  every other `refreshLaunchPad` failure already surfaces through `lp.error`.

Alternatives considered:
- **New `lp.teamStatus` field threaded through to the renderer**: rejected —
  `lp.error` already exists precisely for "tell the user why this refresh
  isn't what they expected," and the message text itself (not a new enum) is
  sufficient for the renderer to display; a parallel channel would duplicate
  what `lp.error` already does for every other refresh failure (network
  error, bad key, GraphQL error).

### Decision 4: The "no open tickets in CON" message is a header change, not an error

Per Decision 3, an empty-but-real team is success, not failure — the
acceptance criteria's `no open tickets in CON` wording is deliberately
unadorned (no warning color, no `error:` framing). `headerLine` in
`launchpad.js` already computes `total` and renders `<n> open`; when `total
=== 0` and the team is confirmed real, it renders `no open tickets in
<TEAM>` in place of `0 open`, using the same dim styling the rest of the
header line already has. The team name comes from `lp.cache.teamKey`
(`normalise()` already stores this — see `linear.js`), not from re-deriving
it, so the header never disagrees with what was actually queried.

## Risks / Trade-offs

- **[Risk]** A team that is real but was renamed/re-keyed between one fetch
  and the next could theoretically flip between "empty" and "not found"
  messaging across refreshes. **Mitigation**: this matches Linear's own
  source of truth at the moment of each refresh — there is no staler state to
  reconcile against, and the cache is always overwritten wholesale on a
  successful fetch, never merged.
- **[Risk]** The extra `resolveTeam` round-trip adds latency specifically to
  the already-slow "your team key is wrong" path. **Mitigation**: acceptable
  — this path is already an error state the user needs to see explained; a
  few hundred extra milliseconds is immaterial next to the confusion it
  replaces, and Decision 2 already keeps it off the common (non-empty)
  fetch path entirely.
- **[Risk]** `concertino validate`'s new warning could false-positive for a
  project intentionally relying on the `idExample`-derived fallback.
  **Mitigation**: `teamKeyFromConfig`'s own comment already treats that
  fallback as a last resort, not a supported configuration — the warning is
  accurate to that documented intent, and it is a warning (does not fail
  validate), matching the severity of every other soft-misconfiguration
  check in that section (e.g. missing `specProvider` command fields).

## Migration Plan

No data migration — `lib/ui/cache.js`'s on-disk shape is unchanged (the team
name already round-trips via `normalise()`'s existing `teamKey` field). No
`CACHE_SCHEMA_VERSION` bump is required. Purely additive behavior on top of
existing fetch/render code paths; ships as a normal PR.
