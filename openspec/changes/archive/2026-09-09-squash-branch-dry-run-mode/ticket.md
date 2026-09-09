# CON-164: squash-branch.sh has no dry-run mode, so "check whether the guard passes" always commits on success

## Description

`squash-branch.sh` has no way to ask *"would this pass?"* without also performing the squash. Invoking it to check always commits when the check succeeds.

That makes a reasonable instruction impossible to follow. An orchestrator asked an executor to "verify the guard passes, then hand back" — there is no invocation that does the first half without the second. The executor either commits (exceeding its instruction) or does not run the check (not following it).

### Why it matters beyond convenience

The gate exists to be consulted. A gate that can only be consulted by submitting to it pushes callers toward two bad habits: running it prematurely to find out where they stand, or reasoning about what it *would* say instead of asking. Both are worse than a flag.

It also compounds CON-163. NOTE (premise validation, 2026-09-09): this specific compounding rationale is now STALE — CON-163 shipped at fc88cd0 and moved all validation ahead of the reset, so at the current base (2101a78) a refusal already mutates nothing. The requested fix is unaffected; only the stated motivation is weaker than the ticket text implies.

### Fix

Add `DRY_RUN=1` (matching `cut-release.sh`'s existing convention in the consuming repo — verified at helio `scripts/release/cut-release.sh:81`, `if [ "${DRY_RUN:-0}" = "1" ]`, so there is one spelling across the suite): run every validation, print the same PASS/refusal output, exit with the same code, and perform no reset, no commit, no branch mutation.

Guard it by mutation: capture `git rev-parse HEAD` and the index state before and after a dry-run invocation on a branch that *would* pass, and assert both are unchanged. Asserting only on the refusal path would miss the case this ticket is actually about — a dry run on a **passing** branch is exactly where an unguarded implementation would still commit.

### Context

Raised together with CON-163 (destructive reset before validation) from the same run. Both are about the gate's *interaction contract* rather than its judgment.

**The guard's judgment is correct and must not be weakened.** Every refusal on this batch was right, including two that caught real problems: unparseable manifest declarations, and genuine `npm install` lockfile drift in a CSS-only ticket.

Found on helio HEL-451, 2026-09-08.

## Acceptance Criteria

1. `DRY_RUN=1` is honoured by `core/scripts/squash-branch.sh` as an environment variable, using the same `${DRY_RUN:-0}` = `1` spelling as helio's `scripts/release/cut-release.sh`.
2. Under `DRY_RUN=1`, every validation the normal path runs is still run: merge-base computation and criss-cross refusal, base-advancement logging, staged-file-set computation, the CON-162 staged-blob/on-disk/divergence checks, declaration parsing, and the allowlist comparison.
3. Under `DRY_RUN=1`, the exit code is identical to what the same invocation would have produced without the flag, on both the passing and every refusing path.
4. Under `DRY_RUN=1`, the diagnostic output is the same as the non-dry-run path, distinguished only by an explicit, unambiguous indication that this was a dry run and nothing was committed.
5. Under `DRY_RUN=1`, no branch mutation occurs: no `git reset`, no `git commit`, no change to `HEAD`, and no change to the index.
6. The no-mutation property is proven by mutation-guarded evidence on a branch that **would pass**: `git rev-parse HEAD` and the index state (e.g. `git status --porcelain` plus a staged-tree hash such as `git write-tree`) are captured before and after, and asserted unchanged. A test that only exercises the refusal path does not satisfy this criterion.
7. The evidence must demonstrate the test is failable — an implementation that ignored `DRY_RUN` and committed anyway must make the test red.
8. The guard's judgment is not weakened in any way: no refusal that fires today stops firing, and the allowlist/declaration semantics are unchanged.
9. The fix lands in `core/scripts/squash-branch.sh` (the source of truth). Any rendered copy under `scripts/concertino/` is a render target — see CON-172; do not hand-edit it as the fix.

## Constraints from premise validation

- Base is `origin/main` = `2101a78`, which already contains CON-163 (validate-before-reset) and CON-162 (staged-blob declaration read + index/worktree divergence refusal). Both mechanisms must survive intact.
- `core/scripts/squash-branch.sh` is copied verbatim by the renderer with no variable substitution — no build-time templating is available in this file.
