## Why

CON-163 established the contract that a refused squash leaves the branch exactly as it found it, and moved `git reset --soft "$MERGE_BASE"` to after the guard. One window survives by construction: the reset immediately precedes `git commit`, so a commit that fails for any reason — a consumer repo's `pre-commit` hook rejecting, a signing failure, a full disk, an empty staged set — exits the script with the branch already sitting at merge-base and everything staged. That is precisely the "looks like an empty branch" state CON-163 exists to eliminate, reached through a different door, and it is the state that costs a human a reflog excavation to recognise and undo.

Both CON-163 final-gate skeptic rounds flagged this and it was correctly scoped out there. It is now this change's obligation. CON-164 additionally deferred one concrete instance of it — the empty-prospective-staged-set case — into this ticket by name (`design.md` D6), so leaving it unaddressed here would be the second deferral of the same defect.

## What Changes

- `core/scripts/squash-branch.sh` records the pre-reset HEAD and restores it, together with the index, whenever the post-guard `git commit` fails — so no failure path anywhere in the script can leave the branch at merge-base. The script still exits non-zero, and its diagnostic now states both what failed and that the branch was restored.
- The restore is also armed against abnormal termination (signal, harness kill) between the reset and the commit, so an interrupted squash is not a stranded branch either.
- The `git commit-tree` direction the ticket prefers is **rejected**, with the reasoning recorded in `design.md`: it bypasses the commit-hook chain that consumer repos rely on. This is a deliberate, argued departure from the ticket's stated preference, not an oversight.
- CON-164 `design.md` D6 is ruled on explicitly rather than deferred again: the *harm* it describes (a stranded branch after an empty-staged-set commit failure) is fixed here as a direct consequence of the restore, while the dry/wet exit-code divergence itself is upheld as correct and closed out rather than re-deferred to an unnamed owner.
- Regression coverage in `test/scripts/squash-branch.test.sh` for the commit-failure path, with the no-strand assertion proven failable by in-place mutation per the repo's existing `PRISTINE_SCRIPT` snapshot-plus-trap convention.
- `scripts/concertino/squash-branch.sh` is re-rendered by direct `cp` from `core/` so the CON-172 drift gate stays green.

**No guard judgment changes.** Every refusal that fires today fires identically, with the same exit code and diagnostics. No new refusal is introduced. `DRY_RUN=1` continues to mutate nothing.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `delivery-squash-guard`: the existing "A refusal leaves the branch exactly as it found it" requirement is widened from *refusals* to *every non-success exit*, so a post-guard `git commit` failure — the one window that requirement's current wording leaves open — is covered. The `DRY_RUN` requirement's "a dry run does not predict failure of the reset or commit themselves" carve-out gains a companion guarantee: the wet path's own failure on that input is now non-destructive.

## Impact

- `core/scripts/squash-branch.sh` (source of truth) and its rendered copy `scripts/concertino/squash-branch.sh`.
- `test/scripts/squash-branch.test.sh`.
- No caller changes. The script's arguments, environment contract, exit codes on every currently-reachable path, and success output are all unchanged. Consumer repos see a strictly better failure mode and no behavioural change on success.
- **Explicitly out of scope:** running `concertino sync`. Two untracked files in the main checkout are pending an owner ruling (CON-173); the rendered copy is updated by direct `cp` instead.
