# CON-10: Nothing emits evidence events, so the drill-down's evidence panel is always empty

## Description

The event schema defines an `evidence` kind carrying `ref` and `label`, and
`lib/ui/reducer.js` folds it. The drill-down screen built in slice 2b renders
an EVIDENCE panel from it.

**No role or script ever emits one.** The panel therefore renders `no evidence
recorded` on every run — honestly, which is the right degradation, but
permanently.

This is the same defect class as CON-1 (gate events carry no duration or
error detail), which shipped: the reducer read `duration_ms` and `first_error`
off `gate.result` and nothing wrote them, so a panel designed around those
fields would have been empty. Worth fixing the same way, and worth noticing
that the schema has now grown a second field nothing produces.

## Why it matters

Evidence is the point of the workflow. The whole design replaces "human
confirms Y" with "an evidence artifact plus a cold checker that verifies Y
against ground truth" — proposals, design docs, evaluation reports, skeptic
reports, diffs. Those artifacts exist on disk today; the dashboard just
cannot see them.

Being able to open a run's evaluation report from the drill-down, rather than
attaching to the agent and hunting for the path, is most of the reason to
have a drill-down at all.

## Acceptance criteria

* The orchestrator emits `evidence` when it creates a planning artifact, at
  the point it already writes `workflow-state.md`.
* The evaluator and skeptic emit `evidence` for the report each writes,
  alongside the `verdict` event they already emit. `verdict` carries `ref`
  today — decide whether that is enough or whether a distinct `evidence`
  event is warranted, and justify it rather than emitting both by default.
* `ref` is a path that can actually be resolved from the dashboard's working
  directory, not a path relative to the agent's worktree — the worktree is
  destroyed at cleanup while the event log survives, so a worktree-relative
  path becomes a dangling reference the moment a run succeeds. This is the
  trap CON-1's sibling `first_error` avoided by carrying content rather than
  a pointer.
* The drill-down lists them; the existing `no evidence recorded` path still
  renders for a run that genuinely has none.
* Tests cover a run with evidence and a run without.

## Notes

Consider whether `evidence` should carry enough to be useful after the
worktree is gone. A path into a deleted worktree is worse than no event, by
the same reasoning that made a wrong ticket id worse than a dropped one in
the tier-2 emission work.

## The trap (repeated deliberately by the orchestrator briefing this ticket)

An `evidence` event carries a `ref`. The obvious implementation points that
`ref` at a file inside the run's own worktree — but `cleanup.sh --phase4`
destroys that worktree while the event log deliberately survives it. So a
worktree-relative path becomes a dangling reference at exactly the moment a
run succeeds, which is when someone would most want to read the evidence.

That is the same shape as an earlier decision in this codebase: a wrong
ticket id was judged worse than a dropped event, because a wrong one
corrupts another run's telemetry while a gap renders honestly. Apply the
same standard here — an evidence ref that cannot be resolved after cleanup
is worse than no evidence event at all.

Also decide, and justify, whether `verdict` already carrying a `ref` makes a
separate `evidence` event redundant for evaluator and skeptic reports.
Emitting both by default without deciding would be the wrong answer either
way.
