## Skeptic Report — final gate (round 1, skeptic-final-1.md)

All checks below were run by me against the worktree / throwaway clones. Mutation
experiments were performed in `/tmp/con163-probe` (a `--shared` clone), never in the
worktree; the worktree's tracked files are unmodified apart from this report.

### What I verified (with evidence)

**Suite (gate command).** `npm test` from the worktree root — **EXIT=0**, whole suite
green. `bash test/scripts/squash-branch.test.sh` alone — **25 passed, 0 failed**.
`bash -n core/scripts/squash-branch.sh` — syntax OK.

**AC1 — prospective set computed without moving HEAD; reset only after the guard.**
Read the diff. `STAGED_FILES` is now `git_wt diff --cached --name-only "$MERGE_BASE"`
at line 118, and `grep -n 'reset --soft'` finds exactly **one** `git_wt reset --soft`
in the whole script, at line 232, after every guard exit and immediately before
`git_wt commit`. Met.

**AC2 — HEAD untouched on every refusal path.** Structural: the exits at lines
82 (missing worktree), 97 (uncomputable merge-base), 102 (ambiguous merge-base),
210 (no usable declaration) and 226 (staged set exceeds declaration) all precede
the single reset at 232. Empirical, with `rev-parse HEAD` recorded before and after
a real script run on purpose-built fixtures:

```
refusal=stray    rc=1 HEAD UNCHANGED     (staged set exceeds declaration)
refusal=empty    rc=1 HEAD UNCHANGED     (unparseable declaration)
refusal=nofm     rc=1 HEAD UNCHANGED     (missing files-modified.md)
uncomputable merge-base (orphan branch)  HEAD UNCHANGED
```

Also confirmed on the real branch (see CR-1 below): the guard refused and reported
`HEAD UNCHANGED`. Met.

**AC3 — accept/reject decision provably unchanged.** Two independent proofs.

*(a) The set identity.* `git diff --cached --name-only <MB>` vs the old post-`reset
--soft` `git diff --cached --name-only`, on a fixture carrying committed commits, a
staged-but-uncommitted new path (`f3.txt`), a staged modification of a tracked file
(`f1.txt`), an unstaged-only change and an untracked file:

```
NEW: f1.txt f2.txt f3.txt   OLD: f1.txt f2.txt f3.txt   IDENTITY: MATCH
```

Staged-but-uncommitted paths are included by both; unstaged and untracked by neither.
`reset --soft` moves neither index nor worktree, so index-vs-`MERGE_BASE` is the same
comparison either side of it.

*(b) Behavioural parity sweep.* I extracted `main`'s `squash-branch.sh` into a
harness with its sibling `lib/` (my first attempt at this omitted `lib/git-child-env.sh`
and both scripts failed early at merge-base — that run proved nothing and I discarded
it; the numbers below are from the corrected harness) and ran old vs new over 5
fixture shapes x `--allow-empty-declaration` on/off:

```
declared/none 0=0  declared/allow 0=0  stray/none 1=1  stray/allow 1=1
empty/none 1=1     empty/allow 0=0     nofm/none 1=1   nofm/allow 0=0
onlychange/none 0=0                    onlychange/allow 0=0
```

10/10 SAME, including both `--allow-empty-declaration` interactions. Met.

**AC4 — success path byte-identical in tree and parent.** Same fixture run through
both scripts:

```
OLD tree=f5bdfef4... parent=8ed61d41...   NEW tree=f5bdfef4... parent=8ed61d41...
TREE: IDENTICAL   PARENT: IDENTICAL
```

Met.

**AC5 — regression guard exists and is mutation-failable by the ORDERING mutation.**
I did not rely on the suite's own Scenario 2d (which only asserts that HEAD moved
under its self-applied mutation — a proxy). I applied the ordering mutation myself to
`core/scripts/squash-branch.sh` in the probe clone, reinserting the early
`reset --soft "$MERGE_BASE"` at its old position above the staged-set computation,
and ran the real suite:

```
FAIL 3.5 no squash commit was created on guard trip (commit count unchanged)
FAIL 3.5 HEAD is unchanged across the guard trip
FAIL 3.5 the stray file remains reachable from HEAD after the guard trip (work not lost)
FAIL 3.3 HEAD is unchanged across the missing/unparseable-declaration refusal
squash-branch.test.sh: 21 passed, 4 failed
```

The red comes from the HEAD-unchanged assertions specifically, on **both** refusal
paths (Scenario 2 and Scenario 4A) — not from some unrelated branch of the test. The
guard-strictness assertions ("guard exits non-zero", "names the unexpected file") stayed
green, confirming the mutation isolates ordering rather than strictness.

**Neutering the new assertion.** I made both new HEAD comparisons vacuous
(`HEAD_AFTER2="$HEAD_BEFORE2"`). Clean script: 25/0 green, as expected — a vacuous
assertion cannot fail on correct code. Neutered **plus** the ordering mutation: still
`23 passed, 2 failed`, caught by the sibling commit-count and stray-file-reachability
assertions. So detection is redundant rather than resting on a single line. Met.

**Scope (CON-162 / CON-164).** No `--dry-run`/`DRY_RUN` token anywhere in the script.
The index-vs-worktree semantics are untouched — both old and new inspect the index
(`diff --cached`), and the 10/10 decision-parity sweep is the evidence that nothing
about what is inspected changed. No drift into either sibling ticket.

**CON-154 content intact.** `git diff main HEAD -- core/roles/orchestrator.md
test/scripts/openspec-validate-cmd.test.sh` → **IDENTICAL** for both files. The
first commit's accidental revert was fully undone by `9ae5711`. Confirmed.

**Task 4.3 (render target).** `scripts/concertino/squash-branch.sh` exists and is
absent from `git status --short` — untouched.

**A correction to the brief.** The brief said the net diff should touch only three
areas and I should read `git diff main...HEAD`. Three-dot diff compares the
*merge-base* to HEAD, not `main` to HEAD; the branch is based on `2ce8f22`, three
commits behind `main`, so I used `git diff main HEAD` for the true tree delta. The
five extra files it lists (`core/roles/auditor.md`, `core/scripts/README.md`,
`core/scripts/check-merge-readiness.sh`, its test, and the fleet-driver SKILL) are
`main`-ahead content the branch simply lacks — the branch introduces no change to
any of them. That part is clean.

### Verdict: REFUTE

The code change is correct and complete: all five acceptance criteria are met, with
independent evidence for each, and the regression guard survives the specific
mutation it exists to catch. I found no defect in `squash-branch.sh` or its tests.

The refusal is on branch state, which provably blocks delivery — see CR-1.

### Change Requests

1. **The branch carries an unmerged CON-154 commit, and the delivery squash for this
   ticket will refuse because of it.** The branch is `2ce8f22` (three commits behind
   `main`) + `486cd53 CON-154 ...` + the two CON-163 commits. Relative to the
   merge-base — which is exactly what `squash-branch.sh` inspects — the branch
   therefore stages `core/roles/orchestrator.md` and
   `test/scripts/openspec-validate-cmd.test.sh`, neither of which is declared in
   `openspec/changes/validate-before-reset/files-modified.md`. I ran the real
   delivery squash against a clone of this branch with `origin/main` set to real
   `main`:

   ```
   FAIL staged file set exceeds the run's declared touched-file set. Unexpected file(s):
     core/roles/orchestrator.md
     test/scripts/openspec-validate-cmd.test.sh
   Refusing to commit. Investigate before re-running.
   HEAD UNCHANGED
   ```

   (Pleasingly, this is the fix working as designed — the refusal left HEAD intact.)

   **Do not fix this by adding those two files to `files-modified.md`.** Their content
   is already identical to `main`, so declaring them would ship a no-op declaration and
   quietly widen the run's declared surface. Rebase the branch onto `main` instead.
   Note that a plain rebase **conflicts** on `486cd53`, because `main` acquired that
   content by a different route; `git rebase --skip` on that one commit is correct.
   I verified the outcome end to end:

   ```
   git rebase --onto origin/main 2ce8f22 HEAD    # conflicts on 486cd53
   git rebase --skip                              # 9ae5711 then auto-drops, "already upstream"
   -> one commit on top of main, touching only:
      core/scripts/squash-branch.sh
      test/scripts/squash-branch.test.sh
      openspec/changes/validate-before-reset/**
   -> squash-branch.sh: READY squash commit created
   -> bash test/scripts/squash-branch.test.sh: 25 passed, 0 failed
   ```

   After that rebase the net delta is exactly the three intended areas and the gate is
   green. No code change is required — this is purely a branch-topology fix, and I
   have already confirmed the post-rebase state passes both the guard and the suite.

### Non-blocking notes

- If `git_wt commit` at line 237 fails, HEAD is already reset. That is the
  guard-passed path rather than a refusal, so it is outside AC2, and the behaviour is
  unchanged from before — but it remains the one window where an error leaves the
  branch at the merge-base. A follow-up could reset only after a successful
  `commit-tree`, or restore HEAD on commit failure.
- Scenario 2d asserts the mutant moved HEAD, which is a proxy for "the guard's
  assertion goes red" rather than the assertion itself. It happens to be sound here
  (I confirmed the real assertions go red independently), but a future refactor of
  Scenario 2 could leave 2d passing while the guard it certifies no longer exists.
- The worktree has an uncommitted `workflow-state.md` modification and an untracked
  `evaluation-1.md`; both are change-dir artifacts covered by the allowlist.
