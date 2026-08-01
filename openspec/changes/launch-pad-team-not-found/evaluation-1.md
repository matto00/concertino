## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL
Issues:
- AC1/AC2 ("the screen says which it is: `no open tickets in CON` versus
  `no team with key "ABC"`") is only *half* implemented. `headerLine`
  (`lib/ui/screens/launchpad.js:168-183`) correctly renders `no open tickets
  in CON` for a real, confirmed-empty team. But `renderLaunchPad`'s
  cold-cache early return (`lib/ui/screens/launchpad.js:303`) still fires for
  that exact same state — a real fetch that wrote `fetchedAt: <timestamp>,
  tickets: []` to the cache — because it guards on `cache.isCold(lp.cache)`,
  and `isCold` (`lib/ui/cache.js:131-134`) treats "fetchedAt set, zero
  tickets" identically to "never fetched" *by design* (its own header
  comment says so). The rendered screen therefore shows the new header text
  **and**, directly below it, the old `no tickets cached yet — press r to
  fetch` hint — which is factually false (a fetch did happen, `staleness`
  in the same header line even says `fetched 0s ago`) and reintroduces, one
  line lower, the exact "can't tell which state this is" ambiguity the
  ticket was written to eliminate. Verified with a direct `renderLaunchPad`
  call against the state `refreshLaunchPad` actually produces for a
  real/empty team (see Phase 2 for the repro). `handleKey`
  (`lib/ui/screens/launchpad.js:508`) has the matching gate and is
  functionally harmless here (nothing is selectable in an empty list
  anyway), but the render-side contradiction is a real, reachable defect —
  not a corner case: any team that legitimately clears its backlog hits it
  on the very next `r` refresh.
- Everything else in Phase 1 passes: AC3 (`concertino validate` warning) is
  implemented exactly as specified and tested (warn-only, correct trigger
  conditions, `test/validate.test.js`); AC4 (genuinely cold cache) is
  unaffected and still tested (`test/launchpad.test.js`'s pre-existing "r is
  the only bound key against a cold cache" and the new "genuinely cold cache
  (no error) is unaffected" test both pass); tasks.md is checked off
  consistently with what's implemented; the one documented deviation from a
  literal reading of tasks 2.4/3.2 (adding `&& !lp.error` to the two
  `cache.isCold` gates so the team-not-found error isn't swallowed) is
  explained in `files-modified.md` and is itself correct — it just didn't
  go far enough, since it only handles the *error* half of the zero-ticket
  ambiguity, not the *confirmed-empty* half. No scope creep found — the
  `postRaw()` extraction in `lib/ui/linear.js` is a reasonable, in-scope
  DRY move (shared by `post()` and the new `resolveTeam()`) and preserves
  `post()`'s existing error behavior exactly (all pre-existing
  `linear.test.js` tests still pass). No spec/schema regressions detected.

### Phase 2: Code Review — FAIL

**Gates (fresh run, `WORKTREE_PATH`, `EVALUATOR_CLEAN_WORKTREE=false` so no
clean-worktree re-run applies):**
```
npm test
```
Result: exit 0. `node --test`: 1036/1036 passed, 0 failed. All 16 bash
script suites: passed, 0 failed. Full log retained at
`/tmp/claude-1000/-home-matt-Development-concertino/d444ded4-e644-4057-abe1-2bfe01168340/scratchpad/test_output.log`.
Gates alone are clean; the defect below is a coverage gap, not a gate
failure.

**Issues:**
1. **`lib/ui/screens/launchpad.js:303`** (and the mirrored
   `lib/ui/screens/launchpad.js:508` in `handleKey`) — the cold-cache guard
   `cache.isCold(lp.cache) && !lp.refreshing && !lp.error` still returns
   `true` for a *real, confirmed-empty* team (fetched, `lp.error === null`,
   `tickets.length === 0`), because `cache.isCold` only looks at
   `fetchedAt`/`tickets.length`, not at whether a team-resolution outcome is
   known. Repro (state exactly as `refreshLaunchPad` writes it for a
   real/empty team):
   ```js
   const { renderLaunchPad } = require('./lib/ui/screens/launchpad');
   const NOW = Date.now();
   const out = renderLaunchPad({
     status: { enabled: true, reason: null, message: null },
     cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'CON' },
     pane: 'tickets', epicIndex: 0, ticketIndex: 0, selected: new Set(),
     mode: 'parallel', refreshing: false, error: null,
     project: 'concertino', defaultConcurrency: 2,
   }, [], { cols: 78, now: NOW });
   ```
   produces (ANSI stripped):
   ```
   NEW RUN · concertino       no open tickets in CON · fetched 0s ago · r refresh

     no tickets cached yet — press r to fetch
   ...
     r fetch   esc back
   ```
   The header (`fetched 0s ago`) and the body (`no tickets cached yet`)
   directly contradict each other. **Fix**: the cold-cache branch needs a
   condition that distinguishes "genuinely never fetched"
   (`lp.cache.fetchedAt == null`, matching every existing cold-cache test's
   fixture) from "fetched, confirmed-empty" — e.g. gate on
   `(!lp.cache || lp.cache.fetchedAt == null) && !lp.refreshing && !lp.error`
   instead of `cache.isCold(lp.cache) && ...` in both
   `renderLaunchPad` (line 303) and `handleKey` (line 508), and give the
   confirmed-empty-team state its own body copy (or none — the header alone
   may be sufficient once the misleading "press r to fetch" text is no
   longer shown underneath it).
2. Test coverage gap that let #1 through: `test/launchpad.test.js`'s "a real
   team with zero open tickets says so by name in the header" only asserts
   the header text is present (`assert.match(out, /no open tickets in
   CON/)`) and that `0 open` is absent; it never asserts the cold-cache hint
   (`press r to fetch`) is *absent* for that same state, which is what would
   have caught this. Recommend adding that assertion once #1 is fixed.

No other code-quality issues found: the `postRaw()` extraction is clean and
DRY (shared error handling for `post()`/`resolveTeam()`, no duplication);
naming is clear; no magic values; `resolveTeam`'s `{ found: boolean }`
contract matches design.md Decision 1 exactly; error handling at the
transport/HTTP/GraphQL boundaries is thorough and consistent with the
existing `post()` pattern; the `concertino validate` addition is a minimal,
correctly-scoped warning; no dead code, no leftover TODO/FIXME; no
over-engineering. Type safety and security are not meaningfully in scope for
this change (no new user-facing input parsing beyond an existing config
shape; team key is passed as a GraphQL variable, not interpolated).

### Phase 3: UI Review — N/A
No UI review configured for this project; dev-server steps skipped per
instructions.

### Overall: FAIL

### Change Requests
1. Fix the cold-cache/team-not-found-error render and keymap gates in
   `lib/ui/screens/launchpad.js:303` and `lib/ui/screens/launchpad.js:508`
   so a *confirmed-empty* team (real fetch, `lp.error === null`,
   `lp.cache.tickets.length === 0`, `lp.cache.fetchedAt` a real timestamp)
   no longer falls into the same branch as a genuinely never-fetched cache.
   Distinguish on `lp.cache.fetchedAt == null` (matching the existing
   cold-cache tests' fixtures) rather than `cache.isCold(lp.cache)`, and
   remove or replace the `no tickets cached yet — press r to fetch` body
   text for the confirmed-empty case so it no longer contradicts the header
   line's `fetched <n> ago` staleness text sitting directly above it.
2. Add a test asserting the `press r to fetch` hint is *absent* when a real,
   confirmed-empty team's cache is rendered (companion to the existing "says
   so by name in the header" test in `test/launchpad.test.js`), so this
   contradiction can't regress silently again.

### Non-blocking Suggestions
- `lib/ui/watch.js:641` passes `process.env.LINEAR_API_KEY` explicitly to
  `resolveTeam` rather than reusing whatever `apiKey` `fetchTickets` was
  actually invoked with (which defaults to `process.env.LINEAR_API_KEY` but
  could in principle be overridden via `opts.apiKey`). They're identical in
  every current call site, but threading the same resolved value through
  would remove the implicit assumption that they always agree.
