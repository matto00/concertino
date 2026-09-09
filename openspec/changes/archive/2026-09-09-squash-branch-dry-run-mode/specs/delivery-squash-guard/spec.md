## ADDED Requirements

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
