## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket ACs addressed explicitly:
  1. "warn naming the commits behind" — `assert-phase.sh delivery`'s new stale-base block prints
     `WARN base <remote>/<branch> has moved — this branch is N commit(s) behind:` plus up to 5
     `git log --oneline` lines to stderr (`core/scripts/assert-phase.sh:127-133`). Verified live via
     `test/scripts/assert-phase.test.sh` (3-commits-behind and 12-commits-behind cases), both green.
  2. "never blocks / never raises a blocking escalation" — the check never sets `FAILED`, never
     touches `PASS delivery`/exit code, and only emits a `gate.warning` telemetry event (not an
     `escalation.*` kind); confirmed `lib/ui/reducer.js`'s `TIER2_KINDS`/`TIER3_KINDS` don't include
     `gate.warning`, so it's a no-op for dashboard state today (default: break, `lib/ui/reducer.js:142-143`).
  3. "current base -> no output" — tested and green (`no WARN line when base current`, `only one
     event (gate.result) when base current`).
  4. ROADMAP.md's "Stale-base warning at the delivery gate" bullet removed (`git diff` confirms).
- No AC silently reinterpreted — spec.md's four Requirements map 1:1 to the AC language and match
  the implemented script exactly (re-verified by reading `core/scripts/assert-phase.sh` in full
  against each scenario).
- All tasks.md items marked `[x]` and each corresponds to real code: 1.1-1.5 in
  `core/scripts/assert-phase.sh:105-143` (mirrored byte-identically into
  `scripts/concertino/assert-phase.sh`, verified with `diff` — identical); 2.1-2.5 in
  `test/scripts/assert-phase.test.sh` (new "CON-31 stale-base warning" block, 28 new assertions, all
  passing); 3.1 ROADMAP.md edit confirmed; 3.2 spec.md cross-checked against actual output, matches.
- No scope creep: the only change outside the stale-base check itself is hoisting
  `GATE_TICKET`/`looks_like_ticket` above the phase `case` dispatch so the new `delivery`-case
  telemetry call can use them — a mechanical, behavior-preserving move (same definitions, same
  values), not a new capability. `files-modified.md` documents this explicitly and it's needed by
  task 1.4.
- No regressions: full `npm test` run (34 test files incl. `assert-phase.test.sh`,
  `cleanup.test.sh`, `doctor-base-branch.test.sh`, `check-merge-readiness.test.sh`, dashboard/reducer
  suites) exits 0, 0 failures.
- No API/schema contract change — the `PASS <phase>`/`FAIL` stdout contract is explicitly unchanged
  (design.md Decision 2), confirmed by the untouched `check "stdout is PASS delivery"` assertions
  still passing across all 4 new scenarios.
- Planning artifacts (design.md, spec.md) accurately describe the final implementation — cross-read
  side by side with the code, no drift found.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Correctness (independently verified, not just trusted)**: confirmed empirically that
  `git fetch <remote> <branch>` does update the local remote-tracking ref (`refs/remotes/<remote>/<branch>`)
  in both a plain clone and a `git worktree add` linked worktree (reproduced in a scratch repo), which
  the check's subsequent `git rev-parse "${STALE_REMOTE}/${STALE_BRANCH}"` (assert-phase.sh:119)
  depends on. This matters because Concertino worktrees are linked worktrees, not fresh clones — the
  behavior holds because remote-tracking refs live at the shared-repo level.
- **Guard-rail correctness**: every git call in the new block is individually guarded
  (`... || VAR=""` / nested `if`) so a fetch failure, unresolvable ref, or unexpected git error can't
  trip `set -euo pipefail` (assert-phase.sh:2) and abort the script — matches design.md Decision 2 /
  tasks.md 1.3. Verified live with the "fetch fails" test case (remote path deleted): exit 0, `PASS
  delivery`, no WARN, no `gate.warning` event.
- **DRY**: no in-file duplication introduced. The "fetch, compare, best-effort" shape is
  intentionally similar to `cleanup.sh`'s `attempt_fast_forward()` and `bin/concertino`'s
  `checkBaseBranch`, but those are different scripts/languages solving adjacent-but-distinct problems
  (post-merge fast-forward vs. pre-merge warn); design.md's Decision explicitly weighs and accepts
  this. Not a violation.
- **Readable**: clear `STALE_*` variable naming, comment block explains the non-blocking contract and
  why (assert-phase.sh:105-115). One minor nit below (non-blocking).
- **Modular**: check is self-contained inside the `delivery)` case, matching the file's existing
  per-phase-inline style (no over-abstraction into new functions/files for a ~35-line block used once).
- **Type safety**: N/A (bash).
- **Security**: `CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH` and `GATE_TICKET` are passed as
  discrete `git`/`emit-event.sh` arguments, never `eval`'d or interpolated into a shell string that's
  re-parsed — no injection surface. `commits=` telemetry field is built from short SHAs only (`awk
  '{print $1}'`), not commit subjects, avoiding any free-text-in-JSON-string risk from message content.
- **Error handling**: fetch/rev-parse/merge-base/rev-list/log/emit-event calls all degrade to "skip
  silently" per Decision 2 — no silent contract violation, no unhandled exception path.
- **Tests meaningful**: 28 new assertions across 4 real scenarios (current, 3-behind, 12-behind
  truncation, fetch failure), each exercising real git repos with a real bare "remote" (mirrors
  `cleanup.test.sh`'s proven `new_pair`/`advance_remote` shape) rather than mocking git. These would
  catch a real regression (e.g. wrong count, missing cap, telemetry emitted on the wrong branch,
  stdout contract broken). All 49 assertions in the file pass; full `npm test` passes (exit 0).
- **No dead code**: no leftover TODO/FIXME, no unused variables in the diff.
- **No over-engineering**: no premature abstraction — the check is a single inline block, not a new
  shared library function nobody else needs yet.
- **Behavior-preserving hoist**: the `GATE_TICKET`/`looks_like_ticket` move is definitionally
  identical before/after (same RHS expressions), confirmed by all pre-existing setup/servers/cleanup
  tests in the same file still passing unchanged.

Non-blocking nit (see Suggestions): the 5-commit cap is a literal `5` in two places
(`assert-phase.sh:125` and `:131`) rather than a named constant.

### Phase 3: UI Review — N/A
Backend/tooling script change (bash gate script + shell tests); no UI surface. Per task framing, dev
servers were not started and no UI checks apply.

### Overall: PASS

### Non-blocking Suggestions
- `core/scripts/assert-phase.sh:125,131` — the commit-list cap (`5`) is a literal in two places
  (`git log --oneline -5` and `[ "$STALE_BEHIND" -gt 5 ]`). Extracting a `STALE_COMMIT_CAP=5`
  variable would make the two uses provably consistent if the cap ever changes, though today they're
  correctly in sync and tested (12-behind case confirms exactly 5 listed + `(+7 more)`).
- Per the design-gate skeptic's non-blocking note 1: the new check currently runs unconditionally
  even when the preceding pushed/clean checks already set `FAILED=1` (harmless — no AC depends on
  skipping it, and it can't itself change the fail outcome — but it does spend a network round-trip
  on a gate call that's already going to fail). Not required for this ticket; worth a one-line comment
  or an early-exit if a future pass touches this block anyway.
