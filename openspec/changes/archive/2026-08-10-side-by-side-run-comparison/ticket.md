# CON-114: Side-by-side run comparison (timeline, gates, duration)

## Description

There's no way to see why one run took 3x longer than a similar one, or how
two runs' gate results/verdicts diverged, without opening each drill-down
separately and holding the comparison in your head.

## Proposed

From the run-archive screen (CON-113, already shipped) or the fleet view's
DONE section, select two runs and open a side-by-side comparison of their
timelines, gate results, and total duration.

## Design decisions to escalate

- Depends on CON-113 (the run-archive screen) for picking two runs that are
  off-screen in DONE's trimmed list — sequence this after CON-113 rather
  than in parallel. (CON-113 has already shipped as of this run — see
  `126e8b6 CON-113 Add a searchable, filterable run archive screen (#95)`.)
- Layout for two full timelines side by side on a normal-width terminal —
  likely needs its own narrower rendering of TIMELINE/GATES rather than
  reusing the drill-down's panels verbatim.

## Acceptance Criteria

- Two DONE runs can be selected and compared side by side: timeline, gate
  results, duration.
- Documented in `docs/dashboard.md`.
