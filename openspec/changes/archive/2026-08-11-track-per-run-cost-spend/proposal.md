## Why

No `cost_usd` or token field exists anywhere in the event schema
(`lib/ui/reducer.js`'s `TIER2_KINDS`/`TIER3_KINDS`, `emptyRun()`) — there is
currently no way to see what a run, or the fleet as a whole, is costing
without cross-referencing each harness's own external billing/usage view by
hand.

Research done before this plan was written (recorded in this ticket's
escalation) found Claude Code has no direct `$` field for an interactive
session — only a self-maintained token-usage summation could produce one —
while OpenCode has first-class `opencode stats`/`export` cost accounting and
Codex exposes tokens but no price at all. The human resolved the two open
design questions: **v1 ships Claude Code only** (despite OpenCode's stronger
native cost story — that inversion is intentionally deferred, not solved
here), and the drill-down gets a per-run cost line in addition to the
METRICS fleet-wide roll-up.

## What Changes

- A new tier-2 (deterministic, harness-emitted — same tier as `run.start`/
  `gate.result`) `run.cost` event: `cost_usd`, `input_tokens`,
  `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `model`.
  Emitted once per Claude Code session/turn-increment (i.e. once per role
  spawn plus once per subsequent resume — orchestrator, executor, evaluator,
  skeptic, auditor each fire their own), via a new hook script wired to both
  `SessionEnd` (the orchestrator/root role) and `SubagentStop` (every other
  role — design.md Decision 1's empirical correction of the originally-
  assumed `SessionEnd`-only mechanism) that sums the session transcript's
  per-message token usage — incrementally, via a persisted per-agent cursor,
  so a resumed subagent's repeat firings never double-count — and converts to
  `$` via a self-maintained, checked-in pricing table. A run's total cost is
  the sum of every `run.cost` event it emitted, not a single terminal value.
- `concertino sync` additively wires the `SessionEnd`/`SubagentStop` hooks
  into `.claude/settings.json` (mirroring `mergeAgentMergeSettings` in
  `lib/cli/emit.js`) when a new `costTracking.enabled` config flag is true;
  off by default (opt-in, since the pricing table needs upkeep the project
  owner must accept responsibility for).
- `lib/ui/reducer.js`: `run.cost` added to `TIER2_KINDS`; `emptyRun()` gains
  `costUsd`/`tokens` fields; a new fold accumulates every `run.cost` event's
  `cost_usd` (and token counts) into those fields, and separately retains
  the raw per-event list so METRICS' today/week windowing (which needs each
  event's own timestamp, not just the run total) has what it needs.
- METRICS (`lib/ui/screens/fleet/metrics.js`) gains a `spend today: $X ·
  week: $Y` line, degrading honestly: when at least one run in the window has
  no cost data (non-Claude-Code harness, or a Claude Code run that predates
  this feature), the line states the reporting coverage explicitly (e.g.
  `(N/M runs reporting)`) rather than silently presenting a total that looks
  complete but isn't.
- The drill-down (`lib/ui/screens/drilldown.js`) gains a per-run cost line in
  the header block (alongside `harnessText`/`speedModelsText`), showing the
  run's accumulated `$` + token count, or an explicit "not reported" state
  for a non-Claude-Code run — the same claude-code-only inline-notice
  discipline `lib/ui/controllers/fleet.js`'s `address-failure` case already
  follows for a claude-code-only feature.
- `docs/dashboard.md` (METRICS spend line, drill-down cost line) and
  `docs/config-reference.md` (`costTracking.enabled`, the pricing-table file
  and its upkeep obligation) updated.

## Capabilities

### New Capabilities
- `run-cost-telemetry`: the `run.cost` tier-2 event contract, the
  `SessionEnd`/`SubagentStop` hooks that emit it, the self-maintained
  pricing table, and the sync-time `costTracking.enabled` wiring into
  `.claude/settings.json`.
- `fleet-metrics-spend`: the METRICS panel's fleet-wide spend today/week
  line, including its honest-degradation (partial-coverage) behavior.
- `drilldown-run-cost`: the drill-down header's per-run cost line, including
  its claude-code-only degrade behavior.

### Modified Capabilities
(none — no existing capability's requirements change; this is additive
telemetry and additive rendering on top of it)

## Impact

- `lib/ui/reducer.js` (event schema/fold), `lib/ui/screens/fleet/metrics.js`
  (METRICS), `lib/ui/screens/drilldown.js` (drill-down header), `lib/cli/emit.js`
  (sync-time settings merge), `lib/config.js` (new `costTracking` config
  surface + validation), a new `scripts/concertino/report-cost.sh` +
  `core/scripts/report-cost.sh` (SessionEnd/SubagentStop hook body) and a new
  checked-in pricing-table data file, `docs/dashboard.md`,
  `docs/config-reference.md`.
- No breaking changes; `run.cost` is a brand-new event kind, and every new
  field on `run`/metrics degrades to `null`/"not reported" for any run
  (existing or non-Claude-Code) that never emits it.
