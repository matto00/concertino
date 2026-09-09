## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from commands I ran myself against
the worktree; the executor/evaluator reports were read only as claims to check.

### What I verified (with evidence)

**Scope of the diff.** `git diff --stat d792b42..HEAD` — one commit (36d98a6), 18
files: the new `test/scripts/rendered-scripts-drift.test.sh`, the `package.json`
test-chain registration, four rendered files (`squash-branch.sh`,
`check-merge-readiness.sh`, `cleanup.sh`, `README.md`), and change artifacts. No
production/core behaviour is altered — consistent with the stated Non-Goals.

**Hard constraint 1 — the two owner-protected files.**
- `git diff --name-only d792b42..HEAD | grep -E 'pricing-table|report-cost'` → no
  matches. Absent from the branch entirely.
- In the MAIN checkout (`/home/matt/Development/concertino/`), checked before and
  again after all of my own probing: `git status --porcelain scripts/concertino/`
  shows both still `??` (untracked); `ls -l` shows both still present with mtime
  `Aug 25 12:19` (unchanged by this delivery); `cmp` against `core/scripts/` shows
  both byte-identical; md5s `33a83e10…` / `c4a0aab2…` identical across both of my
  checks. I never wrote to those paths and never ran `concertino sync` anywhere.
  Every mutation I performed was against `mktemp -d` copies.

**Hard constraint 2 — executable assertion, not mode comparison.** Read the gate
(test/scripts/rendered-scripts-drift.test.sh:80-86): the `.sh` branch tests
`[ ! -x "$rendered_file" ]` only; core's mode is never read. Ground truth on the
real tree: `git ls-files -s` gives `100644 a1eff653… core/scripts/lib/git-child-env.sh`
vs `100755 a1eff653… scripts/concertino/lib/git-child-env.sh` — identical blob,
differing modes — and the gate is green on the whole tree, so that file does not
fail. My own enumeration of all 22 core files (`cmp` + `stat -c %a` per file)
confirms: every rendered counterpart is content-identical, every `.sh` render is
755, and the only two missing counterparts are the exempt pair.

**Hard constraint 3 — mutation evidence re-derived independently.** I copied the
real `core/scripts/` and `scripts/concertino/` trees to scratch, sourced the gate
with `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1`, and drove `run_drift_check` myself.
All four classes reproduced, each with a matching green control before/after:
- Restoring the **actual base (d792b42) stale** `squash-branch.sh` → `content differs: squash-branch.sh`, rc=1. This is the strongest case: the gate catches the very drift the ticket documents.
- `chmod 644` a content-identical render (`cleanup.sh`) → `not executable: cleanup.sh`, rc=1, and NOT reported as a content difference.
- New core file with no render → `never rendered: brand-new.sh`, rc=1.
- One-byte append to `lib/git-child-env.sh` render (nested dir) → `content differs`, rc=1.
- Clean scratch copy of the real tree → rc=0 both before and after.

**End-to-end failability of the test FILE (not just the function).** I built a
scratch repo skeleton (core + rendered + the test file), staled `cleanup.sh` from
d792b42, and ran the test file itself: `17 passed, 1 failed`, `FILE_EXIT=1`.
Green control with the file restored: exit 0. (My first attempt reported exit 141;
that was SIGPIPE from a `| head`, not the script — I re-ran without the pipe before
concluding, per the reproduce-before-refuting rule.) A non-zero exit breaks
`package.json`'s `&&` chain, so AC1 ("runs as part of routine verification")
actually bites rather than merely being registered.

**Full suite.** `npm test` in the worktree → `NPM_TEST_EXIT=0`, with the new gate
running last and reporting `18 passed, 0 failed`. Also ran the gate from `/tmp` —
`ROOT` is `BASH_SOURCE`-derived, so it is cwd-independent (exit 0).

**Enumeration source.** The gate reads `find . -type f` under `core_dir` only
(line 87) and looks each path up under rendered. `.concertino.env` and
`speeds.json` are therefore never enumerated — out of scope structurally, not by
an exclusion list that could rot (AC4 satisfied by construction, not by assertion).

**Remedy text.** Line 105 names `concertino sync`, "commit the resulting render as
its own reviewable diff", and "Do not hand-edit files under scripts/concertino/"
(AC3). Observed verbatim in every one of my own red runs.

**AC5 — drift actually cleared.** All four re-rendered files are byte-identical to
their core counterparts in my per-file `cmp` sweep, i.e. exactly what a sync would
have written, with the two unruled files left absent. Worktree is clean apart from
the untracked `evaluation-1.md`.

**The exemption: honest deferral, not a hole.** Three independent reasons I accept
it: (a) it is structurally confined to the missing-counterpart branch (line 70-76 —
the `continue` happens before `cmp` is ever reached), and I confirmed by mutation
that a synthetic exemption over a mutated render still fails as a content mismatch;
(b) each entry carries a written reason naming CON-173, and I verified via Linear
that **CON-173 exists, is open (Backlog), on team Concertino**, and states the
either/or whose resolution deletes both entries — a deferral that names a real
task, not a comment that sits inert; (c) the alternative (ignoring missing
counterparts wholesale) would reproduce this ticket's own silent-failure class for
newly-added core scripts. Verdict on that sub-question: honest recording.

**The two items raised for independent judgement.**
1. `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1` — real but not ship-blocking. `grep -rn`
   across the repo shows the only non-artifact occurrences are the gate's own two
   lines; nothing in `package.json`, CI, or any script sets or exports it. It is
   uniquely named (no plausible ambient collision), opt-in, and its worst effect is
   the gate self-disabling — it cannot cause a false green on a *drifted* file
   while unset. Weighed against the cost of another delivery round on a gate that
   is otherwise demonstrably failable, this is a note, not a REFUTE. Recorded below.
2. The delivery's own squash/commit path having run under the stale rendered
   `squash-branch.sh` — agreed, and it does not weaken the verdict, because none of
   my evidence above depends on the delivery being green. Every check I ran targets
   `core/scripts/` and the test file directly, on scratch copies, from a cold start.

### Verdict: CONFIRM

### Non-blocking notes
- design.md's Risks records `RENDERED_SCRIPTS_DRIFT_EXEMPT_EXTRA` but not
  `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY`. One line for symmetry next time this file
  is touched. (A `BASH_SOURCE`-vs-`$0` sourced-detection idiom would remove the env
  var entirely and is the cleaner shape if this pattern spreads to other tests.)
- Known, recorded blind spot (design.md Risks, Decision 2): a file deleted from
  `core/scripts/` but left behind under `scripts/concertino/` is not reported. I
  confirmed this is real (enumeration is core-only) and agree with the trade-off as
  argued — a leftover render is strictly less harmful than a stale one.
- The gate compares the working tree, not git object content, so a mode change
  staged but not on disk (or vice versa) is judged by disk. Consistent with every
  other test in the suite and with `doctor`; noted only for completeness.
