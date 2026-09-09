# CON-171: Phase 4 cleanup can destroy the worktree while the auditor is still running, losing its report

## Description

Guarantee that Phase 4 teardown never begins while a spawned agent is still writing into the worktree, so no run loses evidence it actually produced.

On CON-163 the orchestrator observed the PR reach `MERGED` by polling `gh pr view` and immediately ran `cleanup.sh --phase4`. The auditor — which had just performed the merge — was still finishing: it had written `auditor-report.md` into the worktree but had not yet called `persist-evidence.sh`. The worktree was torn down under it, the report was lost (recovered only because the auditor reproduced its text in its return value and a human copied it back), and a residual `openspec/changes/archive/<name>/auditor-report.md` made `assert-phase.sh cleanup` fail with `worktree dir still present`.

`core/roles/orchestrator.md` Phase 3 says that on an auditor `MERGE` verdict the orchestrator should "proceed directly into Phase 4 — the auditor's `MERGE` verdict *is* the confirmation". That is correct when the verdict is consumed as the spawn call's return value, but it reads as satisfiable by any observation that the merge happened, and the merge becomes observable out-of-band strictly before the auditor finishes.

### Premise correction (established by this run's premise validation)

The ticket states the auditor "emitted its `verdict=MERGE` event with no `ref` field". In fact `.concertino/runs/CON-163/events.jsonl` contains zero events with `"role":"auditor"` and no `agent.spawn agent=auditor`: the auditor's telemetry was lost entirely, not merely emitted ref-less. The auditor was killed before reaching any emit call.

## Acceptance criteria

1. `cleanup.sh --phase4` refuses to remove the worktree while the auditor's script-owned lease is held — acquired by `check-merge-readiness.sh`, released by the auditor's `verdict` event — or while a live process holds the worktree as its working directory, reporting what is held and exiting non-zero without having removed anything.
2. The process-probe refusal is bounded, not instant: it tolerates a process that is in the act of exiting, so an ordinary run is never blocked by a race with a dev server the script has just killed. The lease check refuses immediately, since a held lease is not a race.
3. The refusal is overridable by an explicit, documented operator flag, so a stuck or unkillable holder can never permanently strand a delivered run.
4. `core/roles/orchestrator.md` states explicitly that Phase 4 may begin only once the auditor's spawn call has returned, and that observing the PR as merged by any other means (polling `gh pr view`, a GitHub notification, a `merged` timestamp) is not that condition.
5. Any change under `core/scripts/` ships its rendered `scripts/concertino/` counterpart in the same commit, keeping `test/scripts/rendered-scripts-drift.test.sh` green — updated by direct copy, never by running `concertino sync`.
6. The new guard has test coverage in `test/scripts/` that fails when either signal is removed, verified by mutation.
