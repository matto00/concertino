# fleet-metrics-harness-breakdown Specification

## Purpose
Breaks out the fleet METRICS panel's success rate and average delivery
duration by `run.harness` and `run.model`, in the expanded tier only, so it's
possible to see whether one harness or model is meaningfully slower or less
reliable than another on a fleet running more than one.
## Requirements
### Requirement: `metricsFor()` computes per-harness and per-model breakdowns
`metricsFor(runs, now)` SHALL return a `harnessBreakdown` array with one entry
per distinct `run.harness` value present across `runs`, and a `modelBreakdown`
array with one entry per distinct `run.model` value present across `runs`.
Runs with no `run.harness` (respectively no `run.model`) SHALL be excluded
from that breakdown. Each entry SHALL be an object `{ harness, rate, avgMs }`
(or `{ model, rate, avgMs }`), where `rate` SHALL have the same shape as the
existing fleet-wide `successRate.today`/`successRate.week` entries (`{ rate,
done, total }`), computed over the same "terminal run" definition the
fleet-wide `successRate` already uses (status `done` or `failed` with a
non-null `endedAt`), but restricted to that harness/model's runs and computed
over ALL history rather than a today/week window. `avgMs` SHALL be computed
over the same "done run with a known `elapsedMs`" definition the fleet-wide
`avgMs` already uses, restricted to that harness/model's runs, and SHALL be
`null` when no such run exists for that key.

#### Scenario: Single harness across all runs
- **WHEN** `metricsFor()` is called with runs that all share the same
  `run.harness` value
- **THEN** `harnessBreakdown` contains exactly one entry, for that harness

#### Scenario: Multiple harnesses
- **WHEN** `metricsFor()` is called with runs spanning two distinct
  `run.harness` values (e.g. `claude-code` and `codex`)
- **THEN** `harnessBreakdown` contains one entry per distinct harness, each
  with a `rate`/`avgMs` computed only from that harness's own runs

#### Scenario: Runs with no recorded harness are excluded
- **WHEN** `metricsFor()` is called with some runs having no `run.harness`
  set
- **THEN** those runs are excluded from every `harnessBreakdown` entry, and
  contribute no entry of their own

#### Scenario: Model breakdown mirrors harness breakdown
- **WHEN** `metricsFor()` is called with runs spanning two distinct
  `run.model` values
- **THEN** `modelBreakdown` contains one entry per distinct model, computed
  the same way `harnessBreakdown` is computed for harness

### Requirement: METRICS' expanded tier renders harness/model breakdown lines only when there is more than one distinct value
`metricsColumnLines()` SHALL render a "by harness" line, in the expanded tier
only (the same `cols >= 80 && contentRows >= 11` gate its existing duration
and recent-escalations blocks already use), only when `harnessBreakdown` has
more than one entry. It SHALL render a "by model" line, under the same
expanded-tier gate, only when `modelBreakdown` has more than one entry. When
a breakdown array has zero or one entries, its corresponding line SHALL NOT
be rendered at all — the expanded tier's output SHALL be identical to today's
output for a fleet with a single harness and a single (or no) recorded
model. The compact (non-expanded) tier SHALL be unaffected by this
requirement.

#### Scenario: Expanded tier, multiple harnesses
- **WHEN** METRICS renders in the expanded tier for a fleet whose runs span
  two distinct harnesses
- **THEN** the rendered lines include a "by harness" line showing per-harness
  success rate and avg duration

#### Scenario: Expanded tier, single harness — no degenerate box
- **WHEN** METRICS renders in the expanded tier for a fleet whose runs all
  share one harness and no more than one recorded model
- **THEN** the rendered lines are identical to the expanded tier's output
  before this change — no "by harness" or "by model" line is rendered

#### Scenario: Expanded tier, multiple models
- **WHEN** METRICS renders in the expanded tier for a fleet whose runs span
  two distinct `run.model` values
- **THEN** the rendered lines include a "by model" line showing per-model
  success rate and avg duration

#### Scenario: Compact tier is never affected
- **WHEN** METRICS renders in the compact (non-expanded) tier, regardless of
  how many distinct harnesses or models are present in `runs`
- **THEN** the rendered lines are identical to today's 5-line compact tier —
  no breakdown line is rendered

