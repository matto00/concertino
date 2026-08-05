# CON-80: Ticket-id case split: a lowercase branch suffix makes one run appear twice on the dashboard

## Description

One run renders as two rows in the fleet, differing only in case:

```
[2] RUNNING
    CON-79   codex-prompt-not-expanded        phase unknown   20s
  ▸ con-79   (no branch yet)                  phase unknown   gates 1/1
```

Both are the same delivery. The run's own telemetry is split across two directories:

```
.concertino/runs/CON-79/   run.start, phase.enter …   (ticket=CON-79, from setup-worktree.sh)
.concertino/runs/con-79/   gate.result phase:setup    (ticket=con-79, from assert-phase.sh)
```

So the real run shows `phase unknown` while its gate history sits under a phantom row — each half missing what the other has.

## Cause

`core/scripts/assert-phase.sh:94` infers the ticket id from the worktree path instead of being told it:

```bash
GATE_TICKET="${WORKTREE_PATH##*/}"
```

This run's branch is `bug/codex-prompt-not-expanded/con-79` — the ticket suffix is **lowercase** (Linear's own `gitBranchName` is lowercase, e.g. `matto00/con-79-codex-launches-…`). The basename is therefore `con-79`, and every gate event is tagged with it. `setup-worktree.sh`, which receives `TICKET_ID` explicitly, correctly uses `CON-79`.

Historically branches carried an uppercase suffix (`feature/per-ticket-harness-override/CON-62`) so the inference happened to agree. It is convention-dependent, and the convention has drifted.

**This is the same defect CON-64 fixed in `cleanup.sh`** — that fix threaded `TICKET_ID` in as an explicit argument, but did not extend to the other two scripts doing the same inference:

```
core/scripts/cleanup.sh        (fixed by CON-64, fallback retained)
core/scripts/assert-phase.sh   <- this bug
core/scripts/start-servers.sh  <- same latent flaw
```

## Blast radius

Telemetry only, for now. `assert-phase.sh`'s emit calls are all `|| true` and the script's own exit code is what the orchestrator acts on, so gates still enforce correctly and the in-flight run is not compromised. The damage is that the dashboard cannot be trusted: a phantom row, a real row missing its gates, and two entries competing for one ticket's identity. Retention and reaping will also treat the phantom directory as a run in its own right.

## Fix

1. Thread `TICKET_ID` explicitly into `assert-phase.sh` and `start-servers.sh`, exactly as CON-64 did for `cleanup.sh`, updating the call sites in `core/roles/orchestrator.md` and re-rendering.
2. Normalise ticket-id case at the boundary regardless — `emit-event.sh` should reject or canonicalise a `ticket=` that differs only in case from an existing run directory, so no future inference can silently fork a run's identity. Ticket ids are conventionally uppercase; the dashboard should not treat `con-79` and `CON-79` as distinct runs.
3. Consider whether `setup-worktree.sh` should normalise the branch suffix it builds, so path-derived values agree with the canonical id even where inference survives as a fallback.

## Acceptance criteria

* A run on a branch whose ticket suffix is lowercase produces exactly one run directory and one fleet row, with its gates attached.
* `assert-phase.sh` and `start-servers.sh` take the ticket id explicitly; any retained inference is a documented fallback.
* Test coverage mirroring CON-64's: a lowercase-suffix branch is the regression case.
* Existing split directories are either merged or clearly ignorable — decide whether a migration is warranted.
