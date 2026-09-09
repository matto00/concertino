## Why

On CON-163's delivery the orchestrator observed the PR reach `MERGED` out-of-band and ran `cleanup.sh --phase4` while the auditor — which had just performed that merge — was still running. The worktree was removed under it. The auditor's `auditor-report.md` was destroyed before `persist-evidence.sh` could copy it, and its telemetry was lost entirely: `.concertino/runs/CON-163/events.jsonl` contains zero events with `"role":"auditor"`. The report survived only because a human copied it out of the auditor's return value by hand.

The hazard is structural, not incidental. The merge becomes observable out-of-band strictly *before* the auditor finishes, so any Phase-4 entry condition phrased as "the merge happened" is satisfiable while a live agent is still writing into the worktree. Today nothing but prose stands between that observation and an irreversible `git worktree remove --force`.

## What Changes

- **`cleanup.sh --phase4` refuses to remove a worktree while the auditor's lease is still held.** The lease is taken by `check-merge-readiness.sh` (the auditor's first action, and a hard precondition of merging) and released by `emit-event.sh verdict ... role=auditor` (its last action, on every terminal verdict). It is matched on the worktree path recorded at acquisition, resolved through a shared helper that finds the main checkout the same way both writers already do — not through `cleanup.sh`'s own cwd-relative repo root, which can disagree and would make the guard fail open silently. Because both hooks are canonical scripts rather than prose, this does not depend on any prompt being read correctly. It covers the CON-163 sequence exactly: an agent killed after writing its report but before persisting it still holds its lease.
- **A complementary `/proc/<pid>/cwd` probe** catches a surviving dev server or a stray shell parked in the worktree. This is best-effort and explicitly *not* the load-bearing signal — a live agent between tool calls holds no process in the worktree at all, so a cwd probe alone would have missed the incident this ticket is about.
- The cwd probe's refusal is **bounded, not instant**: it re-probes every 250 ms for up to 3 s, so a dev server the script has just killed on its own ports is never mistaken for a live holder. The lease check is not subject to the window — it is a durable statement of intent, not a race.
- The refusal is **overridable** by an explicit `--force-teardown` flag, so an unkillable or stuck holder can never permanently strand a delivered run. The override is loud: it prints what it is overriding.
- **`core/roles/orchestrator.md` states the Phase-4 entry condition precisely**: Phase 4 may begin only once the auditor's spawn call has *returned*. Observing the PR as merged by any other means — polling `gh pr view`, a notification, a `merged` timestamp — is explicitly named as not that condition.
- The rendered `scripts/concertino/cleanup.sh` is updated **by direct copy** in the same commit, keeping `test/scripts/rendered-scripts-drift.test.sh` green. `concertino sync` is not run (CON-173: two untracked owner-pending files must not be rendered into the tree).
- New test coverage in `test/scripts/` that fails if either signal is removed.

**Not changed:** the auditor's persist-after-merge ordering. See `design.md` Decision 1 — reordering it introduces a false-verdict hazard and does not close the class.

## Capabilities

### New Capabilities
- `phase4-teardown-safety`: `cleanup.sh --phase4` refuses to destroy a worktree while the auditor's script-owned lease is held or a live process holds it as its cwd, with a bounded settle window and an explicit operator override.

### Modified Capabilities
- `agent-merge`: the Phase-4 entry condition following an auditor `MERGE` verdict is tightened from "the merge is confirmed" to "the auditor's spawn call has returned", with out-of-band merge observation explicitly excluded.

## Impact

- `core/scripts/cleanup.sh`, `core/scripts/check-merge-readiness.sh`, `core/scripts/emit-event.sh`, a new shared lease helper under `core/scripts/lib/`, and their rendered counterparts under `scripts/concertino/`.
- `emit-event.sh` gains a documented semantic side effect (lease release) and its header is updated accordingly — it is currently described as pure telemetry.
- `core/roles/orchestrator.md` (Phase 3 auditor-verdict handling, Phase 4 preamble).
- `test/scripts/` — new coverage for the live-holder guard.
- No change to the auditor, evaluator, skeptic, or executor **role documents** — the lease is acquired and released by scripts those roles already call unconditionally, so no role gains a new instruction it could fail to follow.
