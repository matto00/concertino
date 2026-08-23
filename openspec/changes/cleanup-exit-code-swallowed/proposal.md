## Why

`core/scripts/cleanup.sh --phase4` swallows every git failure inside it and always exits 0 and
always prints `READY cleaned worktree=...`, regardless of whether any actual work happened. On
the HEL-657 delivery this meant a git failure (`fatal: this operation must be run in a work
tree`) produced a "clean cleanup" report while the worktree, local branch, and stale `main` were
all left exactly as they were — discovered an hour later by an unrelated ticket. Because no
caller (orchestrator, TUI, CI) can currently distinguish "cleanup completed" from "cleanup could
not run" without reading the log, this is a silent-failure hazard on every Phase-4 teardown.
Separately, `cleanup.sh` today never deletes the ticket branch at all (local or remote) — the
session that surfaced this ticket found 7 of 8 runs left the branch behind by hand-inspection,
which corroborates this omission rather than a transient bug.

## What Changes

- **BREAKING**: `cleanup.sh --phase4`'s exit code becomes a decision-affecting caller input.
  (Revised after design-gate round 1: the script already exits non-zero on the incident's own
  trigger today via `set -e` — probed directly, exit 128. What actually swallowed the failure was
  the *caller* — `core/roles/orchestrator.md`'s own Phase 4 prose told the orchestrator never to
  check the exit code. This change makes hard git failures name the failing command and its
  stderr explicitly via a `run_git` helper — improving message quality and making the exit code
  reliable regardless of exactly where in the script a failure occurs — and, critically, fixes
  the caller to actually check it.)
- Add branch deletion (local + remote) to `cleanup.sh`, using content-equality
  (`git diff <base_remote>/<base_branch> <branch>` — two-dot, empty means safe to delete — not
  three-dot `...` ancestry-relative diff, and not `git branch -d`'s merged-ancestry check, both
  of which incorrectly refuse/misreport after a squash merge). The worktree is removed before the
  branch delete is attempted (`git branch -D` fails while a worktree still uses the branch). The
  branch to delete is resolved even when the worktree is already gone (a re-run after a prior
  partial cleanup) via a naming-convention fallback (`.../<TICKET_ID>`), never guessed at when
  ambiguous (revised after design-gate round 2 — this is the ticket's own most-cited real case,
  "7 of 8 runs left the branch behind").
- Add postcondition verification that drives the exit code the moment a postcondition is found
  unmet, not merely reported after the fact: worktree absent (including "was already absent," a
  satisfied postcondition, not a no-op), local branch absent, remote branch absent, local
  `<base>` == fetched `<base_remote>/<base>`. Each is independently probed and reported
  (confirmed / not confirmed / not attempted); a postcondition found unmet immediately after its
  own step (e.g. `worktree remove` returns 0 but the directory remains) exits non-zero right
  there, so design and the script's own behavior never disagree about what "exit 0" means
  (revised after design-gate round 2, which found the original design permitted `exit 0` with a
  `RESULT worktree=fail` line — the ticket's own headline defect, reintroduced by omission).
- Add a machine-readable summary line callers can parse without reading the full log:
  `RESULT worktree=<ok|fail|not-attempted> branch_local=<ok|fail|skipped|not-attempted>
  branch_remote=<ok|fail_or_absent|skipped|not-attempted>
  base=<current|updated|diverged|dirty|failed|fetch-failed|no-local-base|not-attempted>` (the
  `base=` field is always exactly the existing `FF_STATUS` value, never a separate vocabulary),
  alongside the existing `READY cleaned worktree=...` line kept for compatibility with existing
  callers that grep for it — emitted only when the run is actually clean by the postcondition
  pass, never blindly. Printed on every exit path, including the earliest possible hard failure —
  never on an unbound-variable crash.
- "Main cannot fast-forward" (dirty tree / diverged base) remains a distinct, reportable,
  non-fatal outcome — not folded into the new hard-failure path, and not silently skipped either.
  This is the one already-real, already-exercised case (tonight's diverged local `main`) the
  fix must keep working correctly.
- No bare-repo support. No changes outside `core/scripts/cleanup.sh` and its own probe/selftest
  scaffolding, except the minimum spec-delta and doc updates this change requires.

## Capabilities

### New Capabilities

- `cleanup-failure-visibility`: `cleanup.sh --phase4`'s failure-handling contract — git
  operations must fail loudly and non-zero rather than being swallowed, postconditions are
  verified by result rather than assumed from exit codes, and the result is reported in a
  caller-parseable form.
- `cleanup-branch-deletion`: `cleanup.sh --phase4` deletes the ticket's local and remote branch
  once its content is confirmed identical to the merged base (content-equality, not ancestry),
  after the worktree using it has been removed.

### Modified Capabilities

- `main-fast-forward`: the existing requirement that fast-forward telemetry "SHALL NOT change
  `cleanup.sh --phase4`'s exit code" is narrowed — an *unresolved* fast-forward (dirty/diverged/
  unknown after retry) still does not fail the script (unchanged, and it's the real case this
  ticket must keep working), but an *actual git command failure* elsewhere in the script (not
  the deliberately-tolerant fast-forward comparison path) now does.

## Impact

- `core/scripts/cleanup.sh` — primary change.
- `core/scripts/cleanup.sh`'s own header comment (lines 24-27, "ALWAYS exits 0 ... regardless of
  whether the fast-forward below succeeded, escalated, or was skipped") is corrected — it was
  already overbroad before this ticket (true only of the fast-forward outcome) and, left as
  written, would keep misleading the very caller this change fixes.
- `core/scripts/lib/git-child-env.sh` — reused unchanged (`git_child` env hardening); no change
  needed, cleanup.sh's new hard-failing paths call `git_child` the same way existing callers do.
- `core/roles/orchestrator.md` — Phase 4 step 1 currently instructs the orchestrator never to
  check `cleanup.sh --phase4`'s exit code ("It always still exits 0 ... this step completes
  either way; there is nothing else to handle here"). This is the load-bearing fix in this
  change, not incidental cleanup: the orchestrator must now actually check the exit code and
  treat non-zero as an environmental `BLOCKER`, per this document's own existing escalation
  table.
- `test/scripts/cleanup.test.sh` — the other real, direct consumer of `cleanup.sh` (grepped and
  found in design-gate round 1; the original "no other script invokes cleanup.sh" claim was true
  only of `lib/`). Its existing 11 assertions are all fast-forward-outcome scenarios and are
  unaffected by this change (see design.md Decision 6); new assertions for hard-failure and
  branch-deletion behavior are added to this same file, reusing its existing `new_pair()` fixture
  builder rather than a parallel harness.
- `scripts/concertino/cleanup.sh` (this repo's own rendered copy) picks up the change via
  `concertino sync` — not hand-edited directly.
- No schema, API, or frontend impact.
