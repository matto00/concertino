## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `cd245f8`. Gates re-run independently by the evaluator
(`npm test` full suite, `test/scripts/squash-branch.test.sh`,
`test/scripts/rendered-scripts-drift.test.sh`) — all green — plus four
independent experiments described below. `concertino sync` was NOT run;
`scripts/concertino/pricing-table.json` and `scripts/concertino/report-cost.sh`
were not touched (neither appears in the diff).

### Phase 1: Spec Review — FAIL

- AC1 (never strands on any failure path) — **PASS for the paths that were
  implemented**, but see AC6/CR1: on the restore-failure sub-path the branch IS
  left at merge-base *and* the step claims otherwise.
- AC2 (`commit-tree` vs record-and-restore decided from evidence) — PASS.
  design.md D1 decides against the ticket's stated preference, argues it from a
  measured fact (concertino has no hooks; helio's `.husky/pre-commit` runs ~20
  gates), and the hook-behaviour non-change is enforced by a test fixture whose
  hook must actually fire (verified: the `.hook-ran-marker` assertion is real).
- AC3 (rule on CON-164 D6) — PASS. design.md D4 rules explicitly, upholds both
  rejections, separates the exit-code divergence (kept) from the harm (fixed
  here), and closes rather than re-defers. Scenario 9 enforces it.
- AC4 (guard judgment unchanged) — PASS, verified mechanically: the first 305
  lines of `core/scripts/squash-branch.sh` are byte-identical to `main`, and the
  diff is two pure-addition hunks below the `DRY_RUN=1` early return. Every
  pre-existing refusal, diagnostic string and exit code above the mutation point
  is unchanged. (One new non-guard refusal was added — see Suggestion 2.)
- AC5 (`DRY_RUN=1` unchanged) — PASS; the early return is above every added
  construct, and Scenario 11 covers a fixture that would fail wet.
- AC7 (rendered copy byte-matches) — PASS; `diff core/scripts/squash-branch.sh
  scripts/concertino/squash-branch.sh` is empty and the drift gate is 18/18.
- AC6 (regression coverage, failability proven) — **FAIL**, see Phase 2 CR2.
- Tasks all marked done and matching the implementation, except task 3.9, whose
  stated premise ("no practical fixture") is false — see CR2.
- No scope creep: three files, all declared in `files-modified.md`.

### Phase 2: Code Review — FAIL

**The specific lead is CONFIRMED — it is a genuine violation, not a misreading.**

`core/scripts/squash-branch.sh:348-351`:

```sh
  echo "FAIL git commit failed after guard passed" >&2
  restore_pre_squash_head
  echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2
  exit 1
```

`set -e` is NOT in force (`core/scripts/squash-branch.sh:2` is `set -uo
pipefail`), `restore_pre_squash_head` is called in statement position, and its
`return 1` is discarded. The "Branch restored" line is therefore unconditional.

Reproduced empirically against the real, unmutated script (fixture: a
`pre-commit` hook that creates `$(git rev-parse --git-dir)/refs/heads/<branch>.lock`
and then exits 1, so the forward reset succeeds and the restoring reset cannot
lock the ref). Actual output:

```
FAIL git commit failed after guard passed
FAIL could not restore HEAD to 50aba05... (current HEAD: 0c48620...).
The branch may be left at an intermediate state. Recover manually via the reflog (git reflog).
Branch restored to pre-squash HEAD 50aba05...
FAIL could not restore HEAD to 50aba05... (current HEAD: 0c48620...).
The branch may be left at an intermediate state. Recover manually via the reflog (git reflog).
--- HEAD before=50aba05...  after=0c48620...  merge-base=0c48620...
```

HEAD is left at the merge-base — the exact stranding this change exists to
eliminate — and the step nevertheless reports "Branch restored to pre-squash
HEAD 50aba05...". That is precisely what the spec delta's scenario **"The
restore itself fails"** forbids: it requires the step to report the failure
"rather than reporting a restoration that did not happen". (The duplicated
diagnostic from the EXIT trap's second attempt is anticipated by design.md D2
and is not itself the defect; the false success line between them is.)

Everything else in the code review is clean:

- DRY / readable / modular: the restore is a single named helper with a
  comment explaining the `--soft` choice and the third-party-hook caveat. Good.
- No `--hard`, no `git checkout` anywhere — the "cannot destroy work while
  trying to protect it" property holds.
- Trap scoping is correct: installed immediately before the forward reset,
  disarmed immediately after a successful commit; Scenario 10 asserts no restore
  message on success and it passes.
- No dead code, no TODOs, no over-engineering.
- Behaviour-preserving above the mutation point (verified byte-identically).

**Independent verification of the three requested items (not a re-run of the
executor's own commands — the script was copied out of the worktree together
with its `lib/` siblings and mutated in the copy, and fixtures were built from
scratch by the evaluator):**

1. **Scenario 12's trap-firing test genuinely fails when the trap line is
   removed — CONFIRMED.** SIGTERM delivered while the script is parked inside a
   sleeping `pre-commit` hook (i.e. after the forward reset), synchronised on a
   marker file the hook writes rather than a timer:

   | script variant | result |
   | --- | --- |
   | pristine | rc=143, **restored** |
   | trap line deleted | rc=143, **STRANDED@merge-base** |
   | explicit restore deleted (trap kept) | rc=143, restored |

   A genuine red/green pair. Also confirmed independently that bash *does* run
   an `EXIT` trap when killed by SIGTERM/SIGINT/SIGHUP, so the spec's
   signal scenario is really satisfied and not merely asserted.

2. **Scenario 8's failability arm genuinely reproduces stranding — CONFIRMED,
   with one caveat that does not invalidate it.** Same matrix, hook rejecting
   immediately, no kill:

   | script variant | result |
   | --- | --- |
   | pristine | rc=1, restored |
   | trap deleted only | rc=1, restored |
   | explicit restore deleted only | rc=1, restored |
   | **both deleted (what Scenario 8's arm does)** | rc=1, **STRANDED@merge-base** |

   Each arming mechanism individually masks the other, so the mutation is only
   failable when both are removed — which is exactly what the test's Python
   mutation does (it deletes the restore call *and* the `trap` line, with an
   explicit comment saying why). The arm is sound.

3. **Nothing above the mutation point changed — CONFIRMED.** First 305 lines
   byte-identical to `main`; the diff is additive only; the set of `FAIL`
   strings and `exit` codes above the mutation point is unchanged.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/**`, `schemas/**` or `openspec/specs/**` files
changed. Dev servers not started.

### Overall: FAIL

### Change Requests

1. **`core/scripts/squash-branch.sh:348-351` — do not report a restoration that
   did not happen.** Gate the confirmation on the helper's return value, e.g.:

   ```sh
   if ! git_wt commit -q -m "$SUBJECT" >/dev/null 2>&1; then
     echo "FAIL git commit failed after guard passed" >&2
     if restore_pre_squash_head; then
       echo "Branch restored to pre-squash HEAD ${PRE_SQUASH_HEAD}." >&2
     fi
     exit 1
   fi
   ```

   `restore_pre_squash_head` already prints its own two-SHA + reflog diagnostic
   on failure, so the `else` arm needs nothing added. Exit code stays 1 either
   way, as the spec requires. Then re-`cp` to
   `scripts/concertino/squash-branch.sh` (never `concertino sync`) and re-run the
   drift gate.

   Consider also whether the EXIT trap should be disarmed on this branch before
   `exit 1` (the second, duplicate restore attempt and its repeated diagnostic
   are anticipated by design.md D2, so this is optional — but if you keep the
   duplication, the D2 note should be updated to describe the post-fix output).

2. **`test/scripts/squash-branch.test.sh` (Task 3.9) — replace the
   inspection-only verification with a real fixture; its stated premise is
   false.** Task 3.9 claims inducing a `git reset --soft` failure "is genuinely
   awkward" and settles for three `grep`s against the script text. Those greps
   pass today *while the script emits a false restoration claim*, which is
   exactly the AC6 gap that let CR1 through. A practical fixture exists and takes
   about ten lines — the one used above:

   ```sh
   cat > "$branch_dir/.git/hooks/pre-commit" <<'HOOK'
   #!/bin/sh
   touch "$(git rev-parse --git-dir)/refs/heads/feature/eval/CON-170.lock"
   exit 1
   HOOK
   ```

   The forward reset succeeds, the commit fails, and the restoring reset cannot
   lock the ref. Assert: exit non-zero; the `FAIL could not restore HEAD to ...`
   diagnostic is present; **`Branch restored to pre-squash HEAD` is NOT present**;
   and add the failability arm (with CR1's fix reverted, the "not present"
   assertion goes red). Update task 3.9 and design.md D2/D5 to record that a
   fixture does exist.

### Non-blocking Suggestions

- **Scenario 12's `pgrep -f "sleep 20"` / `pkill -f "sleep 20"` are
  machine-global and unscoped** (`test/scripts/squash-branch.test.sh`, both the
  3.7 and 3.8 arms). Two concurrent runs of this suite — routine in this system —
  will satisfy each other's poll and `pkill` each other's hook, and any unrelated
  `sleep 20` on the box short-circuits the poll before the reset has happened,
  which would turn 3.7 green vacuously. Prefer a per-run token in the hook (a
  marker file, as the 3.1 fixture already does, or `sleep 20 # $$-token`) and
  reap by recorded PID. I hit this exact class of bug while building my own
  variant of this fixture: a `pkill -f "sleep 17"` matched the evaluating shell's
  own command line and killed it (exit 144).
- **The new `FAIL could not record pre-squash HEAD before resetting; refusing to
  proceed` branch (`core/scripts/squash-branch.sh:312-315`) is a new refusal
  that design.md does not call out against AC4.** It is practically unreachable
  (a merge-base was already computed, so HEAD is readable) and it is not a guard
  judgment, so it does not violate AC4 in substance — but D2 should state that
  explicitly rather than leaving a reader to work it out from the diff.
- design.md D2's note that a failed restore "may print [the diagnostic] a second
  time … That is harmless" is accurate but reads as though the failure path had
  been thought through end-to-end, which CR1 shows it had not. Worth tightening
  when CR1 lands.
