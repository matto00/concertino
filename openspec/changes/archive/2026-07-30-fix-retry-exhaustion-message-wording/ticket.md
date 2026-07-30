# CON-33: Phase 4 retry-exhaustion message claims main "remains behind" when the retry couldn't fetch

## Description

Cosmetic follow-up from CON-25 evaluation — wording only, no behavioural defect.

When Phase 4's fast-forward escalates, the human answers `retry`, and the retry also fails, `cleanup.sh` writes a stderr message stating that local `main` remains behind its remote before skipping and letting cleanup finish.

That is accurate in the common case (the tree was still dirty, or the base still diverged). It is not accurate in the sub-case where the *retry's own fetch* failed — offline, remote unreachable, auth expired. There the script does not actually know the relationship between local and remote; it knows only that it could not find out. Reporting a confident "behind" for an unknown state points the reader at the wrong problem: they go looking at their working tree when the real issue is the network.

## Acceptance Criteria

- Retry exhaustion after a failed fetch reports that the base state could not be determined, and why.
- Retry exhaustion after a confirmed still-behind check keeps the current wording.
- Neither path changes the exit status or the skip-and-continue behaviour — cleanup still completes.
- Covered in `test/scripts/cleanup.test.sh`.
