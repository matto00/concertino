## Auditor Report

### Condition 1–3 (check-merge-readiness.sh)

```
$ scripts/concertino/check-merge-readiness.sh "$WORKTREE_PATH" "bug/fix-report-numbering-collision/CON-81" "CON-81"
FAIL not mergeable: DIRTY
(exit 1)
```

Independently confirmed via `gh pr view` (bypassing the script) and `git merge-tree`:

```
$ gh pr view "bug/fix-report-numbering-collision/CON-81" --json state,mergeable,mergeStateStatus,baseRefName,headRefName,statusCheckRollup,number,url
{"baseRefName":"main","headRefName":"bug/fix-report-numbering-collision/CON-81","mergeStateStatus":"DIRTY","mergeable":"CONFLICTING","number":67,"state":"OPEN","statusCheckRollup":[]}
```

`git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main` shows a real
textual conflict in `package.json`'s `scripts.test` line: `main` gained
`test/scripts/escalation-raise-wait.test.sh` (from PR #66, CON-76, merged to
`main` after this branch diverged) on the same line this branch edited to add
`test/scripts/next-report-number.test.sh` and
`test/scripts/persist-evidence.test.sh`. This is a genuine, real merge
conflict — not a transient/environmental GitHub state.

- CI (statusCheckRollup): empty — no checks configured on this repo/PR, which
  the script treats as a pass. No FAIL line was raised for CI.
- This run's own gates (from `.concertino/runs/CON-81/events.jsonl`, read
  fresh): latest `role=evaluator` verdict = `PASS` (`evaluation-1.md`,
  t=1785913801759); latest `role=skeptic` verdict = `CONFIRM`
  (`skeptic-final-1.md`, t=1785914225927, later than the earlier
  `skeptic-design-1.md` REFUTE / `skeptic-design-2.md` CONFIRM cycle). Both
  hold. No FAIL line was raised for this condition.
- **Mergeability: FAIL.** `mergeStateStatus=DIRTY`, `mergeable=CONFLICTING`
  against current `main`. This is condition 2 failing, and it is the only one
  of the three that failed.

### Condition 4 (acceptance criteria, traced cold)

Ticket ACs (from `openspec/changes/archive/2026-08-05-fix-report-numbering-collision/ticket.md`)
against `git diff main...HEAD`:

1. **"A fold-in sub-run on a reopened archived change writes its reports to
   fresh filenames; no prior-sub-run report is modified or deleted."** —
   `scripts/concertino/next-report-number.sh` (new) scans `<change-dir>` for
   the highest existing `<kind>-<N>.md` and returns `<kind>-<HIGHEST+1>.md`,
   re-checking the target doesn't already exist before returning it.
   `core/roles/evaluator.md` and `core/roles/skeptic.md` are both rewired to
   call this script first and write to the `path=` it returns instead of a
   `CYCLE`/`N`-derived name. Met.
2. **"A third sub-run behaves the same — numbering continues, it does not
   reset."** — `next-report-number.sh`'s numbering is derived purely from
   what's on disk (`HIGHEST` over all matching files), not from any
   per-sub-run counter, so a 3rd (or Nth) sub-run scanning a dir that already
   holds `evaluation-1.md`, `evaluation-2.md` continues at
   `evaluation-3.md` identically to how a 2nd sub-run continues from a dir
   holding only `evaluation-1.md`. Met by construction; no special-casing of
   "3rd" exists or is needed.
3. **"The evidence copies under `.concertino/runs/<TICKET>/evidence/` retain
   one entry per report across all sub-runs."** —
   `scripts/concertino/persist-evidence.sh` gained an opt-in `--no-clobber`
   third argument: when the destination exists with different content it
   `FAIL`s instead of overwriting; identical content is a no-op success.
   `core/roles/evaluator.md`/`skeptic.md` now pass `--no-clobber` on their
   `persist-evidence.sh` call. Since `next-report-number.sh` already
   guarantees a fresh filename per report, the destination path is unique per
   report, so no two sub-runs' persisted copies collide/overwrite. Met.
4. **"If a collision somehow still arises, it fails loudly rather than
   overwriting."** — Two independent backstops: (a)
   `next-report-number.sh` re-checks its computed `TARGET` doesn't already
   exist and `FAIL`s with "computed target already exists (scan/regex bug?)"
   if it does; (b) `persist-evidence.sh --no-clobber` `FAIL`s loudly
   (`--no-clobber: destination already exists with different content`) on
   any differing-content collision instead of silently overwriting. Both role
   docs instruct `BLOCKER` + do-not-guess-a-fallback-filename on a `FAIL`
   from either script. Met.
5. **"Single-sub-run runs are unaffected: numbering still starts at 1 and
   reads identically to today."** — `next-report-number.sh` on an empty/no-
   matching-file change dir has `HIGHEST=0`, so `NEXT=1`, producing
   `evaluation-1.md` / `skeptic-design-1.md` / `skeptic-final-1.md` exactly as
   before. Met.

All five acceptance criteria trace cleanly to concrete diff evidence.
Condition 4 is satisfied on its own; the blocker is condition 2 only.

### Verdict: ESCALATE

### Reason
- **Condition 2 (mergeable) fails: `mergeStateStatus=DIRTY` /
  `mergeable=CONFLICTING`.** PR #67 has a genuine merge conflict against
  current `main` in `package.json`'s `scripts.test` line — `main` moved (PR
  #66 / CON-76 merged after this branch diverged) and edited the same line
  this branch's new test entries were appended to. This is a real,
  non-environmental finding (confirmed independently via `gh pr view` and
  `git merge-tree`, not just the script's own read). A human needs to rebase
  or merge `main` into this branch, resolve the `package.json` conflict (both
  sets of `test/scripts/*.test.sh` entries are additive and should both be
  kept), push, and re-run the auditor. No merge was performed; the PR is left
  open and the worktree untouched.
- All other conditions hold: CI rollup is empty (passes), this run's own
  evaluator (`PASS`) and skeptic (`CONFIRM`) gates passed, and all five
  acceptance criteria trace cleanly to the diff (see Condition 4 above).
