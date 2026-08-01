## Skeptic Report — final gate (round 2)

### What I verified (with evidence)

- Read `ticket.md` (Linear CON-20, fetched fresh via MCP) and the planning
  artifacts under `openspec/changes/launch-pad-team-not-found/` —
  `evaluation-2.md`, `skeptic-final-1.md`, `workflow-state.md` — treated as
  claims, not fact. Did not read them as a substitute for verifying the code.
- `git diff 810e368...f8fadca -- lib/ui/cache.js lib/ui/watch.js` read in
  full: `CACHE_SCHEMA_VERSION` bumped 2→3; `cache.js` `read()`/`write()` gain
  a `teamFound: boolean | null` field with a strict `typeof === 'boolean'`
  guard (not `||`, so `false` round-trips as `false` rather than collapsing
  to `null`); `watch.js`'s `openLaunchPad()` now seeds `lp.error` from
  `initialCache.teamFound === false` instead of hardcoding `null`;
  `refreshLaunchPad` now writes `teamFound` onto every cache row via
  `Object.assign({}, result, { teamFound })`. This is exactly what round 1's
  Change Request 1 asked for.
- Re-ran the full gate myself: `node --test` → `1045/1045 pass, 0 fail`
  (1038 from round 1 + 7 new: 2 restart-scenario tests plus 5 others added
  across this and the prior cycle). `npm test` (adds the 16 bash suites) →
  all suites `0 failed`.
- Read the two new regression tests in `test/watch.test.js`
  ("a stale team-not-found cache renders the error on a fresh process,
  before any refresh" and its confirmed-empty companion) line by line: both
  write a cache row directly via `cache.write` (no refresh performed), then
  open the launch pad in a **brand-new `watch()` process** whose
  `fetchTickets`/`resolveTeam` both throw if called — proving the message
  comes from the persisted row, not a live network call. This is precisely
  the gap round 1 identified as untested.
- **Built my own independent, from-scratch repro against the real
  `watch()` entry point** (not the executor's test harness, and not
  `renderLaunchPad` in isolation) to avoid trusting the executor's or
  evaluator's narrative:
  1. Process A (fresh root, real `watch()`): opened the launch pad, pressed
     `r`, faked `resolveTeam` → `{found:false}` for team `ABC`. Captured
     rendered frame after the real `POLL_MS=1000` redraw tick — confirmed it
     contains `no team with key "ABC" — check ticketProvider.teamKey`.
     On-disk cache after teardown:
     `{"schemaVersion":3,...,"teamKey":"ABC","teamFound":false}`.
  2. Process B: brand-new `watch()` call against the **same root**, no `r`
     pressed, `fetchTickets`/`resolveTeam` both throw if invoked (proving no
     network call produces the frame). Rendered frame **matched
     `/no team with key "ABC" — check ticketProvider\.teamKey/`** and did
     **not** match `/no open tickets in ABC/` — this is the exact restart
     scenario round 1 refuted on, now fixed.
  3. Ran the companion case: a confirmed-empty real team (`teamFound: true`)
     written directly to disk, opened by a fresh process with no refresh —
     rendered `no open tickets in CON`, with neither the error line nor
     `press r to fetch` present. Confirms the fix doesn't overcorrect into
     treating every stale zero-ticket cache as an error.
  4. Independently hand-wrote a pre-CON-20 (`schemaVersion: 2`, no
     `teamFound` field) cache row and called `cache.read()` on it directly:
     it degrades to `empty()` (`fetchedAt: null`), i.e. cold/`press r to
     fetch`, never misread as either confirmed-empty or team-not-found —
     the schema-version guard handles the migration correctly (AC4
     preserved for pre-existing on-disk caches too).
- Re-verified AC3 independently, not just via the unit suite: ran
  `node bin/concertino validate` against the real `concertino.config.json`
  (has `teamKey`) — no warning. Ran it again with `--config=` pointed at a
  copy of that config with `ticketProvider.teamKey` stripped — got
  `! ticketProvider.teamKey not set — dashboard.launchPad.enabled is true,
  so the launch pad will fall back to a guess derived from
  ticketProvider.idExample...`.
- Checked the round-1 non-blocking note about `quickStartCold` (fleet
  screen's QUICK START widget) — confirmed it remains untouched by this
  diff (correctly out of scope per proposal.md's Impact section) and was
  already flagged non-blocking, not re-raised here.
- Checked scope: `git diff main...HEAD --stat` — 23 files, all either
  `lib/ui/{cache,linear,watch}.js` + `lib/ui/screens/launchpad.js` +
  `bin/concertino`, their tests, or `openspec/changes/launch-pad-team-not-
  found/**`. No drift beyond the ticket. `design.md`/`spec.md` were not
  updated to mention the new `teamFound` persisted field or the restart
  scenario (noted below, non-blocking — the ticket's ACs are about product
  behavior, which is what I verified, not about design-doc completeness).

### AC traceability

1. "A fetch that returns zero tickets distinguishes between a team that
   returned nothing and a team key that matched no team" — met:
   `linear.resolveTeam` (unchanged from cycle 1) + the new `teamFound`
   persisted field carrying that distinction across restarts
   (`lib/ui/watch.js:679-687`, `lib/ui/cache.js:104,123`).
2. "The screen says which it is" — met and now **restart-safe**: verified
   both messages render correctly from a persisted cache row on a brand-new
   process (my repro above, plus the executor's own two new tests).
3. "`concertino validate` warns..." — met, re-verified directly against
   real config files, not just the shipped unit test.
4. "A cold cache still renders `press r to fetch`" — met, including for
   pre-existing (`schemaVersion` 1/2) on-disk caches, which the schema-bump
   migration correctly degrades to cold rather than misreading.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md`/`specs/launchpad-team-resolution/spec.md` were not amended to
  document the `teamFound` persisted field or the restart-survival
  requirement that round 1 surfaced. The code and tests are correct and
  restart-safe regardless; this is purely a planning-artifact freshness gap
  a future reader of `design.md` would not learn about without reading the
  commit itself.
- Everything round 1 already called solid (resolveTeam/postRaw reuse,
  apiKey threading, the cycle-2 `fetchedAt`-vs-`isCold` fix, validate's
  warning scoping) remains correct — re-verified via the full test run
  above and the AC3 spot check.
