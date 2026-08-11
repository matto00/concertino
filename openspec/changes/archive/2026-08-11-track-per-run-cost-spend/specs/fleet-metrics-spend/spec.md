## ADDED Requirements

### Requirement: METRICS reports fleet-wide spend today and this week
`metricsFor()` (`lib/ui/screens/fleet/metrics.js`) SHALL compute
`spendToday`/`spendWeek` totals in USD, summing every `run.cost` event across
all runs whose event timestamp `t` falls within the "today" (UTC calendar
day) or "this week" (rolling 7-day) window already used by
`deliveredToday`/`deliveredWeek`, plus the reporting coverage for each window
(the count of runs with at least one `run.cost` event in that window over the
count of terminal runs — `status` `done` or `failed` — whose `endedAt` falls
in that window).

#### Scenario: Full coverage
- **WHEN** every terminal run that ended today reported at least one
  `run.cost` event
- **THEN** METRICS' spend line shows `spend today: $X` with no coverage
  caveat, where `X` is the sum of every `run.cost` event's `cost_usd` with
  `t` inside today's window

#### Scenario: Partial coverage
- **WHEN** at least one terminal run that ended today reported no `run.cost`
  event at all (non-Claude-Code harness, feature disabled, or a run predating
  this feature)
- **THEN** METRICS' spend line shows the coverage fraction explicitly (e.g.
  `spend today: $X (N/M runs reporting)`), where `M` is the count of terminal
  runs ended today and `N` is the count of those that reported at least one
  `run.cost` event

#### Scenario: No terminal runs today
- **WHEN** no run reached a terminal state (done or failed) today
- **THEN** METRICS' spend line reports `n/a` for today, matching the existing
  `avg delivery`/`success` lines' `n/a` convention for an empty window

### Requirement: Spend totals never fabricate a value for unreported runs
METRICS SHALL NOT fabricate a spend value for a run that never reported
`run.cost` data. A run with no `run.cost` events (`run.costUsd === null`, per
`run-cost-telemetry`'s reducer requirement) SHALL contribute `0` to the
spend total's numerator but SHALL still be counted in the coverage
denominator — never silently excluded from the denominator (which would
make an incomplete total look complete) and never treated as a genuine `$0`
spend (which would understate coverage as accuracy).

#### Scenario: Mixed reporting and non-reporting runs
- **WHEN** two runs ended today, one Claude-Code run reporting `$1.50` total
  and one OpenCode run reporting no cost data
- **THEN** METRICS' spend line shows `$1.50 (1/2 runs reporting)` for today,
  not `$1.50` alone and not `$0.75` (an averaged or silently-diluted figure)
