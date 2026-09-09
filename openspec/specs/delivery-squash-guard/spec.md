# delivery-squash-guard Specification

## Purpose
Canonical procedure for squashing a delivery branch that always resets against the branch's true merge-base (never the base ref's live tip), guards the staged file set against the run's declared scope, and always surfaces the staged file count and list before committing.

## Requirements

### Requirement: Squash resets against the branch's true merge-base
The delivery squash step SHALL reset the branch against
`git merge-base HEAD <base-ref>` rather than against `<base-ref>`'s current
tip, so commits landed on the base after the branch diverged are never staged
as reverts.

#### Scenario: Base advanced with an unrelated merge during Execution
- **WHEN** a sibling change merges to the base ref while this branch is still
  in its Execution/Evaluation loop, and the branch later reaches Delivery
- **THEN** squashing resets against the merge-base computed at squash time,
  and the sibling change's files are not staged for deletion or modification

### Requirement: Staged file set is guarded against the run's declared touched-file set
The squash step SHALL compare the file set that the merge-base reset *would*
stage — computed without moving HEAD — against the union of (a) a
caller-supplied `<CHANGE_DIR>/**` workflow-artifact allowlist (never hardcoded
in the script itself) and (b) the paths parsed out of the change's
`files-modified.md` declaration **as that declaration exists in the index**,
and SHALL stop without committing if that set contains any file outside that
union. The declaration SHALL be read from the staged blob, never from the
worktree file, so the content the guard validates is the content the commit
captures.

#### Scenario: Staged set exceeds the declared touched-file set
- **WHEN** the prospective staged file list contains a path absent from both
  the fixed workflow-artifact allowlist and the parsed `files-modified.md`
  declaration
- **THEN** the script exits non-zero, commits nothing, and reports the
  unexpected file(s) explicitly

#### Scenario: Staged set matches the declared touched-file set
- **WHEN** every prospective staged file is present in the fixed
  workflow-artifact allowlist or the parsed `files-modified.md` declaration
- **THEN** the script resets against the merge-base and creates the squash
  commit

#### Scenario: A workflow artifact is staged but not individually named in files-modified.md
- **WHEN** a prospective staged file falls under the caller-supplied
  `<CHANGE_DIR>/**` (e.g. `proposal.md`, `workflow-state.md`, a `skeptic-*.md`
  report) and is not itself listed in `files-modified.md`
- **THEN** the script proceeds without stopping, because the change-dir
  allowlist already covers it — regardless of whether `<CHANGE_DIR>` is
  `openspec/changes/<name>` or a project-configured alternative

#### Scenario: files-modified.md yields no parseable paths while staged files remain outstanding
- **WHEN** the staged `files-modified.md` blob is absent, or its content
  contains no line matching a leading-bullet backtick-quoted path, and at least
  one prospective staged file falls outside the fixed workflow-artifact
  allowlist
- **THEN** the script fails loudly — printing the raw declaration content (if
  present) and the outstanding staged paths — and exits non-zero unless
  `--allow-empty-declaration` was passed, in which case it proceeds

#### Scenario: The on-disk declaration differs from the staged declaration
- **WHEN** the worktree copy of `<CHANGE_DIR>/files-modified.md` differs from
  the blob staged in the index at squash time
- **THEN** the script exits non-zero, commits nothing, and reports the
  divergence together with the remedy (stage the corrected declaration, or
  revert it, then re-run) — the divergence is never resolved silently toward
  either copy

#### Scenario: The declaration exists on disk but is absent from the index
- **WHEN** `<CHANGE_DIR>/files-modified.md` is present in the worktree but has
  no staged blob (untracked, or staged for deletion)
- **THEN** the script exits non-zero with a diagnostic naming that specific
  cause AND stating the self-service remedy (stage the declaration, then
  re-run), rather than falling through to the generic no-usable-declaration
  branch whose remedy would be the wrong one

#### Scenario: The declaration is absent from the worktree but present in the index
- **WHEN** `<CHANGE_DIR>/files-modified.md` has a staged blob but no worktree
  file
- **THEN** the script parses the staged blob and proceeds — this is not a
  divergence, because the staged blob is exactly what the commit will capture —
  and the declaration it contains is still enforced, so a staged file that blob
  does not declare is still refused

#### Scenario: --allow-empty-declaration does not suppress a declaration divergence
- **WHEN** the declaration diverges between index and worktree, or is present on
  disk but absent from the index, and `--allow-empty-declaration` is passed
- **THEN** the script still exits non-zero and commits nothing, because that
  flag opts in only to the narrowly-stated no-usable-declaration condition and
  is never a general proceed-anyway switch

### Requirement: Staged file count and list are always printed before committing
The squash step SHALL print the prospective staged file count and the full
staged file list before creating any commit and before performing the reset,
regardless of whether the guard trips.

#### Scenario: Ordinary successful squash
- **WHEN** the guard passes and the script proceeds to reset and commit
- **THEN** the staged file count and list were already printed to output
  before that reset and commit

### Requirement: Base advancement is logged explicitly
The squash step SHALL detect and log when the base ref's tip differs from the
computed merge-base (i.e. the base advanced since the branch point), without
requiring a rebase before squashing.

#### Scenario: Base ref tip differs from merge-base
- **WHEN** `<base-ref>`'s current tip is not identical to
  `git merge-base HEAD <base-ref>`
- **THEN** the script logs that the base advanced and how many commits
  separate the merge-base from the base ref's tip, then proceeds using D1's
  merge-base reset

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

### Requirement: The guard is consultable without submitting to it
The squash step SHALL support a dry-run invocation, requested by setting the
`DRY_RUN` environment variable to `1`, that answers "would this pass?" without
performing the squash. Under a dry run the step SHALL perform every validation
it performs otherwise — merge-base computation and the ambiguous-merge-base
refusal, base-advancement detection, computation of the prospective staged file
set, the staged-declaration presence, index/worktree divergence and
on-disk-but-unstaged checks, declaration parsing, and the allowlist comparison —
and SHALL reach the same guard verdict, exiting with the same status code the
identical invocation would have produced with `DRY_RUN` unset **for every
validation outcome**. This identity is scoped to the guard's own verdict: a dry
run performs no reset and no commit, so it SHALL NOT be required to predict
failure of those git operations themselves — a wet invocation whose guard passes
but whose reset or commit subsequently fails exits non-zero from a path a dry run
never enters, and that divergence is outside this requirement. A dry run SHALL
NOT weaken, skip, or soften any refusal: every condition that refuses today SHALL
still refuse, with the same non-zero status.

#### Scenario: Dry run on a branch whose guard would pass

- **WHEN** the step is invoked with `DRY_RUN=1` on a branch whose prospective
  staged file set lies entirely within the allowed union, so a normal
  invocation would have reset and committed
- **THEN** the step reports that the guard passed, exits zero, and performs no
  branch mutation whatsoever: `HEAD` is identical before and after, the index
  is identical before and after, and no squash commit exists

#### Scenario: Dry run on a branch whose guard would refuse

- **WHEN** the step is invoked with `DRY_RUN=1` on a branch that a normal
  invocation would have refused — a staged path outside the declared union, no
  usable declaration while unexpected paths remain, a declaration diverging
  between index and worktree, a declaration present on disk but absent from the
  index, or an ambiguous merge-base
- **THEN** the step reports the same refusal with the same diagnostic detail and
  exits with the same non-zero status it would have exited with without the
  flag, and likewise mutates nothing

#### Scenario: A dry run does not predict failure of the reset or commit themselves

- **WHEN** the guard passes on an input for which the wet path's own `git reset`
  or `git commit` would subsequently fail — for example a prospective staged set
  that is empty, so there is nothing for the commit to capture
- **THEN** the dry run truthfully reports that the guard passed and exits zero,
  and this is not a violation of the exit-code identity above, because that
  identity covers the guard's verdict and not the outcome of git operations the
  dry run deliberately does not perform

#### Scenario: A dry run is unambiguously distinguishable from a completed squash

- **WHEN** the step completes a dry run on a branch whose guard would pass
- **THEN** its output states explicitly that this was a dry run and that nothing
  was committed, so the transcript cannot be mistaken for a transcript of a
  squash that actually happened

#### Scenario: The default invocation is unchanged

- **WHEN** the step is invoked with `DRY_RUN` unset, or set to any value other
  than `1`
- **THEN** it behaves exactly as it did before this capability existed —
  refusing where it refused, and on success resetting against the merge-base and
  creating the squash commit
