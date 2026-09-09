# CON-170: squash-branch.sh still leaves the branch at merge-base if the commit itself fails after the guard passes

## Description

CON-163 moved `git reset --soft "$MERGE_BASE"` to after the guard passes, so every guard refusal now leaves HEAD untouched. One window survives by design: the reset immediately precedes `git_wt commit`, so if the commit itself fails (hook rejection, disk, signing, an unexpected git error), the branch is already at merge-base with everything staged — exactly the "looks like an empty branch" state CON-163 exists to eliminate, reached through a different door.

This was flagged as a non-blocking note by both final-gate skeptic rounds on CON-163 and correctly scoped out there: CON-163's contract was "reset only after the guard has passed", and its spec delta's ADDED requirement is scoped to guard refusals and earlier preconditions.

The ticket names two directions but decides neither: (a) build the commit with `git commit-tree` against the merge-base and move the ref only on success, so no intermediate reset state exists at all; (b) record HEAD before the reset and restore it if the commit fails. The ticket calls the first "structurally stronger".

### Premise validation (performed at Setup, CON-136)

- The window is REAL and unchanged at `87f1a53`: reset immediately precedes commit, nothing between.
- The ticket's "Collision note" is STALE: CON-162 (`2101a78`), CON-163 (`fc88cd0`) and CON-164 (`d792b42`) have all merged. There is no live collision; this file is exclusively ours.
- The ticket's preference for `commit-tree` is NOT cost-free and must be re-argued from evidence rather than inherited. This repo has no commit hooks, but `core/scripts/squash-branch.sh` is *rendered into consumer repos*, and helio's `.husky/pre-commit` runs roughly twenty gates that this script's `git commit` executes today. `commit-tree` bypasses the hook chain entirely and silently. That is a gate-chain regression for consumers and it materially undercuts the "structurally stronger" claim.
- A drift gate is live (`test/scripts/rendered-scripts-drift.test.sh`, CON-172, 18/18 green at `87f1a53`) byte-comparing `core/scripts/**` against `scripts/concertino/**`. `scripts/concertino/squash-branch.sh` is currently byte-identical to its source and MUST be updated in this same delivery by direct `cp` (see constraints).

## Acceptance Criteria

1. `squash-branch.sh` never leaves the branch at merge-base on ANY failure path. Specifically, when `git commit` fails after the guard has passed, the branch ref and the index are both restored to exactly the state they held when the script was invoked, and the script still exits non-zero with a clear diagnostic.
2. The chosen direction (`commit-tree` vs. record-and-restore) is decided explicitly in `design.md` with the hook-execution consequence for consumer repos argued from evidence, not asserted. Whichever is chosen, the commit-hook behaviour that consumer repos rely on today must not silently change; if it does change, that must be a stated, justified decision rather than a side effect.
3. CON-164's `design.md` D6 deferral (the empty-prospective-staged-set case, where the guard passes, a dry run exits 0, and the wet path exits 1 because `git commit` has nothing to capture) is ruled on explicitly in this change's `design.md` — either addressed here, or its deferral restated with a named owner. It must not be left unaddressed a second time.
4. The guard's judgment is unchanged: every refusal that fires today still fires, with the same exit code and the same diagnostics. No new refusal is introduced except where AC3's ruling explicitly decides otherwise and argues for it.
5. `DRY_RUN=1` (CON-164) continues to perform no mutation whatsoever and to return the same exit code it returns today for every guard verdict.
6. Regression coverage exists for the new failure path, and the no-strand assertion is proven failable by mutation (per this repo's "demand the red" convention and the existing `PRISTINE_SCRIPT` snapshot-plus-trap machinery in `test/scripts/squash-branch.test.sh`) — not merely asserted green.
7. `scripts/concertino/squash-branch.sh` is updated to byte-match `core/scripts/squash-branch.sh` and `test/scripts/rendered-scripts-drift.test.sh` passes.

## Constraints

- Source of truth is `core/scripts/squash-branch.sh`. The rendered copy at `scripts/concertino/squash-branch.sh` must be updated by direct `cp` from the source.
- **Do NOT run `concertino sync` anywhere, for any reason.** Two untracked files in the main checkout (`scripts/concertino/pricing-table.json`, `scripts/concertino/report-cost.sh`) are pending an owner ruling under CON-173; a sync would render them into the tree and carry them onto `main` through this PR. Do not delete, move, commit, or render over them.
- Read the merged diffs of CON-162 (`2101a78`), CON-163 (`fc88cd0`) and CON-164 (`d792b42`) before designing. The file no longer looks the way this ticket describes it.
