# CON-36: doctor's core-divergence check doesn't compare roles/

## Description

`bin/concertino`'s `coresDiffer()` (used by `doctor` to detect when a project's copy of `core/` has drifted from the source-of-truth core) compares `core/scripts/*`, `core/laws/*`, and `core/workflow-state.template.md` between the two cores — but not `core/roles/*`.

Flagged by CON-13's own final-gate skeptic and evaluator at the time (PR #12's "Risks / follow-ups"): "doctor's divergence check (coresDiffer) compares scripts/, laws/, and workflow-state.template.md between cores, but not roles/ — this matches what was scoped in design/tasks, flagged... as a plausible future follow-up, not a defect against this change's scope." Confirmed still true against current `bin/concertino` — no later ticket touched this.

A project whose `core/roles/*.md` has diverged from the canonical core (edited by hand, or stale after a `sync` that predates a role-spec change) gets no warning from `doctor`. Since roles are the actual behavioral spec each agent reads, this is arguably a more consequential drift to miss than the three categories already checked.

## Acceptance Criteria

- `coresDiffer()` in `bin/concertino` also compares `core/roles/*` between the two cores, consistent with how `scripts/`, `laws/`, and `workflow-state.template.md` are already handled.
- A project with a diverged `core/roles/*.md` now gets the same divergence note `doctor` already prints for the other three categories.
- Existing behavior for `scripts/`, `laws/`, and `workflow-state.template.md` is unchanged.
