# CON-162: squash-branch.sh validates the working tree but commits the index, so its guard cannot detect its own bypass

## Description

`core/scripts/squash-branch.sh` parses and validates the WORKING TREE copy of
`<CHANGE_DIR>/files-modified.md`, then commits the INDEX. When those differ, the
guard passes against corrected on-disk content while the commit captures the
stale staged blob. The guard cannot detect its own bypass, because it never
reads what it is about to commit.

Observed on helio HEL-732: the executor staged `files-modified.md`, kept editing
it, and the guard validated the corrected file on disk. The commit captured the
earlier staged version — 24 stale markers committed, zero present on disk.

This matters beyond hygiene: `files-modified.md` is a direct input to other
tickets, so stale content is inherited as fact by later runs.

Verified independently at fc88cd0 by an empirical probe, which showed the defect
is STRONGER than the ticket states: the on-disk declaration does not merely
produce a stale committed record, it AUTHORIZES a staged file that the committed
declaration does not declare. The guard exited 0 and committed an undeclared
file. This is a live guard bypass.

## Acceptance Criteria

- AC1: The declaration content the guard validates is the same bytes the commit
  captures. Concretely, the guard must not make an allow/refuse decision using
  worktree content that differs from what will be committed.
- AC2: An index/worktree divergence of the declaration file itself is surfaced
  as a loud refusal, not silently resolved in either direction.
- AC3: The refusal is scoped so that it does not break ordinary runs where the
  declaration is consistent between index and worktree (including the ordinary
  case where other declared source paths are legitimately unstaged/dirty).
- AC4: A regression test exists that stages one declaration content, writes
  DIFFERENT content to disk, and asserts the script refuses (or validates the
  staged version). The test must be proven failable by mutation: reverting the
  fix makes the new test go red. A test that only exercises index == worktree
  does not satisfy this.
- AC5: Any "this case is allowed" escape hatch introduced by the fix has its own
  structural check, so an exemption cannot silently become a blanket amnesty.

## Out of scope (sequencing)

- No dry-run mode (CON-164 is queued on the same script).
- No opportunistic refactor of other parts of squash-branch.sh.
- The drift between `core/scripts/squash-branch.sh` and the tracked rendered copy
  `scripts/concertino/squash-branch.sh` is routed to a separate ticket.
