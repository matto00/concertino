## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, the revised `proposal.md`, `design.md`, `tasks.md`, and all three spec
  deltas fresh, plus the real `core/scripts/cleanup.sh` and `test/scripts/cleanup.test.sh`
  (409 lines) rather than the artifacts' description of them.
- **Round 1 change requests, re-checked against the current text:**
  - CR1 (three-dot diff): fixed. `grep -rn 'diff .*\.\.\.'` across proposal/design/tasks/specs
    now matches only the two explicit "NOT three-dot" warnings (design.md:156, tasks.md:65).
    The operative expression is the two-dot `git diff "${BASE_REMOTE}/${BASE_BRANCH}" "$BRANCH"`.
  - CR2/CR3 (false `set -e` root cause): fixed. Decision 1 now states the probed truth (script
    already exits 128 on the incident's trigger) and relocates the root cause to
    `core/roles/orchestrator.md`'s Phase 4 prose; Decision 5 / tasks §6.1 make that the
    load-bearing fix. I confirmed the script's own header (cleanup.sh:24-27, "ALWAYS exits 0")
    really does say what Decision 1 quotes, and tasks 2.4 corrects it.
  - CR4 (unbound vars in `fail()`): fixed. Decision 4 + task 3.1 declare
    `WT_OK/BRANCH/BRANCH_LOCAL/BRANCH_REMOTE/FF_STATUS` to `not-attempted` before any fallible
    step. I checked the `[ -d ... ] && VAR=fail` re-probe idiom is `set -e`-safe (failure of a
    non-final command in an AND-list does not exit) — that part is sound.
  - CR5 (invisible test suite): fixed. `test/scripts/cleanup.test.sh` is now in proposal Impact,
    Decision 6, and tasks 1.1/§5.
  - CR6 (dangling "four self-referential failure modes"): fixed — enumerated inline as
    tasks.md 5.7 (a)-(d).
  - CR7 (RESULT grammar divergence): fixed. proposal.md:34-36, tasks.md:52-53,
    `specs/cleanup-failure-visibility/spec.md:34-36` and design.md:217 now agree, and `base=`
    is bound to the real `FF_STATUS` vocabulary (verified against cleanup.sh:104-161).
- `grep -rni "TODO|TBD|figure out later"` across all planning artifacts: no matches.
- **Baseline gate**: `bash test/scripts/cleanup.test.sh` → `73 passed, 0 failed`.
- **Probed Decision 6's central claim** ("none of the 11 existing assertions change their
  expected result"). `grep -c "worktree add" test/scripts/cleanup.test.sh` → **0**. Every
  fixture passes a *nonexistent* path as `WORKTREE_PATH` (`WT="$BASE/TICK-1"` … `TICK-31`,
  lines 112-398); `new_pair()` (lines 59-78) creates only a bare remote + a primary clone, and
  never a worktree or a ticket branch. So every existing scenario takes cleanup.sh:68's
  `[ -d "$WORKTREE_PATH" ]`-false path: `worktree remove` is never invoked and no branch exists.
- Read cleanup.sh:68-71 and :301 for the worktree-removal / `READY` paths, and :137 for the
  `worktree list --porcelain` parse Decision 3 proposes to reuse (it lives *inside*
  `attempt_fast_forward`, i.e. after removal — so task 4.1's "capture BEFORE removal" is a new
  parse, not a reuse of the existing one; feasible, but stated inaccurately).

### Verdict: REFUTE

### Change Requests

1. **The absent-worktree path is undefined, and as designed it breaks all 11 existing
   `prints READY …` assertions — contradicting design.md Decision 6.** Decision 4 states
   `READY cleaned worktree=...` "is now only reached when `WT_OK=ok`". `WT_OK` is only set to
   `ok` "right after `worktree remove` succeeds", but cleanup.sh:68 skips that call entirely
   when `$WORKTREE_PATH` does not exist — which is the case in *every* fixture in
   `test/scripts/cleanup.test.sh` (evidence above: zero `git worktree add`, all `WT=` paths
   nonexistent) and is also the script's own documented "Safe to re-run" idempotent case
   (cleanup.sh:11). On that path `WT_OK` stays `not-attempted`, `READY` is suppressed, and the
   suite's `has "prints READY …"` assertions at lines 116, 135, 150, 171, 191, 214, 238, 275,
   342, 381, 402 fail. Decision 6's claim that these are unaffected because they are "all
   fast-forward outcomes" is wrong: they are also all *absent-worktree* runs. Fix the design to
   define this case explicitly — the postcondition (worktree absent) is in fact *satisfied* when
   the directory was already gone, so it should report success (e.g. `WT_OK=ok`, or a distinct
   `already-absent` value that must then be added to the `RESULT` grammar in proposal.md:34,
   tasks.md 3.3 and `cleanup-failure-visibility/spec.md:34-36`), and `READY` must remain printed
   on it. State the resulting expectation for the 11 existing assertions explicitly rather than
   asserting no change.

2. **Design and spec contradict each other on the exit code when the postcondition re-probe
   fails.** design.md Decision 4 says "Exit code: `0` only when every hard-failing step
   (Decision 2's `run_git` calls) succeeded", yet the same decision's re-probe can set
   `WT_OK=fail` *after* `run_git "worktree remove"` returned 0 (`[ -d "$WORKTREE_PATH" ] &&
   WT_OK=fail`) — a real case, since `git worktree remove` is known to leave a non-empty
   directory behind (HEL-655). `specs/cleanup-failure-visibility/spec.md` requires the opposite:
   "`0` means every hard-failing step it attempted succeeded (the `RESULT` line's `worktree` and
   `branch_local` fields are **never `fail`** on this path)". As written an implementer can
   legitimately produce `exit 0` with `RESULT worktree=fail`, which is precisely the ticket's
   headline defect (success exit code on a teardown that did not happen, AC #1/#2). Decide and
   state it in both documents: a re-probe that finds the postcondition unmet must drive the exit
   code (and must not print `READY`).

3. **Branch deletion is unreachable on exactly the repair scenario the ticket cites, and the
   design does not say whether that is intended.** Decision 3 gates the whole block on
   `[ -n "$BRANCH" ]`, and `BRANCH` is captured from the worktree listing before removal (task
   4.1) — so a re-run after a partial cleanup (worktree already gone, branch left behind) yields
   an empty `BRANCH` and `branch_local=skipped`, never deleting the branch. The ticket's own
   session tally ("7 of 8 runs left the branch behind") makes the leftover-branch re-run the
   likely first real use. Either add a defined fallback for resolving the branch when the
   worktree is already absent, or state explicitly in Decision 3 that this case is out of scope
   and why, so the executor does not have to guess. (Relatedly, correct Decision 3 / task 4.1's
   claim that the porcelain listing is "already parsed once for the base-branch lookup" — that
   parse is at cleanup.sh:137, *inside* `attempt_fast_forward` and therefore after removal; this
   is a new, earlier parse.)

4. **Tasks §5's probes presuppose fixture capabilities `new_pair()` does not have.** 5.2, 5.3,
   5.5 and 5.6 require a real linked worktree, a real ticket branch, a squash-merged branch, and
   a *second* live worktree — none of which `new_pair()` can currently produce (it creates only
   remote + primary clone). Task 1.1 says "extend `new_pair()`" but names no new capability, so
   the acceptance signal for §5 is unclear. Enumerate the fixture extensions required (add a
   linked worktree on a ticket branch; a squash-merge helper; an optional second worktree), and
   note that adding a real worktree to shared fixtures changes the code path existing scenarios
   exercise (see CR1) — so the extension must be additive/opt-in, not a change to the default
   `new_pair()` shape.

### Non-blocking notes

- design.md Decision 4's exit-code paragraph still uses round-1 variable names `BR_LOCAL_OK`
  and `BASE_OK`, which no longer exist in the same decision's own snippet
  (`BRANCH_LOCAL`, `FF_STATUS`). Harmless but confusing; rename for consistency.
- `run_git` returns stdout via `printf '%s'`, dropping the trailing newline — fine for the
  `rev-parse` / `branch -D` uses here; worth a comment so a future caller does not assume
  newline preservation.
- `git-child-env.sh`'s header documents a prior incident where a fixture `git init` inherited a
  poisoned `GIT_DIR` and re-initialised the real repo as bare — still a strong candidate
  explanation for this ticket's unattributed `core.bare = true`, and a reason the §5 fixture work
  must go through `git_child`. Worth a spinoff, not this ticket.
