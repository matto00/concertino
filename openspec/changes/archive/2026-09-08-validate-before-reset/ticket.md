# CON-163: squash-branch.sh resets the branch to merge-base BEFORE validating, so a refusal leaves the run looking like an empty branch

## Description

`core/scripts/squash-branch.sh:118` runs `git reset --soft "$MERGE_BASE"` unconditionally. Validation happens afterward, at line 124+, and then refuses.

So on any refusal the branch is left at merge-base with everything staged and its own commits off HEAD — reachable only through the reflog. The work is not lost, but it does not look like work that exists.

Hit four times in one day across two helio tickets (HEL-732 and HEL-451). Cost nothing only because the caller happened to check the reflog rather than trusting appearances.

The danger is not the reset itself; it is that a refusal produces a state whose obvious interpretation is wrong. A 15-commit ticket in that state is indistinguishable from an empty branch, and the natural reaction — `git reset --hard`, `git checkout .`, delete the branch and start over — destroys the run permanently.

The fix is to reorder: validate first, reset only once validation passes. The reset is not needed to compute what validation inspects.

## Acceptance Criteria

- `core/scripts/squash-branch.sh` computes the prospective staged file set without moving HEAD, runs the full existing guard against it, and performs `git reset --soft "$MERGE_BASE"` only after the guard has passed.
- On every refusal path, `git rev-parse HEAD` is identical before and after the script runs, and the branch's own commits remain reachable from HEAD.
- The guard's accept/reject decision is unchanged: no path that was previously refused is now accepted, and no path previously accepted is now refused. The set the guard inspects is exactly the set it inspected before.
- On the success path, the resulting squash commit is byte-identical in tree and parent to what the previous ordering produced.
- A regression guard exists that runs the real script against a branch the guard will refuse and asserts HEAD is unchanged, and that guard is proven mutation-failable by reintroducing the early reset and observing it go red.

## Out of scope

- CON-162 (the script validates the working tree but commits the index) — do not touch.
- CON-164 (dry-run mode) — do not touch.
- Any relaxation of what the guard rejects. Every field refusal was correct.
