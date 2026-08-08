# local-ticket-state-durability Specification

## Purpose
Make `set-ticket-state.sh`'s local-provider status write-backs durable — committed to git history, and pushed to the remote when possible — instead of an uncommitted working-tree edit that leaves the main checkout dirty for the whole run.
## Requirements
### Requirement: set-ticket-state.sh commits its own write when the tickets directory is a git working tree
`core/scripts/set-ticket-state.sh` SHALL, after successfully rewriting a
ticket file's frontmatter `state:` line, check whether `<tickets-dir>` is
inside a git working tree (`git -C <tickets-dir> rev-parse
--is-inside-work-tree`). When it is, the script SHALL stage and commit
**only** the rewritten ticket file (a pathspec-limited `git commit -- <file>`,
never `git commit -a` or an equivalent whole-tree commit) with a commit
message identifying the ticket id and the new state, before printing `OK
<id> <state>` and exiting 0. When it is not inside a git working tree, the
script SHALL skip the commit step entirely and proceed straight to printing
`OK <id> <state>` and exiting 0, exactly as before this change.

#### Scenario: Tickets directory is a real git working tree
- **WHEN** `set-ticket-state.sh <tickets-dir> CON-12 started` runs and
  `<tickets-dir>` is inside a git working tree
- **THEN** the rewritten `tickets/CON-12.md` is committed by itself (no
  other file is staged or committed), the script prints `OK CON-12 started`,
  and it exits 0

#### Scenario: Tickets directory is not a git working tree
- **WHEN** `set-ticket-state.sh <tickets-dir> CON-12 started` runs and
  `<tickets-dir>` is a plain directory with no enclosing git repository
- **THEN** the file is rewritten exactly as today, no git command is
  attempted, the script prints `OK CON-12 started`, and it exits 0

#### Scenario: An unrelated dirty file in the same checkout is left untouched
- **WHEN** `set-ticket-state.sh <tickets-dir> CON-12 started` runs inside a
  git working tree that also has an unrelated uncommitted change to some
  other tracked file
- **THEN** only `tickets/CON-12.md` is staged and committed; the unrelated
  file remains uncommitted and untouched exactly as it was before the call

### Requirement: set-ticket-state.sh makes one best-effort push attempt after committing
`set-ticket-state.sh` SHALL, after a successful commit (per the requirement
above), make exactly one attempt to push that commit to the remote and
branch name currently checked out at `<tickets-dir>` — `git push <remote>
HEAD:<current-branch>`, where `<remote>` resolves the same way
`core/scripts/cleanup.sh` resolves its base remote (`CONCERTINO_BASE_REMOTE`
if set, else `origin`) — using a plain, non-forced push (never `--force` or
`--force-with-lease`). The script SHALL NOT retry the push, SHALL NOT
attempt any rebase or merge to make the push succeed, and a failed push
SHALL NOT change the script's exit code or its `OK <id> <state>` output — it
SHALL only print a note on stderr. When `<tickets-dir>` is not inside a git
working tree, or the currently checked-out ref is not a branch (detached
HEAD), the script SHALL skip the push attempt (and, for a non-git tickets
directory, the commit step per the requirement above) entirely.

#### Scenario: Push succeeds
- **WHEN** the commit from the requirement above succeeds and the resolved
  remote accepts a fast-forward push of the current branch
- **THEN** the remote branch's tip now includes the ticket-state commit,
  the script still prints `OK <id> <state>`, and it exits 0

#### Scenario: Push is rejected
- **WHEN** the commit from the requirement above succeeds but the push is
  rejected (offline, no push access, a protected branch, or the remote has
  moved ahead)
- **THEN** the commit remains in local git history, the script prints a note
  on stderr, does not retry or force the push, still prints `OK <id> <state>`
  on stdout, and exits 0

#### Scenario: Detached HEAD at the tickets directory
- **WHEN** `<tickets-dir>` is inside a git working tree but that working
  tree's `HEAD` is detached (not on a branch)
- **THEN** the script still performs the pathspec-limited commit but skips
  the push attempt entirely, prints `OK <id> <state>`, and exits 0

