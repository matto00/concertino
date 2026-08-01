## Why

The launch pad's "0 open tickets" and "misconfigured `ticketProvider.teamKey`"
states render identically today: both are a successful GraphQL fetch that
returns an empty `issues` connection, because Linear answers a query against
an unknown team key with an empty result, not an error. A user staring at an
empty launch pad has no way to tell "your backlog is genuinely empty" from
"you're querying a team that doesn't exist" — which is exactly the trap that
caught the placeholder `teamKey: "ABC"` shipped in this project's own config
during development, and then caught a real user immediately afterwards.

`launchPadStatus()` already solves the identical shape of problem one layer
up — it reports which of three gate conditions failed rather than just
hiding the feature. This extends that same "tell the user why, not just
that" discipline past the gate and into the fetch itself.

## What Changes

- `lib/ui/linear.js`: before running the bulk ticket fetch, resolve the
  configured team key against Linear and distinguish "team exists, zero open
  tickets" from "no team with this key". Linear's API can answer this
  directly — a team lookup by key returns nothing for a key that matches no
  team, independent of how many tickets that team has open.
- `lib/ui/watch.js` (`refreshLaunchPad`): surface which of the two zero-result
  cases occurred, without changing the cold-cache ("press r to fetch") path,
  which is unaffected — it never reaches the network at all.
- `lib/ui/screens/launchpad.js`: render `no open tickets in CON` when the team
  is real but empty, and `no team with key "ABC" — check
  ticketProvider.teamKey` when the key itself doesn't resolve. Both replace
  today's silent `0 open` header with no explanation.
- `bin/concertino` (`cmdValidate`): warn when `dashboard.launchPad.enabled` is
  `true` and `ticketProvider.teamKey` is absent, since `teamKeyFromConfig`'s
  fallback (deriving from `ticketProvider.idExample`) is a last-resort guess
  against a value documented as a sample id, not a real team key — the same
  trap this whole change exists to catch, caught one step earlier, at
  config-check time instead of at first launch-pad use.

## Capabilities

### New Capabilities

- `launchpad-team-resolution`: resolving `ticketProvider.teamKey` against
  Linear before/alongside the bulk ticket fetch, distinguishing "team exists,
  zero open tickets" from "no team with this key" — and the config-time
  warning (`concertino validate`) that catches the same misconfiguration
  before the launch pad is ever opened. No existing spec covers this fetch
  path (`launchpad-detail-pane` covers only the inline detail pane, a
  different part of the screen), so this is new ground rather than a
  modification.

### Modified Capabilities

(none)

## Impact

- `lib/ui/linear.js`: new team-lookup query/helper, called before (or
  alongside) `fetchTickets`; `fetchTickets` behavior for a *found* team is
  unchanged.
- `lib/ui/watch.js`: `refreshLaunchPad` now branches on the lookup result
  when the fetch returns zero tickets.
- `lib/ui/screens/launchpad.js`: header/empty-state rendering gains a new
  "team not found" message distinct from "no open tickets".
- `bin/concertino`: `cmdValidate`'s `ticketProvider` section gains one new
  warning; no error-level check changes.
- No change to the cold-cache path, the feature gate (`launchPadStatus`), or
  any other screen.
