# CON-52: core/scripts/cleanup.sh comment drifted from its rendered copy after CON-32

## Description

Follow-up from CON-32 — found during that ticket's Phase 4 hygiene check, non-blocking.

CON-32 (matto00/concertino#46) fixed a stale comment in `scripts/concertino/cleanup.sh` (the rendered copy) claiming `CONCERTINO_BASE_REMOTE` "is not currently rendered" — no longer true once that PR shipped. The fix was made directly to the rendered copy, but the canonical source it is rendered from, `core/scripts/cleanup.sh`, was never updated and still carries the old, now-inaccurate comment.

This surfaced immediately: `cleanup.sh --phase4`'s own post-fast-forward re-render step (main-fast-forward, CON-25) ran `concertino sync` against the main checkout right after merging CON-32, which re-rendered `scripts/concertino/cleanup.sh` from the stale `core/scripts/cleanup.sh` template — silently reverting the just-merged comment fix back to the stale text as an uncommitted local diff on `main`.

## Acceptance Criteria

* `core/scripts/cleanup.sh`'s comment at (originally) lines 51-52 is updated to match what `scripts/concertino/cleanup.sh` already correctly says: that `renderEnv()` writes both `CONCERTINO_BASE_BRANCH` and `CONCERTINO_BASE_REMOTE` (the latter from `project.baseRemote`, defaulting to `origin`).
* Re-running `concertino sync` against this repo's own checkout no longer reverts `scripts/concertino/cleanup.sh`'s comment.
* Consider whether other rendered `scripts/concertino/*` files touched by recent tickets have similar drift from their `core/scripts/*` templates, given this project renders its own tooling from `core/` (see the precedent commit "chore: re-render scripts/concertino/emit-event.sh from updated core").
