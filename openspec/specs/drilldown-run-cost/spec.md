# drilldown-run-cost Specification

## Purpose
Defines the drill-down header's per-run cost line — the run's accumulated `run.cost` total and token count, or an explicit, harness-attributed "not reported" state when no cost data exists.
## Requirements
### Requirement: The drill-down header shows the run's accumulated cost
`lib/ui/screens/drilldown.js`'s header block SHALL render a cost line
alongside the existing `harnessText`/`speedModelsText` lines, showing the
selected run's accumulated `run.costUsd` (formatted as USD) and total token
count when at least one `run.cost` event exists for that run.

#### Scenario: Run with reported cost
- **WHEN** the drilled-down run has `run.costUsd` non-null
- **THEN** the header shows the accumulated `$` figure and total token count

### Requirement: Non-reporting runs show an explicit, harness-attributed notice
When the drilled-down run has no `run.cost` events at all, the header SHALL
show an explicit "not reported" state naming the reason: the run's harness
when it is not `claude-code` (this feature's scope, per `run-cost-telemetry`),
or a generic "not reported" state when the harness is `claude-code` but no
cost data exists (feature was disabled at sync time, or the run predates this
feature) — never a blank field and never a fabricated `$0.00`.

#### Scenario: Non-Claude-Code run
- **WHEN** the drilled-down run's `harness` is not `claude-code` and it has
  no `run.cost` events
- **THEN** the header's cost line states that cost isn't reported for that
  harness, naming it explicitly

#### Scenario: Claude Code run with cost tracking disabled or predating the feature
- **WHEN** the drilled-down run's `harness` is `claude-code` but it has no
  `run.cost` events
- **THEN** the header's cost line shows a generic "not reported" state,
  distinct in wording from the non-Claude-Code case

