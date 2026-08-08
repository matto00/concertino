## Why

Under `ticketProvider.kind: "local"`, `set-ticket-state.sh` rewrites
`tickets/<ID>.md` in place in the main checkout and never commits it. This
leaves the main checkout dirty for the whole run and, on any repo with a
remote, deterministically trips Phase 4 cleanup's fast-forward dirty-tree
escalation on every single delivery — a blocking `emit-event.sh escalation
--await` a human has to answer every time. It also means the tracked
backlog (`tickets/`, deliberately tracked per design.md Decision 3, precisely
so it "survives a clone... is visible to a collaborator, to PR review and to
CI") never actually records a status transition: the committed file says
`unstarted` forever.

## What Changes

- `core/scripts/set-ticket-state.sh` commits its own write (scoped to just
  the one rewritten ticket file, via a pathspec-limited `git commit`) when
  the tickets directory is inside a git working tree — durable state
  transitions land in git history unconditionally, in both the `started`
  (pre-worktree, Setup) and `completed` (post-cleanup, Cleanup) call sites,
  with no change needed to when either is called.
- After committing, it makes one best-effort attempt to `git push` that
  commit to the checked-out branch's configured remote (default `origin`,
  reusing `project.baseRemote`/`CONCERTINO_BASE_REMOTE` the same way
  `cleanup.sh` already does) — fast-forward only, never forced. Success
  keeps local `<base>` in lockstep with the remote, so Phase 4's cleanup
  fast-forward finds a clean, non-diverged tree and never escalates. Failure
  (offline, no push access, a protected branch) is silent-but-noted on
  stderr and never turns into a script failure — the write itself already
  succeeded and is durable in local history regardless.
- No behavioral change to `core/scripts/cleanup.sh` or to any other
  ticket-provider (`linear`, `github`) — `set-ticket-state.sh` is exclusively
  the `local`-provider write-back seam (design.md Decision 6).
- `docs/config-reference.md`'s "Status write-back leaves the main checkout
  dirty" section is rewritten to describe the new (usually escalation-free)
  behavior and to plainly document the one residual case where the old
  escalation can still occur: the base branch is push-protected, so the
  best-effort push never lands and local `<base>` is left durably ahead of
  its remote until a human pushes it manually.

## Capabilities

### New Capabilities
- `local-ticket-state-durability`: `set-ticket-state.sh`'s write-back
  now commits (and best-effort pushes) every state transition it makes,
  instead of leaving an uncommitted working-tree edit behind.

### Modified Capabilities
(none — `main-fast-forward`'s existing requirements are unchanged; this
change removes the *precondition* that used to trigger its dirty/diverged
escalation path for local-provider runs, it does not change that path's
behavior.)

## Impact

- `core/scripts/set-ticket-state.sh` (and its synced copy
  `scripts/concertino/set-ticket-state.sh`, refreshed by `concertino sync`).
- `test/scripts/set-ticket-state.test.sh` — new coverage for the commit/push
  behavior, and for graceful no-op when the tickets dir isn't a git working
  tree (keeps every existing non-git-scratch-dir test passing unchanged).
- `docs/config-reference.md` — rewritten "Status write-back" section.
- No change to `lib/`, `core/roles/orchestrator.md`, or any rendered agent
  prompt — the orchestrator's existing Setup/Cleanup steps already just
  invoke `set-ticket-state.sh` and treat a non-zero exit as `FAIL` →
  `BLOCKER`; that contract is unchanged, only the script's internal
  behavior grows.
