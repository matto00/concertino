## 1. Reorder the reset

- [x] 1.1 Replace the post-reset `git_wt diff --cached --name-only` with `git_wt diff --cached --name-only "$MERGE_BASE"` and delete the reset from its position above it; verify by `bash -n core/scripts/squash-branch.sh` and by confirming no `reset --soft` remains before the guard.
- [x] 1.2 Insert the reset block verbatim (same message, same exit code) immediately before the `git_wt commit` call; verify the success-path scenarios in `test/scripts/squash-branch.test.sh` still pass and the commit's parent is the merge-base.

## 2. Rewrite the two Scenario 2 assertions that encode the old ordering

Scenario 2 of `test/scripts/squash-branch.test.sh` asserts post-refusal state and goes red under task 1 — this is expected, and its correct post-fix form is fixed by design.md D5, not chosen under a red suite.

- [x] 2.1 Update the comment block at `test/scripts/squash-branch.test.sh:232-234`, which currently states the inverse of the new contract ("the guard trips AFTER the (already-performed) `reset --soft <merge-base>`, so HEAD is back at the merge-base"); verify the comment describes the new contract and no longer mentions HEAD returning to the merge-base.
- [x] 2.2 Rewrite the `:235-239` "no squash commit was created" assertion to compare `git rev-parse HEAD` (or the commit count) against a value **recorded before the run**, never against a literal — hardcoding `2` reintroduces the same fixture-shaped assertion in the other direction; verify the assertion passes and contains no hardcoded count.
- [x] 2.3 Rewrite the `:241-246` "the stray file remains staged" assertion as the work-is-not-lost check it actually is — the stray file is still present and reachable from HEAD (it is committed on the branch in this fixture, so the index is legitimately clean after the fix). Do NOT delete this assertion; deleting it removes exactly the coverage this ticket exists to create. Verify it passes and still fails if the file were unreachable.

## 3. Regression guard

- [x] 3.1 Add a scenario asserting HEAD is unchanged across a refused run — either as an extension of Scenario 2 or as a fresh fixture — against a branch carrying at least one of its own commits past the merge-base (otherwise the assertion is vacuous under the ordering mutation) and an undeclared path in the prospective staged set; assert non-zero exit, no new commit, and `git rev-parse HEAD` identical to a value recorded before the run. Verify it passes on the fixed script.
- [x] 3.2 Add the mutation proof: reintroduce the early reset in the real file at its old position, re-run the same fixture, assert the HEAD-unchanged check now fails, then restore from the suite's existing snapshot; verify the suite reports both the guard and its mutation as ok.
- [x] 3.3 Add the same HEAD-unchanged assertion to the missing/unparseable-declaration refusal path so both refusal exits are covered; verify by running the suite.

## 4. Verification

- [x] 4.1 Run `bash test/scripts/squash-branch.test.sh` and confirm zero failures. Task 2's rewrites are what make this hold — a green run before task 2 is complete is not expected and is not the target.
- [x] 4.2 Run `npm test` and confirm the full suite is green. The only test file changed is `test/scripts/squash-branch.test.sh`; no other script's behaviour changes.
- [x] 4.3 Confirm `scripts/concertino/squash-branch.sh` is unmodified (`git status --short` shows no entry for it), so the render target is untouched.
