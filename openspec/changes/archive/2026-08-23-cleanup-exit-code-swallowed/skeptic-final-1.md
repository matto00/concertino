## Skeptic Report — final gate (round 1, skeptic-final-1.md)

All probes below were run either read-only against the worktree, or inside throwaway
copies/fixtures under `/tmp/claude-1000/.../scratchpad/`. Nothing was run against
`/home/matt/Development/concertino`, `/home/matt/Development/helio`, the live
`.../CON-87` worktree, or the untracked WIP files.

### What I verified (with evidence)

**Ground truth**
- `git diff --stat 80ee2e8 HEAD` — 16 files, code changes confined to
  `core/scripts/cleanup.sh` (+202/-30), `core/roles/orchestrator.md` (+51/-…),
  `test/scripts/cleanup.test.sh` (+250). No stray files; nothing under
  `.concertino/worktrees/`; the untracked WIP files
  (`.claude/skills/concertino-fleet-driver/`, `scripts/concertino/pricing-table.json`,
  `scripts/concertino/report-cost.sh`) are not in the commit.
- Read the full post-change `core/scripts/cleanup.sh` (471 lines), not just the diff.

**Design decisions re-verified cold (all of them, not only the two human-approved fixes)**
- *Decision 2 (`run_git`)*: present, `err="$(mktemp)"` + `2>"$err"` (never `2>&1`, so a
  stdout capture is not corrupted), prints `cleanup.sh: FAILED <desc>: <cmd>` + indented
  stderr, then `fail`. `printf '%s' "$out"` keeps it usable as `VAR="$(run_git ...)"`.
- *Human-approved fix 1 — `fail()`/`print_result` on stderr*: `print_result` ends in `>&2`
  (cleanup.sh, `print_result()`), `fail()` calls it before `exit 1`. Independently proven by
  the suite's own two-stream probe: `RESULT never leaks onto stdout` (asserted against the
  stdout file) and `RESULT lands on stderr` both pass, and both **fail** against the
  pre-change script (see red probe below). This is the exact command-substitution swallow
  that design-gate round 3 raised.
- *Human-approved fix 2 — `worktree=not-attempted` on the rev-parse failure*: assertion
  `RESULT reports worktree=not-attempted (failed before the removal block)` passes on the
  fixed script and fails on the old one. Correct semantics: removal was never reached.
- *Decision 3a (branch resolution + ambiguity safety)*: porcelain parse captured **before**
  `worktree remove`; fallback `git branch --list "*/${T}" --format='%(refname:short)'` used
  only when exactly one match (`grep -c .` == 1). Multi-match probe (6.5) confirms neither
  branch is deleted and `branch_local=skipped`. Zero-match falls through to empty `BRANCH`
  → `skipped`.
- *Decision 3b (two-dot content-equality)*: `git diff "${BASE_REMOTE}/${BASE_BRANCH}"
  "${BRANCH}"` — two-dot, no `...`. Independently probed in a throwaway repo that
  `git branch -d` refuses a squash-merged branch ("not fully merged", `merge-base
  --is-ancestor` false) while the script's content-equality path deletes it (test 6.2
  asserts the ref is *actually gone*, not just a reported status).
- *Ordering*: worktree removal block precedes the branch-deletion block in the file;
  `worktree prune` stays soft (`2>/dev/null || true`), as designed.
- *Base-branch guard*: `[ "$BRANCH" != "$BASE_BRANCH" ]` present.
- *Decision 4 (defaults + immediate postcondition re-probe)*: all five RESULT fields
  declared before `REPO_ROOT` (i.e. before anything that can fail), so `set -u` can't crash
  `print_result`. `WT_OK=ok` is set on the **already-absent** branch (not `not-attempted`) —
  which is why all 73 pre-existing assertions stay green. Both re-probes (`[ -d
  "$WORKTREE_PATH" ]` after removal; `show-ref --verify` after `branch -D`) call `fail()`
  immediately rather than deferring.
- *Exit paths*: `grep -n exit` shows exactly three — the pre-guard `exit 0` (before the
  RESULT vars exist, correctly outside the contract), `fail()`'s `exit 1`, and the success
  fall-through where `print_result` runs immediately before `READY`. `attempt_fast_forward`
  is invoked in the main shell, so `FF_STATUS` really reaches `print_result` (confirmed by
  the `base=diverged` assertion passing).
- *Decision 5 (orchestrator prose)*: read the actual diff of `core/roles/orchestrator.md`
  Phase 4 step 1. The old "It always still exits 0 … there is nothing else to handle here"
  is gone; replaced with an explicit exit-code check, RESULT-line grammar matching the
  spec verbatim, a non-zero → `BLOCKER` rule (no proceeding to steps 2–3, no silent retry),
  and an explicit "`base=` never affects the exit code, don't escalate on it".
- *Decision 6*: `new_pair()` is unchanged; `new_worktree`/`squash_merge_into_main`/
  `run_cleanup_streams`/`new_fakegit_worktree_remove_noop` are additive opt-in helpers.

**Acceptance criteria — traced**
1. *Non-zero + named command + stderr, red-before-green*: `bash test/scripts/cleanup.test.sh`
   run by me → `112 passed, 0 failed`. Then the real red arm, run by me: I copied the
   worktree to a throwaway dir, replaced `core/scripts/cleanup.sh` with
   `git show 80ee2e8:core/scripts/cleanup.sh`, and re-ran the same suite →
   **`91 passed, 21 failed`**, including `names the failing command`, `RESULT lands on
   stderr`, `stuck worktree removal exits non-zero`, `the squash-merged branch is actually
   gone`. So the new probes genuinely exercise the fixed paths and are not vacuous.
2. *Postconditions by result, reported*: `RESULT worktree=… branch_local=… branch_remote=…
   base=…` printed on every path past the guard; worktree + local-branch re-probed by
   direct inspection; `base=` is verbatim `FF_STATUS`. Asserted green in 6.1/6.4/6.6/6.7.
3. *Regression probe reproduces the original symptom*: probe 6.1 uses the incident's own
   trigger (`core.bare true`) and asserts non-zero exit, no `READY` on stdout, RESULT on
   stderr only. Per design Decision 1 (which I re-checked against the old script in the red
   run: `forced git failure exits non-zero` passes there too) the script already exited
   non-zero — the swallow was caller-side, and the caller-side half is closed by the
   orchestrator prose change. Both halves are traceable.
4. *Content-equality, worktree first*: verified in code and by probes 6.2/6.3/6.9
   (asserting real ref state, not just RESULT text).
5. *Scoped to its own run*: probe 6.9 — a second live worktree + branch in the same fixture
   base is untouched (both directory and ref asserted present afterwards). Passes.

**No regressions**
- `bash test/scripts/cleanup.test.sh` → `112 passed, 0 failed` (73 pre-existing + 39 new;
  none renamed away — I read the diff, existing assertions are untouched).
- `npm test` → exit 0, full suite (includes `node --test` plus all 32 bash suites; grep for
  failures found none).

### Verdict: CONFIRM

### Non-blocking notes
- **Two-dot content-equality is empty only when the base tip has not advanced past the
  merge.** I probed this directly in a throwaway repo: with a sibling commit landing on
  `main` after the squash, `git diff main feat` is 7 lines (it includes deleting the sibling
  file), so the script will report `branch_local=skipped` and leave the branch behind. This
  is exactly what the ticket prescribes (AC4 names the two-dot form verbatim) and it fails
  safe and visibly, so it is not a defect against this contract — but it means the
  "branch left behind" case will still occur whenever another PR merges between this
  ticket's merge and its Phase 4. Worth a follow-up ticket (e.g. compare against the merge
  commit / `git diff <branch> $(git merge-base ...)`-style narrowing) rather than a change
  here.
- **The ambiguous/zero-match fallback logs nothing.** tasks.md 4.1b and design Decision 3a
  say "leave `BRANCH` empty and log a note"; the implementation only reflects it as
  `branch_local=skipped`, which is indistinguishable from the "unmerged content" skip. The
  binding spec requirement is met (no guessing, `skipped` reported); a one-line stderr note
  naming the ambiguity would close the diagnostic gap.
- **`branch_remote` is never independently re-probed** (no `ls-remote` check); it is derived
  from the `push --delete` exit status, with `fail_or_absent` deliberately conflating
  "already gone" and "failed". This is what design Decision 3b and the spec chose; noting it
  only because AC2 lists "remote branch absent" among the postconditions.
- **Rendered copies are stale by design/convention**: `scripts/concertino/cleanup.sh` is
  still the 282-line pre-change render (vs. 471 in `core/`), and there is no rendered
  orchestrator agent file in the tree at all. Prior commits in this repo are inconsistent
  here (CON-99 committed the rendered copy; CON-129 did not), and this change's proposal
  explicitly defers it to `concertino sync`. Practical consequence worth the orchestrator's
  awareness: **this ticket's own Phase-4 run will execute the stale rendered script**, so
  the new behavior won't apply to its own teardown until a sync lands.
