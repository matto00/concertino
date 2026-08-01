# Files modified — CON-20 / launch-pad-team-not-found

- `lib/ui/cache.js` (cycle 3, skeptic-final-1.md Change Request 1) — new
  `CACHE_SCHEMA_VERSION` bump (2 -> 3) for a new `teamFound: boolean | null`
  field alongside `teamKey`, both in `read()` and `write()`. `false` is
  handled the same way `priority: 0` already is elsewhere in this codebase —
  round-tripped explicitly (`typeof ... === 'boolean'`), never collapsed to
  `null`/absent via a truthiness check. The version bump means a cache row
  from before this field existed reads as `empty()` (cold), exactly like
  every prior schema bump — it never reaches a per-field default at all, so
  there is no separate migration path to get wrong.
- `lib/ui/linear.js` — added `TEAM_QUERY` (a `teams(filter: { key: { eq:
  $teamKey } })` lookup, independent of the bulk `issues` fetch) and
  `resolveTeam(transport, apiKey, teamKey)`, which returns `{ found:
  boolean }`. Refactored `post()`'s request/error handling into a shared
  `postRaw(transport, apiKey, query, variables)` so `resolveTeam` gets
  identical error reporting (rejected key, HTTP status, non-JSON body,
  GraphQL `errors` array) to `fetchTickets` without duplicating it. Exported
  `resolveTeam`/`TEAM_QUERY`.
- `lib/ui/watch.js` — `refreshLaunchPad` now calls `resolveTeam` (with the
  same team key `fetchTickets` used) only when the fetch itself returned zero
  tickets, and sets `lp.error` to `no team with key "<KEY>" — check
  ticketProvider.teamKey` when the team doesn't resolve. A non-empty fetch
  never triggers the extra lookup. Cycle 2 (non-blocking suggestion,
  evaluation-1.md): `apiKey` is now resolved once and passed explicitly to
  both `fetchTickets` and `resolveTeam`, rather than `resolveTeam` reading
  `process.env.LINEAR_API_KEY` a second time — the two requests can no longer
  disagree about which key authenticated the pair. Cycle 3 (skeptic-final-1.md
  Change Request 1) — the team-not-found distinction used to live ONLY in
  the in-memory `lp.error`, which does not survive a process restart:
  `refreshLaunchPad` now writes `teamFound` (true/false, matching whether
  `resolveTeam` ran and what it found — or `true` outright when a non-empty
  fetch already proved it) onto the cache row itself, and `openLaunchPad`
  derives the initial `lp.error` from `lp.cache.teamFound === false` instead
  of hardcoding `null`, so a stale team-not-found cache still shows the
  error on the very first render of a brand-new process, before any `r`
  keypress. A shared `teamNotFoundMessage(teamKey)` helper keeps the two
  call sites' wording identical.
- `lib/ui/screens/launchpad.js` — `headerLine` renders `no open tickets in
  <TEAM>` (team key from `lp.cache.teamKey`) in place of `0 open` when the
  total is zero and there's no error. Both the cold-cache early-return in
  `renderLaunchPad` and the matching gate in `handleKey` gained a `&&
  !lp.error` condition in cycle 1: `cache.isCold` treats "zero tickets" and
  "never fetched" identically, which is right for a genuinely empty team but
  was swallowing the team-not-found error (and locking the keymap to
  `r`-only) on a first-ever refresh. Cycle 2 (evaluation-1.md Change Request
  1): that fix was incomplete — `cache.isCold` ALSO still matched a real,
  confirmed-empty team (a real fetch, `lp.error === null`,
  `tickets.length === 0`), so the screen rendered the new "no open tickets in
  CON" header AND the old "no tickets cached yet — press r to fetch" body
  directly beneath it, contradicting the header's own `fetched <n> ago`.
  Both gates now check `(!lp.cache || lp.cache.fetchedAt == null)` instead of
  `cache.isCold(lp.cache)` — matching every genuinely-cold-cache test's own
  fixture (none set `fetchedAt`) — so a confirmed-empty team falls through to
  the normal render, where the header alone carries the message.
- `bin/concertino` — `cmdValidate` now warns (not fails) when
  `dashboard.launchPad.enabled` is `true` and `ticketProvider.teamKey` is
  absent, naming the risk (the `idExample`-derived fallback is a sample id,
  not a real team key).
- `test/cache.test.js` (cycle 3) — round-trip tests for the new `teamFound`
  field (`true`, `false` — explicitly asserting it never collapses to `null`
  via a falsy default — and the no-value-given default of `null`), a
  non-boolean-on-disk-degrades-to-null test, and a schema-version-bump test
  confirming a pre-`teamFound` cache row reads as empty rather than reaching
  any per-field default. Also updated three pre-existing tests whose fixtures
  hardcoded `"schemaVersion":2` to use `cache.CACHE_SCHEMA_VERSION` (now 3) so
  they keep exercising what they actually claim to, and one exact-shape
  `deepEqual` assertion to include the new `teamFound` key.
- `test/linear.test.js` — unit tests for `resolveTeam` (found/not-found,
  error propagation matching `fetchTickets`, query shape) and for the new
  `TEAM_QUERY` constant.
- `test/watch.test.js` — end-to-end `refreshLaunchPad` tests against a fake
  `lib/ui/linear` module (same require.cache-substitution pattern as the
  existing fake session): real team/zero tickets, team-not-found,
  non-empty-fetch-skips-lookup, and cold-cache-never-fetches-implicitly.
  These assert through the on-disk cache and the fake `fetchTickets`/
  `resolveTeam` call-tracking arrays rather than the rendered screen — a
  real wall-clock wait for watch.js's own POLL_MS timer (and, separately,
  forcing a `resize`-triggered full repaint) were both found to corrupt
  node:test's own pass/fail accounting for an ADJACENT test whenever
  `process.stdout.write` is overridden across a macrotask boundary
  (reproduced in isolation down to a two-line repro); a pure microtask flush
  does not have this problem, so these tests use that instead and leave the
  rendered-text assertions to launchpad.test.js, where no terminal emulation
  or timing is involved. Cycle 3 (skeptic-final-1.md Change Request 2) —
  added the skeptic's own end-to-end restart repro as regression tests: a
  cache written directly (no refresh performed, matching a brand-new `lp`
  object from a fresh `watch()` process) with `teamFound: false` renders the
  team-not-found error immediately; the `teamFound: true` companion renders
  the header message, not an error. `fetchTickets`/`resolveTeam` both throw
  if called, proving neither state depends on any network activity. Also
  added `teamFound` assertions to the two existing cycle-1 refresh tests
  (real-team-empty writes `teamFound: true`; team-not-found writes
  `teamFound: false`) and updated a comment in the latter that had gone
  stale (it used to correctly say the error channel was the only
  distinguishing signal — that stopped being true once `teamFound` started
  persisting the same distinction to disk).
- `test/launchpad.test.js` — unit tests against `headerLine`/`renderLaunchPad`/
  `handleKey` directly: the "no open tickets in CON" header text, the
  "team-not-found" error line reaching the screen (and not being swallowed by
  the cold-cache hint), keys not locked to `r`-only in that state, and the
  pre-existing genuinely-cold-cache behavior staying unaffected. Cycle 2
  (evaluation-1.md Change Request 2): added the missing companion assertion —
  a real, confirmed-empty team's render must NOT also contain "press r to
  fetch"/"no tickets cached yet" — plus a `handleKey` test proving normal
  keys (not just `r`/esc) reach the ordinary handlers for that state, while a
  genuinely never-fetched cache still locks the keymap to `r`-only.
- `test/validate.test.js` (new) — spawns `bin/concertino validate` as a real
  subprocess against fixture configs, covering the warn case
  (`dashboard.launchPad.enabled: true`, no `teamKey`) and the three no-warn
  cases (`teamKey` present; launch pad disabled; launch pad absent).
- `test/scripts/watch-smoke.test.sh` (cycle 3) — its four hand-written cache
  fixtures hardcoded `"schemaVersion":2`; bumped to `3` to match the
  `teamFound` schema bump above — without this, `npm test`'s real-tmux smoke
  suite would read every one of those fixtures as stale/empty and 6 of its
  checks (tickets/epics that were supposed to already be on screen) would
  fail. Caught by running the full `npm test` gate, not just `node --test`.
