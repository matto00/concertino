## 1. Ground the change in the merged reality of the file

- [x] 1.1 Read the merged diffs of CON-163 (`fc88cd0`), CON-162 (`2101a78`) and CON-164 (`d792b42`) before editing. The ticket describes a version of `core/scripts/squash-branch.sh` that predates two of them.
- [x] 1.2 Confirm by direct read that the forward reset still immediately precedes `git_wt commit`, and that the commit-failure branch exits without undoing it.
- [x] 1.3 Confirm the `DRY_RUN=1` early return sits above the forward reset and must stay above every construct added by this change.

## 2. Implement the restore in `core/scripts/squash-branch.sh`

- [x] 2.1 Immediately before `git_wt reset --soft "$MERGE_BASE"`, record `PRE_SQUASH_HEAD="$(git_wt rev-parse HEAD)"`. Fail loudly if it cannot be read — proceeding without a restore point would silently reintroduce the defect.
- [x] 2.2 Add a restore helper that performs `git_wt reset --soft "$PRE_SQUASH_HEAD"` and, on failure, prints a diagnostic naming `$PRE_SQUASH_HEAD`, the current HEAD, and the reflog as the recovery route (design.md D2).
- [x] 2.3 Install an `EXIT` trap invoking that helper immediately before the forward reset; disarm it immediately after the commit succeeds (D2). Scope it so it cannot fire on the success path or on any path above the mutation point.
- [x] 2.4 On the `git commit` failure branch, call the restore explicitly, keep the existing `FAIL git commit failed after guard passed` wording as the leading diagnostic, and add a line stating the branch was restored to `$PRE_SQUASH_HEAD`. Exit non-zero (D2 — a restored branch is not a successful squash).
- [x] 2.5 Leave the forward-reset failure branch's control flow as-is; verify the trap's restore is a harmless no-op there (D3).
- [x] 2.6 Use `--soft` exclusively. No `--hard`, no `git checkout`, nothing that can discard index or worktree content (D2).
- [x] 2.7 Do NOT adopt `git commit-tree` (D1). Do NOT add `--allow-empty`. Do NOT add an emptiness refusal (D4). Do not alter any guard, refusal, diagnostic or exit code above the mutation point.

## 3. Regression coverage in `test/scripts/squash-branch.test.sh`

- [x] 3.1 Add a fixture that installs a `pre-commit` hook exiting 1 in the fixture repo, on a branch whose guard passes (design.md D5). This fixture does double duty: it proves the restore works AND that hooks still run.
- [x] 3.2 Assert on that fixture: exit non-zero; `git rev-parse HEAD` identical before and after; `git write-tree` identical before and after; `git status --porcelain` identical before and after; no new commit on the branch; the output names both the commit failure and the restoration.
- [x] 3.3 **Failability (the red).** Mutate the real script in place to delete the restore, re-run 3.1's fixture, assert HEAD **is** at the merge-base — reproducing the exact stranding the ticket describes — then restore from `PRISTINE_SCRIPT`. Reuse the existing snapshot-plus-trap machinery; do not add a second restoration mechanism.
- [x] 3.4 Add a scenario for the empty-prospective-staged-set input (design.md D4 / CON-164 D6): guard passes, nothing staged, commit fails, branch restored, exit non-zero, no empty commit created. **Revised per skeptic-final-1.md CR1: the original fixture had no commits beyond origin/main, so merge-base == HEAD and the forward reset was a no-op — the "branch restored" assertion passed vacuously even with the fix fully reverted (confirmed by the skeptic's full-revert probe).** The fixture now uses two commits (add the declared file, then `git rm` it) so HEAD genuinely diverges from the merge-base while the prospective staged set is still empty; a fixture-premise assertion checks `HEAD != merge-base` before trusting anything downstream, and a dedicated mutation-failability arm (matching 3.3/3.8's shape) proves the restore is load-bearing on this specific input.
- [x] 3.5 Add a success-path scenario asserting the squash commit is created and no restore fired — guarding against a trap that misfires on success.
- [x] 3.6 Add a `DRY_RUN=1` scenario on a fixture whose wet run would fail at the commit: exit 0, HEAD unchanged, index unchanged, no commit, dry-run marker present.
- [x] 3.7 **Trap coverage (design.md D2) — the trap must be exercised firing, not merely asserted not to fire.** Give a fixture a `pre-commit` hook that `sleep`s rather than exiting, run the script in the background, `kill -TERM` it while it is parked inside the hook (i.e. after the forward reset, before the commit returns), and assert `git rev-parse HEAD` equals the pre-run commit rather than the merge-base. Task 3.5 only proves the trap does NOT fire on success; without this the spec scenario "The step is terminated between the reset and the commit" is unverified.
- [x] 3.8 **Failability arm for 3.7.** Using the same `PRISTINE_SCRIPT` snapshot machinery as 3.3, delete the `trap` installation line from the real script, re-run 3.7's fixture, assert HEAD **is** at the merge-base, then restore. Without this arm the trap assertion is green-by-construction.
- [x] 3.9 **Revised per evaluation-1.md CR2: the original "no practical fixture" premise was false.** A `pre-commit` hook that creates the branch's own ref lock file (`refs/heads/<branch>.lock`) before exiting 1 makes the restoring `git reset --soft` fail too (it cannot acquire the same lock), so "the restore itself fails" is directly reproducible. Scenario 13 asserts: exit non-zero; the restore-failure diagnostic (both SHAs, reflog) is present; `Branch restored to pre-squash HEAD` is **absent** (this is CR1's exact bug — the step must not claim a restoration that did not happen); HEAD is genuinely at the merge-base. A failability arm reverts CR1's gate (`if restore_pre_squash_head; then ...`) back to the unconditional form and asserts the false claim reappears.
- [x] 3.10 Verify the pre-existing scenarios (1, 2, 2d, 3, 4, 5, 6, 7) all still pass unchanged — the guard's judgment must be provably untouched.

## 4. Re-render and verify the gates

- [x] 4.1 Update `scripts/concertino/squash-branch.sh` by direct `cp` from `core/scripts/squash-branch.sh` (design.md D6).
- [x] 4.2 **Do not run `concertino sync`, anywhere, for any reason.** Two untracked files in the main checkout are pending an owner ruling (CON-173) and a sync would carry them onto `main` through this PR.
- [x] 4.3 Run `test/scripts/rendered-scripts-drift.test.sh` and confirm it is green (it was 18/18 at `87f1a53`).
- [x] 4.4 Run `test/scripts/squash-branch.test.sh` in full and confirm every pre-existing and new scenario passes.
- [x] 4.5 Run the repo's full test suite and confirm no unrelated regression.
- [x] 4.6 Write `files-modified.md` declaring `core/scripts/squash-branch.sh`, `scripts/concertino/squash-branch.sh` and `test/scripts/squash-branch.test.sh`.
