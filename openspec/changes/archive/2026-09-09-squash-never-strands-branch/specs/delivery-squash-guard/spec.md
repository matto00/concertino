## MODIFIED Requirements

### Requirement: A refusal leaves the branch exactly as it found it
The squash step SHALL NOT leave HEAD, the index, or the working tree changed
on any path that ends in anything other than a completed squash commit. (The
recovery mechanism mandated below moves HEAD transiently and then restores it;
what this requirement constrains is the state the step leaves behind, not the
absence of any intermediate movement.)
The merge-base reset SHALL be performed only after the guard has passed, so a
branch whose squash was refused retains its own commits reachable from HEAD
and can be inspected, corrected and re-squashed without consulting the reflog.

This guarantee SHALL extend past the guard to the mutation itself: the step
SHALL record the branch's HEAD immediately before performing the merge-base
reset, and SHALL restore HEAD to that recorded commit if the subsequent commit
does not succeed — for any reason, including a consuming repository's
`pre-commit` hook rejecting the commit, a signing failure, an empty staged set
with nothing for the commit to capture, or an unexpected git error. The restore
SHALL be armed both explicitly on the commit-failure path and against abnormal
catchable termination of the step (`SIGTERM`/`SIGINT`/`SIGHUP`) between the
reset and the commit, so an interrupted squash is not a stranded branch either.
`SIGKILL` is uncatchable and is therefore outside this guarantee. The restore SHALL move only the branch
ref (a soft reset), never discarding index or working-tree content. The step
SHALL still exit non-zero when the commit failed; a restored branch is not a
successful squash.

The step SHALL NOT achieve this guarantee by constructing the commit through a
mechanism that bypasses the consuming repository's commit hooks. Whatever hook
chain a `git commit` from the step runs today SHALL still run, so that the
guarantee is delivered by recovering from a rejection rather than by preventing
the rejection from ever being detected.

If the restore itself fails, the step SHALL report that failure explicitly,
naming both the recorded commit and the current HEAD and pointing at the
reflog, rather than exiting as though the branch had been restored.

#### Scenario: Guard refuses a branch carrying its own commits
- **WHEN** the guard rejects the prospective staged set — because a staged
  path is outside the declared union, or because no usable declaration exists
  while unexpected paths remain
- **THEN** the script exits non-zero having committed nothing, and
  `git rev-parse HEAD` is identical to its value before the script ran

#### Scenario: An earlier precondition fails
- **WHEN** the script stops before the guard for any other reason — an
  ambiguous merge-base, or a merge-base that cannot be computed
- **THEN** HEAD is likewise unchanged, because no reset has been attempted
  at that point

#### Scenario: The commit is rejected by a consuming repository's pre-commit hook
- **WHEN** the guard passes, the step resets to the merge-base, and the
  subsequent `git commit` fails because the repository's `pre-commit` hook
  exits non-zero
- **THEN** the step restores HEAD to the commit the branch was on before the
  reset, leaves the index and working tree as it found them, exits non-zero,
  and reports both that the commit failed and that the branch was restored —
  so the branch is never left at merge-base looking like an empty branch

#### Scenario: Commit hooks still run
- **WHEN** the step creates the squash commit in a repository that installs a
  `pre-commit` hook
- **THEN** that hook runs, exactly as it does for an ordinary `git commit`, and
  a hook that rejects the commit causes the step to fail rather than being
  bypassed

#### Scenario: Nothing is staged, so the commit has nothing to capture
- **WHEN** the prospective staged set is empty, so the guard passes and the
  subsequent commit fails for want of content
- **THEN** the step restores HEAD to its pre-reset commit and exits non-zero,
  rather than leaving the branch at merge-base — the step still does not create
  an empty commit, and still introduces no new refusal for this input

#### Scenario: The step is terminated between the reset and the commit
- **WHEN** the step is terminated by a catchable signal (`SIGTERM`, `SIGINT`
  or `SIGHUP`) after the merge-base reset has moved HEAD but before the commit
  has succeeded
- **THEN** HEAD is restored to its pre-reset commit as the step terminates,
  rather than being left at the merge-base

#### Scenario: A successful squash is unaffected
- **WHEN** the guard passes and the commit succeeds
- **THEN** the squash commit exists on the branch and no restore is performed,
  so the recovery path cannot regress the ordinary success case

#### Scenario: The restore itself fails
- **WHEN** the commit has failed and the attempt to restore HEAD to the
  recorded commit also fails
- **THEN** the step reports that explicitly — naming the recorded commit, the
  current HEAD, and the reflog as the recovery route — and exits non-zero,
  rather than reporting a restoration that did not happen
