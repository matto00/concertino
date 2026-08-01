## Why

CON-32 fixed a stale comment in the *rendered* copy (`scripts/concertino/cleanup.sh`)
claiming `CONCERTINO_BASE_REMOTE` "is not currently rendered" — no longer true
once that PR shipped. The fix was applied only to the rendered copy, not to
the canonical template it is rendered from (`core/scripts/cleanup.sh`). As a
result, the very next `concertino sync` (which `cleanup.sh --phase4` runs
against `main` after every merge) silently reverted the rendered file back to
the stale comment, undoing the CON-32 fix as an untracked local diff. This
change fixes the canonical template so the correction is durable across every
future sync.

## What Changes

- Update the comment at `core/scripts/cleanup.sh` lines ~51-52 to state that
  `renderEnv()` writes both `CONCERTINO_BASE_BRANCH` and
  `CONCERTINO_BASE_REMOTE` (the latter from `project.baseRemote`, defaulting
  to `origin`) — matching the corrected text CON-32 already put in the
  rendered copy.
- Re-run `concertino sync` so `scripts/concertino/cleanup.sh` re-renders with
  the corrected comment, and commit the result (proving sync no longer
  reverts it).
- Audit other `core/scripts/*.sh` templates against their rendered
  `scripts/concertino/*.sh` counterparts for the same class of drift (fix
  applied to the rendered copy but not the template); fix any found.

## Capabilities

### New Capabilities

(none — this is a documentation/comment correction with no behavioral or
requirement-level change)

### Modified Capabilities

(none — no spec requirement changes; `core/scripts/cleanup.sh`'s comment is
implementation-detail prose, not spec-tracked behavior)

## Impact

- `core/scripts/cleanup.sh` (canonical template)
- `scripts/concertino/cleanup.sh` (rendered copy, re-synced)
- No behavioral change: the script's logic (`BASE_REMOTE`/`BASE_BRANCH`
  resolution) is already correct on both sides; only the explanatory comment
  was stale.
