# git-child-env-hardening Specification

## Purpose
Guards every concertino script that shells out to `git` against the git-exported `GIT_*` environment leak from a linked worktree's hook subprocess re-targeting a different real repository, via a `git_child` prefix-strip helper and its verified call sites.
## Requirements
### Requirement: git_child helper strips GIT_* by prefix
`core/scripts/lib/git-child-env.sh` SHALL provide a `git_child` shell function that, before
exec'ing a child `git` invocation, unsets every environment variable whose name matches the
prefix `GIT_` (via `compgen -v GIT_`), not an enumerated list of variable names. The strip SHALL
run inside a `()` subshell so it never leaks into the calling script's own environment.

#### Scenario: Poisoned GIT_DIR does not redirect a git_child call
- **WHEN** a process exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`,
  `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at a different
  ("poisoned") repository, and calls `git_child -C <target-dir> <args>`
- **THEN** the invocation SHALL operate on `<target-dir>`, not the poisoned repository

#### Scenario: A yet-unnamed GIT_* variable is still stripped
- **WHEN** a `GIT_*`-prefixed environment variable not present in any historical denylist (e.g. a
  newly introduced git-exported variable) is set in the caller's environment
- **THEN** `git_child` SHALL still strip it, because the strip matches by prefix rather than by
  an enumerated name

#### Scenario: Strip does not leak into the caller's environment
- **WHEN** a script sources `git-child-env.sh` and calls `git_child` one or more times
- **THEN** the script's own environment (outside the `git_child` subshell) SHALL still have its
  original `GIT_*` variables set, unaffected by any `git_child` call

### Requirement: Four call sites use git_child instead of bare git
The four scripts `core/scripts/assert-phase.sh`, `core/scripts/cleanup.sh`, `core/scripts/setup-worktree.sh`, and `core/scripts/start-servers.sh` SHALL source `lib/git-child-env.sh` and SHALL route every git invocation that targets worktree/repository state through `git_child` rather than a bare `git` call.

#### Scenario: No bare git invocations remain in the four scripts
- **WHEN** any of the four scripts is inspected for direct `git <subcommand>` invocations (e.g.
  `-C`, `rev-parse`, `worktree`, `show-ref`, `fetch`, `status`, `merge`, `update-ref`, `log`)
- **THEN** every such invocation SHALL be routed through `git_child`, with none remaining bare

### Requirement: setup-worktree.sh hook-eval sequencing
`core/scripts/setup-worktree.sh`'s `CONCERTINO_WORKTREE_HOOKS` eval loop SHALL use the line
`( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
verbatim, including its enclosing `( ... ) || true` subshell — a failed `cd` SHALL unconditionally
skip the hook body (the `GIT_*` strip and the subsequent `eval "$hook"` reachable only after a
successful `cd "$WORKTREE_PATH"`), and the `cd`/strip/`eval` SHALL all be confined to the
subshell so none of them leak into the calling script's own cwd or environment.

#### Scenario: Failed cd never reaches eval, and the loop continues
- **WHEN** `$WORKTREE_PATH` does not exist (or `cd` otherwise fails) for a given hook
- **THEN** neither the `GIT_*` strip nor `eval "$hook"` SHALL execute; the subshell's `exit 0`
  SHALL end only that subshell (not the whole script), the outer `|| true` SHALL prevent this
  hook's failure from aborting the loop, and the calling script's own cwd/environment SHALL be
  unaffected

#### Scenario: Successful cd runs the strip then the hook, confined to the subshell
- **WHEN** `cd "$WORKTREE_PATH"` succeeds inside the subshell
- **THEN** the `GIT_*` strip SHALL run unconditionally (independent of any other command's exit
  status), followed by `eval "$hook"`, both inside the worktree directory and confined to the
  subshell — the calling script's own cwd and `GIT_*` environment SHALL be unchanged after the
  subshell exits

### Requirement: Regression selftest asserts against the real shipped file
`core/scripts/lib/git-child-env.selftest.sh` SHALL include a check that asserts directly against
the literal content of the sibling `setup-worktree.sh`'s real hook-eval line — resolved relative
to the selftest's own location (so the check is correct both in-place under `core/scripts/` and
post-render under `scripts/concertino/`), not an inline copy of the pattern embedded in the
selftest itself — such that reverting only the real line to the buggy
`( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ 2>/dev/null) || true; eval "$hook" >/dev/null 2>&1 ) || true`
sequencing (the enclosing subshell preserved, only the internal `cd`/`unset`/`eval`
punctuation reverted to the buggy `&&`/`||`/`;` form) causes the selftest to fail, even if the
selftest file itself is untouched.

#### Scenario: Selftest goes red when only the real file regresses
- **WHEN** `core/scripts/setup-worktree.sh`'s hook-eval line is reverted to the buggy
  `( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ 2>/dev/null) || true; eval "$hook" >/dev/null 2>&1 ) || true`
  form, and the selftest file itself is left unmodified
- **THEN** running the selftest SHALL exit non-zero and report a failure naming the sequencing
  regression

#### Scenario: Selftest exercises all four call sites under a simulated poisoned env
- **WHEN** the selftest runs
- **THEN** it SHALL simulate a poisoned hook environment (the repo-locating `GIT_*` variables set
  to an unrelated "poisoned" repository) and confirm each of the four scripts' `git_child`-wrapped
  call-site patterns still resolves the intended target repository, not the poisoned one

### Requirement: core/scripts/ renders and drift-checks a nested lib/ directory
The render engine (`lib/cli/emit.js`'s `copyAssets`) and the doctor drift check (`lib/cli/doctor.js`'s `checkArtifacts`) SHALL recursively enumerate `core/scripts/`, including files under nested subdirectories such as `core/scripts/lib/`, rather than the flat single-level `fs.readdirSync` enumeration that throws `EISDIR` on any directory entry.

#### Scenario: A render produces the nested helper files
- **WHEN** `concertino sync` renders a project whose `core/scripts/` contains
  `lib/git-child-env.sh` and `lib/git-child-env.selftest.sh`
- **THEN** the rendered project SHALL contain `scripts/concertino/lib/git-child-env.sh` and
  `scripts/concertino/lib/git-child-env.selftest.sh`, both with the executable bit set (`0o755`)

#### Scenario: Doctor detects drift in a nested file
- **WHEN** a rendered `scripts/concertino/lib/git-child-env.sh` differs byte-for-byte from
  `core/scripts/lib/git-child-env.sh`
- **THEN** `concertino doctor` SHALL report it as differing from core, exactly as it already does
  for flat (non-nested) rendered scripts

#### Scenario: Existing flat scripts are unaffected
- **WHEN** `core/scripts/` contains only flat files (no subdirectories), as in every project prior
  to this change
- **THEN** render and doctor behavior SHALL be identical to before this change

