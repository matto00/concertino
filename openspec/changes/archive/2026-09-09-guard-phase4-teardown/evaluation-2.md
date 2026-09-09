## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: e51cf99 (on top of 466f5a6), `bug/phase4-teardown-races-auditor/con-171`.
Phase 3 (UI): **N/A** — shell/prompt change, no UI surface.

### Phase 1: Spec Review — PASS

Cycle 1's Phase 1 findings stand. The delta re-checked here:
- `design.md` Decision 3 and `tasks.md` 2.5 now state the wall-clock-deadline mechanics and the batched `readlink`, so the artifacts describe what was actually implemented (AC 2's "bounded" is now true in wall-clock terms, not just in sleep-sum terms).
- No scope creep in the delta: `core/scripts/cleanup.sh` + its render, the test file, and the two artifact paragraphs. `evaluation-1.md` is committed alongside, which is normal evidence retention.

### Phase 2: Code Review — PASS

**Gates re-run fresh by me in the worktree** (`CLEAN_WORKTREE` unset):
- `npm test` (full chain) → **exit 0**, zero `not ok`/`FAIL` lines, no suite reporting a non-zero failure count.
- `test/scripts/rendered-scripts-drift.test.sh` → **18 passed, 0 failed**.
- `test/scripts/phase4-teardown-guard.test.sh` → **58 passed, 0 failed**.
- Working tree clean at HEAD before and after all probing (every mutation reverted).

**1. CR-1 — FIXED, re-measured by me.** Same harness that produced cycle 1's numbers (persisting holder, end-to-end `cleanup.sh --phase4` timing):

| condition | cycle 1 (466f5a6) | cycle 2 (e51cf99) |
|---|---|---|
| idle | 9.51 s | **3.79 / 3.78 s** |
| under `nproc` busy loops | 10.93 s | **4.69 / 4.62 s** |
| no holder (single probe) | 0.53 s | (unchanged, immediate break) |

The loop now captures `SETTLE_DEADLINE_MS=$(( $(now_ms) + SETTLE_BOUND_MS ))` once and compares `now_ms()` against it after each probe, so probe cost is inside the bound. Wall time is now the 3 s bound plus ordinary script overhead, and — importantly — no longer grows with the machine's pid count the way the sum-of-sleeps version did. `now_ms()`'s non-GNU-`date` fallback to `node` is a correct defensive addition: without it, a BSD `date` returning a literal `N` would make the arithmetic hard-abort the whole script under `set -e`.

**2. CR-2 — FIXED, re-run by me under the exact original reproduction.** With `nproc` busy loops saturating the machine, the full suite ran **4/4 clean at 58 passed, 0 failed** (cycle 1: 4/4 failing on 15.1). The two changes are both real: holder lifetime raised to 30 s (matching 12.1/17.1, neither of which ever flaked), and `wait_holder_ready()` replaces the fixed `sleep 0.2` with a bounded poll on the holder's own `/proc/<pid>/cwd` — polling the actual signal rather than guessing at scheduling latency, with a `bad` assertion (15.0) if it times out, so a warm-up failure surfaces as a test failure instead of silently weakening 15.1.

**3. Assertion 15.2 is a real guard, not a passing decoration — verified by mutation.** I reverted *only* the deadline logic back to summing `sleep` durations, keeping the batched `readlink` speedup in place (the strictest form of the question: does 15.2 still bite when the other half of the fix is left intact?):
- measured wall time jumped straight back to **10.10 s idle**;
- the suite went **57 passed, 1 failed** with exactly `FAIL 15.2 the refusal path completes within a small multiple of the bound`.

So 15.2 fails on a pure CR-1 regression even on an idle machine and even with batching retained. Its 10 000 ms threshold is loose relative to the ~3.8 s actual, but it is not so loose that it stops discriminating — which is what mattered.

**4. Batching did not weaken detection — verified three ways.**
- Sibling/ancestors-only: 17.1 and 17.2 (sibling holder detected and named) pass, and deleting the probe block still turns them red — see the re-run mutation below — so they remain load-bearing over the new implementation. 16.1 (cwd inside the worktree does not self-refuse) still passes, so the exclusion is still ancestors-only rather than widened.
- Pid-vanishing tolerance under `set -e`: I ran the refusal path against ~4 000 short-lived processes churning concurrently with the scan. Result: `rc=1`, the real holder still named in the refusal, and **no** shell errors (`unbound`/`syntax`/`line N:`) in stderr.
- The alignment-safety fallback is **live code, not a dead branch**: I instrumented the per-pid fallback with a marker and re-ran the churn test — it was taken **5 times** in one run, and the holder was still detected on that path. The line-count mismatch check is therefore both reachable and correct in practice, which is what makes the batched `readlink` safe.

**Cycle-1 mutation evidence re-performed against the new implementation** (the probe changed, so the old result no longer transfers): deleting the Signal B probe block → **52 passed, 6 failed** (12.1, 12.2, 12.3, 15.1, 17.1, 17.2). Deleting the lease check on top of that → **21 red**. Both guards remain covered.

**5. Constraints re-confirmed.** `git diff --name-only main...HEAD` shows exactly four paths under `scripts/concertino/` (`check-merge-readiness.sh`, `cleanup.sh`, `emit-event.sh`, `lib/auditor-lease.sh`) and **zero** hits for `pricing-table.json` or `report-cost.sh` — neither modified, created, nor staged. All four renders `cmp`-byte-match their `core/scripts/` originals, and the drift gate is green, so the render was a direct copy and no `concertino sync` was run.

**Issues:** none blocking.

### Phase 3: UI Review — N/A

### Overall: PASS

### Non-blocking Suggestions
- (carried from cycle 1) Test 9.5/9.6 asserts the fail-closed refusal but does not exercise `cleanup.sh`'s own `lease_resolve_root` failure branch — `REPO_ROOT` resolution fails first, and 9.5 passed unchanged with the whole lease block deleted. The branch is near-unreachable in practice; a `git` stub failing only `rev-parse --git-common-dir` would make the assertion real if it is ever worth doing.
- The batched `readlink` alignment check compares line counts, so a pid vanishing mid-batch *and* another candidate's cwd containing a literal newline could in principle cancel out and yield a silently misaligned pid attribution. This is remote enough not to be worth code today; if it is ever tightened, `readlink -z` plus NUL-delimited reading removes the class outright.
- 15.2's 10 000 ms threshold is ~2.6× the observed worst case (4.69 s under saturation). Proven failable, so this is only a note: tightening it toward ~7 000 ms would catch a partial regression earlier without risking CI flake.
