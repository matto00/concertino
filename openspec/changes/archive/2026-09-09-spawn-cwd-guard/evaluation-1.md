## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `aa9d511` on `bug/spawn-cwd-guard/CON-174`, diffed against `main`.

### Phase 1: Spec Review — FAIL

- PASS — `assert-cwd.sh` implements design.md's round-3-corrected Decision 1 faithfully. Independently traced the contract line-by-line against `core/scripts/assert-cwd.sh`: existence check → `FAIL worktree-missing`; `realpath` ambient → `FAIL ambient-path-invalid`; exact `BASE="${WORKTREE_PATH%/$BRANCH}"` derivation (not a levels-up heuristic), with the non-suffix case degrading to `BASE=""`/no-collision-check rather than a false BLOCKER; collision check keyed on *under BASE but not under-or-equal WT*; `AMB == WT` and `AMB == BASE` both explicitly tolerated; ambient outside BASE tolerated; branch check independent, via `git_child` (CON-133). It does **not** require ambient to equal or resolve under `WORKTREE_PATH` — the round-2 rejected shape is absent. Verified live: `assert-cwd.sh /home/matt/Development/concertino <this worktree> bug/spawn-cwd-guard/CON-174` → `READY` (the real normal-spawn shape passes).
- PASS — 16 ambient-cwd-relative call sites re-grepped independently by me, not taken on the executor's word: executor 1, evaluator 6, skeptic 6, auditor 3 = **16**, matching the AC exactly. Every one now carries `cd "$WORKTREE_PATH" && ` in the same compound command. The only remaining bare `scripts/concertino/...` strings in those four files are prose mentions (`executor.md:111`, `evaluator.md:367,372`, `skeptic.md:284,289`, `auditor.md:321`) — precisely the exclusion list `tasks.md` 3.4 names. Orchestrator's own invocations untouched, per Non-Goals.
- PASS — drift gate: `diff core/scripts/assert-cwd.sh scripts/concertino/assert-cwd.sh` is empty; both 3680 bytes, both `0755`.
- PASS — CON-139 scope decision stated explicitly in design.md Non-Goals + Decision 3.
- PASS — `openspec validate spawn-cwd-guard --type change` exits zero; spec delta covers all six behaviors.
- **FAIL (CR #3)** — spec delta requires "the orchestrator supplies BRANCH to every worktree-bound role it **spawns or warm-resumes**", and `tasks.md` 2.1 claims the Cycles-2+ resume instruction (`~line 696`) was updated. It was not — the diff touches only four spawn sites (515/671/673/725). See CR #3 for why this is not purely cosmetic.
- **FAIL (CR #2)** — an uncommitted `design.md` edit (three `14`→`16` call-site corrections) is sitting in the worktree. As committed, `design.md` still says 14 while the implementation and `tasks.md` say 16.

### Phase 2: Code Review — FAIL

Gates re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):
- `npm test` — **green**, full chain including `assert-cwd.test.sh` (11/11) and `cwd-guard-render.test.sh` (14/14), plus the pre-existing `rendered-scripts-drift.test.sh` and every render test. No regressions.
- `npx openspec validate spawn-cwd-guard --type change` — valid.

Code quality: script is small, readable, `set -euo pipefail`, no magic values, comments explain *why* (the ancestor-not-descendant reasoning) rather than restating code. `render.js`'s `cwdGuard` block follows the existing `docsExecutor`/`specReadNote` pattern with no per-call-site parameterization, matching Decision 4. Absolute-path invocation of `assert-cwd.sh` is correct and self-consistent (the check cannot depend on the correctness it verifies). No dead code, no TODOs, no over-engineering.

**Blocking issue — CR #1: the mutation-scoped suite does not actually cover the ancestor case the AC demands, and a survivable mutant reintroduces the round-2 defect.**

`test/scripts/assert-cwd.test.sh:44-46` sets `ANCESTOR_DIR="$MAIN_REPO"` = `$SCRATCH/main-repo`, while `LANE2_WT` = `$SCRATCH/worktrees/bug/lane-two/CON-2`. `$SCRATCH/main-repo` is a **sibling** of the worktrees base, not an ancestor of `WORKTREE_PATH` by any path relation. So case 1a is path-relation-identical to case 1b (both "unrelated dir outside BASE"), and no case exercises the actual real-world normal-spawn shape (driver root *containing* `.concertino/worktrees`, i.e. a strict ancestor of `WORKTREE_PATH` that is itself outside BASE).

Demonstrated, not asserted. I ran a mutant that rejects an ambient which is a strict ancestor of `WT` and is outside `BASE`:

```
case "$AMB" in
  "$BASE"|"$BASE"/*) : ;;
  *) case "$WT" in "$AMB"/*) echo "FAIL cwd-mismatch: outside-BASE ancestor rejected"; exit 1 ;; esac ;;
esac
```

Result: the full suite stays **11 passed, 0 failed** — the mutant survives every case — yet the same mutant run against a real spawn (`ambient=/home/matt/Development/concertino`, this worktree, this branch) prints `FAIL cwd-mismatch` and exits 1. That mutant is exactly the round-2 REFUTE ("BLOCKERs every normal spawn"), and the suite as written cannot catch it. The AC's clause "a case using the actual value a correct spawn produces (an ancestor directory, not `WORKTREE_PATH` itself) demonstrated going green" is therefore not satisfied, and case 1a's own comment ("a real ancestor of `WORKTREE_PATH`") is false about its own fixture.

(For completeness: the `boundary: ambient==BASE` case does kill the cruder ancestor-rejecting mutant, but only because `BASE` is an ancestor *inside* the tolerated-BASE branch. It does not cover the outside-BASE ancestor, which is the shape every real spawn has.)

### Phase 3: UI Review — N/A

No UI-affecting files (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) changed; this change is role docs, one shell script, `render.js`, and tests.

### Overall: FAIL

### Change Requests

1. **`test/scripts/assert-cwd.test.sh:44-46` — make case 1a a genuine ancestor.** Restructure the fixture so the worktrees base lives *inside* the driver root, mirroring the real `.concertino/worktrees` layout: e.g. `BASE="$MAIN_REPO/.concertino/worktrees"` (with `ANCESTOR_DIR="$MAIN_REPO"` then being a true strict ancestor of `LANE2_WT` and itself outside `BASE`). Keep case 1b's different-repo ambient as-is so both relations stay covered. Then prove it: re-run the suite against the outside-BASE-ancestor mutant quoted in Phase 2 and show it goes **red**, and correct case 1a's comment so it describes the fixture it actually builds.
2. **Commit the pending `design.md` edit.** The three `14`→`16` call-site corrections are uncommitted working-tree changes; as committed, `design.md` contradicts both `tasks.md` and the implementation on the call-site count. Include them in the cycle-2 commit so the merged planning artifact reflects the delivered behavior.
3. **`core/roles/orchestrator.md` (~line 696, Cycles 2+ resume) — reconcile with the spec delta.** The spec requires `BRANCH` on spawn *or warm-resume*, and `tasks.md` 2.1 marks this done, but the resume instruction was not touched. A warm `SendMessage` resume legitimately inherits the original spawn's inputs, so the plain warm path is fine — but the documented **fallback** on that same page ("If `SendMessage` is unavailable, fall back to a fresh spawn whose prompt begins `RESUME — do not start over`") is a *cold* spawn that would carry no `BRANCH`, leaving the resumed role's mandated first action invoking `assert-cwd.sh` with an unbound `$BRANCH`. Either add `BRANCH` to that fallback-spawn instruction, or state explicitly in the resume text that warm resume inherits it — and correct `tasks.md` 2.1's claim either way.

### Non-blocking Suggestions

- `assert-cwd.sh` step 5 runs `git_child rev-parse` without guarding a non-repo `WT`; a `WORKTREE_PATH` that exists but is not a git worktree dies via `set -e` with git's raw stderr rather than a `FAIL <reason>` line. Not reachable through the orchestrated flow (the path is always a real worktree), but a one-line `|| { echo "FAIL not-a-git-worktree: $WT"; exit 1; }` would keep the failure vocabulary uniform.
- `workflow-state.md` is untracked in the worktree — expected run state, noted only so it is not mistaken for a stray artifact at Delivery.
