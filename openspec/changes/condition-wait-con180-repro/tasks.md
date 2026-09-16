## 1. Reproduce the failure first (the red)

- [x] 1.1 On a pristine base-SHA checkout, measure the first-read margin with an instrumented
      mutant, unloaded and loaded, and verify the loaded distribution exceeds the 1.000s budget —
      verified by recorded margins (done in Planning: unloaded 0.943-0.947s; loaded bimodal with
      1.048/1.050s exceedances).
- [x] 1.2 Record the pre-fix failure rate of the `CON-180 repro: its reason describes the STALE
      content` assertion under a slow-runner emulation (`taskset -c 0` + spin loops) — verified by
      trial-by-trial output (done in Planning: 5/6 failed; 0/4 unpinned).

## 2. Implement the condition wait

- [x] 2.1 In the mutant-generating python substitution in `test/scripts/escalation-loop.test.sh`,
      add a guarded first-read marker write immediately after `reason=` is parsed and before the
      injected race window — verified by generating the mutant and grepping the marker line out of
      it, and by the block's existing `assert src.count(...) == 1` premises still holding.
- [x] 2.2 Export `CON180_FIRST_READ_MARKER` into the mutant's environment in the repro block, and
      replace the fixed `sleep 1` (line 278) with a bounded poll for that marker (10s at 0.05s)
      followed immediately by the `MALFORMED_B` write — verified by the repro block's three
      assertions passing.
- [x] 2.3 On marker-wait timeout, report a failed `check()` naming the missing first-read
      evidence rather than proceeding — verified by mutation task 4.2.
- [x] 2.4 Replace the obsolete "give its first poll tick a full second ... confirmed empirically"
      comment with one stating why a condition wait is required (the wait raced an equal-length
      poll period; measured margins) — verified by reading the diff.

## 3. Verify the fix removes the race

- [x] 3.1 Run `bash test/scripts/escalation-loop.test.sh` under the same slow-runner emulation
      that produced 5/6 failures, at least 10 trials — verified by the STALE assertion passing in
      every trial (not one clean run).
- [x] 3.2 Run the full `npm test` suite to completion with a 600000ms Bash timeout and confirm
      `escalation-loop.test.sh` reports `0 failed` — verified by the suite's own summary line, read
      from a complete log (a truncated log is not a pass).

## 4. Prove the assertion is still failable (mutation)

- [x] 4.1 Mutate the fix by defeating the wait (write `MALFORMED_B` immediately, so B wins the
      mutant's first read) and confirm the `CON-180 repro: its reason describes the STALE content`
      assertion goes RED — verified by observing the FAIL line; then revert the mutation.
- [x] 4.2 Mutate by preventing the marker from ever being written and confirm the new bounded-wait
      check goes RED naming the missing evidence, and that the suite does not report the
      reproduction as passing — verified by observing the FAIL line; then revert the mutation.
- [x] 4.3 Confirm the un-instrumented mutant is unchanged: with `CON180_FIRST_READ_MARKER` unset,
      the generated mutant STILL CONTAINS the guarded marker-write line (correcting the original,
      wrong wording of this task — the line is present but inert), and the guard does not fire and
      writes no file when the var is unset — verified by grepping the generated mutant for the
      guarded line and by exercising the guard with the var unset.

## 5. Deliver

- [x] 5.1 Confirm no file outside `test/scripts/escalation-loop.test.sh` and the change's own
      openspec artifacts is modified — verified by `git diff --stat` against the live review base.
- [ ] 5.2 Archive with `openspec archive condition-wait-con180-repro --yes --skip-specs` (this
      change carries no spec delta; see design.md Decision 5) — verified by the archive completing
      and `openspec/specs/` showing no new or modified capability.
