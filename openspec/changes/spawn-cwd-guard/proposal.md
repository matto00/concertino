## Why

A spawned Concertino sub-agent (executor/evaluator/skeptic/auditor) inherits the spawning session's ambient working directory at spawn time, not the `WORKTREE_PATH` it is instructed to work in. Nothing verifies the two agree. On 2026-09-09 a driver's diagnostic `cd` into one lane's worktree caused an executor spawned for a *different* lane to land in the wrong worktree — one with a live orchestrator mid-cycle in it. The executor caught it and escalated on its own initiative; nothing mechanical would have caught it if it hadn't. This is the same "ambient default silently substitutes for the pinned target" defect class CON-165 already closed for dev-server ports — same shape, one layer up, and strictly higher stakes because a spawned role writes rather than reads.

## What Changes

- Add a canonical script, `assert-cwd.sh`, that every role which receives `WORKTREE_PATH` runs as its literal first action: the role first captures its own inherited (ambient) working directory via a standalone `pwd -P`, then the script verifies (a) that ambient directory does not resolve inside a *different* ticket's worktree under the same worktree-base directory, and (b) that `WORKTREE_PATH` itself is checked out to the run's `BRANCH`. Exits non-zero with `FAIL <reason>` on any disagreement (missing worktree, cross-worktree cwd collision, branch mismatch); prints `READY` on success. An ambient directory that is merely an ancestor of `WORKTREE_PATH` (the ordinary case for a correct spawn) is explicitly tolerated, not flagged. (Design round 1 REFUTEd an earlier version that only re-checked `WORKTREE_PATH`'s own state post-`cd`, invariant under ambient cwd; round 2 REFUTEd the first correction for requiring ambient to resolve *under* `WORKTREE_PATH`, which BLOCKERs every normal spawn since a correct spawn's ambient is structurally an ancestor, not a descendant. This is the round-3 shape that satisfies both constraints.)
- Fix the 14 existing ambient-cwd-relative `scripts/concertino/<x>` invocations across the four affected role docs so a `READY` verdict is not undermined by a later bare invocation resolving against the wrong tree (design.md Decision 2).
- Mirror the script byte-for-byte from `core/scripts/assert-cwd.sh` into `scripts/concertino/assert-cwd.sh` in this same commit (CON-172/CON-173's rendered-scripts drift gate has an empty exemption table — no script change may land without its mirror).
- Add `BRANCH` as a structured spawn input, passed by the orchestrator on every executor/evaluator/skeptic spawn and resume (auditor already receives it) — needed for the branch half of the check.
- Update `core/roles/executor.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md`, `core/roles/auditor.md` so each role's step 1 (before any other read or write) runs `assert-cwd.sh` and BLOCKER-and-stops on `FAIL`.
- Update `core/roles/orchestrator.md`'s spawn/resume instructions to pass `BRANCH` alongside the existing spawn inputs.
- `design.md` records a deliberate scope decision on the CON-139 relationship: the mis-spawned-agent's *reporting channel* (`ORCHESTRATOR_AGENT_REF` misdelivery) is explicitly left to CON-139, out of scope here — this change only closes the *detection* gap (mechanical cwd/branch verification), which is orthogonal to CON-139's addressing-mechanism gap.

## Capabilities

### New Capabilities
- `spawn-cwd-guard`: every ticket-delivery role verifies its actual working directory and branch resolve to the run it was spawned for, before any other action, failing loudly rather than silently working against the wrong worktree.

### Modified Capabilities
(none — no existing capability's requirements change; this adds a new precondition capability consumed by the existing role specs, but does not alter their existing requirements)

## Impact

- New file: `core/scripts/assert-cwd.sh` (+ mirrored `scripts/concertino/assert-cwd.sh`).
- Modified: `core/roles/executor.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md`, `core/roles/auditor.md`, `core/roles/orchestrator.md`.
- Modified: `lib/cli/render.js` if a shared block is used to avoid duplicating the same instruction text across four role files.
- New tests exercising the script directly against constructed failing/passing conditions (wrong inherited cwd, correct cwd, missing worktree, branch mismatch).
- No schema/data migrations. No behavior change to any existing passing spawn path beyond one extra mechanical check at the start of each role's work.
