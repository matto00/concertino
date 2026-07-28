## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs** — fetched CON-7 directly from Linear (not just `ticket.md`): 5 ACs (true ms
  resolution, BSD/macOS portability preserved, byte-identical `READY`/`PASS`/`FAIL` stdout,
  `|| true` telemetry-safety preserved, tests assert non-zero/non-1000-multiple duration for a
  sub-second gate). All five are addressed by `proposal.md` §"What Changes" and `design.md`
  §Goals/Non-Goals.

- **Root-cause code confirmed live in the worktree**, matching the ticket's claim exactly:
  - `core/scripts/assert-phase.sh:50` — `START_TS="$(date +%s)"`
  - `core/scripts/assert-phase.sh:111` — `DURATION_MS=$(( ($(date +%s) - START_TS) * 1000 ))`
  - `core/scripts/start-servers.sh:52,64` — identical pattern inside `start_one()`.

- **`now_ms()` precedent confirmed** — `core/scripts/emit-event.sh:31-38` already has the exact
  8-line helper the plan proposes to duplicate (`date +%s%3N` with a `node -e
  'process.stdout.write(String(Date.now()))'` fallback on the `*N*|''` case). `tasks.md` task 1.1
  quotes this fallback string byte-for-byte, which is good — it removes an ambiguity that could
  otherwise let an implementer improvise a slightly different fallback.

- **"Standalone scripts, no cross-sourcing" convention verified, not just asserted** — ran
  `diff` between `core/scripts/{assert-phase,start-servers,emit-event}.sh` and their
  `scripts/concertino/` counterparts: all three are byte-identical today, confirming the
  rendered-mirror pattern the design leans on for its "duplicate rather than source" decision is
  real, current, and already in `core/scripts/`.

- **Test-file conventions checked** — `test/scripts/assert-phase.test.sh` and
  `start-servers.test.sh` already assert `duration_ms is numeric` / `non-negative` using the
  `node -e ... JSON.parse(l)` pattern the tasks reference; task 4.1/4.2 correctly extend an
  existing pattern rather than inventing a new one. `start-servers.test.sh` already has
  `duration_ms` coverage today (contra tasks.md's hedge "or add if the CON-1 change didn't leave
  meaningful coverage here" — it did; the task correctly frames this as "extend").

- **Spec delta format checked against this repo's own precedent** — compared
  `specs/gate-telemetry/spec.md` in the change dir against the *actual* CON-1 archived delta at
  `openspec/changes/archive/2026-07-28-add-gate-event-duration-error/specs/gate-telemetry/spec.md`.
  The new delta correctly uses `## MODIFIED Requirements` and reproduces the *entire* requirement
  block (all 3 existing scenarios) plus the new "Sub-second gate reports true millisecond
  resolution" scenario — matching this repo's convention that a MODIFIED requirement carries its
  full text, not just the delta. The wording tightening ("measured with millisecond-resolution
  timestamps (not derived from whole-second deltas)") is accurate to what the code will do and
  doesn't silently expand scope (field name/type/shape untouched, confirmed against
  `proposal.md`'s explicit non-goals).

- **Scope check** — `git status --short` in the worktree shows only the untracked
  `openspec/changes/fix-gate-duration-precision/` directory; no source files touched yet
  (`workflow-state.md` confirms `PHASE: Planning (design-gate)`, `CYCLE: 0`). Nothing here is
  scope creep beyond the three files + two test files + one spec delta the ticket implies.

- **No missing contract-update gap** — the design's non-goals (no reducer/dashboard/schema-version
  change) are correct: `duration_ms` stays an integer in every scenario, no new field, no renamed
  field, so no reducer-side delta is needed. I did not find a reducer file that pattern-matches on
  duration value buckets that this change would silently break.

### Verdict: CONFIRM

The plan traces cleanly to every ticket AC, the "duplicate `now_ms()` vs. shared lib" decision is
justified against a convention I independently confirmed is real (identical `core/` /
`scripts/concertino/` trees today), the spec delta matches this project's own precedent for
MODIFIED-requirement deltas, and I found no placeholders, contradictions, or scope gaps.

### Non-blocking notes

1. **Task 4.1's flakiness risk deserves a harder look before it's declared done, even though I'm
   not blocking on it.** The task targets the `setup` phase specifically — the *fastest* phase in
   the codebase — for the "non-zero, non-1000-multiple" assertion. I read the actual existing test
   (`test/scripts/assert-phase.test.sh:28-44`): `setup` does two `[ -d ]` / `[ -f ]` checks with no
   loop body in the common case. If `now_ms()`'s two subprocess calls (`date +%s%3N`, once at
   `START_TS`, once at the end) happen to land in the same millisecond tick, `DURATION_MS` would
   legitimately be `0` — which *is* "a multiple of 1000" and would make the new assertion fail
   despite the fix being correct (a true sub-millisecond duration correctly reporting as 0 is not a
   bug). In practice, the fork+exec overhead of two separate `date`/`node` subprocess calls almost
   certainly pushes real elapsed time past 1ms in virtually every run, so this is unlikely to
   flake — but "unlikely" isn't "impossible," and the task's own hedge ("probabilistic but
   effectively-always-true") shows the plan authors already know this. Suggest the executor either
   (a) empirically confirm during task 4.3's `npm test` run that this doesn't flake across a few
   repeated runs, or (b) target a slightly heavier phase (e.g. the failing-setup path, which runs
   two checks plus `fail()` bookkeeping) if `0` is ever observed. Not a design blocker — just worth
   the executor's attention rather than assuming the hedge is automatically safe.
2. `tasks.md` 2.1 doesn't specify where in `start-servers.sh` the duplicated `now_ms()` should live
   (top-level vs. inside `start_one()`); top-level (mirroring `assert-phase.sh` and
   `emit-event.sh`) is the obvious choice given the file has only one function, so this isn't
   ambiguous enough to require a revision — just noting it wasn't spelled out.
