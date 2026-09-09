# Mutation-proof transcript (task 4.6)

All mutation probes below were run against the REAL `core/scripts/squash-branch.sh`
(never an inline reimplementation), following the suite's existing snapshot/restore
convention. Each probe mutates the real file in place, runs the relevant fixture(s),
captures the output, then restores the file from a snapshot taken of the fixed
script before mutating. `diff` against the snapshot confirmed a clean restore after
every probe; `git diff --stat` on the tracked file showed only the intended fix
diff (`60 insertions, 8 deletions`) once all probes were done.

## Probe 1 — full revert of the fix (covers 4.1, 4.2, 4.3, 4.3b, 4.4)

Mutation: `core/scripts/squash-branch.sh` replaced wholesale with the pre-fix
content (`git show HEAD:core/scripts/squash-branch.sh`, i.e. the script as it
stood before this change).

Ran the full suite (`bash test/scripts/squash-branch.test.sh`) against the
reverted script. Result: **28 passed, 11 failed** — every failure was one of the
CON-162 scenarios, and no pre-existing (CON-129/CON-151/CON-163) scenario
regressed:

```
Scenario 6: CON-162 -- guard validates the staged declaration blob, not the worktree copy
  FAIL 4.1 divergent worktree declaration is refused
       exit=0 output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 2
Staged files:
  openspec/changes/con-162-demo/files-modified.md
  own-file.txt
READY squash commit created on feature/con-162/CON-162-a
  FAIL 4.1 refusal names the index/worktree divergence
       output: INFO base origin/main has not advanced past the merge-base. ... READY squash commit created on feature/con-162/CON-162-a
  FAIL 4.1 no squash commit created; HEAD unchanged
       before=9a2cdf6f9dca2fb3a21ebc6d7394451a4fd1d940/2 after=b30dda17fbcf2afa7ecfec1731045c7bc32dc926/2
  FAIL 4.2 divergent worktree declaration cannot authorise an undeclared staged file
       exit=0 (bypass succeeded) output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 3
Staged files:
  openspec/changes/con-162-demo/files-modified.md
  own-file.txt
  sneaky.txt
READY squash commit created on feature/con-162/CON-162-b
  FAIL 4.2 HEAD unchanged (sneaky.txt not committed)
       before=9a2cdf6f9dca2fb3a21ebc6d7394451a4fd1d940 after=a707278f942d878150c9178b858e70ab0ac26df5
  FAIL 4.3 --allow-empty-declaration does not suppress the divergence refusal
       exit=0 output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 2
Staged files:
  openspec/changes/con-162-demo/files-modified.md
  own-file.txt
READY squash commit created on feature/con-162/CON-162-c
  FAIL 4.3b --allow-empty-declaration does not suppress the not-in-index refusal
       exit=0 output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 1
Staged files:
  own-file.txt
READY squash commit created on feature/con-162/CON-162-d
  FAIL 4.3b HEAD unchanged
       before=769039704c87a2f942a3c00f886de38b9bd07d4a after=7a55a6b9742f0b99393ec4993e6a8d769abd8d49
  FAIL 4.4 declaration on disk but not staged is refused
       exit=0 output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 1
Staged files:
  own-file.txt
READY squash commit created on feature/con-162/CON-162-e
  FAIL 4.4 refusal states the self-service remedy (git add ...)
       output: INFO base origin/main has not advanced past the merge-base. ... READY squash commit created on feature/con-162/CON-162-e
  ok   4.4b D4a still enforces the blob (undeclared staged file refused)
  ok   4.4b refusal names the undeclared file
  FAIL 4.4c D4a shape with a fully-declaring blob commits (divergence detector not reached)
       exit=1 output=INFO base origin/main has not advanced past the merge-base.
Staged file count: 2
Staged files:
  openspec/changes/con-162-demo/files-modified.md
  own-file.txt
FAIL no usable declaration in files-modified.md while staged files remain outside the allowlist (openspec/changes/con-162-demo/**).
(files-modified.md is missing at /tmp/tmp.IxxJiEIZio/branch-g/openspec/changes/con-162-demo/files-modified.md)
Staged paths outside the allowlist:
  own-file.txt
Pass --allow-empty-declaration to proceed anyway, or append the real paths to files-modified.md and re-run.
  ok   4.5 ordinary consistent-declaration run still commits

squash-branch.test.sh: 28 passed, 11 failed
```

**Conclusion:** 4.1, 4.2, 4.3, 4.3b, and 4.4 are genuinely mutation-failable by a
full revert — proven red above, all for the correct reason (the pre-fix script
reads the worktree copy, silently resolves the divergence toward it, and commits).

4.4c also went red under the full revert, but for a coincidental reason (the
pre-fix script has no D4a exemption at all — with the declaration missing from
disk it falls through to the generic "no usable declaration" branch and refuses,
which happens to satisfy 4.4c's "not exit 0" but that is not what 4.4c actually
pins; see Probe 3 below for the targeted ordering proof 4.4c requires).

**4.4b did NOT go red under the full revert** (`ok` in the transcript above). The
pre-fix script also refuses in that shape, but for a different, coincidental
reason: with `files-modified.md` absent from disk, `FILES_MODIFIED_PATH` doesn't
exist, `DECLARED_PATHS` is empty, and `sneaky.txt` is caught by the pre-fix
script's generic "no usable declaration while unexpected files remain" branch —
not because it parsed and enforced the staged blob (D4a doesn't exist pre-fix).
A full revert is therefore not a real mutation probe for 4.4b; a full revert
happens to be fail-closed here for the wrong invariant. See Probe 2.

## Probe 2 — targeted D4a-amnesty mutation (covers 4.4b)

Design's own risk statement for D4a: "the blob must still be parsed and
enforced, never treated as an empty declaration that waves the run through."
Mutation: after `DECLARED_COUNT` is computed from the real parse, force it back
to `0` and set `ALLOW_EMPTY_DECLARATION=1` whenever the D4a shape
(`FILE_ON_DISK=0`, `STAGED_BLOB_PRESENT=1`) is in play — i.e. simulate exactly
the amnesty D4a's rationale warns against, instead of a full revert (which does
not discriminate 4.4b, per Probe 1).

```diff
 DECLARED_COUNT=0
 if [ -n "$DECLARED_PATHS" ]; then
   DECLARED_COUNT="$(printf '%s\n' "$DECLARED_PATHS" | grep -c .)"
 fi
+if [ "$FILE_ON_DISK" -eq 0 ] && [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
+  DECLARED_COUNT=0
+  ALLOW_EMPTY_DECLARATION=1
+fi
```

Ran the 4.4b fixture (declaration committed + `own-file.txt`, then the
declaration deleted from the worktree without staging the deletion, then
`sneaky.txt` staged) against this mutated script:

```
=== running MUTATED script (D4a amnesty simulation, take 2) against 4.4b fixture ===
exit=0
INFO base origin/main has not advanced past the merge-base.
INFO files-modified.md declaration read from the index; no worktree copy is present.
Staged file count: 3
Staged files:
  openspec/changes/con-162-demo/files-modified.md
  own-file.txt
  sneaky.txt
READY squash commit created on feature/con-162/f
openspec/changes/con-162-demo/files-modified.md
own-file.txt
sneaky.txt
```

**Conclusion:** under the amnesty mutation, the guard commits `sneaky.txt` —
an undeclared file — exactly the blanket-amnesty failure mode 4.4b exists to
catch. 4.4b is genuinely mutation-failable. The script was restored from the
pre-mutation snapshot and `diff` confirmed byte-identical restoration.

## Probe 3 — ordering mutation (covers 4.4c, per skeptic-design-3's suggestion)

Mutation: move the D7 divergence detector (`git_wt diff --quiet -- ...`) to run
BEFORE the on-disk-presence (`FILE_ON_DISK`) branch, ungated:

```diff
+# ORDERING MUTATION (4.4c proof): divergence detector moved ahead of the
+# -f branch, ungated by FILE_ON_DISK.
+if [ "$STAGED_BLOB_PRESENT" -eq 1 ] && ! git_wt diff --quiet -- "$DECLARATION_INDEX_PATH"; then
+  echo "FAIL (ordering-mutated) ungated divergence detector fired" >&2
+  exit 1
+fi
+
 if [ "$FILE_ON_DISK" -eq 1 ] && [ "$STAGED_BLOB_PRESENT" -eq 0 ]; then
```

Ran the 4.4c fixture (declaration committed + `own-file.txt`, then the
declaration deleted from the worktree without staging the deletion, no other
staged files) against this ordering-mutated script:

```
=== running ORDERING-MUTATED script against 4.4c fixture (should go RED: refusal instead of commit) ===
exit=1
INFO base origin/main has not advanced past the merge-base.
FAIL (ordering-mutated) ungated divergence detector fired
```

**Conclusion:** 4.4c's required assertion (exit 0 / commit) goes red under the
ordering mutation — `git diff --quiet` reports a worktree deletion as an
unstaged change (exit 1), so an ungated detector wrongly refuses the exact
D4a shape 4.4c requires to proceed. This confirms 4.4c is sensitive to the
ordering the design mandates (on-disk-presence routes control first), not just
to a full revert. The script was restored from the pre-mutation snapshot and
`diff` confirmed byte-identical restoration.

## Final state

After all three probes, `core/scripts/squash-branch.sh` was restored to the
fixed version and the full suite was re-run clean:

```
squash-branch.test.sh: 39 passed, 0 failed
```

`git diff --stat core/scripts/squash-branch.sh` showed only the intended fix
(`68 lines changed: 60 insertions(+), 8 deletions(-)`) with no residual mutation
artifacts.

## Summary

| Scenario | Discriminating mutation                              | Result |
|----------|-------------------------------------------------------|--------|
| 4.1      | Full revert                                            | RED (confirmed) |
| 4.2      | Full revert                                            | RED (confirmed) |
| 4.3      | Full revert                                            | RED (confirmed) |
| 4.3b     | Full revert                                            | RED (confirmed) |
| 4.4      | Full revert                                            | RED (confirmed) |
| 4.4b     | Targeted D4a-amnesty mutation (full revert insufficient — see Probe 1 note) | RED (confirmed) |
| 4.4c     | Ordering mutation (detector ahead of `-f` branch)      | RED (confirmed) |

---

# Cycle 2 addendum — pinning WHICH refusal fired (evaluator finding)

evaluation-1.md (PASS, no blocking change requests) flagged a non-blocking finding:
4.2, 4.3, and 4.3b asserted only a bare non-zero exit, and the evaluator demonstrated
those assertions stay green even when the script dies at an unrelated point (merge-base
computation, via a missing `core/scripts/lib/git-child-env.sh`) — i.e. without the
divergence/not-in-index refusal they are named for ever firing. That is a test asserting
the right outcome for possibly the wrong reason: the same defect shape this ticket exists
to close, now in the test layer instead of the script.

## Fix

`test/scripts/squash-branch.test.sh` scenarios 4.2, 4.3, and 4.3b were tightened to grep
the specific refusal's diagnostic text (`differs between the staged index and the
worktree` for the divergence refusal; `no staged blob in the index` for the D4 not-in-index
refusal), in addition to the non-zero exit check, matching the pattern 4.1 and 4.4 already
used. 4.4b's "refusal names the undeclared file" assertion was also tightened per the
evaluator's second non-blocking note: it now requires the `exceeds the run's declared
touched-file set` refusal text alongside the filename, since the filename alone also
appears in the routine `Staged files:` listing above the refusal and does not by itself
pin the refusal's cause.

## Proof: the tightening is real

Reproduced the evaluator's exact early-death shape — `core/scripts/lib/git-child-env.sh`
temporarily moved out of place, so `squash-branch.sh` dies at `source
"${SCRIPT_DIR}/lib/git-child-env.sh"` before it ever reaches the merge-base computation,
let alone the declaration/divergence logic.

**Before this cycle's fix** (documented by the evaluator in evaluation-1.md): the bare
`[ "$RCxx" -ne 0 ]` checks in 4.2/4.3/4.3b stayed green under this mutation, because the
unrelated early death is also a non-zero exit.

**After this cycle's fix**, ran the full suite against the same mutation:

```
=== running full suite with core/scripts/lib/git-child-env.sh MISSING (evaluator's early-death shape) ===
Scenario 6: CON-162 -- guard validates the staged declaration blob, not the worktree copy
  ok   4.1 divergent worktree declaration is refused
  FAIL 4.1 refusal names the index/worktree divergence
       output: .../core/scripts/squash-branch.sh: line 90: .../core/scripts/lib/git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  ok   4.1 no squash commit created; HEAD unchanged
  FAIL 4.2 divergent worktree declaration cannot authorise an undeclared staged file
       exit=1 (bypass succeeded, or wrong refusal fired) output=.../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  ok   4.2 HEAD unchanged (sneaky.txt not committed)
  FAIL 4.3 --allow-empty-declaration does not suppress the divergence refusal
       exit=1 output=.../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  FAIL 4.3b --allow-empty-declaration does not suppress the not-in-index refusal
       exit=1 output=.../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  ok   4.3b HEAD unchanged
  ok   4.4 declaration on disk but not staged is refused
  FAIL 4.4 refusal states the self-service remedy (git add ...)
       output: .../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  ok   4.4b D4a still enforces the blob (undeclared staged file refused)
  FAIL 4.4b refusal names the undeclared file as the cause
       output: .../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  FAIL 4.4c D4a shape with a fully-declaring blob commits (divergence detector not reached)
       exit=1 output=.../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main
  FAIL 4.5 ordinary consistent-declaration run still commits
       exit=1 output=.../git-child-env.sh: No such file or directory
FAIL could not compute merge-base between HEAD and origin/main

squash-branch.test.sh: 15 passed, 24 failed
```

(Note 4.1 and 4.4's pre-existing message-grep assertions, and 4.4c/4.5 — neither of which
was tightened this cycle, they assert exit 0 and go red under any early death regardless —
also correctly go red under this mutation. They were never the gap; the same environment
failure exercises them too, which is expected and not evidence of anything new.)

**Conclusion:** 4.2, 4.3, and 4.3b now go RED under the exact shape the evaluator
demonstrated they previously could not detect — they no longer pass "for possibly the
wrong reason."

**4.4b's cause-anchoring is NOT actually discriminated by this mutation.** Under the
early-death shape, 4.4b's assertion was already RED with the OLD (untightened) grep too —
the entire script output is the loader error, so `sneaky.txt` never appears anywhere in
`$OUT6F` regardless of which assertion variant is used, and the old bare-substring grep for
`sneaky.txt` fails the same way the new cause-anchored grep does. The early-death mutation
therefore says nothing about whether 4.4b's tightening closed a real hole; see the dedicated
probe in the Cycle 3 addendum below for the mutation that actually discriminates it.

`core/scripts/lib/git-child-env.sh` was restored from `/tmp` immediately after capturing
this output; `git status --short core/scripts/lib/` showed no diff, and the full suite was
re-run clean:

```
squash-branch.test.sh: 39 passed, 0 failed
```

---

# Cycle 3 addendum — correcting the Cycle 2 addendum's attribution (evaluator finding)

evaluation-2.md (PASS, no blocking change requests) found the Cycle 2 addendum above
mis-credited two things:

1. It claimed the early-death mutation "also correctly goes red" and demonstrates 4.4b's
   tightening. It does not discriminate 4.4b at all — see the correction inserted directly
   into the Cycle 2 addendum above (this is a correction in place, not a new claim; the
   inaccurate sentence was replaced, not left standing alongside a rebuttal).
2. It described 4.4c/4.5 as "the newly-tightened 4.4c/4.5" — neither was tightened in
   Cycle 2; also corrected in place above.

This section supplies the probe that actually does discriminate 4.4b's tightening, per the
evaluator's Phase 2 finding #2 in evaluation-2.md, reproduced independently.

## Probe 4 — D4a no-parse mutation (the mutation that actually discriminates 4.4b)

Mutation: gate the blob parse on `FILE_ON_DISK -eq 1` as well as `STAGED_BLOB_PRESENT -eq 1`,
so the D4a shape (absent-on-disk, staged blob present) never parses `DECLARED_PATHS` from the
blob at all:

```diff
 DECLARED_PATHS=""
-if [ "$STAGED_BLOB_PRESENT" -eq 1 ]; then
+if [ "$STAGED_BLOB_PRESENT" -eq 1 ] && [ "$FILE_ON_DISK" -eq 1 ]; then
```

Under this mutation, `DECLARED_COUNT` is 0 for the D4a shape, so the script falls through to
the GENERIC "no usable declaration" branch instead of the specific allowlist-exceeded branch —
still a refusal (since `sneaky.txt` remains unexpected and `ALLOW_EMPTY_DECLARATION` is unset),
but for the wrong reason, with output naming `sneaky.txt` only in the routine
"Staged paths outside the allowlist:" listing under the generic message, never under
"exceeds the run's declared touched-file set".

**Run against the OLD test file (`git show 2086609:test/scripts/squash-branch.test.sh`,
temporarily swapped in), same mutated script:**

```
=== OLD test file + D4a no-parse mutation ===
  ok   4.4b D4a still enforces the blob (undeclared staged file refused)
  ok   4.4b refusal names the undeclared file

squash-branch.test.sh: 38 passed, 1 failed
```

4.4b's old bare-substring grep for `sneaky.txt` is satisfied by the generic branch's
"Staged paths outside the allowlist:\n  sneaky.txt" listing, so it stays GREEN even though
the blob was never actually parsed or enforced as the refusal's cause. (The single failure
elsewhere in this run is 4.4c, expected: 4.4c requires a clean COMMIT in the D4a shape, and
the no-parse mutation also breaks that.)

**Run against the CURRENT (Cycle-2-tightened) test file, same mutated script:**

```
=== running full suite against D4a NO-PARSE mutation (blob parse gated on FILE_ON_DISK) ===
  ok   4.4b D4a still enforces the blob (undeclared staged file refused)
  FAIL 4.4b refusal names the undeclared file as the cause

squash-branch.test.sh: 37 passed, 2 failed
```

4.4b's cause-anchored grep (`exceeds the run's declared touched-file set`) correctly goes
RED, because that text is unique to the specific allowlist-exceeded branch and the mutated
script never reaches it for this shape.

**Conclusion:** the D4a no-parse mutation is the discriminating probe for 4.4b's tightening —
old assertion green, new assertion red, on identical input. This corrects the false
attribution in the Cycle 2 addendum.

Both the mutated script and the swapped-in old test file were restored immediately after each
run; `git status --short` in the delivery worktree showed clean (only the untracked
`evaluation-2.md`), and the full suite was re-run clean:

```
squash-branch.test.sh: 39 passed, 0 failed
```
