## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md`,
  `evaluation-1.md`, `evaluation-2.md` in
  `openspec/changes/launch-pad-team-not-found/` — treated as claims, not fact.
- `git diff main...HEAD --stat` and full diffs of `lib/ui/linear.js`,
  `lib/ui/watch.js`, `lib/ui/screens/launchpad.js`, `bin/concertino` — read in
  full, not sampled.
- Re-ran the full gate myself: `node --test` inside the worktree →
  `tests 1038 / pass 1038 / fail 0` (matches evaluation-2.md's claimed
  1038/1038); `npm test` (adds the 16 bash suites) → exit 0.
- Ran `node bin/concertino validate` against the project's own real
  `concertino.config.json` (has `teamKey: "CON"`) — no warning, as expected.
  Then ran it again against a copy with `teamKey` stripped
  (`dashboard.launchPad.enabled: true`) — got:
  `! ticketProvider.teamKey not set — dashboard.launchPad.enabled is true, so
  the launch pad will fall back to a guess derived from
  ticketProvider.idExample...` — confirms AC3 end to end, not just via the
  unit test.
- Called `renderLaunchPad` directly for all three states (genuinely cold,
  confirmed-empty-team, team-not-found) — reproduced exactly what
  evaluation-2.md claims: cold cache still says `press r to fetch`;
  confirmed-empty says `no open tickets in CON` with no contradictory body
  text; team-not-found shows the red `no team with key "ABC" — check
  ticketProvider.teamKey` line and no cold-cache hint. This confirms AC1,
  AC2 (first half), and AC4 for the **live-session** case.
- **Built an independent end-to-end repro using the real `lib/ui/watch.js`
  `watch()` entry point** (not just the render functions in isolation), to
  check what the evaluator's test suite never exercises: two *separate*
  `watch()` processes against the *same* on-disk cache root, simulating a
  dashboard restart. Script and full transcript below.

### A reproduced, AC-relevant defect: the team-not-found state does not survive a process restart

`refreshLaunchPad` (`lib/ui/watch.js:622-658`) carries the "team not found"
distinction *only* in the in-memory `lp.error` field (design.md Decision 3,
deliberately). `cache.write` (`lib/ui/cache.js:88-108`) is called
unconditionally after the `resolveTeam` check, regardless of whether the team
resolved — and the on-disk payload has no field for the distinction at all:
`{ schemaVersion, fetchedAt, teamKey, tickets, epics, truncated }`. I
confirmed this directly:

```
$ node -e '... cache.write(root, { teamKey: "ABC", tickets: [], epics: [] }, Date.now()); console.log(JSON.stringify(cache.read(root)))'
{"fetchedAt":1785559101416,"tickets":[],"epics":[],"teamKey":"ABC","truncated":false}
```

`openLaunchPad()` (`lib/ui/watch.js:591-613`) only initializes `lp.error =
null` once per **process**, from whatever `cache.read(root)` returns — it
never re-runs `resolveTeam`, and nothing auto-refreshes on open (confirmed by
the executor's own test, "opening the launch pad must never fetch on its
own", and by my reading of `handleKey`'s `refresh-launchpad` action, which is
the *only* call site of `refreshLaunchPad`).

Net effect: a team-not-found refresh's *cache row* is indistinguishable on
disk from a confirmed-empty-team's cache row. The distinguishing signal
(`lp.error`) lives only in the process that performed the refresh. The very
next `concertino watch` process — a dashboard restart, which is routine, not
an edge case — reads that same cache row with `lp.error` freshly `null`, and
the header's `!lp.error` gate (`launchpad.js`'s `headerLine`) silently
concludes the team is fine.

I reproduced this through the real `watch()` function, not just by hand-
constructing an `lp` object:

1. **Process A** (fresh `root`): opens the launch pad, presses `r`, fake
   `resolveTeam` returns `{ found: false }` for team key `ABC`. Verified via
   stderr capture that the rendered frame contained `no team with key "ABC"`.
2. **Process A torn down** (`fakeStdin.emit('end')`, awaited) — the on-disk
   cache at `root` now holds `{ teamKey: "ABC", tickets: [], fetchedAt:
   <ts> }`, exactly the payload shown above.
3. **Process B** (same `root`, brand-new `watch()` call, brand-new in-process
   `launchPad` object — this is what a restarted dashboard looks like):
   opens the launch pad with **no refresh**. Its fake `fetchTickets`/
   `resolveTeam` both throw if called, to prove no network call is what
   produces this frame — it comes straight from the stale cache.

Process B's rendered frame (captured verbatim, ANSI cursor codes included):

```
...[1;1Hconcertino ·   · LAUNCH PAD  0 runs
[2;1HNEW RUN                      no open tickets in ABC · fetched 0s ago · r refresh
[4;1H┏ ▣ EPICS ━━━━━━━━━━━━━━━━━━━━━━━┓ ┌ (no epic selected) ...
```

No red error line. No mention that `ABC` doesn't resolve. The header
confidently states `no open tickets in ABC · fetched 0s ago` — the exact
"looks configured, silently wrong" failure mode the ticket exists to fix,
recurring one layer later: instead of an empty list with no explanation, it's
now a *specific, confident, wrong* explanation.

This directly violates AC2 ("The screen says which it is") for the restart
case, and undermines the ticket's own stated motivation — the `ABC`
placeholder bug "caught a real user immediately afterwards" specifically
because it looked configured. A dashboard that reverts to that same
"looks-configured, isn't" appearance on every restart after the first
diagnostic refresh has not actually closed that trap; it just moved where it
reopens.

None of `evaluation-1.md`/`evaluation-2.md`'s test runs exercise this
scenario — every `watch.test.js`/`launchpad.test.js` case either refreshes
and asserts in the same in-memory session, or hand-constructs an `lp` object
with `error` set to match the state under test. There is no test with a
pre-populated on-disk cache (via `cache.write`) opened by a *fresh* `lp`
object with `error: null` representing a **prior** team-not-found result —
which is exactly the gap that hides this.

### Verdict: REFUTE

### Change Requests

1. **Persist the team-not-found distinction, not just the ticket data.**
   `lib/ui/cache.js`'s on-disk schema needs a field carrying whether the
   `teamKey` that produced this cache row actually resolved (e.g. a
   `teamFound: boolean | null` alongside `teamKey`, defaulting to `true`/
   `null` for pre-existing caches so old rows don't retroactively become
   errors — `cache.js` already has a schema-version bump mechanism
   (`CACHE_SCHEMA_VERSION`) built for exactly this kind of change). Then
   `openLaunchPad()` (`lib/ui/watch.js:591`) should derive the initial
   `lp.error` from `lp.cache.teamFound === false` (mirroring the message
   `refreshLaunchPad` already builds), not hardcode `null`, so a stale cache
   from a prior not-found refresh still shows the error on the very first
   render of a new process — before any `r` keypress, exactly like every
   other error this screen surfaces.
2. Add a regression test for this: write a cache to disk directly via
   `cache.write` with a team-not-found-equivalent payload, then open the
   launch pad in a **fresh** `lp`/session (no refresh performed) and assert
   the team-not-found message renders, not `no open tickets in <TEAM>`. This
   is the scenario evaluation-1/2's test suites do not cover, and it is the
   one that actually broke in my repro.

### Non-blocking notes

- `lib/ui/watch.js:824`'s `quickStartCold` (the fleet screen's QUICK START
  widget, CON-40) still calls `cache.isCold(cache.read(root))` and would
  treat a confirmed-empty **or** team-not-found cache identically to a
  genuinely-never-fetched one for that widget's own hint text. This is a
  different screen, not touched by this change's stated scope
  (proposal.md's Impact section lists only `linear.js`/`watch.js`'s
  `refreshLaunchPad`/`launchpad.js`/`bin/concertino`), so I am not blocking
  on it — flagging it only so a future pass on the fleet screen's own
  cold-state messaging doesn't rediscover the same ambiguity from scratch.
- The rest of the implementation is solid: `resolveTeam`/`postRaw` reuse in
  `linear.js` is clean, the `apiKey`-threaded-once fix from evaluation-1.md
  is correctly applied, the cycle-2 `fetchedAt`-vs-`isCold` fix genuinely
  resolves the evaluator's cycle-1 change request (verified directly, see
  above), and `concertino validate`'s new warning is correctly scoped
  (verified both the warn and no-warn paths against real config files, not
  just the shipped unit tests).
