# Tasks — squash-branch.sh dry-run mode (CON-164)

## 1. Implement `DRY_RUN=1` in the source of truth

- [x] 1.1 In `core/scripts/squash-branch.sh`, normalize the environment variable into a `DRY_RUN_MODE` 0/1 integer near the existing `ALLOW_EMPTY_DECLARATION` normalization, using the exact-match form `[ "${DRY_RUN:-0}" = "1" ]` (D1). The `:-0` default is mandatory under `set -u`.
- [x] 1.2 Insert exactly one dry-run branch point (D2): after the final guard refusal block and immediately before `git reset --soft "$MERGE_BASE"`. On `DRY_RUN_MODE` = 1, print the marker line `READY dry run: guard passed, nothing committed (DRY_RUN=1)` and `exit 0` (D3).
- [x] 1.3 Do not add any other `DRY_RUN` conditional anywhere in the file. In particular, do not guard the `reset` and `commit` calls individually, and do not touch any refusal path — exit-code and diagnostic identity on refusals must remain structural, not maintained by parallel code.
- [x] 1.4 Extend the script's usage/header comment block to document `DRY_RUN=1` as an environment variable, stating that it runs every validation, returns the same exit code, and performs no reset, commit, or branch mutation (D5).
- [x] 1.5 Leave `scripts/concertino/squash-branch.sh` (the render target) untouched (D5, CON-172).

## 2. Prove the no-mutation property on the passing path

- [x] 2.1 In `test/scripts/squash-branch.test.sh`, add a scenario building a fixture branch whose guard **would pass** (declared `own-file.txt` plus a consistent staged `files-modified.md`, mirroring the existing 4.5 fixture). Use `mktemp -d`; never operate on this repo.
- [x] 2.2 Capture `git rev-parse HEAD`, `git write-tree`, `git status --porcelain`, and the branch commit count before invoking the script with `DRY_RUN=1`.
- [x] 2.3 Assert after the invocation: exit code 0; HEAD identical; `write-tree` hash identical; `status --porcelain` identical; commit count identical; output contains the dry-run marker and does NOT contain `squash commit created` (D4).
- [x] 2.4 Add a refusal-path identity scenario: run one refusing fixture twice — once with `DRY_RUN=1`, once without — and assert both produce the same non-zero exit code and the same refusal diagnostic, rather than hardcoding an expected string.
- [x] 2.5 Add the exact-match assertion: `DRY_RUN=true` must take the wet path and commit, proving no looser truthiness test was adopted (D1). Build this its own fresh fixture — do NOT reuse the 2.1 fixture, because this assertion commits and would otherwise make the earlier no-mutation assertions order-dependent.
- [x] 2.6 Do not cite 2.4 as evidence that dry-run mode exists: it passes vacuously against a script that ignores `DRY_RUN` entirely, since an unknown environment variable changes nothing. 2.3 is the load-bearing assertion; 2.4 only guards against a future implementation that diverges the refusal paths.

## 3. Prove the test is failable

- [x] 3.1 Add a mutation scenario (D4a) reusing the file's existing snapshot-and-trap machinery: snapshot the script, delete the dry-run early return in place, re-run the passing fixture with `DRY_RUN=1`, and assert HEAD **moved** — i.e. the guard in 2.3 goes red against an implementation that accepts the flag but commits anyway.
- [x] 3.1a Anchor that mutation on the marker string `READY dry run:` together with its `exit 0`, and **assert the mutation actually changed the file** before running the mutated script. A sed matching nothing would leave a wet-path-only script whose HEAD legitimately moves, making the failability proof pass for the wrong reason.
- [x] 3.2 Restore the script from the snapshot within the scenario, and confirm the existing `EXIT` trap still covers an interrupted run. Do not introduce a second restoration mechanism.
- [x] 3.3 Record the mutation transcript (mutated-run output showing HEAD moved, restored-run output showing HEAD unchanged) as evidence in the change directory.

## 4. Verify nothing else moved

- [x] 4.1 Run `bash test/scripts/squash-branch.test.sh` and confirm every pre-existing assertion still passes alongside the new ones.
- [x] 4.2 Run the full `npm test` chain and confirm it is green.
- [x] 4.3 Confirm by diff review that no refusal condition, allowlist rule, or declaration-parsing rule changed, and that `scripts/concertino/squash-branch.sh` is not in the diff.
- [x] 4.3b Grep the orchestrator's Delivery step and any other caller for `READY` prefix matching. If a caller matches `^READY` alone rather than the specific `READY squash commit created` wording, a dry run would be misread as a completed squash; report that rather than silently changing the marker.
- [x] 4.3a Do NOT "fix" the empty-prospective-staged-set divergence described in design.md D6 while implementing. Specifically: do not add `--allow-empty` to the `git commit` call, and do not add a new emptiness refusal above the guard. Both are unrequested wet-path behaviour changes, and the second would change the guard's judgment, which this ticket forbids. That case belongs to CON-170.
- [x] 4.4 Write `files-modified.md` in the change directory declaring every touched path outside the change dir.
