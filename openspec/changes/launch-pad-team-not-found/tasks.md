## 1. Team resolution in `lib/ui/linear.js`

- [x] 1.1 Add a `resolveTeam(transport, apiKey, teamKey)` helper that queries
      Linear's `teams` connection filtered by key and returns `{ found:
      boolean }` (true when the filtered connection has at least one node).
- [x] 1.2 Export `resolveTeam` from `lib/ui/linear.js`'s `module.exports`.
- [x] 1.3 Unit tests: `resolveTeam` returns `found: true` for a canned
      response with a matching team node, `found: false` for an empty
      `nodes` array, and propagates transport/HTTP errors the same way
      `post()` already does (reuse the existing canned-transport test
      pattern in `test/linear.test.js`).

## 2. Wire resolution into the refresh path

- [x] 2.1 In `lib/ui/watch.js`'s `refreshLaunchPad`, after `fetchTickets`
      resolves with zero tickets, call `resolveTeam` with the same
      `team.key` used for the fetch.
- [x] 2.2 When `resolveTeam` reports `found: false`, set `lp.error` to
      `no team with key "<KEY>" — check ticketProvider.teamKey` (mirroring
      the existing `lp.error` assignment style in the same function) instead
      of leaving it `null`.
- [x] 2.3 When `resolveTeam` reports `found: true` (or the fetch returned
      one or more tickets, in which case `resolveTeam` is never called — see
      task 2.1's "after... zero tickets" guard), leave `lp.error` `null`
      exactly as today.
- [x] 2.4 Confirm the cold-cache path (`cache.isCold(lp.cache) &&
      !lp.refreshing`) never calls `refreshLaunchPad` implicitly — it
      already only fires on an explicit `r` keypress, so no code change
      should be needed here; add/confirm a test asserting no network call
      happens on cold-cache render.

## 3. Screen rendering in `lib/ui/screens/launchpad.js`

- [x] 3.1 In `headerLine`, when the ticket total is `0` and `lp.error` is
      not the team-not-found error, render `no open tickets in <TEAM>`
      (team key read from `lp.cache.teamKey`) in place of `0 open`, keeping
      the existing dim styling and the rest of the header line (staleness,
      `r refresh`) unchanged.
- [x] 3.2 Confirm the existing `lp.error` rendering path (the `f.red(...)`
      line already in `renderLaunchPad`) needs no change to display the new
      team-not-found message — it is just a string through the same channel.
- [x] 3.3 Confirm the `0 selected` / empty-tickets-pane messaging
      (`(no open tickets in this epic)`) is unaffected — that string covers
      a different case (an epic with no tickets, team otherwise populated)
      and must not be conflated with the team-wide empty/not-found states.

## 4. `concertino validate` warning

- [x] 4.1 In `bin/concertino`'s `cmdValidate`, in or near the existing
      `ticketProvider` checks, add a warning when
      `cfg.dashboard?.launchPad?.enabled === true` and
      `!cfg.ticketProvider?.teamKey` (falsy/absent), naming
      `ticketProvider.teamKey` and explaining the derived-fallback risk.
- [x] 4.2 Confirm the warning does not fire when `dashboard.launchPad.enabled`
      is absent/false, or when `ticketProvider.teamKey` is present.
- [x] 4.3 Add/extend a `concertino validate` test (or existing CLI test
      fixture) covering both the warn and no-warn cases.

## 5. Verification

- [x] 5.1 Run the full test suite and existing gates; add new tests above to
      `test/linear.test.js`, `test/watch.test.js` (or the closest existing
      equivalent), and the validate command's own test coverage.
- [x] 5.2 Manually sanity-check (or write a targeted test for) the three
      scenarios end to end: cold cache -> `press r to fetch`; real team,
      zero tickets -> `no open tickets in CON`; bad team key -> `no team
      with key "ABC" — check ticketProvider.teamKey`.
- [x] 5.3 Update `openspec/changes/launch-pad-team-not-found/files-modified.md`
      per this project's usual executor handoff convention, if one exists.
