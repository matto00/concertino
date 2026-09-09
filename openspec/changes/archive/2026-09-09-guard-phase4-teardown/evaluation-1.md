## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: 466f5a6 on `bug/phase4-teardown-races-auditor/con-171`.
Phase 3 (UI) is **N/A** — no `frontend/**` surface; this is a shell/prompt change to the harness.

### Phase 1: Spec Review — PASS

- AC1 (lease + live-process refusal): met. Acquire in `core/scripts/check-merge-readiness.sh:136-158`, release in `core/scripts/emit-event.sh:312-323`, query/refusal in `core/scripts/cleanup.sh` guard block. Both refusals route through the existing `fail()` (one `RESULT` line, worktree reported not removed, non-zero exit).
- AC2 (bounded, not instant) — **met only in the weak sense; see Phase 2 CR-1.** The lease refuses immediately and the probe does re-probe rather than refusing on first sight, but the "3 s bound" is not a wall-clock bound.
- AC3 (`--force-teardown`): met, parsed only after the `--phase4`/`CONCERTINO_PHASE4` opt-in, loud override reporting for both signals, mistyped-flag usage error. No env var reaches it (asserted at 21.1/21.2).
- AC4 (orchestrator entry condition): met — `core/roles/orchestrator.md:1049-1060` names the spawn call's return value as the only satisfying condition and explicitly excludes `gh pr view` polling / notifications / a `merged` timestamp; the Phase-4 preamble documents refusal-as-`BLOCKER` and the benign plain re-run recovery.
- AC5 (rendered copies by direct copy, drift gate green): met and independently verified — `cmp` byte-match for all four files; `test/scripts/rendered-scripts-drift.test.sh` 18/18.
- AC6 (mutation-verified coverage): met, re-performed independently (Phase 2).
- Tasks: all 32 items marked `[x]` and each corresponds to code I located in the diff. No scope creep: the only non-obvious addition (`package.json` wiring the new suite into `npm test`, `test/scripts/cleanup.test.sh` vendoring the new lib) is required for the change to be gated at all, and is disclosed in `files-modified.md`.

### Phase 2: Code Review — FAIL

**Gates re-run by me, fresh, in the worktree** (`CLEAN_WORKTREE` not set):
- `npm test` (full chain, 40 suites incl. `node --test`) → **exit 0**, zero `not ok`/`FAIL` lines.
- `test/scripts/rendered-scripts-drift.test.sh` → **18 passed, 0 failed** (CON-172 gate green).
- `test/scripts/phase4-teardown-guard.test.sh` → **57 passed, 0 failed**, 8 consecutive clean runs on an idle machine.

**Directed checks requested by the orchestrator:**

1. **Same canonicalised key on acquire and release — CONFIRMED.** Both paths go through `lease_path()` → `lease_canonicalize()` (`core/scripts/lib/auditor-lease.sh:80-90`), so `check-merge-readiness.sh` passing `$TICKET_ID` raw and `emit-event.sh` passing an already-uppercased `$TICKET` land on the identical path. The design-gate case-mismatch finding is closed. Verified behaviourally too (10.1–10.4: lowercase acquire, lowercase verdict, lease cleared, cleanup proceeds).
   **Root resolution — CONFIRMED.** `lease_resolve_root()` resolves via `git rev-parse --git-common-dir` and explicitly refuses a caller-supplied root; `cleanup.sh` calls `lease_resolve_root` with no argument and never passes its own `--show-toplevel` `REPO_ROOT`. Asserted from three cwds (9.1–9.4) including cwd inside the worktree.
   **Matched by recorded worktree path, not `T` — CONFIRMED.** `lease_find_by_worktree()` compares only the `worktree=` field; 11.1/11.2 exercise the non-ticket-shaped-branch case with `TICKET_ID` omitted.

2. **Fail-closed — CONFIRMED in code; the assertion for it is honest but vacuous.** `cleanup.sh` calls `fail "could not resolve run root …"` on an empty `LEASE_ROOT`. A malformed ticket id creates no lease at all: acquisition sits below both `looks_like_ticket` (`check-merge-readiness.sh:125-129`) and the worktree-dir check (`:131-134`). Test 9.5 asserts a refusal but, as its own comment states, the pre-existing `REPO_ROOT` resolution fails first, so the new branch never executes — confirmed empirically: 9.5 still passed under Mutation 1 with the whole lease block deleted. See non-blocking note 1.

3. **Self-exclusion is ancestors-only, not vacuous — CONFIRMED.** The exclusion set is built strictly from `$$` → `PPid` (field 4 of `/proc/<p>/stat`) → … → 1. The `$(...)`-subshell bug the executor reports is really fixed: `worktree_holders` is invoked with a plain `> "$HOLDERS_TMP"` redirection and read back with bash's non-forking `$(<file)` form at both call sites (guard loop and `--force-teardown` reporting). 17.1/17.2 prove a sibling holder sharing only the harness as a common ancestor is still detected and named, and Mutation 2 turns both red — so the assertion is load-bearing, not vacuous.

4. **Mutation evidence — RE-PERFORMED, both claims exactly confirmed.**
   - Deleting the Signal A lease block (`LEASE_ROOT=…` through the `fail "…auditor lease held…"`): **47 passed, 10 failed** — 8.1, 8.2, 8.3, 9.1, 9.2, 9.4, 11.1, 11.2, 21.1, 21.2.
   - Deleting the Signal B probe block (settle loop + holder refusal): **51 passed, 6 failed** — 12.1, 12.2, 12.3, 15.1, 17.1, 17.2.
   Working tree restored to 466f5a6 afterwards (only the pre-existing `workflow-state.md` modification remains).

5. **Flake — the executor's "non-reproducible" finding is wrong; I reproduced it deterministically. See CR-1/CR-2 below.**

6. **Constraints — CONFIRMED.** `git diff --name-only main...HEAD` contains no `scripts/concertino/pricing-table.json` and no `scripts/concertino/report-cost.sh` (zero hits), and neither is untracked-but-staged (`git status --porcelain` shows only the pre-existing `workflow-state.md` edit). No evidence of a `concertino sync` run: the diff touches exactly the four hand-copied renders and nothing else under `scripts/concertino/`. File modes are consistent with the existing pair (`core/scripts/lib/auditor-lease.sh` 100644 / render 100755, matching `git-child-env.sh`), and the drift gate's case 2.9 covers that combination.

**Code quality:** helper is small, single-purpose, documented against the design decision it implements; no duplication with `git-child-env.sh`; no dead code; no untyped/silent-failure paths — every best-effort failure prints a `note:` to stderr. `set -e` tolerance for vanishing pids is handled correctly (`|| continue` on `readlink`). Error handling on the release path is correctly "never fail the run".

**Issues:**

**CR-1 (blocking) — the settle window's "3 s bound" is not a wall-clock bound; measured 9.5 s on an idle machine.**
`core/scripts/cleanup.sh`, the Signal B loop: `SETTLE_ELAPSED_MS` is incremented by `SETTLE_INTERVAL_MS` only after each `sleep 0.25`, so it accounts for sleep time and **not** for the cost of the probe itself. `worktree_holders` is a pure-bash scan over every `/proc/<pid>` with a `readlink` fork per pid; on this machine (560 pids) one probe costs ~0.4–0.5 s, so 13 probes + 12 sleeps take ~9.5 s of wall time for a documented 3 s bound.

Measured, holder present, cleanup timed end-to-end:
- idle: `rc=1 elapsed=9.51`
- under `nproc` busy loops: `rc=0 elapsed=10.93`
- no holder (single probe, immediate break): `rc=0 elapsed=0.53`

This contradicts AC 2 and tasks 2.5 (“re-probe every 250 ms up to a 3 s bound … Never wait past the bound”) and design.md Decision 3. It matters beyond the test: on a machine with a few thousand pids the probe cost grows linearly and Phase-4 teardown blocks for tens of seconds with no upper bound, in exactly the loaded-machine conditions a fleet run produces.

Required change: make the bound a real deadline rather than a sum of sleeps — capture a start stamp once (e.g. `SETTLE_DEADLINE_MS=$(( $(date +%s%3N) + 3000 ))`) and break when `date +%s%3N` has passed it, checked both before sleeping and after the probe returns. Keep the existing "empty holder set → break immediately" behaviour. Please also add an assertion that a cleanup run with a persisting holder returns within a small multiple of the bound, so this cannot regress silently.

**CR-2 (blocking) — assertion 15.1 is genuinely timing-fragile and will flake in CI.**
`test/scripts/phase4-teardown-guard.test.sh:285-291` backgrounds `sleep 10` as the holder and expects the refusal. Given CR-1, the cleanup run itself takes ~9.5 s idle, so the holder outlives it by only ~0.5 s. Under CPU load I reproduced the failure **4 out of 4 runs** (`FAIL 15.1 a holder persisting past the 3s bound: refuses`; 56 passed, 1 failed each time) — the holder exits before the loop reaches its bound, the final probe is empty, and cleanup proceeds. This is not a mystery flake: it is CR-1 observed through the test. The executor's "5 clean reruns" were run idle, which is the wrong experiment for this failure mode.

Required change: fix CR-1 (which restores a ~7 s margin), and additionally harden the fixture — replace the fixed `sleep 0.2` warm-up with a bounded wait until `readlink /proc/$HOLDER_PID/cwd` is actually inside `$WT` before invoking cleanup, and give the holder a lifetime comfortably above the bound (e.g. `sleep 30`, as 12.1 and 17.1 already use — neither of those flaked under the same load). Re-run the suite under load (`for i in $(seq $(nproc)); do (while :; do :; done) & done`) as the acceptance evidence, not idle reruns.

### Phase 3: UI Review — N/A
No UI-affecting files changed (no `frontend/**`, no route/schema/spec surface).

### Overall: FAIL

### Change Requests
1. **CR-1** — `core/scripts/cleanup.sh` Signal B settle loop: make the 3 s bound a wall-clock deadline instead of a sum of `sleep` durations, so the probe's own cost is inside the bound. Measured today: 9.51 s idle, 10.93 s under load, for a documented 3 s bound — violating AC 2 / tasks 2.5. Add an assertion bounding the refusal path's wall time. Re-copy the render and keep the drift gate green.
2. **CR-2** — `test/scripts/phase4-teardown-guard.test.sh:285-291` (assertion 15.1): reproduced failing 4/4 under CPU load. After CR-1, raise the holder lifetime to match 12.1/17.1 and replace the `sleep 0.2` warm-up with a bounded poll on `/proc/$HOLDER_PID/cwd`. Provide under-load rerun evidence.

### Non-blocking Suggestions
- Test 9.5/9.6 ("an unresolvable root refuses") does not exercise the new fail-closed branch — it passed unchanged with the entire lease block deleted, because `cleanup.sh`'s pre-existing `REPO_ROOT` resolution fails first. The test comment says so honestly, and the new branch is near-unreachable in practice (`--show-toplevel` succeeding implies `--git-common-dir` succeeds), so this is defence-in-depth rather than a coverage hole. If you want it real, drive `lease_resolve_root` to failure directly (e.g. a `git` stub on `PATH` that fails only on `rev-parse --git-common-dir`).
- `worktree_holders` forks a `readlink` per pid. Reading `/proc/*/cwd` via a single loop is inherent, but replacing the per-pid `readlink` fork with bash's own `[ -L ]`+`ls -l`-free approach, or short-circuiting on `/proc/<pid>/cwd` `stat` inode comparison, would cut the dominant cost behind CR-1.
