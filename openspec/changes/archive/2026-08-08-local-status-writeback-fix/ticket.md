# CON-90: Local status write-back dirties the main checkout, never commits, and escalates every run

## Description

Found by the whole-branch review of the CON-44 first slice (PR #78, finding C-1). Documented in `docs/config-reference.md` but not fixed — the fix needs a design decision.

## What happens

Setup step 1 runs `scripts/concertino/set-ticket-state.sh tickets "$TICKET_ID" started`. That resolves against the **main checkout**, and `tickets/` is tracked in git by design (design doc Decision 3). Two consequences:

1. **A blocking escalation on every run.** The main checkout is dirty for the whole run. At Phase 4, `core/scripts/cleanup.sh` calls `attempt_fast_forward`, finds the base branch checked out at `REPO_ROOT` (`cleanup.sh:50`), runs `git -C "$base_worktree" status --porcelain` (`:149`), gets a non-empty result, sets `FF_STATUS="dirty"` and raises `emit-event.sh escalation --await ... options=retry,skip` (`:172-176`) — a call that blocks until a human answers.

   Deterministic on any local-provider repo with a git remote: the run's own PR just merged, so local base is behind the remote, so the fast-forward path is always entered; the tree is always dirty because the run itself dirtied it. Under `linear` this never happened — the main checkout stayed clean because `.concertino/` is gitignored.
2. **The tracked backlog never records a status transition.** Nothing commits the rewritten file. Decision 3's whole argument for tracking `tickets/` is that the backlog "survives a clone, is visible to a collaborator, to PR review and to CI" — but with write-back only ever touching the working tree, the committed `tickets/CON-12.md` says `unstarted` forever.

## Why it wasn't fixed in the first slice

Committing is not a one-liner either: committing to the local base makes `FF_STATUS="diverged"` (`cleanup.sh:121-125`), which escalates too. And the timing is awkward — Setup writes `started` **before** the worktree exists, and cleanup writes `completed` **after** it is destroyed, so "commit it on the feature branch so it rides the PR" is not a drop-in.

## Options to weigh

* Commit the transition on the feature branch so it rides the PR. Needs a story for the `started` write (pre-worktree) and the `completed` write (post-cleanup).
* Teach `cleanup.sh`'s fast-forward check to ignore `tickets/`. Narrow, but changes cleanup semantics for every provider.
* Reverse Decision 3 and gitignore `tickets/` after all — cheapest, but gives up the reviewability that motivated tracking them.

## Acceptance criteria

* A local-provider delivery run completes without a spurious dirty-tree escalation.
* The state transition is durable somewhere a collaborator can see, or the docs state plainly that it is not and why.
