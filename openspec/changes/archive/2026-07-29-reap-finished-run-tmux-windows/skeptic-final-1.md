## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth re-established fresh.** Read `ticket.md`, `design.md`, `tasks.md`,
  `specs/window-reaping/spec.md`, and `git show 825d6ce --stat` / `git diff
  main...HEAD --stat -- . ':!openspec'` (matches `files-modified.md` exactly:
  `docs/dashboard.md`, `lib/ui/reap.js`, `lib/ui/session.js`, `lib/ui/store.js`,
  `lib/ui/watch.js`, `test/reap.test.js`, `test/session.test.js`,
  `test/watch.test.js` — no scope creep).

- **Core safety property (never reap a dead window without `run.end`) —
  enforced in shipped code and proven end-to-end.**
  `lib/ui/reap.js:24-28` (`selectReapable`) filters on
  `run.endStatus != null && run.window && run.window.alive === false`.
  Cross-checked against `lib/ui/reducer.js`: `emptyRun()` defaults
  `endStatus: null` (reducer.js:44); `endStatus` is only ever set in the
  `run.end` case of `applyEvent` (reducer.js:76-79); `deriveStatus`'s tier-1
  telemetry line (`run.window && !run.window.alive` → `failed`,
  reducer.js:152) is exactly the line the ticket says must remain the sole
  evidence path. `test/reap.test.js:49-63` ("a dead window with no run.end is
  never reaped, and still resolves to status failed") is a real
  end-to-end test: it builds a run from a real `reduce()` call (not a hand-
  built fixture) with a `run.start`-only event log and a dead window, asserts
  `run5.status === 'failed'`, and separately asserts
  `reap.selectReapable(runs)` returns `[]`. I ran this test myself — passes.

- **Conservative-only, not aggressive.** `selectReapable` requires
  `window.alive === false` in addition to `endStatus != null` — nothing kills
  a still-alive window on `run.end` alone (`lib/ui/reap.js:26`,
  `test/reap.test.js:28-31` "terminal + alive window is NOT selected", which I
  re-ran and confirmed passes). `design.md` Decision 3 documents the Phase 4
  trace behind this choice (`cleanup.sh` emits `run.end` before the
  orchestrator's remaining Phase 4 steps in the same window), matching what I
  independently read in the ticket's own framing of the trade-off.

- **Scrollback captured before kill, best-effort, non-blocking.**
  `lib/ui/reap.js:36-55` (`reapFinished`): `captureFull` wrapped in try/catch
  → write wrapped in its own try/catch → `session.kill(ticket)` unconditionally
  after both, regardless of either failing. `test/reap.test.js:67-115` covers
  ordering (scrollback on disk before `kill` fires), a throwing `captureFull`,
  and a write failure (ENOTDIR trick) — all three re-run by me, all pass. The
  real-tmux integration test (`test/reap.test.js:140-162`) spawns an actual
  short-lived tmux window, reaps it, and asserts both that the window is gone
  from `listWindows()` and the scrollback file on disk contains the expected
  marker — I re-ran this specific test and it passed (tmux is present on this
  host).

- **`__concertino__` / `concertino-smoke-*` structurally untouched.**
  `lib/ui/session.js:88` filters `PLACEHOLDER` out of every
  `listWindows()` result, so `__concertino__` never reaches `runs` and can
  never appear in `selectReapable`'s output — the exclusion is structural, not
  a special-cased check that could be forgotten. Smoke sessions
  (`concertino-smoke-<pid>`) run entirely under a different tmux *session*
  name, created via their own `createSession(...)` calls in test scripts —
  `reapFinished` only ever operates on the one `session` object `watch.js`
  passes it (the dashboard's own configured session), so a smoke session's
  windows are never part of the `runs`/`session.listWindows()` universe
  `reap.js` sees at all.

- **Wiring is correct.** `lib/ui/watch.js:410-419`: `reap.reapFinished(root,
  session, runs)` is called exactly once, immediately after `runs =
  reduce(...)`, inside `draw()` — matches tasks.md 3.1 and design.md's
  migration plan. `test/watch.test.js`'s new wiring test (require.cache-
  substituted `session`/`reap` modules, fake stdin) asserts `reapFinished` is
  called exactly once per `draw()` with the exact `reduce()` output
  (`endStatus`/`window` populated, which only `reduce()` produces) — re-ran,
  passes. The one-off startup `reduce()` pass used for queue restoration
  (watch.js:504-518) does not call `reapFinished` — correct, since the spec
  requires reaping to run "on every poll of `concertino watch`'s poll loop,"
  not during startup reconciliation, and the very next line (`runs =
  draw()`) enters the real loop and reaps on the first real poll anyway.

- **Re-ran the full test suite myself** (not trusting the evaluator's pasted
  numbers): `node --test` → `tests 559, pass 559, fail 0`; targeted
  `node --test test/reap.test.js test/session.test.js test/watch.test.js` →
  45/45 pass, including the two tmux-backed integration tests (not skipped —
  tmux is installed on this host). Full `npm test` (all `node --test` cases
  plus every bash script test suite: emit-event, persist-evidence,
  assert-phase, start-servers, watch-smoke, doctor-artifacts,
  ticket-pattern, escalation-loop, sync-core-resolution, harness-identity,
  cleanup, doctor-base-branch, auditor-render, check-merge-readiness) — all
  green, zero failures.
  `openspec validate reap-finished-run-tmux-windows --strict` →
  "Change 'reap-finished-run-tmux-windows' is valid".

- **No unrelated files touched**: `lib/ui/retention.js` has zero diff
  (`git diff main...HEAD -- lib/ui/retention.js` is empty) — the ticket's
  "neither should assume the other ran" independence is preserved by
  construction, not just by claim.

- **AC traceability** (ticket.md): dead+terminal reaped ✓ (reap.js +
  test:23-26); dead+no-run.end preserved and still resolves `failed` ✓
  (reap.js + test:49-63, real reducer); conservative-only (no
  aggressive/grace-period) ✓ (predicate requires `alive === false`, design.md
  Decision 3); scrollback captured before kill, best-effort ✓ (reap.js:39-53 +
  tests); `__concertino__`/smoke sessions untouched ✓ (structural, verified
  above); gitignore/disk-widening note addressed in design.md Decision 5 and
  echoed in `docs/dashboard.md`'s new "Window reaping" section.

- **No UI to review** — this is a backend/tmux-lifecycle change with no
  browser-testable surface; correctly marked N/A by the evaluator, and I have
  no reason to dispute that given the diff touches only `lib/ui/*.js`,
  `docs/*.md`, and tests.

### Verdict: CONFIRM

### Non-blocking notes
- Carried from the evaluator's report and worth keeping visible: a window a
  human kills manually via the drilldown's `kill-confirmed` action never
  emits `run.end`, so it is correctly never auto-reaped and stays a stray
  until closed by hand again — out of scope per the ticket's own invariant,
  but an explicit one-line callout in `docs/dashboard.md` would preempt an
  operator's confusion later. Not a blocker.
