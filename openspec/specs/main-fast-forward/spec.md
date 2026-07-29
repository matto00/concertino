# main-fast-forward Specification

## Purpose
Bring local `main` forward automatically and safely as part of Phase 4 cleanup — fast-forwarding
silently when it's clean, escalating with a bounded retry/skip loop when it isn't, re-rendering
afterward so rendered artifacts can't go stale, and letting `doctor` name this as the usual cause
when it reports local `main` behind its remote.
## Requirements
### Requirement: cleanup.sh fast-forwards local main on a clean, unambiguous fast-forward
`core/scripts/cleanup.sh --phase4`, after removing the worktree, SHALL fetch the configured base
remote/branch (`CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH`, same defaults as
`setup-worktree.sh`: `origin`/`main`) and, when the local base branch's tip is already equal to
the fetched remote tip, do nothing further for this step (no output beyond routine cleanup
output). When the local base branch is a strict ancestor of the fetched remote tip, it SHALL
bring the local base branch forward to match: via `git update-ref` when the base branch is not
checked out in any worktree, or via `git merge --ff-only` in whichever worktree has it checked
out when that worktree's tree is clean. Neither path SHALL touch any file outside the `.git`
metadata of the ref being moved.

#### Scenario: Local main already matches the remote
- **WHEN** `cleanup.sh --phase4` runs and local `main`'s tip already equals `origin/main`'s tip
  after fetching
- **THEN** no ref is changed and nothing beyond routine cleanup output is printed for this step

#### Scenario: Local main is behind and not checked out anywhere
- **WHEN** `cleanup.sh --phase4` runs, local `main` is a strict ancestor of `origin/main`, and no
  worktree (including the primary checkout) currently has `main` checked out
- **THEN** `refs/heads/main` is updated to `origin/main`'s commit via `git update-ref`, with no
  working tree touched

#### Scenario: Local main is behind and checked out in a clean worktree
- **WHEN** `cleanup.sh --phase4` runs, local `main` is a strict ancestor of `origin/main`, and
  `main` is checked out in a worktree whose `git status --porcelain` is empty
- **THEN** that worktree's `main` is fast-forwarded to `origin/main` via `git merge --ff-only`,
  and the fast-forward proceeds silently

### Requirement: cleanup.sh never fast-forwards over uncommitted work or a diverged base
`cleanup.sh --phase4` SHALL NOT run `git merge --ff-only`, `git update-ref`, or any other
ref-moving or working-tree-modifying command against the base branch when the worktree that has
it checked out is dirty (`git status --porcelain` non-empty there), or when local `main` is not a
strict ancestor of the fetched remote tip (i.e. local `main` carries commits `origin/main` does
not have — a diverged base). In either case it SHALL leave every ref and every file exactly as it
found them and proceed to the escalation described below.

#### Scenario: Dirty tree blocks the fast-forward
- **WHEN** `cleanup.sh --phase4` runs, local `main` is a strict ancestor of `origin/main`, and the
  worktree with `main` checked out has uncommitted changes
- **THEN** no ref is moved, no file in that worktree is touched, and the escalation described
  below is raised instead

#### Scenario: A diverged local main blocks the fast-forward
- **WHEN** `cleanup.sh --phase4` runs and local `main` has at least one commit `origin/main` does
  not have (not a strict ancestor)
- **THEN** no ref is moved and the escalation described below is raised instead

### Requirement: An unresolvable fast-forward escalates with a bounded retry/skip loop
`cleanup.sh --phase4` SHALL call `emit-event.sh escalation --await` and block on the result
whenever it cannot fast-forward local `main` cleanly (dirty tree, diverged base, or the
fast-forward attempt itself failing unexpectedly), passing `ticket=<the ticket being cleaned
up>`, a `question=` naming the reason, and `options=retry,skip`. An answer of exactly
`retry` SHALL cause the fast-forward algorithm to run once more; any other answer (including a
free-text reply, or a timeout) SHALL be treated as `skip`. Across one `cleanup.sh --phase4`
invocation, this SHALL escalate and retry at most once more (two total fast-forward attempts) —
a second unresolved failure SHALL log a note and proceed without re-escalating. Regardless of
outcome, the rest of Phase 4 (already-completed worktree removal, and whatever the caller does
afterward) SHALL proceed — `cleanup.sh --phase4` SHALL NOT fail or exit non-zero solely because
the fast-forward could not complete.

#### Scenario: A retry answer re-attempts and succeeds
- **WHEN** the fast-forward escalates due to a dirty tree, the human stashes their work out of
  band and answers `retry`
- **THEN** `cleanup.sh` re-runs the fast-forward algorithm, and if the tree is now clean and still
  a strict ancestor, the fast-forward completes silently and `cleanup.sh --phase4` still prints
  its normal `READY cleaned worktree=...` line

#### Scenario: A skip answer proceeds without touching main
- **WHEN** the fast-forward escalates and the human answers `skip` (or any reply other than
  exactly `retry`, or the escalation times out)
- **THEN** local `main` is left exactly as it was, and `cleanup.sh --phase4` still completes and
  prints its normal `READY cleaned worktree=...` line

#### Scenario: A second consecutive failure does not escalate a third time
- **WHEN** the human answers `retry` and the re-attempted fast-forward also fails to resolve
  cleanly
- **THEN** `cleanup.sh --phase4` logs a note that `main` remains behind and completes without
  raising a second escalation

### Requirement: A successful fast-forward triggers a best-effort re-render
`cleanup.sh --phase4` SHALL attempt to re-render the project's rendered artifacts (equivalent to
running `concertino sync` against the checkout whose `main` was just moved) immediately after it
successfully brings local `main` forward (silently, or after a `retry`). If that re-render
attempt fails or `concertino`'s binary is not resolvable from that checkout, `cleanup.sh` SHALL
NOT fail the script or the fast-forward on that account — it SHALL print a note to stderr stating
that a manual `concertino sync` is needed.

#### Scenario: Re-render runs after a successful fast-forward
- **WHEN** `cleanup.sh --phase4` successfully fast-forwards local `main`
- **THEN** it subsequently attempts a re-render of the checkout's rendered artifacts

#### Scenario: A failed re-render is noted, not fatal
- **WHEN** the post-fast-forward re-render attempt itself fails
- **THEN** `cleanup.sh --phase4` still completes successfully and prints a note to stderr that a
  manual `concertino sync` is needed

### Requirement: doctor reports when local main is behind its remote and names the usual cause
`concertino doctor` SHALL, on a best-effort basis (skipping silently if the fetch fails, e.g.
offline), fetch the configured base remote/branch and compare it against the local base branch.
When the local base branch is strictly behind the fetched remote tip, it SHALL print a warning
stating how many commits it is behind and naming Phase 4 cleanup's fast-forward step (not having
run, or a merge having landed outside the workflow) as the usual cause. When the local base branch
is even with or ahead of the fetched remote tip, `doctor` SHALL NOT print a warning for this
check.

#### Scenario: doctor warns when local main is behind
- **WHEN** `concertino doctor` runs and local `main` is 3 commits behind the fetched
  `origin/main`
- **THEN** doctor prints a warning naming the commit count and stating that Phase 4 cleanup's
  fast-forward not having run (or an out-of-workflow merge) is the usual cause

#### Scenario: doctor is silent when local main is current or ahead
- **WHEN** `concertino doctor` runs and local `main`'s tip is equal to or a descendant of the
  fetched `origin/main`
- **THEN** doctor prints no warning for this check

#### Scenario: doctor degrades silently when it cannot fetch
- **WHEN** `concertino doctor` runs and fetching the base remote/branch fails (e.g. no network)
- **THEN** doctor skips this check without printing an error or warning for it, and the rest of
  doctor's checks still run

