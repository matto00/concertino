# Validate the declaration blob the commit will capture

## Why

`core/scripts/squash-branch.sh` decides whether to commit by parsing the
WORKING TREE copy of `<CHANGE_DIR>/files-modified.md`, but the commit it then
creates captures the INDEX. When those differ, the guard approves content that
is not the content it commits — it cannot detect its own bypass, because it
never reads what it is about to commit.

An empirical probe at `fc88cd0` (recorded in this change's premise validation)
shows the consequence is worse than a stale record. With a staged declaration
naming one path and an on-disk declaration naming two, the guard used the
on-disk copy to AUTHORISE a staged file (`src/STALE_NOT_DECLARED.ts`) that the
committed declaration does not declare. The script exited 0 and the undeclared
file landed in the commit. This is a live guard bypass, not only a hygiene
defect.

It matters downstream: `files-modified.md` is read by later tickets as an
authoritative record of what a run touched, so a stale or unvalidated
declaration is inherited as fact.

## What Changes

- The declaration parse reads the STAGED BLOB (`git show :<path>`) rather than
  the worktree file, so the bytes the guard validates are the bytes the commit
  captures.
- An index/worktree divergence of the declaration file itself is a loud
  refusal, surfaced rather than silently resolved in either direction.
- A declaration file present on disk but absent from the index is refused with
  its own distinct diagnostic, because such a file will not be in the commit.
- The divergence refusal is NOT suppressible by `--allow-empty-declaration`,
  and that non-suppressibility carries its own structural test.
- A mutation-proven regression test covers the divergent case, which the
  existing suite never exercised.

## Capabilities

- `delivery-squash-guard` — the guard's declaration source becomes the staged
  blob, and index/worktree divergence of the declaration becomes a refusal.

## Out of scope

- Dry-run mode (CON-164, queued on the same script).
- Any other refactor of `squash-branch.sh`.
- The core-vs-rendered drift of `scripts/concertino/squash-branch.sh`, routed
  to its own ticket.
