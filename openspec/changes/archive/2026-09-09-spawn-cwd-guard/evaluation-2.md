## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `dcd4ddc` (on top of `aa9d511`) on `bug/spawn-cwd-guard/CON-174`. Diffed `aa9d511..dcd4ddc` and re-verified cycle-1's three change requests against the tree, not against the executor's summary.

### Phase 1: Spec Review — PASS

- **CR #2 (design.md 14→16) — verified fixed.** `grep -c '14 call sites'` → 0, `'16 call sites'` → 3. `git status --porcelain` now shows only the expected untracked `workflow-state.md`; no pending artifact edits.
- **CR #3 (BRANCH on the cold resume fallback) — verified fixed, and it covers the path I flagged.** `lib/cli/render.js`'s `harnessResume` (claude-code arm) now states the fallback spawn is cold, inherits nothing, and must be passed `WORKTREE_PATH`/`CHANGE_NAME`/`TICKET_ID`/`BRANCH`, naming the reason (the mandated `assert-cwd.sh` first action needs `$BRANCH` bound). `core/roles/orchestrator.md`'s Cycles-2+ section separately states the warm `SendMessage` path carries them forward implicitly and points at the fallback. That is the exact hazard I raised — the warm path never needed re-passing; the cold fallback did.
- **`tasks.md` 2.1 no longer overclaims** — it now describes what was actually done and records the correction with its source (`evaluation-1.md` CR #3), rather than asserting a resume-line edit that never happened.
- Call sites re-grepped again this cycle: executor 1 / evaluator 6 / skeptic 6 / auditor 3 = **16**, unchanged and all still ambient-cwd-immune.
- Drift gate: `diff core/scripts/assert-cwd.sh scripts/concertino/assert-cwd.sh` empty — byte-identical.
- `openspec validate spawn-cwd-guard --type change` → valid. Spec delta unchanged and still matches the implemented behavior.
- Decision 1's contract remains intact after the cycle-2 edit to step 5 (see Phase 2) — no change to the collision-check semantics, and a live run against the real normal-spawn shape (`ambient=/home/matt/Development/concertino`) still returns `READY`.

### Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set): `npm test` → **exit 0**, full chain green, including `assert-cwd.test.sh` 11/11, `cwd-guard-render.test.sh` 14/14, and the pre-existing `rendered-scripts-drift.test.sh` / render suites. `openspec validate` valid.

**CR #1 (mutation-coverage hole) — verified fixed by re-running my own mutant, not by trusting the claim.** The fixture now nests `BASE="$MAIN_REPO/.concertino/worktrees"` inside the driver root, so `ANCESTOR_DIR="$MAIN_REPO"` is a genuine strict ancestor of `LANE2_WT` that is itself outside `BASE` — the real normal-spawn shape. Re-running the identical round-2-regression mutant from `evaluation-1.md` (reject an ambient outside `BASE` that is still an ancestor of `WT`) against the corrected suite:

- cycle 1: **11 passed, 0 failed** — mutant survived.
- cycle 2: **9 passed, 2 failed** — mutant killed at case 1a (`1a: ancestor ambient -> exit 0` and `1a: READY output`).

The suite now discriminates the exact defect round 2's REFUTE identified, and case 1a's comment accurately describes the fixture it builds. Cases 1b/2/3/4 and the `AMB == BASE` boundary are unchanged and still pass on the real script.

Non-blocking suggestion #1 was also taken up: step 5 now guards `git_child rev-parse` and emits `FAIL not-a-git-worktree: <WT>` instead of raw git stderr, keeping the failure vocabulary uniform. The change is a correct `if ! FOUND_BRANCH="$(...)"` capture with `2>/dev/null`, and does not alter the branch-mismatch path.

No new code-quality issues: no dead code, no untyped/unsafe escape hatches, no scope creep beyond the three change requests plus the accepted suggestion, and the diff is confined to the files `files-modified.md` lists.

### Phase 3: UI Review — N/A

No UI-affecting files changed (role docs, one shell script, `render.js`, tests, planning artifacts only).

### Overall: PASS

### Non-blocking Suggestions

- The new `FAIL not-a-git-worktree` branch has no test case of its own (`grep 'not-a-git-worktree' test/scripts/assert-cwd.test.sh` → no hits). It is three lines and low-risk, but it is currently the one failure path in `assert-cwd.sh` with no mutation coverage — a fifth case (point `WORKTREE_PATH` at a plain `mkdir`'d directory) would close that asymmetry cheaply. Not blocking: the behavior is unreachable through the orchestrated flow, where `WORKTREE_PATH` is always a real worktree.
- `core/roles/orchestrator.md:688` — the inserted sentence runs directly into the pre-existing `**The same rule applies to a resume as to a fresh spawn:` on the same line. Renders fine as markdown; a paragraph break would read better.
