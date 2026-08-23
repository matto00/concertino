## Context

`core/scripts/cleanup.sh` is the canonical Phase-4 (post-merge) teardown script: kill dev
servers, remove the worktree, fast-forward local `<base>`, re-render shared artifacts, and emit
`run.end`. It runs under `set -euo pipefail`; a failed `git_child` call in the worktree-removal
path (including the `REPO_ROOT="$(git_child ... rev-parse --show-toplevel)"` lookup at the top of
the script) already causes the script to exit non-zero today — this was probed directly against
the incident's own trigger (`core.bare=true` → `fatal: this operation must be run in a work
tree`) and confirmed: exit 128, stderr identifying the failure, no `READY` line. The
fast-forward path (`attempt_fast_forward`) is separately, deliberately built to never raise
`set -e` — every git call inside it is guarded with `|| return 0` / `2>/dev/null`, which is
correct for that comparison/escalation logic and is the one place in the file this is
intentional. So the script does not currently swallow the incident's failure. What actually
swallows it is the caller: `core/roles/orchestrator.md`'s own Phase 4 prose instructs the
orchestrator never to check `cleanup.sh`'s exit code ("it always still exits 0 ... there is
nothing else to handle here" — an overgeneralization of a header comment that was really only
ever true of the fast-forward outcome specifically). See Decision 1 for the full account,
corrected after design-gate round 1 probed and rejected this document's original (different,
wrong) claim about a `set -e` command-substitution gap.

There is currently no branch-deletion step in `cleanup.sh` at all — `grep -rl "branch -d\|branch
-D"` across `core/` and `scripts/` returns nothing. That is a plain omission, not a bug in
existing logic.

## Goals / Non-Goals

**Goals:**
- A git operation `cleanup.sh --phase4` depends on for correctness (worktree removal, branch
  deletion, base fast-forward's own git calls when NOT going through the tolerant
  `attempt_fast_forward` comparison path) that fails unexpectedly makes the script exit non-zero,
  naming the failing command and its stderr.
- Postconditions (worktree absent, local branch absent, remote branch absent, base == remote
  base) are checked by direct inspection after the destructive steps run, independent of whatever
  exit codes those steps returned, and reported per-condition.
- The "main cannot fast-forward" (dirty/diverged) case remains a legitimate, non-fatal, clearly
  reported outcome — this is real and current (tonight's diverged local `main`), not hypothetical.
- Branch deletion uses content-equality against the fetched base, not `git branch -d`'s
  merge-ancestry check, and happens only after the worktree is removed.
- A caller can tell "cleanup completed" from "cleanup could not run" from the exit code alone,
  without parsing stderr — while a machine-readable summary line still gives finer detail for a
  caller that wants it.

**Non-Goals:**
- Bare-repo support (explicitly rejected — this ticket corrects that framing).
- Fixing CON-119 (empty parent dir), CON-121 (`other_runs_live()` false-positives), HEL-655
  (worktree removal "Directory not empty"), HEL-764 (fast-forward false-positives), CON-132,
  CON-127, CON-126. Referenced, not touched, unless the fix here naturally subsumes one — flagged
  explicitly in the final report if so, never silently.
- Changing the `--phase4` opt-in guard, the dev-server-kill step, the re-render-on-fast-forward
  step, or `run.end` emission semantics beyond what's needed to keep them correct under the new
  exit-code contract.
- Retrying branch deletion or worktree removal beyond what git itself would need (no new
  bounded-retry loop is introduced for these — only the existing fast-forward retry/skip loop,
  unchanged).

## Decisions

### Decision 1 (revised after design-gate round 1 — see skeptic-design-1.md change request 2/3):
the exit-0 symptom is a **caller-side** defect, not a `set -e` gap in the script itself

Round 1 of this design claimed `set -e` silently swallows a failed `VAR="$(git_child ...)"`
assignment. That claim was probed and is **false**: `bash -c 'set -euo pipefail; X="$(false)";
echo SURVIVED'` exits 1 without printing `SURVIVED`, on bash 5.3. A second probe — reproducing
the HEL-657 incident directly (`core.bare=true` in a throwaway fixture, then invoking the real,
unmodified `core/scripts/cleanup.sh --phase4`) — confirms this: the current script already exits
**128**, prints `fatal: this operation must be run in a work tree` to stderr, and never reaches
`READY cleaned worktree=...`, on exactly the failure the ticket describes. The script does not
currently swallow this failure.

So where did "exited 0 having done nothing" come from? From the **caller**, not the script.
`core/scripts/cleanup.sh`'s own header comment (pre-existing, lines 24-27) says cleanup "ALWAYS
exits 0, regardless of whether the fast-forward below succeeded, escalated, or was skipped" —
written to describe the fast-forward step specifically, but read by both a human and (more
importantly) `core/roles/orchestrator.md`'s own Phase 4 prose as a blanket guarantee: "It always
still exits 0 ... this step completes either way; there is nothing else to handle here." The
orchestrator's own role definition instructs it never to check `cleanup.sh`'s exit code at all.
That is the actual root cause of the reported symptom: a caller that was told, in its own
governing document, that checking the exit code is unnecessary — so when the script legitimately
failed loudly (exit 128, stderr identifying the command), nothing downstream noticed, and the run
was reported/treated as a clean Phase-4 teardown regardless.

This reframes the fix's center of gravity: the load-bearing change is **Decision 5** (below),
correcting `core/roles/orchestrator.md` to check the exit code and treat non-zero as a `BLOCKER`,
and correcting `cleanup.sh`'s own header comment (currently overbroad/wrong) to say what's
actually true after this change. The script-side changes (Decisions 2-4) remain valuable
independent of that: they replace ad hoc `set -e` propagation (correct today, but its failure
message is whatever raw git spew happens to reach stderr, mixed with routine output, with no
structured indication of *which* step failed) with an explicit `run_git` helper that names the
failing command and isolates its stderr, and they add the postcondition/`RESULT` line so a
caller — including the now-corrected orchestrator — has a machine-checkable summary instead of
having to parse free text. But the acceptance-criteria framing ("script exits 0, script must
instead exit non-zero") needs read as "script exit code must be a decision-affecting caller
input" — the script already gets to non-zero on the incident's own scenario; the gap being closed
is that the exit code was, until this change, meaningless to the one caller that has ever existed.

Concretely, every `VAR="$(git_child ...)"` assignment in the hard-failing path is still routed
through explicit `|| fail "<desc>" "<captured stderr>"` (via `run_git`, Decision 2) — not because
`set -e` fails to catch it (it does), but so the failure message names the specific command and
isolates its stderr from routine output, and so the `RESULT` line (Decision 4) reliably reflects
what actually happened rather than depending on where in the script `set -e` happened to fire.

### Decision 2: A single `run_git` helper wraps every hard-failing git call; capture stderr
explicitly since `2>&1` would corrupt stdout captures

```bash
# run_git <description> -- <git_child args...>
# On success: prints command's stdout on stdout, returns 0.
# On failure: prints "cleanup.sh: FAILED <description>: <command>" and the
# command's stderr to stderr, then calls `fail` (below) to exit non-zero.
run_git() {
  local desc="$1"; shift
  [ "$1" = "--" ] && shift
  local out err rc
  err="$(mktemp)"
  if out="$("$@" 2>"$err")"; then
    rc=0
  else
    rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "cleanup.sh: FAILED ${desc}: $*" >&2
    sed 's/^/  /' "$err" >&2
    rm -f "$err"
    fail "${desc}"
  fi
  rm -f "$err"
  printf '%s' "$out"
}
```

`fail()` prints the accumulated `RESULT ...` line (Decision 4, whatever has been confirmed so
far — never nothing) to **stderr**, then `exit 1`. This is load-bearing, not cosmetic (fixed
after design-gate round 3, change request 1, itself confirmed by a direct probe): `run_git` is
designed to be usable as `VAR="$(run_git ...)"` — tasks 2.2 requires exactly this for
`REPO_ROOT` — and a command substitution only captures the subshell's **stdout**. If `fail()`
printed `RESULT` to stdout, then on the incident's own earliest failure path (`REPO_ROOT="$(...)"`
failing) the `RESULT` line would be captured into `REPO_ROOT` and discarded along with the
assignment, so it would never reach the terminal or a caller — reproducing, inside this very
fix, the exact "the failure happened but nothing legible came out" defect this ticket exists to
close. Printing to stderr instead means `RESULT` is visible regardless of whether the surrounding
call happens to be in a command-substitution position. `print_result` (used identically on the
success path) also writes to stderr, for the same reason and so callers only ever grep one
stream for it, not stdout on the happy path and stderr on the sad path. This is deliberately NOT
`set -e`-driven for these
specific calls (the calls need to distinguish "this failure is fatal" from "this failure is an
expected/tolerable outcome", which raw `set -e` cannot express) — `set -euo pipefail` stays at
the top of the file for genuinely-unexpected failures elsewhere (e.g. a typo), but every git call
this ticket's acceptance criteria are about goes through `run_git` (hard-fail) or
`attempt_fast_forward`'s existing tolerant pattern (soft-fail-with-status), never bare.

### Decision 3: Branch deletion — content-equality, correct order, local then remote

After the worktree is removed (existing step, now going through `run_git` for the
`worktree remove` call specifically — `worktree prune` stays soft/best-effort, matching today,
since a prune failure never leaves the branch or worktree in a worse state), `BRANCH` must first
be resolved.

**Decision 3a (revised, design-gate round 2 change request 3): resolve `BRANCH` even when the
worktree is already gone.** Round 1/2 captured `BRANCH` only by parsing `git worktree list
--porcelain` for `$WORKTREE_PATH`'s checked-out branch, done BEFORE removal. Design-gate round 2
pointed out this makes branch deletion **unreachable** on exactly the ticket's own most-cited
case: a re-run of `cleanup.sh --phase4` after a prior run already removed the worktree but left
the branch behind (session tally: "7 of 8 runs left the branch behind"). On that re-run,
`$WORKTREE_PATH` doesn't exist, so this lookup finds nothing and `BRANCH` stays empty. (Also
correcting an inaccuracy round 2 caught: `git worktree list --porcelain` is otherwise parsed only
inside `attempt_fast_forward`, cleanup.sh:137 — for a *different* purpose, locating where
`$BASE_BRANCH` is checked out — and that parse runs after removal in the existing script's
control flow. This is a new, separate, earlier parse, not a reuse of that one.)

Fixed with a two-step resolution, in order:

1. **Worktree still present** (the common case): parse `git worktree list --porcelain` for the
   branch `$WORKTREE_PATH` has checked out, exactly as before, captured before the `worktree
   remove` call.
2. **Worktree already absent** (the idempotent-re-run case): fall back to searching local
   branches by the project's own established naming convention — every ticket branch this
   codebase creates ends in `/<TICKET_ID>` (`[feature|task|bug]/<desc>/<TICKET_ID>`, per
   `setup-worktree.sh`'s own contract and `CLAUDE.md`'s "Git conventions"). Run `git branch --list
   "*/${T}"` (`T` is the ticket id already resolved earlier in the script, cleanup.sh:80). If
   **exactly one** local branch matches, use it as `BRANCH`. If **zero or more than one** match,
   leave `BRANCH` empty and log a note — an ambiguous or absent match is never safe to guess at
   and force-delete; this mirrors the existing "unresolvable → report, don't force" posture used
   everywhere else in this script, not a new pattern.

```bash
BRANCH=""
if [ -d "$WORKTREE_PATH" ]; then
  # existing porcelain-listing lookup — captured BEFORE `worktree remove` runs.
  ...
elif [ -n "$T" ]; then
  MATCHES="$(git_child -C "$REPO_ROOT" branch --list "*/${T}" --format='%(refname:short)' 2>/dev/null)"
  if [ "$(printf '%s\n' "$MATCHES" | grep -c .)" -eq 1 ]; then
    BRANCH="$MATCHES"
  fi
fi
```

**Decision 3b: content-equality gate, using the correct two-dot diff form** (design-gate round 1
change request 1: this MUST be `git diff <A> <B>`, not three-dot `git diff <A>...<B>`. Three-dot
diffs from `merge-base(A,B)` to `B` — merge-base-relative, not content-equality — and is
non-empty for exactly the squash-merge case this feature exists to handle: measured, `git diff
main feat` empty, `git diff main...feat` 7 lines, on a squash-merged fixture branch. The ticket's
own correction already states the two-dot form, `git diff origin/main <branch>`; this design now
matches it exactly):

```bash
if [ -n "$BRANCH" ] && [ "$BRANCH" != "$BASE_BRANCH" ]; then
  git_child -C "$REPO_ROOT" fetch --quiet "$BASE_REMOTE" "$BASE_BRANCH" 2>/dev/null || true
  DIFF="$(git_child -C "$REPO_ROOT" diff "${BASE_REMOTE}/${BASE_BRANCH}" "${BRANCH}" 2>/dev/null)" \
    && DIFF_OK=1 || DIFF_OK=0
  if [ "$DIFF_OK" -eq 1 ] && [ -z "$DIFF" ]; then
    run_git "delete local branch ${BRANCH}" -- git_child -C "$REPO_ROOT" branch -D "$BRANCH"
    git_child -C "$REPO_ROOT" push "$BASE_REMOTE" --delete "$BRANCH" 2>/dev/null \
      && BRANCH_REMOTE=ok || BRANCH_REMOTE=fail_or_absent
    BRANCH_LOCAL=ok
  else
    # Content differs from base, or the diff itself couldn't be computed
    # (fetch failed, or the branch is already gone) — never force-delete.
    # This is the same "unresolvable → report, don't force" posture as the
    # existing fast-forward dirty/diverged handling, not a new pattern.
    BRANCH_LOCAL=skipped
    BRANCH_REMOTE=skipped
  fi
else
  BRANCH_LOCAL=skipped
  BRANCH_REMOTE=skipped
fi
```

Local branch deletion (`git branch -D`, after content-equality is confirmed) IS a hard failure if
attempted and it errors — a confirmed-identical branch that still won't delete is a real defect
worth surfacing, not a soft outcome. Remote branch deletion is treated as soft/best-effort
(`fail_or_absent`, not distinguished further) because the remote branch is very commonly already
gone by Phase 4 — GitHub/GitLab's "delete branch on merge" default already removes it before
cleanup.sh ever runs, and re-attempting a delete against an already-gone ref is not itself a
defect worth failing the whole teardown over. This mirrors the ticket's own emphasis (acceptance
criterion 4 names content-equality + ordering explicitly; it does not require remote-delete to be
a hard failure).

**Never delete `$BASE_BRANCH` itself** — the `[ "$BRANCH" != "$BASE_BRANCH" ]` guard exists
specifically for a misconfigured worktree that somehow has `main` checked out (should never
happen given `setup-worktree.sh`'s own contract, but this script must never be the thing that
deletes `main`).

### Decision 4: Postcondition verification + machine-readable `RESULT` line

`fail()` (Decision 2) must be able to print a `RESULT` line from the very first hard-failing
call, which can happen before `BRANCH`/`BRANCH_LOCAL`/`BRANCH_REMOTE`/`FF_STATUS` are ever
assigned. Round 1 of this design left those variables unset on that path, which — under this
script's own `set -euo pipefail` — dies on an unbound-variable reference instead of printing
`RESULT worktree=fail` (the exact scenario the spec requires it to cover). Fixed by declaring
every `RESULT`-line field to a defined default (`not-attempted`) at the very top of the script,
before any step that could fail:

```bash
# Declared up top, immediately after the argument parsing / --phase4 guard —
# before REPO_ROOT, before attempt_fast_forward, before anything that can fail.
WT_OK="not-attempted"
BRANCH=""            # captured from `git worktree list --porcelain`, see Decision 3
BRANCH_LOCAL="not-attempted"
BRANCH_REMOTE="not-attempted"
FF_STATUS="not-attempted"

print_result() {
  # stderr, deliberately — see the note above run_git's stdout-capture contract:
  # this must stay visible even when the calling context is a command
  # substitution (e.g. `REPO_ROOT="$(git_child ...)" || fail ...`).
  echo "RESULT worktree=${WT_OK} branch_local=${BRANCH_LOCAL} branch_remote=${BRANCH_REMOTE} base=${FF_STATUS}" >&2
}

fail() {
  # $1: description of the failing step, already reported in detail by run_git
  print_result
  exit 1
}
```

**Worktree-absence is itself the satisfied postcondition, and is reported `ok`, not
`not-attempted`** (design-gate round 2, change request 1). `$WORKTREE_PATH` not existing at
script start is the script's own documented idempotent-re-run case (cleanup.sh:11, "Safe to
re-run"), and every existing scenario in `test/scripts/cleanup.test.sh` already exercises this
path (its `new_pair()` fixture never creates a real linked worktree — verified: `grep -c
"worktree add" test/scripts/cleanup.test.sh` is 0, and every fixture's `WORKTREE_PATH` argument
points at a nonexistent directory). So:

```bash
if [ -d "$WORKTREE_PATH" ]; then
  run_git "remove worktree" -- git_child -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
  # Re-probe IMMEDIATELY, not only at the end — a `worktree remove` that
  # returns 0 but leaves a non-empty directory behind (HEL-655's own
  # symptom) must still be caught here, driving the exit code, not merely
  # reported after the fact (round-2 change request 2: design and spec
  # must not disagree on this).
  if [ -d "$WORKTREE_PATH" ]; then
    WT_OK=fail
    fail "worktree still present after removal: $WORKTREE_PATH"
  fi
  WT_OK=ok
else
  WT_OK=ok   # already absent — the postcondition this field tracks is already true
fi
git_child -C "$REPO_ROOT" worktree prune 2>/dev/null || true   # soft, unchanged from today
```

Each other step updates its own field the moment its real outcome is known (`BRANCH_LOCAL=ok`/
`skipped` per Decision 3, `FF_STATUS` already set by `attempt_fast_forward` exactly as today).
Branch-local re-verification (catching a `branch -D` that returned 0 but somehow left the ref
behind) is likewise checked immediately after the delete attempt, not deferred to the very end —
the same "re-probe drives the exit code the moment the postcondition is known to be unmet"
principle applies uniformly, not just to the worktree step:

```bash
if [ "$BRANCH_LOCAL" = "ok" ]; then
  git_child -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${BRANCH}" 2>/dev/null \
    && { BRANCH_LOCAL=fail; fail "branch ${BRANCH} still present after deletion"; }
fi

print_result   # unconditionally, immediately before `READY`, on the success path
```

`RESULT` is printed, to stderr, on every exit path this script takes past the `--phase4` guard —
success, hard-failure via `fail()` (at whatever point it fires, however early, including inside a
command substitution elsewhere in the script), and the existing tolerant-outcome path — so a
caller never needs to parse the rest of stderr's free text to know what happened; it greps one
line on stderr, and it never crashes on an unbound variable regardless of how early a failure
occurs. `READY cleaned worktree=...` is kept, unchanged, for existing callers
(`test/scripts/cleanup.test.sh` already asserts on it extensively — see Decision 6), and remains
reachable exactly when it is today: `WT_OK` is `ok` on both "removed successfully" and "was
already absent", never `fail` on the success path (a `fail`-worthy postcondition already exited
the script via `fail()` before `READY` is ever reached).

Exit code: `0` only when every postcondition this script directly re-probes is confirmed true at
the moment it's checked — by construction this means `WT_OK=ok` and `BRANCH_LOCAL` is `ok` or
`skipped` (never `fail` — a `fail`-worthy state calls `fail()` and exits 1 the instant it's
detected, per the two re-probe snippets above, not merely at the very end). `FF_STATUS` being
`diverged`/`dirty`/etc. does NOT affect the exit code — that outcome is deliberately tolerated
per the existing `main-fast-forward` spec and this ticket's own "keep this case working"
requirement. `1` whenever `fail()` was invoked, for any reason, at any point. This resolves
design-gate round 2's change request 2: `specs/cleanup-failure-visibility/spec.md`'s "the
`RESULT` line's `worktree` and `branch_local` fields are never `fail` on \[the exit-0\] path" and
this decision's exit-code paragraph now say the identical thing, because a re-probe finding a
postcondition unmet is what triggers `fail()`, not a separate later check that could disagree
with it.

### Decision 5: Orchestrator prose update — the load-bearing fix, not an afterthought

`core/roles/orchestrator.md`'s Phase 4 step 1 currently reads (paraphrased): "`cleanup.sh`...
always still exits 0 and prints its normal `READY cleaned worktree=...` line...; this step
completes either way; there is nothing else to handle here." Per Decision 1, this is the actual
mechanism by which the HEL-657 incident went unnoticed for an hour — the script itself already
exited non-zero on that failure. This sentence is rewritten to: (a) actually run/wait for
`cleanup.sh --phase4` and check its exit code; (b) on exit 0, parse the `RESULT` line (Decision
4) and proceed as today; (c) on non-zero exit, treat it exactly like any other environmental
Phase-4 failure already covered by this document's own escalation table — surface a `BLOCKER` to
the human, do not proceed to steps 2-3 (setting the ticket Done, hygiene check) until resolved,
and do not silently retry. `cleanup.sh`'s own header comment (lines 24-27, "ALWAYS exits 0...")
is corrected in the same change — it was already overbroad before this ticket (true only of the
fast-forward comparison outcome, not of every git call in the script), and left as-is it would
actively mislead the very caller this fix is trying to correct.

### Decision 6: Extend the existing test harness, do not build a parallel one

`test/scripts/cleanup.test.sh` (409 lines) already has a throwaway-fixture builder (`new_pair()`:
bare remote + primary clone, with `cleanup.sh`/`emit-event.sh`/`git-child-env.sh` vendored in and
committed) exercising the real, unmodified script as a subprocess — exactly the shape task 1.1
originally proposed building from scratch. Its 11 existing assertions codify today's contract
("must still exit 0 and print `READY cleaned worktree=...`") for every fast-forward outcome
(current, updated via each path, dirty-escalation, diverged-escalation, retry-success,
retry-exhaustion x2, sync-skip, explicit-ticket, run.end-untaggable).

**Correction (design-gate round 2, change request 1):** round 1 of this design claimed these 11
scenarios are unaffected because they're "fast-forward outcomes." That's necessary but not
sufficient — they are *also*, in every case, **absent-worktree runs**: `new_pair()` never creates
a real linked worktree (`grep -c "worktree add" test/scripts/cleanup.test.sh` is 0), and every
fixture passes a `WORKTREE_PATH` argument pointing at a directory that was never created. Under a
naive reading of Decision 4's original "`READY` only when `WT_OK=ok`, and `WT_OK` is only set
`ok` right after `worktree remove` succeeds," these 11 scenarios would never set `WT_OK=ok` at
all (the `worktree remove` call is skipped entirely when the directory doesn't exist), silently
breaking all 11 `has "prints READY ..."` assertions. Decision 4 above is now explicit that
worktree-absence-at-start is itself the satisfied postcondition and sets `WT_OK=ok` directly —
so these 11 scenarios genuinely are unaffected, but because of that explicit branch, not merely
because they're fast-forward scenarios. Baseline, pre-change: `bash test/scripts/cleanup.test.sh`
→ `73 passed, 0 failed`; this suite must still report `73 passed, 0 failed` unmodified once this
change's own new assertions are added on top (never fewer passing, never any of the 11 renamed
away).

New probes for this ticket's hard-failure and branch-deletion behavior are added to this same
file, reusing `new_pair()` for its bare-remote/primary-clone shape but requiring real extensions
`new_pair()` does not currently provide (design-gate round 2, change request 4) — see tasks §1/§5
for the enumerated, explicitly additive/opt-in fixture extensions (a real linked worktree on a
ticket branch, a squash-merge helper, an optional second worktree) needed to exercise
worktree-removal and branch-deletion at all. These extensions must be additive helpers the new
probes opt into, never a change to what `new_pair()` itself produces by default — the existing 11
assertions depend on `new_pair()`'s current (no-worktree) shape, per the correction above. This
also means the new branch-deletion side effects (`branch -D`, `push --delete`) are exercised
inside fixtures built on the same trusted foundation as the rest of the suite, not a second,
less-scrutinized copy. `test/diff-coverage.test.js:53` (which exercises the rendered copy of
`cleanup.sh`) needs no change — it is about sync/diff coverage, not cleanup's own behavior.

## Risks / Trade-offs

- **Behavior change is intentionally breaking**: any existing caller relying on `cleanup.sh`
  always exiting 0 must now handle a non-zero exit — though per Decision 1, the script's exit
  code was already non-zero on a hard failure before this change; what's newly meaningful is that
  a caller now actually *acts* on it. The real caller updated in the same change is the
  orchestrator (Phase 4 step 1, Decision 5). `test/scripts/cleanup.test.sh` is the other real
  consumer (Decision 6) — its 11 existing assertions remain green because worktree-absence is now
  an explicit `WT_OK=ok` branch (Decision 4), not merely because they're fast-forward scenarios
  (round 1's original, insufficient justification); new assertions are added there for the new
  hard-failure/branch-deletion behavior, using explicitly additive fixture extensions, not a
  separate harness.
- **New branch-deletion step is new destructive behavior** on a script that previously only ever
  removed the worktree. Mitigated by content-equality gating (never deletes a branch whose
  content differs from the fetched base) and by keeping remote-delete soft/best-effort.
- **`run_git`'s `mktemp` use** adds a small amount of temp-file churn per hard-failing call;
  negligible, and cleaned up in both success and failure paths.
- **Squash-merge content-equality diff can be expensive on a very large branch** — same cost
  profile as `delivery-squash-guard`'s own pre-squash diff already accepts elsewhere in this
  codebase; not a new class of cost.
