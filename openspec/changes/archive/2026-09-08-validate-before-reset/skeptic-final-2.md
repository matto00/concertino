## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-derivation on the rebased tree. Round 1's REFUTE was branch topology
only, with no code defect; this round re-verifies that refutation is genuinely
resolved AND re-checks the change as a whole on its new base.

### What I verified (with evidence)

**1. Round-1 refutation resolved — branch topology**
- `git log --oneline -6`: branch is exactly two commits on top of main —
  `2a5e893` (the change), `cf9ac3c` (change-dir artifacts), parented on
  `4bf4e92` = current `main`. `git merge-base --is-ancestor main HEAD` passes:
  the branch is no longer behind.
- `git diff main --stat`: 14 files, exactly `core/scripts/squash-branch.sh`,
  `test/scripts/squash-branch.test.sh`, and `openspec/changes/validate-before-reset/**`.
  Nothing else. The CON-154 commit and the "restore two files" commit are gone
  from the branch's own history (reflog `@{2}`/`@{1}` confirm they were dropped
  by the rebase, not squashed in).

**2. Real delivery squash now ACCEPTS (round 1's actual refusal)**
- Cloned the repo to `/tmp`, fetched the branch tip, ran the real script:
  `core/scripts/squash-branch.sh <clone> origin main "<subject>" openspec/changes/validate-before-reset`
- Result: `READY squash commit created`, **exit 0**. Staged file count 14, the
  list is exactly the three declared areas. Round 1's refusal on two undeclared
  files does not reproduce.

**3. Nothing lost in the rebase**
- `core/scripts/squash-branch.sh`, `test/scripts/squash-branch.test.sh`,
  `files-modified.md`, `tasks.md`, `design.md` are all **byte-identical** to the
  pre-rebase tip `7008844` (diffed each).
- `comm -23` of pre-rebase vs current trees: no file present before and absent now.

**4. AC 1 — validate before reset**
Read the diff. `git reset --soft "$MERGE_BASE"` is deleted from its old position
(immediately after merge-base computation) and reinserted verbatim — same message,
same exit code — immediately before `git_wt commit`. The staged set is now computed
as `git diff --cached --name-only "$MERGE_BASE"` with HEAD unmoved. Met.

**5. AC 2 — HEAD unchanged on every refusal path**
- Verified directly in the clone runs and by the suite's new assertions.
- Read the pre-guard region (script lines ~93–117): the only earlier exits are
  the merge-base-uncomputable and ambiguous-merge-base failures, both of which
  now precede any reset. No `reset`/`add`/`stash`/`checkout` exists anywhere
  before the guard (`grep` returned nothing — the script never stages anything
  itself). Met.

**6. AC 3 — guard decision unchanged, same inspected set**
- Equivalence is exact, not merely plausible: `reset --soft` moves HEAD only and
  leaves the index untouched, so post-reset `diff --cached` (index vs new HEAD =
  MERGE_BASE) and pre-reset `diff --cached MERGE_BASE` (index vs MERGE_BASE)
  compare identical pairs.
- Confirmed empirically rather than by argument alone: the old-ordering script
  and the new-ordering script printed the **identical 14-file staged list** on
  the same fixture. Met.

**7. AC 4 — success-path commit byte-identical**
Ran the pre-fix script (extracted from `main`) and the fixed script against two
identical clones of the same branch tip:
- old ordering → tree `a4bbf5d04e7e5cc148700a0af0116d24dacde71a`, parent `4bf4e92…`
- new ordering → tree `a4bbf5d04e7e5cc148700a0af0116d24dacde71a`, parent `4bf4e92…`
Identical tree and identical parent. Met.
(First attempt at this check refused with "could not compute merge-base"; that was
a **measurement artifact** — the extracted copy in `/tmp` could not resolve its
relative `lib/git-child-env.sh` source. Re-run with the old script placed inside
the clone's `core/scripts/`, where its lib resolves, and it succeeded. Reported
here rather than treated as a finding.)

**8. AC 5 — regression guard is mutation-failable by the ORDERING mutation**
Independently reproduced on this rebased tree, not taken from the evaluator:
applied my own ordering mutation (reinserted the early reset at its old position,
nothing else) and ran the suite:
```
FAIL 3.5 no squash commit was created on guard trip (commit count unchanged)
FAIL 3.5 HEAD is unchanged across the guard trip
FAIL 3.5 the stray file remains reachable from HEAD after the guard trip (work not lost)
FAIL 3.3 HEAD is unchanged across the missing/unparseable-declaration refusal
squash-branch.test.sh: 21 passed, 4 failed
```
Four independent assertions go red, and they go red for the *ordering* mutation
specifically — not for a weakening of guard strictness, which would prove the
wrong thing. Restored; `git status --porcelain` clean afterwards. Met.

**9. Gate re-run myself**
`npm test` on the rebased tree: **1221 passed, 0 failed** across all suites.
Working tree clean after the run (the suite's own script mutation self-restores).

**10. No scope drift into CON-162 / CON-164**
`git diff main` over both changed scripts contains no `dry-run`, `CON-162`,
`CON-164`, or working-tree-vs-index change. The fix deliberately still reads the
index, leaving CON-162's separate concern untouched.

**11. Render target untouched (task 4.3)**
`scripts/concertino/squash-branch.sh` is not in the diff. It was **already**
drifted from `core/` on `main`, and the immediately-prior change to the same file
(CON-151, `2021434`) likewise did not touch the rendered copy. Leaving it to
`concertino sync` is the documented rule, not an omission.

### Verdict: CONFIRM

Round 1's refutation is resolved by rebase alone, exactly as prescribed, with no
code change and no content lost. Every acceptance criterion traces to evidence I
produced myself; none is unverifiable.

### Non-blocking notes

1. The post-guard `git commit` failure path still leaves the branch reset (the
   reset immediately precedes it). This is unchanged from before, is outside the
   ticket's stated scope ("reset only after the guard has passed"), and the spec
   delta correctly scopes its ADDED requirement to guard refusals and earlier
   preconditions. Noting only so it is a known, deliberate residue rather than an
   oversight.
2. Scenario 2d restores the mutated script with a plain `mv` and no `trap`,
   unlike Scenario 2b which uses one. Since `bad()` records and continues rather
   than exiting, the restore runs on assertion failure — but an unexpected hard
   abort mid-scenario would leave the real script mutated. Aligning 2d with 2b's
   trap-restore would close that.
