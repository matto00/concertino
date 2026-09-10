## 1. Canonical script

- [x] 1.1 Write `core/scripts/assert-cwd.sh` per design.md Decision 1 (round 3, corrected per round-3 CR #2/#3): contract `assert-cwd.sh <AMBIENT_PWD> <WORKTREE_PATH> <BRANCH>`. `BASE="${WORKTREE_PATH%/$BRANCH}"` (exact, not a levels-up heuristic). Collision check (ambient under `BASE` but not under-or-equal to `WORKTREE_PATH` → FAIL cwd-mismatch; ambient not under `BASE` at all, or ambient equal to `BASE`/`WORKTREE_PATH`, → tolerated), independent branch check on WORKTREE_PATH itself via `lib/git-child-env.sh`'s `git_child` (CON-133). `READY`/`FAIL <reason>` output and exit codes as specced.
- [x] 1.2 Mirror it verbatim to `scripts/concertino/assert-cwd.sh` in the same commit (CON-172/CON-173 drift gate).
- [x] 1.3 Write a mutation-scoped test suite (design.md Decision 5, round-3-corrected) with five cases: (1a) correct spawn — AMBIENT_PWD is a real ancestor directory of WORKTREE_PATH in the same repo, not itself under BASE → READY; (1b) correct spawn — AMBIENT_PWD is an unrelated directory in a *different repository entirely*, not an ancestor of WORKTREE_PATH by any path relation, not under BASE → READY (kills a mutant that tolerates only the ancestor relation instead of the BASE-containment test); (2) misdirected spawn — AMBIENT_PWD is a genuinely different, real, pre-existing worktree under the SAME base as WORKTREE_PATH, different branch → FAIL cwd-mismatch; (3) WORKTREE_PATH itself checked out to the wrong branch → FAIL branch-mismatch; (4) WORKTREE_PATH missing → FAIL worktree-missing. For cases 1b–4, demonstrate the specific mutant each kills.

## 2. Wire BRANCH into spawn inputs

- [x] 2.1 Update `core/roles/orchestrator.md`'s executor/evaluator spawn (Cycle 1, line ~671/673) and the skeptic design-gate (line ~515) and final-gate (line ~725) spawn instructions, to include `BRANCH` in the listed inputs alongside `WORKTREE_PATH`/`CHANGE_NAME`/`TICKET_ID`. **Correction (cycle 2, evaluation-1.md CR #3):** the Cycles-2+ *warm* `SendMessage` resume (line ~696) does not need `BRANCH` re-passed — it's already bound in the resumed agent's own session, and `orchestrator.md`'s resume section now states this explicitly. The gap was the harness-resume-model's documented *fallback* spawn (`RESUME — do not start over`, used only when `SendMessage` is unavailable) — that spawn is cold and previously inherited nothing; it now explicitly passes `WORKTREE_PATH`/`CHANGE_NAME`/`TICKET_ID`/`BRANCH` (`lib/cli/render.js`'s `harnessResume` block, claude-code arm).
- [x] 2.2 Confirm the auditor spawn instructions already include `BRANCH` (per `core/roles/auditor.md:26`) — no change needed there beyond consistency review.

## 3. Role-doc wiring (mechanical detection + prompt-level BLOCKER response)

- [x] 3.1 Add a shared `cwdGuard` block to `lib/cli/render.js` (design.md Decision 4 — no per-role parameterization needed): fixed text instructing (a) capture ambient cwd via a standalone `pwd -P` as the literal first Bash call, (b) invoke `"$WORKTREE_PATH/scripts/concertino/assert-cwd.sh" "<captured pwd>" "$WORKTREE_PATH" "$BRANCH"`, (c) on `FAIL`, BLOCKER-and-stop: report the mismatch, perform no other read/write, (d) on `READY`, proceed normally.
- [x] 3.2 Insert `{{block:cwdGuard}}` as a new top-of-file section (right after `## Input`, before `## Resumability`/`## Evidence discipline`/`## Setup`) in `core/roles/executor.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md`, and `core/roles/auditor.md`.
- [x] 3.3 Verify each role's `Input` section documents `BRANCH` as a received input where it did not already (executor, evaluator, skeptic — auditor already does).
- [x] 3.4 **Re-derive the call-site count from the tree before fixing anything** — do not trust the number written here: `grep -nE '^\s*`?scripts/concertino/[a-zA-Z0-9_-]*\.sh|then `scripts/concertino/[a-zA-Z0-9_-]*\.sh' core/roles/{executor,evaluator,skeptic,auditor}.md` (excluding prose mentions like `executor.md:104`, `evaluator.md:358/363`, `skeptic.md:279/284`, `auditor.md:317`). As last mechanically re-enumerated (round 3, orchestrator-verified 2026-09-09): **16** — executor 1, evaluator 6, skeptic 6 (including `skeptic.md:93`/`:94`, `start-servers.sh`/`assert-phase.sh`), auditor 3. If your own re-count disagrees with 16, STOP and report the discrepancy rather than reconciling it quietly. Fix every enumerated site to either chain an explicit `cd "$WORKTREE_PATH" && ` into the same command, or use an absolute `"$WORKTREE_PATH/scripts/concertino/<x>"` path. Do not touch the orchestrator's own bare invocations (out of scope, design.md Non-Goals).
- [x] 3.5 Add one render-test assertion (per both skeptic rounds' non-blocking note) that a typo'd `{{block:...}}` name is caught rather than silently passing through `render.js`'s `default:` literal-passthrough arm — or confirm an existing test already covers this before adding a duplicate.

## 4. Spec/proposal validation and evidence

- [x] 4.1 `openspec validate spawn-cwd-guard --type change` exits zero.
- [x] 4.2 Design-gate skeptic re-review (handled by the orchestrator, not this task list).

## 5. Verification

- [x] 5.1 Run the new test suite; confirm all pass, including the mutation-toggle demonstrations.
- [x] 5.2 Run the project's existing test suite / lint to confirm no regression to the four modified role docs' other content, to `render.js`'s existing block rendering, or to any existing render/sync test (`test/scripts/*-render.test.sh`, `test/scripts/rendered-scripts-drift.test.sh`).
- [x] 5.3 Confirm `scripts/concertino/assert-cwd.sh` byte-for-byte matches `core/scripts/assert-cwd.sh` via direct `diff` (do NOT run `concertino sync`, per CON-173).
