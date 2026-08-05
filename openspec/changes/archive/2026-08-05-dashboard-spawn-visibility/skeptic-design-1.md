## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/spawn-visibility/spec.md` in full, then cross-checked every factual
claim about the current codebase against the actual source (not the
narrative) in `WORKTREE_PATH`:

- `lib/ui/session.js` (read in full): `createSession(name)` takes one arg
  today; `spawn(ticket, cmd, env)` does zero filesystem I/O beyond `tmux`.
  Matches design.md Decision 1's premise exactly.
- `lib/ui/watch.js`: `grep -n "createSession"` shows the single production
  call site `createSession(cfg.tmuxSession || 'concertino')` at line 135,
  with `const root = opts.root` already in scope a few lines earlier (line
  132) — matches the claim that `root` is available at the one place that
  needs threading.
- Confirmed via `grep -rln "require('./session')"` across the tree
  (excluding tests) that `watch.js` is the *only* production requirer of
  `session.js` — the "exactly one call site" claim in proposal.md/design.md
  holds with no bypass path in `bin/` or elsewhere.
- `lib/ui/prompt.js#submitTicket` (grep + read): calls
  `session.spawn(parsed.ticket, command, env)` — the one and only
  production caller of `session.spawn`, matching Decision 1's "every real
  call path already converges" claim.
- `lib/ui/reducer.js` (read in full): confirmed the existing window-merge
  fallback (`reduce()` lines 245–252, a live tmux window with no log still
  produces a run) and `TIER2_KINDS`/`TIER3_KINDS` (lines 8–13) exactly as
  design.md's Context and Decision 3 describe them — `run.spawn` correctly
  omitted from both sets would leave `deriveTelemetry` returning `'none'`
  for a spawn-only run, as Decision 3 requires.
- `lib/ui/screens/fleet/rows.js` (read in full): `statusLine()` (lines
  31–80) and `renderFinishedRow()` (lines 130–151) match the current
  "no telemetry" / "window exited" branches design.md's Decision 5 and
  tasks.md §3 describe as the edit points, field-for-field.
- `lib/ui/screens/drilldown.js`: `elapsedText()` (364–370) and
  `headerLines()`'s `phaseRight` (404–410) match the described edit points;
  confirmed the branch ordering (endStatus checked first, so the new
  "starting" branch correctly only fires for a live `running` case that
  falls through today's checks).
- `lib/ui/reap.js` (read in full) and `lib/ui/retention.js` (read in full):
  confirmed `selectReapable`'s `if (run.endStatus == null || !run.window)
  return false` (line 67) and `isEligible`'s `hasRunEnd` gate (lines 35–38,
  45–46) already structurally exclude any run with no `run.end` — Decision
  6's "no code change, add a regression test" claim is accurate, not
  hand-waved.
- `scripts/concertino/emit-event.sh`'s `build_line()` (lines 295–303): the
  wire shape (`t`, `kind`, `project`, `ticket`, `role`, plus extra fields)
  matches Decision 2's hand-rolled JSON-line spec field-for-field.
- `test/session.test.js` / `test/reap.test.js`: confirmed every existing
  test constructs `createSession(SESSION)` with one argument, backing the
  "additive-only, no test breakage" claim in the Risks section.

### Acceptance-criteria trace

- AC1 ("appears within one poll, before telemetry") → Requirement 1 +
  Decision 1/2 (synchronous in-process write inside `session.spawn()`,
  before the window-creating call returns).
- AC2 ("dies without run.start surfaces as failure, scrollback reachable")
  → `deriveStatus` already returns `'failed'` for a dead window regardless
  of telemetry (verified in reducer.js, unchanged); the "failed to start"
  label (Decision 5, tasks §3.3/3.4/4.1) makes it distinct; scrollback
  reachability falls out of Decision 6 (never reaped, window/log untouched)
  — explicitly tested by task 5.1.
- AC3 ("live-no-telemetry renders distinct from mid-phase") → Decision 5 +
  spec Requirement 3, verified against the real branch structure in
  rows.js/drilldown.js above.
- AC4 ("reaping/retention treat it correctly") → Decision 6 + spec
  Requirement 4, verified as already-true-and-now-tested against the real
  guard clauses in reap.js/retention.js.

All four ACs trace to a specific decision, task, and spec requirement with
no gap.

### Soundness checks

- No placeholders/TBD/deferred decisions found anywhere in the four
  artifacts — every decision (event-write site, wire format, telemetry
  tier classification, field naming, rendering site, reap/retention
  no-op) is made explicitly, with alternatives named and rejected with
  reasons, not left open.
- No internal contradictions between proposal.md, design.md, tasks.md, and
  spec.md — task numbering maps cleanly onto design.md's six numbered
  decisions, and spec.md's four requirements map onto the same six
  decisions without a stray requirement or an uncovered decision.
- No ambiguity a competent implementer could read two ways: task 1.3's
  "after the `respawn-window` call succeeds" pins the exact write point;
  task 2.3's derivation formula is given as literal code, not prose; the
  wire-shape JSON is given literally in both design.md and tasks.md.
- No scope drift: Non-Goals explicitly excludes a new `status: 'starting'`
  value/section and an idle-timeout policy, and the Impact/tasks lists
  don't touch anything beyond those six files + their tests.
- Missing-contract check: this is UI/telemetry-internal, not a public
  API/schema surface external to the dashboard process itself; the one
  contract that does exist (the `run.spawn` wire shape parsed by
  `store`/`reducer`) is captured as a new ADDED requirement in spec.md,
  which is the correct spec delta for a new event kind.

### Verdict: CONFIRM

Design is sound, fully traceable to the ticket's four acceptance criteria,
and every factual claim about the existing codebase that I spot-checked
(session.js, watch.js, prompt.js, reducer.js, rows.js, drilldown.js,
reap.js, retention.js, emit-event.sh, and the existing test call sites)
matched the real source exactly. No placeholders, no contradictions, no
scope drift, no unjustified assumptions found.

### Non-blocking notes

- Task 3.2 (skip the elapsedMs-based duration segment whenever
  `run.telemetry === 'none'`, not just when `spawnedAt` is set) slightly
  widens today's rendering for the pre-existing "live window, no log at
  all" fallback case too (it currently shows a meaningless "—" duration
  there and will stop after this change). This is a strict improvement and
  consistent with the acceptance criteria's intent, but the executor
  should note in `files-modified.md` that this one line touches a case
  broader than "spawn-only runs" so the evaluator doesn't mistake it for
  an unrelated behavior change.
