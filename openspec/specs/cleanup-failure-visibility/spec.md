# cleanup-failure-visibility Specification

## Purpose
cleanup.sh --phase4's failure-handling contract: hard-failing git operations exit non-zero naming the failing command and its stderr, postconditions are verified by direct re-probe rather than assumed from step exit codes, and a machine-readable RESULT line lets a caller distinguish cleanup completed from cleanup could not run without reading the log.
## Requirements
### Requirement: cleanup.sh exits non-zero and names the failing command when a hard-failing git operation fails
`core/scripts/cleanup.sh --phase4` SHALL exit non-zero when any git operation it depends on for
correctness — worktree removal, local branch deletion once content-equality has been confirmed —
fails unexpectedly. On such a failure it SHALL print, to stderr, the failing command's
description and arguments and the command's own stderr output, before exiting. It SHALL NOT
print the `READY cleaned worktree=...` success line on this path. (Note: `set -e` already causes
today's script to exit non-zero on several of these failures; this requirement is about making
that outcome reliable and legible — a clearly-identified failing command and isolated stderr,
regardless of exactly where in the script the failure occurs — not about a prior "always exits 0"
defect in the script itself. The historically-reported "exited 0, did nothing" symptom traces to
the caller never checking the exit code, addressed separately — see this change's proposal.md
Impact and design.md Decision 1/5.)

#### Scenario: worktree removal fails
- **WHEN** `git worktree remove` fails for a reason other than the worktree already being absent
  (e.g. the underlying repository is unexpectedly in a bad state)
- **THEN** `cleanup.sh --phase4` exits non-zero, prints a message naming `git worktree remove` and
  the command's stderr, and does not print `READY cleaned worktree=...`

#### Scenario: a confirmed-identical branch fails to delete
- **WHEN** content-equality against the fetched base has confirmed the ticket branch has no
  unmerged content, and `git branch -D` on that branch nonetheless fails
- **THEN** `cleanup.sh --phase4` exits non-zero and names `git branch -D` and its stderr

### Requirement: cleanup.sh verifies its own postconditions by direct inspection, and a failed postcondition drives the exit code the moment it's detected
`core/scripts/cleanup.sh --phase4` SHALL initialize its result-tracking fields
(`worktree`, `branch_local`, `branch_remote`, `base`) to `not-attempted` before any step that
could fail, so a `RESULT` line can always be printed — including on the earliest possible hard
failure — without referencing an unset variable. It SHALL directly re-probe ground truth
immediately after each destructive step, not only at the very end: whether `$WORKTREE_PATH` still
exists immediately after an attempted `worktree remove`, and whether the ticket's local branch
ref still exists immediately after an attempted `branch -D`. A postcondition found still unmet at
either of these points (e.g. `git worktree remove` returns success but the directory remains,
or `git branch -D` returns success but the ref remains) SHALL be treated exactly like any other
hard-failing step: it SHALL exit non-zero at that point, not merely be reported in the `RESULT`
line while still exiting 0. `$WORKTREE_PATH` not existing when the script starts (the documented
idempotent-re-run case) SHALL be reported as `worktree=ok` — the postcondition this field tracks
("worktree absent") is already true, not `not-attempted`.

It SHALL print, to **stderr** (never stdout — stdout may be captured by a caller using this
script's own `run_git`-style helper in a command-substitution position, and a `RESULT` line
printed to stdout in that position would be silently discarded), a single machine-readable
summary line of the exact form `RESULT worktree=<ok|fail|not-attempted>
branch_local=<ok|fail|skipped|not-attempted> branch_remote=<ok|fail_or_absent|skipped|
not-attempted> base=<FF_STATUS value>` — where the
`base=` field is always exactly the value `FF_STATUS` already holds
(`current|updated|diverged|dirty|failed|fetch-failed|no-local-base`, or `not-attempted` if the
fast-forward step was never reached) and is never re-collapsed into a separate ok/fail vocabulary
— reflecting what it actually confirmed, on every exit path past the `--phase4` opt-in guard
(both the success path and any `fail()`-triggered exit, however early).

#### Scenario: A clean run reports every postcondition confirmed
- **WHEN** `cleanup.sh --phase4` removes the worktree, deletes the branch, and local `main`
  already matched the remote
- **THEN** it prints `RESULT worktree=ok branch_local=ok branch_remote=ok base=current` (or
  `updated`, if a fast-forward happened) before its `READY cleaned worktree=...` line

#### Scenario: A run where the worktree was already absent still reports success and prints READY
- **WHEN** `cleanup.sh --phase4` runs and `$WORKTREE_PATH` does not exist at all (e.g. a second,
  idempotent invocation after a prior run already removed it)
- **THEN** it reports `worktree=ok` (the postcondition is already satisfied, not
  `not-attempted`) and still prints `READY cleaned worktree=...` on an otherwise-clean run

#### Scenario: A worktree-removal failure is reflected in the RESULT line before exiting
- **WHEN** worktree removal fails and the script calls `fail()`
- **THEN** the printed `RESULT` line shows `worktree=fail`, reflecting the directly-probed state
  rather than an assumed success, and the script exits non-zero without crashing on any unset
  `branch_local`/`branch_remote`/`base` field (each already defaulted to `not-attempted`)

#### Scenario: The RESULT line is observable even on the earliest possible failure, inside a command substitution
- **WHEN** the very first git operation the script depends on (e.g. resolving the repository root
  via `rev-parse --show-toplevel`, captured as `REPO_ROOT="$(...)"`) fails, before the worktree
  block is ever reached
- **THEN** `cleanup.sh --phase4` still prints a `RESULT` line — with `worktree=not-attempted`
  (removal was never reached, distinct from `fail`, which means removal was attempted and the
  postcondition was still unmet) — and that line is observable on the script's stderr stream
  specifically, independent of whatever stdout the surrounding command substitution captured and
  discarded

#### Scenario: A worktree that appears removed but leaves a directory behind still exits non-zero
- **WHEN** `git worktree remove` returns success but `$WORKTREE_PATH` still exists immediately
  afterward (a non-empty-directory leftover)
- **THEN** `cleanup.sh --phase4` treats this as a hard failure at the moment it's detected —
  reports `worktree=fail` and exits non-zero — rather than reporting success because the git
  command itself returned 0

### Requirement: A caller can distinguish "cleanup completed" from "cleanup could not run" without reading the log
`core/scripts/cleanup.sh --phase4`'s exit code alone SHALL be sufficient for a caller to
distinguish these two outcomes: `0` means every postcondition it directly re-probes was confirmed
true (the `RESULT` line's `worktree` and `branch_local` fields are never `fail` on this path —
by construction, since a postcondition found unmet drives an immediate `fail()` exit rather than
being reported after the fact); non-zero means at least one postcondition was found unmet, or an
underlying git operation itself failed. The `RESULT` line SHALL be available for any caller that
wants finer-grained detail than the exit code alone provides.

#### Scenario: Exit code reflects the hard-failure outcome
- **WHEN** any hard-failing step or postcondition (worktree removal or its result, or a
  confirmed-safe branch delete or its result) fails
- **THEN** `cleanup.sh --phase4` exits non-zero

#### Scenario: A tolerated fast-forward outcome does not affect the exit code
- **WHEN** every other postcondition is confirmed but local `main` cannot be fast-forwarded
  (dirty or diverged, per the existing `main-fast-forward` escalation/retry/skip flow)
- **THEN** `cleanup.sh --phase4` still exits 0, with the `RESULT` line's `base=` field naming the
  unresolved outcome (`dirty`, `diverged`, `failed`, `fetch-failed`, or `no-local-base`)

