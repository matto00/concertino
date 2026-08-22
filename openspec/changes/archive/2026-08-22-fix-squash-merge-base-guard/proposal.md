## Why

The Delivery squash step resets the branch against `origin/main` as it is at
squash time, not against the commit the branch actually diverged from. When
`origin/main` has advanced mid-run (a sibling run merged concurrently), the
intervening commits become staged deletions — an invisible mass revert that
passes CI and review because the resulting tree is self-consistent. This
happened for real in helio on 2026-08-21 (HEL-548 nearly reverted HEL-772),
caught only by an orchestrator manually reading the staged diff. It must be
made structurally impossible to commit silently.

## What Changes

- Add a canonical `squash-branch.sh` script (mirroring the
  `setup-worktree.sh`/`cleanup.sh`/`assert-phase.sh` pattern) that:
  - Resets against the true merge-base (`git merge-base HEAD <base-ref>`),
    never against the base ref directly.
  - Detects when the base ref has advanced past that merge-base (i.e. the
    branch is behind) and requires an explicit, logged decision rather than
    silently absorbing the difference — for a squash (not a rebase), "the
    base advanced" is inherently expected/harmless as long as the merge-base
    reset is used, so this is a loud diagnostic + the guard below, not a
    forced rebase.
  - Compares the staged file set (after `reset --soft`) against the union of
    (a) a caller-supplied `<CHANGE_DIR>/**` workflow-artifact allowlist
    (never hardcoded in the script — `core/scripts/**` is copied verbatim
    with no variable substitution, and `specProvider.changeDir` is itself
    configurable) and (b) the paths parsed out of the change's
    `files-modified.md` (the executor's own declared source-touch set), and
    **stops without committing** if the staged set contains any file outside
    that union. *(Corrected at design-gate round 1: `files-modified.md`
    alone is not a complete or reliably-parseable declaration. Corrected
    again at design-gate round 2: the allowlist path must be a caller
    argument, not hardcoded — see design.md D2/D2a/D2b.)*
  - Always prints the staged file count and full file list before any
    commit, unconditionally (not just on guard failure).
- Wire the orchestrator's Phase 3 Delivery step 1 (in
  `core/roles/orchestrator.md`, which renders to
  `.claude/agents/concertino-orchestrator.md` — there is no `core/agents/`
  directory) to call this script instead of leaving the squash mechanism
  unspecified (today's prose names no git command at all, which is why an
  orchestrator improvised `git reset --soft origin/main` in the first
  place).
- On guard trip, the script exits non-zero with a clear report (which files
  are unexpected, what the merge-base and base-tip were) so the orchestrator
  treats it as a `BLOCKER` per the existing escalation table, rather than
  proceeding.

## Capabilities

### New Capabilities

- `delivery-squash-guard`: canonical, tested procedure for squashing a
  delivery branch that (a) always resets against the branch's true
  merge-base rather than the base ref's current tip, (b) never commits a
  staged file outside the run's own declared touched-file set without
  stopping and reporting, and (c) always surfaces the staged file count/list
  before committing.

### Modified Capabilities

(none — no existing spec captures today's squash behavior; this is new
ground truth for that procedure)

## Impact

- New file: `core/scripts/squash-branch.sh` (+ rendered copy at
  `scripts/concertino/squash-branch.sh` via `concertino sync`, not run here).
- New test file: `test/scripts/squash-branch.test.sh`, added as a new
  conjunct in `package.json`'s `"test"` script.
- `core/roles/orchestrator.md` Phase 3 Delivery step 1 prose updated to
  invoke the new script.
- No changes to `cleanup.sh`, `check-merge-readiness.sh`, or any of
  CON-128/131/132/121/HEL-764's territory.
- Test-only: a throwaway git repo fixture proving red-before-green (revert
  reproduced with the guard absent, no revert with it present), never run
  against this repo or helio.
