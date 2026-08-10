# CON-104: Live diff panel in the run drill-down

## Description

The drill-down (`lib/ui/screens/drilldown.js`) has four panels — TICKET, TIMELINE, GATES, EVIDENCE — and no way to see what an agent has actually changed in its worktree while a run is in flight. The only options today are `tmux attach` or waiting for the eventual PR. This is a real observability gap given how EVIDENCE-driven the rest of the drill-down already is.

## Proposed

Add a fifth panel, CHANGES, alongside TICKET/TIMELINE/GATES/EVIDENCE (`1`-`5` jump, `Tab` cycles through all five). It shows `git diff --stat` against the run's worktree (`run.worktree`, already tracked by `reducer.js`'s `run.start` handling) by default, with an affordance to expand a selected file into its full unified diff, reusing the existing panel-scroll conventions (`↑`/`↓`, `Page Up`/`Page Down`) TICKET/TIMELINE already use.

## Design decisions to escalate

* Live-refresh cadence: recompute the diff every poll (same cadence as the rest of the dashboard), or only on panel focus/keypress? Shelling out to `git diff` every ~1s poll tick could be costly against a large working tree.
* What happens once the run finishes and the worktree is removed (`cleanup.sh --phase4`)? EVIDENCE's `ticket.md` convention (persist a durable snapshot under `.concertino/runs/<TICKET>/evidence/`) suggests persisting the final diff too, rather than losing it once the worktree is gone — needs a decision on where a durable diff snapshot would live, or whether CHANGES simply reads "worktree removed" once gone.
* Binary/large-diff handling — truncate, or refuse and say so?

## Acceptance criteria

* A CHANGES panel is reachable via `5`/`Tab` from the drill-down while a run's worktree still exists, showing `git diff --stat` and letting a file be expanded to its full diff.
* The panel degrades honestly (not silently) once the worktree is gone, per the project's "absent data must never render as healthy data" convention.
* Documented in `docs/dashboard.md`'s drill-down section, and the new key(s) are advertised in the footer per `sections.js`'s "only advertise a key that currently does something" discipline.
