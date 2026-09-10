# spawn-cwd-guard Specification

## Purpose
Every ticket-delivery role that is spawned against a specific worktree must mechanically verify, before any other action, that its ambient working directory does not collide with a different ticket's worktree — closing the gap where an agent silently inherits an ambient cwd pointed at another lane's tree instead of its own pinned `WORKTREE_PATH`, while tolerating the ordinary ancestor relationship a normal spawn's ambient cwd has to `WORKTREE_PATH`.

## Requirements

### Requirement: Every worktree-bound role captures and verifies its ambient cwd and WORKTREE_PATH's branch before any other action
Any role that receives a `WORKTREE_PATH` input (executor, evaluator, skeptic, auditor) SHALL, as its literal first action before any read or write of ticket content, code, or state, capture its own inherited ("ambient") working directory exactly as received at spawn time, and mechanically verify that (a) this ambient directory does NOT resolve inside a worktree other than `WORKTREE_PATH` under the same worktree-base directory, and (b) `WORKTREE_PATH`'s checked-out git branch equals the run's `BRANCH` input. An ambient directory that is an ancestor of `WORKTREE_PATH`, or that does not resolve inside the worktree-base directory at all, SHALL NOT be treated as a mismatch — only an ambient directory resolving inside a *different* ticket's worktree constitutes a mismatch.

#### Scenario: Normal spawn — ambient cwd is the driver/orchestrator's own root, an ancestor of WORKTREE_PATH
- **WHEN** a role is spawned with `WORKTREE_PATH`/`BRANCH` set for run A, and the role's actual inherited working directory is the driver/orchestrator's own root — an ancestor of `WORKTREE_PATH`, not itself resolving inside any single ticket's worktree — and `WORKTREE_PATH` is checked out to `BRANCH`
- **THEN** the verification passes and the role proceeds; no other actions are blocked

#### Scenario: Normal spawn — ambient cwd is an unrelated directory in a different repository entirely
- **WHEN** a role is spawned with `WORKTREE_PATH`/`BRANCH` set for run A, and the role's actual inherited working directory is not an ancestor of `WORKTREE_PATH` by any path relation (a different repository checkout entirely) and does not resolve inside the worktree-base directory at all
- **THEN** the verification passes and the role proceeds — the check tolerates any ambient location outside the worktree-base directory, not only an ancestor of `WORKTREE_PATH`

#### Scenario: Ambient cwd is exactly WORKTREE_PATH, or exactly the worktree-base directory itself
- **WHEN** a role's ambient working directory resolves to exactly `WORKTREE_PATH` (the post-`cd` steady state), or to exactly the worktree-base directory itself (not inside any specific ticket's worktree)
- **THEN** the verification passes in both cases — neither is "inside a different ticket's worktree," which is the only condition that constitutes a mismatch

#### Scenario: A role is actually misdirected at another run's worktree
- **WHEN** a role is spawned with `WORKTREE_PATH`/`BRANCH` for run A, but the role's actual inherited working directory resolves inside a different, real, pre-existing worktree under the same worktree-base directory (e.g. a different lane's `WORKTREE_PATH`)
- **THEN** the verification fails with a non-zero exit and a `FAIL <reason>` message identifying the mismatch, and the role treats this as a BLOCKER: it stops immediately without performing any other read or write, and reports the mismatch rather than proceeding

#### Scenario: WORKTREE_PATH itself does not exist
- **WHEN** a role is spawned with a `WORKTREE_PATH` that does not exist or is not a directory
- **THEN** the verification fails with `FAIL worktree-missing` and the role BLOCKERs and stops

#### Scenario: WORKTREE_PATH exists but is checked out to the wrong branch
- **WHEN** a role's ambient working directory does not collide with a different worktree, but `WORKTREE_PATH` itself is currently checked out to a branch other than the run's `BRANCH`
- **THEN** the verification fails with `FAIL branch-mismatch` and the role BLOCKERs and stops

### Requirement: The cwd/branch verification is a canonical mechanical script, not a prompt-only obligation
The verification described above SHALL be implemented as a single canonical script (`assert-cwd.sh`) usable identically by every worktree-bound role, invoked via an absolute path built from the trusted `WORKTREE_PATH` input (never a bare relative invocation, since locating the check itself must not depend on the very ambient-cwd correctness being verified).

#### Scenario: Script mirrored into the rendered scripts directory
- **WHEN** `core/scripts/assert-cwd.sh` is added or changed
- **THEN** an identical copy exists at `scripts/concertino/assert-cwd.sh` in the same commit, satisfying the rendered-scripts drift gate

### Requirement: Subsequent script invocations in the same role session are immune to ambient cwd
Once a role has passed the cwd/branch verification, every subsequent invocation of a `scripts/concertino/<x>` script within that role's own documented steps SHALL be written so its resolution does not depend on the ambient working directory — either by chaining an explicit `cd "$WORKTREE_PATH" &&` into the same command, or by using an absolute `"$WORKTREE_PATH/scripts/concertino/<x>"` path.

#### Scenario: A role's later script invocation does not depend on ambient cwd
- **WHEN** a worktree-bound role's documented steps invoke any `scripts/concertino/<x>` script after the initial cwd/branch verification has passed
- **THEN** that invocation is written with an explicit `cd "$WORKTREE_PATH" &&` prefix in the same command, or as an absolute `"$WORKTREE_PATH/scripts/concertino/<x>"` path — never a bare relative reference relying on the ambient directory happening to already be `WORKTREE_PATH`

### Requirement: The orchestrator supplies BRANCH to every worktree-bound role it spawns or resumes
The orchestrator SHALL pass `BRANCH` as a structured spawn/resume input to every role capable of performing the cwd/branch verification (executor, evaluator, skeptic, auditor), so the check never has to infer the expected branch on its own.

#### Scenario: Executor spawn includes BRANCH
- **WHEN** the orchestrator spawns or warm-resumes the executor for a run
- **THEN** the spawn/resume inputs include `BRANCH` alongside `WORKTREE_PATH`, `CHANGE_NAME`, and `TICKET_ID`
