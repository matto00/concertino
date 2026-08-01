## MODIFIED Requirements

### Requirement: doctor reports when local main is behind its remote and names the usual cause
`concertino doctor` SHALL, on a best-effort basis (skipping silently if the fetch fails, e.g.
offline), fetch the configured base remote/branch and compare it against the local base branch.
The configured base remote SHALL be resolved from `project.baseRemote` in `concertino.config.json`
(defaulting to `origin` when absent) — the same effective value `renderEnv()` writes to
`CONCERTINO_BASE_REMOTE` for `cleanup.sh --phase4` and `assert-phase.sh delivery` to read, so
`doctor` and those scripts SHALL NOT be able to disagree about which remote is "the" base remote
for a given project. `doctor` SHALL NOT hardcode the remote name to a literal. When the local base
branch is strictly behind the fetched remote tip, it SHALL print a warning stating how many
commits it is behind and naming Phase 4 cleanup's fast-forward step (not having run, or a merge
having landed outside the workflow) as the usual cause. When the local base branch is even with or
ahead of the fetched remote tip, `doctor` SHALL NOT print a warning for this check.

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

#### Scenario: doctor resolves a configured non-default base remote
- **WHEN** `concertino.config.json` sets `project.baseRemote` to `"upstream"` and `concertino
  sync` has been run since
- **THEN** `concertino doctor`'s `Git` check fetches and compares against `upstream/<base
  branch>`, not `origin/<base branch>`, and `cleanup.sh --phase4`'s fast-forward step (reading
  `CONCERTINO_BASE_REMOTE=upstream` from the rendered `.concertino.env`) resolves to the same
  remote, so the two checks agree

#### Scenario: absent configuration, behavior is unchanged
- **WHEN** `concertino.config.json` has no `project.baseRemote` field
- **THEN** `doctor`'s `Git` check and `cleanup.sh --phase4`'s fast-forward step both resolve the
  base remote to `origin`, identical to behavior before this field existed
