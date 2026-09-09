## Why

`squash-branch.sh` resets the delivery branch to its merge-base before it validates anything, so every guard refusal leaves the branch at merge-base with the run's work staged and its commits reachable only through the reflog. That state's obvious interpretation — "an empty branch with a pile of files I didn't stage" — is wrong, and the natural cleanup response to it (`reset --hard`, `checkout .`, delete the branch) destroys the run permanently. It occurred four times in one day across two helio tickets.

## What Changes

- Compute the prospective staged file set with `git diff --cached --name-only "$MERGE_BASE"`, which compares the merge-base tree against the index without moving HEAD, and run the existing guard against that set.
- Move `git reset --soft "$MERGE_BASE"` to after the guard has passed, immediately before the commit.
- Leave every guard decision, diagnostic message, exit code, and the always-print-the-staged-list behaviour exactly as they are. This change is about ordering only.
- Add a regression guard to `test/scripts/squash-branch.test.sh` asserting HEAD is unchanged across a refused run, proven failable by reintroducing the early reset.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `delivery-squash-guard`: the guard is specified against a set computed without moving HEAD, and a refusal is now required to leave HEAD untouched.

## Impact

- `core/scripts/squash-branch.sh` — reordering of the reset relative to validation.
- `test/scripts/squash-branch.test.sh` — new refusal-preserves-HEAD scenario plus its mutation proof.
- No caller changes: the CLI surface, arguments, exit codes and output lines are unchanged. `scripts/concertino/squash-branch.sh` is a render target and is not hand-edited here.
