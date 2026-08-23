## ADDED Requirements

### Requirement: cleanup.sh resolves the ticket branch to delete even when the worktree is already gone
`core/scripts/cleanup.sh --phase4` SHALL resolve which branch to delete via, in order: (1) when
`$WORKTREE_PATH` exists, the branch that worktree has checked out, captured before it is removed;
(2) when `$WORKTREE_PATH` does not exist (an idempotent re-run after a prior partial cleanup left
the branch behind), a search of local branches by the project's own naming convention (any local
branch ending in `/<TICKET_ID>`). If step 2 finds zero or more than one matching branch, it SHALL
NOT guess — it SHALL leave the branch unresolved (`branch_local=skipped`) rather than deleting an
ambiguous or unconfirmed branch.

#### Scenario: A worktree still present resolves its own checked-out branch
- **WHEN** `cleanup.sh --phase4` runs and `$WORKTREE_PATH` exists
- **THEN** the branch to delete is the one that worktree has checked out, captured before removal

#### Scenario: A worktree already gone still resolves the branch by naming convention
- **WHEN** `cleanup.sh --phase4` runs on a re-run where `$WORKTREE_PATH` no longer exists but a
  local branch named `.../<TICKET_ID>` still exists
- **THEN** `cleanup.sh --phase4` resolves that branch and proceeds to the content-equality check,
  rather than leaving the branch unresolved just because no worktree exists to read it from

#### Scenario: An ambiguous branch match is never guessed at
- **WHEN** `$WORKTREE_PATH` does not exist and zero, or more than one, local branch matches
  `.../<TICKET_ID>`
- **THEN** `cleanup.sh --phase4` reports `branch_local=skipped` and does not attempt any deletion

### Requirement: cleanup.sh deletes the ticket branch by content-equality, not merge-ancestry
`core/scripts/cleanup.sh --phase4` SHALL determine whether the ticket branch is safe to delete
by comparing its content against the fetched base branch — `git diff <base_remote>/<base_branch>
<branch>` (two-dot form) being empty — NOT by `git branch -d`'s merge-ancestry check, and NOT by
the three-dot form `git diff <base_remote>/<base_branch>...<branch>` (merge-base-relative, not
content-equality — non-empty for exactly the squash-merge case this requirement exists to
handle). It SHALL NOT treat a `git branch -d` refusal, or an equivalent ancestry-based signal, as
proof that unmerged work exists.

#### Scenario: A squash-merged branch is recognized as safe to delete
- **WHEN** the ticket branch was squash-merged into the base branch (so its commits are not
  ancestors of the base branch's tip, but its content is identical)
- **THEN** `cleanup.sh --phase4` deletes the branch, because content-equality confirms it, even
  though `git branch -d` would have refused

#### Scenario: A branch with genuinely unmerged content is left alone
- **WHEN** `git diff <base_remote>/<base_branch> <branch>` (two-dot form) is non-empty
- **THEN** `cleanup.sh --phase4` does not delete the branch and reports `branch_local=skipped` in
  its `RESULT` line

### Requirement: The worktree is removed before the branch it used is deleted
`core/scripts/cleanup.sh --phase4` SHALL remove the worktree using the ticket branch before
attempting to delete that branch, since `git branch -D` fails while a worktree still has the
branch checked out.

#### Scenario: Branch deletion is attempted only after worktree removal
- **WHEN** `cleanup.sh --phase4` runs on a worktree still checked out to the ticket branch
- **THEN** the worktree removal step completes (or the script has already exited non-zero on its
  failure) before any `git branch -D` call is attempted

### Requirement: cleanup.sh never deletes the base branch
`core/scripts/cleanup.sh --phase4` SHALL NOT attempt to delete the configured base branch
(`CONCERTINO_BASE_BRANCH`, default `main`), regardless of what branch a worktree reports as
checked out.

#### Scenario: A worktree misconfigured onto the base branch is not deleted
- **WHEN** the worktree's checked-out branch happens to equal the configured base branch
- **THEN** `cleanup.sh --phase4` does not attempt to delete it and reports `branch_local=skipped`

### Requirement: Remote branch deletion is best-effort and does not fail the run
`core/scripts/cleanup.sh --phase4` SHALL attempt to delete the ticket branch on the configured
base remote once local content-equality has been confirmed, but a failure to do so (including the
remote branch already being absent, e.g. via the host's "delete branch on merge" default) SHALL
NOT cause the script to exit non-zero.

#### Scenario: The remote branch is already gone
- **WHEN** the remote branch was already deleted (e.g. by GitHub's delete-on-merge setting) before
  `cleanup.sh --phase4` runs
- **THEN** the remote-delete attempt fails harmlessly, `branch_remote=fail_or_absent` is reported
  in the `RESULT` line, and the script's exit code is unaffected
