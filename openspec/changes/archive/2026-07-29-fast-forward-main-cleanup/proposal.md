## Why

Nothing in the workflow brings the local `main` checkout forward after a PR merges. Every merge
— by a human, by another run, by anyone on the team — leaves local `main` behind `origin/main`,
silently. This has already caused a real sibling-run conflict (CON-8 vs CON-7), an hour lost to
stale rendered agents (the origin of the `doctor` drift check and CON-13), and it is invisible on
the dashboard today. Phase 4 cleanup is the one moment the workflow already knows a merge
happened, so it is the natural place to bring `main` forward automatically — safely, or not at
all.

## What Changes

- `cleanup.sh` (Phase 4, post-merge) fetches `origin/<base>` and fast-forwards local `main` when
  it is a clean, unambiguous fast-forward. A clean fast-forward proceeds silently and is followed
  by a best-effort `concertino sync` re-render (or a clear note that one is needed), so rendered
  artifacts can't silently go stale again.
- When the fast-forward is not clean (dirty tree, diverged local `main`, or ambiguous checkout
  state), `cleanup.sh` changes nothing and raises a blocking escalation over the existing
  `emit-event.sh escalation --await` machinery, with `retry`/`skip` options plus a free-text
  reply, bounded to a small number of attempts.
- `concertino doctor` gains a check that reports when local `main` is behind its remote, naming
  the fast-forward step as the usual cause (it already detects the *consequence* — rendered
  artifact drift — this names the likely cause).
- The dashboard (`lib/ui/watch.js` + a new `lib/ui/banner.js`) grows a persistent, cross-screen
  escalation banner: any live escalation is now visible regardless of which screen is on top (not
  just the fleet screen and that run's own escalation screen), with a reachable reply path, and it
  clears the moment the escalation is answered or times out.

## Capabilities

### New Capabilities
- `main-fast-forward`: the Phase 4 fast-forward algorithm and its safety guards (never touch a
  dirty tree or a diverged base), the retry/skip escalation it raises when it can't proceed, the
  post-fast-forward re-render step, and `doctor`'s local-main-behind-remote check.
- `cross-screen-escalation`: a persistent banner, visible from every dashboard screen, showing the
  oldest live escalation across the whole fleet (not just the current run), with a reachable
  reply path, that clears automatically once the escalation is resolved.

### Modified Capabilities
- (none — both capabilities above are additive; no existing spec's requirements change)

## Impact

- `core/scripts/cleanup.sh` (and its rendered copy `scripts/concertino/cleanup.sh`, kept in sync
  via `concertino sync`): new fast-forward step between worktree removal and the final `run.end`
  emission.
- `bin/concertino`'s `cmdDoctor`: a new check function alongside `checkArtifacts`.
- `lib/ui/reducer.js`: no change to the escalation model itself — the existing per-run
  `escalation.raised`/`answered`/`timeout` handling already fits, since `cleanup.sh`'s blocking
  `--await` call keeps the raising run's `run.end` from being emitted until the escalation
  resolves (so the run is not yet "ended" while its escalation is live, and existing staleness
  logic in `deriveStatus`/`escalationStale` needs no change).
- `lib/ui/watch.js`, new `lib/ui/banner.js`, `lib/ui/store.js` (reused, not changed): compose a
  banner above whatever screen is on top, with its own small reply sub-state.
- `core/roles/orchestrator.md` (Phase 4 instructions): note that the `cleanup.sh --phase4` Bash
  call needs a long timeout (matching the existing escalation `--await` guidance) since it may now
  block on a fast-forward escalation.
- Out of scope: the `ROADMAP.md` "stale-base warning at the delivery gate" item is a different
  moment (mid-run, PR-creation time) with different mechanics (warn, never block) and is not
  required by this ticket's acceptance criteria; left as a follow-up rather than folded in here to
  keep this change's blast radius reviewable.
