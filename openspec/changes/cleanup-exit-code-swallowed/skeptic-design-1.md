## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three spec deltas
  (`cleanup-failure-visibility`, `cleanup-branch-deletion`, `main-fast-forward`).
- Read the actual `core/scripts/cleanup.sh` (301 lines) and `core/scripts/lib/git-child-env.sh`
  rather than relying on design.md's description of them.
- **Probed design.md Decision 1's stated root cause.** Decision 1 claims `set -e` does not
  trigger on `VAR="$(cmd)"` in bash. Run twice:
  `bash -c 'set -euo pipefail; X="$(false)"; echo SURVIVED'` → prints nothing, `rc=1`.
  The claim is false on bash 5.3.
- **Probed the current (unfixed) script against the incident's exact symptom.** Built a throwaway
  repo (bare remote + clone + linked worktree + vendored `cleanup.sh`/`git-child-env.sh`), set
  `core.bare=true` to reproduce `fatal: this operation must be run in a work tree`, ran
  `./scripts/cleanup.sh --phase4 <wt> "" "" TIC-1`. Result, **reproduced twice**:
  `fatal: this operation must be run in a work tree` / `EXIT=128`, no `READY cleaned` line,
  worktree still present. The unfixed script already exits non-zero on this failure.
- **Probed the content-equality expression.** Fixture: `main` + `feat`, `feat` squash-merged into
  `main`. `git diff main feat` → 0 lines (content-equal, correct);
  `git diff main...feat` → 7 lines (non-empty); `git branch -d feat` → "not fully merged".
- Grepped callers: `lib/ui/*.js`, `lib/cli/doctor.js` mention `cleanup.sh` only in comments.
  The real second consumer is `test/scripts/cleanup.test.sh` (409 lines) plus
  `test/diff-coverage.test.js:53`.
- Grepped `ticket.md` for "self-referential" / "four " (tasks.md 4.7's referent): no match.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 3 / `proposal.md` / `tasks.md` 3.2 / `specs/cleanup-branch-deletion/spec.md`
   use the wrong diff form — three-dot instead of two-dot — which defeats the feature's whole
   purpose.** All four say `git diff <base_remote>/<base_branch>...<branch>`. `A...B` diffs from
   `merge-base(A,B)` to `B`, i.e. it is merge-base-relative, not content-equality. Measured above:
   for a squash-merged branch, `git diff main feat` is empty but `git diff main...feat` is 7 lines.
   As designed, `DIFF` is non-empty for exactly the squash-merge case, so `branch_local=skipped`
   and the branch is never deleted — directly failing this change's own spec scenario
   "A squash-merged branch is recognized as safe to delete" and ticket AC #4. The ticket itself
   writes the correct two-dot form (`git diff origin/main <branch>`). Change every occurrence to
   two-dot `git diff "${BASE_REMOTE}/${BASE_BRANCH}" "$BRANCH"`.

2. **`design.md` Decision 1 asserts a factually false root cause and labels it "the actual root
   cause, not an anomaly".** `X="$(false)"` under `set -euo pipefail` *does* exit (evidence above).
   This violates `systematic-debugging` (no fix built on an unprobed cause). Rewrite Decision 1
   against the probe: the current script exits **128** on the incident's failure. Explicit guards
   on `VAR="$(git_child ...)"` are still worth having for the *message quality* (`run_git` naming
   the command and its stderr), but they must be justified as that, not as the cause of the
   reported exit 0.

3. **The reported symptom ("exit 0, `READY` printed, zero work") is not reproducible against the
   unfixed script, so tasks 1.2, 1.3 and 4.1 and ticket ACs #1/#3 are unexecutable as written.**
   My probe forced the incident's git failure at the `REPO_ROOT` lookup / worktree-removal step
   and got `EXIT=128` with no `READY` line, twice. A red probe demanding "exit code 0 and
   `READY cleaned worktree=...` printed" on the current script cannot go red-before-green honestly;
   an executor under task pressure will contort or fake it. Revise the plan to state where exit 0
   actually came from and target *that*: the evidence points at the **caller**, not the script —
   `core/roles/orchestrator.md` Phase 4 step 1 literally instructs "It always still exits 0 ...
   so this step completes either way; there is nothing else to handle here", and the script's own
   header comment (lines 24-27) says "ALWAYS exits 0". Either (a) re-scope the red probe to the
   genuine gap the incident exposed — no postcondition verification and a caller told to ignore the
   exit code — or (b) name and probe a concrete invocation path that really does mask 128 (e.g. a
   pipeline/`|| true` wrapper) before designing against it. Decision 5's "minimal prose update" is
   currently treated as an afterthought when the evidence makes it the load-bearing fix.

4. **`design.md` Decision 4's `RESULT` snippet crashes on the early-failure path it is required to
   cover, under `set -u`.** `BASE_OK="$FF_STATUS"`, `BR_LOCAL_OK=$BRANCH_LOCAL`, `BR_REMOTE_OK=$BRANCH_REMOTE`
   and `refs/heads/${BRANCH}` all read variables that are only assigned *after* worktree removal and
   the fast-forward. If `fail()` fires at worktree removal (the headline scenario, and the spec's
   own "A worktree-removal failure is reflected in the RESULT line before exiting"), `cleanup.sh`
   runs under `set -euo pipefail` and dies on the unbound variable *instead of* printing
   `RESULT worktree=fail`. Initialise all four to a defined default (`unknown`/`not-attempted`)
   at the top of the script, before any step can fail.

5. **The existing test suite is invisible to the entire plan and encodes the contract being
   broken.** `test/scripts/cleanup.test.sh` already has a fixture builder (`new_pair()`: bare
   remote + primary clone + vendored scripts) doing exactly what task 1.1 proposes to build from
   scratch, and its header + 11 assertions codify the old contract ("must still exit 0 and print
   its normal `READY cleaned worktree=...` line"; `cleanup.test.sh:6-7,116,135,150,171,191,214,238,275,342,381,402`).
   Adding branch deletion also introduces new destructive side effects (`branch -D`,
   `push --delete`) inside those existing fixtures. Neither `proposal.md`'s Impact section nor
   `tasks.md` mentions this file. Add it to Impact and add tasks to extend/update it — and put the
   new probes there rather than in a parallel ad-hoc harness. (`proposal.md`'s "No other script in
   this repo invokes `cleanup.sh`" is true only for `lib/`; the test suite invokes it directly, and
   `test/diff-coverage.test.js:53` also exercises the rendered copy.)

6. **`tasks.md` 4.7 has a dangling referent.** It requires avoiding "the four self-referential-test
   failure modes named in the ticket"; `ticket.md` names no such list (grep: no match for
   "self-referential"). Either enumerate the four modes inline in `tasks.md` or drop the clause —
   as written the executor cannot know what it must avoid, and cannot tell when 4.7 is done.

7. **`RESULT` is a machine-parseable contract and the three artifacts disagree on its grammar.**
   `proposal.md` says `branch_remote=<ok|fail|skipped>` and `base=<current|updated|diverged|dirty|unknown>`;
   `design.md` Decision 4 and `specs/cleanup-failure-visibility/spec.md` say
   `branch_remote=<ok|fail_or_absent|skipped>` and `base=<FF_STATUS value>` — and `unknown` is not
   an `FF_STATUS` value (the real set is `current|updated|diverged|dirty|failed|fetch-failed|no-local-base`,
   `cleanup.sh:91-99`). Pick one grammar and make proposal, design, and spec identical.

### Non-blocking notes

- `cleanup.sh:24-27`'s own header comment ("ALWAYS exits 0") becomes wrong under this change and is
  not listed in Impact — worth a line in tasks §5.
- `git-child-env.sh`'s header describes a prior incident where a fixture `git init` inherited a
  poisoned `GIT_DIR` and "re-initialised the real repo as bare". That is a strikingly close match to
  the ticket's unexplained `core.bare = true` "set by an unidentified actor". Not this ticket's
  scope, but worth a spinoff — and a reason task 1.1's throwaway-fixture work must itself go through
  `git_child`.
- Decision 2's `run_git` returns stdout via `printf '%s'`, dropping the trailing newline. Harmless
  for the rev-parse/`branch -D` uses here; note it so no future caller assumes newline-preserving.
