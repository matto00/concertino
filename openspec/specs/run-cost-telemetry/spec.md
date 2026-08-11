# run-cost-telemetry Specification

## Purpose
Defines the `run.cost` tier-2 event contract — emitted by `core/scripts/report-cost.sh` via Claude Code's `SessionEnd`/`SubagentStop` hooks, with an incremental per-agent cursor so a resumed subagent never double-counts — and the sync-time `costTracking.enabled` wiring that gates it.
## Requirements
### Requirement: `run.cost` is a tier-2 (deterministic) event kind
`lib/ui/reducer.js`'s `TIER2_KINDS` SHALL include `run.cost`, so a run that
has emitted only `run.start`/`gate.result`/`run.cost` events (no agent-authored
tier-3 event) is still classified `telemetry: 'partial'`, not `'none'` —
matching how every other deterministic, script/hook-emitted event kind is
classified.

#### Scenario: A run with only run.start and run.cost events
- **WHEN** a run's event log contains `run.start` and one or more `run.cost`
  events, with no `phase.enter`/`agent.spawn`/`agent.resume`/`agent.return`/
  `verdict` event
- **THEN** `deriveTelemetry` classifies that run's `telemetry` as `'partial'`

### Requirement: report-cost.sh emits one `run.cost` event per Claude Code session or subagent turn-increment
`core/scripts/report-cost.sh` SHALL be invoked as both a Claude Code
`SessionEnd` hook and a `SubagentStop` hook, reading the hook's JSON payload
from stdin. **Empirically confirmed (not doc-derived): `SessionEnd` fires
exactly once for the top-level (orchestrator/root) session and never carries
`agent_type`; `SubagentStop` fires once per Task-tool subagent
turn-completion and carries `agent_type`/`agent_id`/`agent_transcript_path`
— including firing again, for the same `agent_id` against the same, appended
transcript, on every subsequent resume of that subagent.** For a firing whose
process environment carries a `CONCERTINO_TICKET` value (see the
ticket-identification requirement below), `report-cost.sh` SHALL read the
relevant transcript (`transcript_path` for `SessionEnd`, `agent_transcript_path`
for `SubagentStop`), sum `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, and `cache_read_input_tokens` across every
assistant-role entry's `message.usage` object that has not already been
summed by an earlier firing for this same session/agent (see the incremental-
cursor requirement below), and emit at most one `run.cost` event (via
`emit-event.sh`) per firing, carrying `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_creation_tokens`, and `model` (the transcript's
`message.model` value). It SHALL exit `0` without emitting an event when
`CONCERTINO_TICKET` is unset in its environment, when the transcript is
missing or unreadable, or when the firing's increment contains no new
assistant usage — a hook firing for an unrelated Claude Code session (one
never launched through concertino) must never error or emit garbage
telemetry.

#### Scenario: SessionEnd fires for the orchestrator's own session
- **WHEN** the top-level Claude Code session running the orchestrator role
  ends, and `CONCERTINO_TICKET` is set in its environment
- **THEN** `report-cost.sh` emits exactly one `run.cost` event tagged with
  that ticket's id and `role=orchestrator`, carrying non-negative integer
  token counts summed across that session's own transcript

#### Scenario: SubagentStop fires for a concertino role's subagent
- **WHEN** a Task-tool subagent running as one of the executor/evaluator/
  skeptic/auditor roles completes a turn, and `CONCERTINO_TICKET` is set in
  its environment
- **THEN** `report-cost.sh` emits exactly one `run.cost` event tagged with
  that ticket's id, carrying non-negative integer token counts summed across
  that subagent's own transcript (`agent_transcript_path`)

#### Scenario: A hook fires for an unrelated session
- **WHEN** the hook fires for a Claude Code session/subagent with no
  `CONCERTINO_TICKET` set in its environment (never launched through
  concertino)
- **THEN** `report-cost.sh` exits `0` and emits no event

### Requirement: transcript summation is incremental, never double-counting a resumed subagent
`report-cost.sh` SHALL persist a per-agent (per-session, for `SessionEnd`)
transcript line-count cursor under `<main checkout>/.concertino/runs/
<ticket>/.cost-cursors/`, and SHALL sum only the transcript lines added since
that cursor was last recorded, updating the cursor after every firing
(including a firing with no new usage) — because a resumed subagent's
`SubagentStop` firing carries the SAME `agent_id` against the SAME, appended
`agent_transcript_path` file as its earlier firing(s), summing the whole file
on every firing would double-count everything an earlier firing already
reported. This SHALL apply identically to `SessionEnd` and `SubagentStop`
firings.

#### Scenario: A resumed subagent's second SubagentStop firing
- **WHEN** a subagent whose first `SubagentStop` firing already reported its
  turn's usage is later resumed and produces a second `SubagentStop` firing
  for the same `agent_id`, against a transcript file that has grown since the
  first firing
- **THEN** the `run.cost` event emitted for the second firing carries only
  the token usage added since the first firing, not the whole transcript's
  cumulative usage again

### Requirement: ticket and role are identified without relying on `cwd`
`report-cost.sh` SHALL determine the `ticket` field for its `run.cost` event
from the `CONCERTINO_TICKET` environment variable, never from the hook
payload's `cwd` — every concertino-launched session's root process has
`CONCERTINO_TICKET` set unconditionally by `lib/ui/prompt.js`'s
`submitTicket()` (the one spawn entry point every launch path funnels
through) at spawn time, and that value is inherited by every descendant
process, including any subagent session's own hook invocation, by ordinary OS
environment-variable inheritance. `report-cost.sh` SHALL determine the `role`
field from the hook payload's `agent_type` field when present (stripping the
`concertino-` prefix Concertino's own agent definitions are named with, e.g.
`concertino-executor` -> `executor`), and SHALL default `role` to
`orchestrator` when `agent_type` is absent from the payload — which is always
the case for a `SessionEnd` firing (the root/orchestrator session's own
firing) and never the case for a `SubagentStop` firing.

#### Scenario: Root orchestrator session ends
- **WHEN** `SessionEnd` fires for the orchestrator's own top-level session,
  whose hook payload carries no `agent_type` field
- **THEN** the emitted `run.cost` event's `role` field is `orchestrator`

#### Scenario: A subagent completes a turn
- **WHEN** `SubagentStop` fires for a Task-tool subagent whose hook payload
  carries `agent_type: "concertino-executor"`
- **THEN** the emitted `run.cost` event's `role` field is `executor`

### Requirement: cost_usd is derived from a self-maintained pricing table, omitted when the model is unrecognized
`report-cost.sh` SHALL look up the transcript's `model` id in
`scripts/concertino/pricing-table.json` (synced from
`core/scripts/pricing-table.json`) and, when found, compute `cost_usd` as the
sum of each token category multiplied by its per-million-token rate. When the
model id has no entry in the pricing table, `report-cost.sh` SHALL emit the
`run.cost` event with token fields populated and `cost_usd` omitted entirely
(not `0`, not a guessed value) — a caller distinguishes "no cost data" from
"zero cost" by field presence.

#### Scenario: Recognized model
- **WHEN** the transcript's `model` id has a matching entry in
  `pricing-table.json`
- **THEN** the emitted `run.cost` event includes a `cost_usd` field equal to
  the token-weighted sum at that model's rates

#### Scenario: Unrecognized model
- **WHEN** the transcript's `model` id has no matching entry in
  `pricing-table.json`
- **THEN** the emitted `run.cost` event omits `cost_usd` entirely while still
  including the summed token fields

### Requirement: `submitTicket()` unconditionally injects `CONCERTINO_TICKET`
`lib/ui/prompt.js`'s `submitTicket()` SHALL merge `{ CONCERTINO_TICKET:
<the resolved ticket id> }` into the `env` map passed to `session.spawn()`
for every spawn, regardless of launch path (the `n` prompt, queue tick,
force-start, restart, address-failure) and regardless of whether any
provider-routing env (`CON-65`'s `CONCERTINO_PROVIDER`) also applies — never
overwriting a caller-supplied env value on key collision, though none exists
between `CONCERTINO_TICKET` and any pre-existing injected key today.

#### Scenario: Plain launch, no provider routing
- **WHEN** a ticket is launched via the `n` prompt with no provider label
  override
- **THEN** the spawned session's environment includes `CONCERTINO_TICKET`
  set to that ticket's id

#### Scenario: Launch with provider routing also active
- **WHEN** a ticket is launched with a `provider:ollama` label override
  active (contributing `CONCERTINO_PROVIDER` and related env)
- **THEN** the spawned session's environment includes both
  `CONCERTINO_TICKET` and the provider-routing env, with neither overwriting
  the other

### Requirement: `cost_usd` is parsed as a number before summation, tolerating string encoding
`lib/ui/reducer.js`'s `run.cost` fold SHALL parse `cost_usd` as a number
before summing it, never assume it already arrived as a JS number.
`scripts/concertino/emit-event.sh`'s `json_value()` auto-unquotes only bare
JSON integers, so a fractional `cost_usd` value is emitted as a JSON string
(e.g. `"0.0234"`), not a JSON number. `lib/ui/reducer.js`'s `run.cost` fold
SHALL parse `ev.cost_usd` via `Number(...)` before adding it to the running
`run.costUsd` total, rather than assuming it already arrived as a JS number.
When `Number(ev.cost_usd)` is `NaN` (absent, or a malformed/torn value), that
event SHALL contribute `0` to the dollar total while its token fields are
still summed normally — a malformed `cost_usd` degrades exactly like an
absent one, never producing `NaN`/string-concatenation corruption of
`run.costUsd`.

#### Scenario: A string-encoded fractional cost_usd sums correctly
- **WHEN** a `run.cost` event's `cost_usd` field arrives as the JSON string
  `"0.0234"` (as `emit-event.sh` actually encodes it)
- **THEN** `run.costUsd` reflects `0.0234` added as a number, not the string
  concatenated or the sum reported as `NaN`

### Requirement: reducer.js accumulates run.cost events, never overwrites
`lib/ui/reducer.js`'s event fold SHALL, on each `run.cost` event, add that
event's `cost_usd` (when present, parsed per the requirement above) to a
running `run.costUsd` total and each token field to running `run.tokens`
totals — never replace the prior total with the new event's value. A run
with no `run.cost` events SHALL have `run.costUsd === null` (not `0`) and
`run.tokens === null`, so "no data reported" is distinguishable from
"reported and the total happens to be zero."

#### Scenario: Multiple sessions report cost for the same run
- **WHEN** a run's event log contains two `run.cost` events, each with its
  own `cost_usd` and token fields, from two different role sessions
- **THEN** `run.costUsd` equals the sum of both events' `cost_usd` values,
  and each `run.tokens` field equals the sum of both events' corresponding
  token fields

#### Scenario: A run with no cost events at all
- **WHEN** a run's event log contains no `run.cost` event
- **THEN** `run.costUsd` is `null` and `run.tokens` is `null`

#### Scenario: A run where only some sessions report cost_usd
- **WHEN** a run's event log contains two `run.cost` events, one with a
  `cost_usd` field and one where `cost_usd` was omitted (unrecognized model)
- **THEN** `run.costUsd` equals only the sum of the events that carried
  `cost_usd`, and the run is still distinguishable downstream as
  partially-reporting (see `fleet-metrics-spend`'s coverage requirement)

### Requirement: `costTracking.enabled` gates the SessionEnd + SubagentStop hooks, default off
`concertino sync` SHALL additively merge the same `report-cost.sh` hook entry
into **both** `settings.hooks.SessionEnd` **and** `settings.hooks.SubagentStop`
of the target project's `.claude/settings.json`, only when the project
config's `costTracking.enabled` is `true` — both are required (design.md
Decision 1's empirical finding: `SessionEnd` alone only ever reports the
orchestrator/root role; every other role's cost is only observable via
`SubagentStop`). This merge SHALL preserve every other pre-existing key in
`.claude/settings.json` (including any other `hooks` entries), matching the
existing read-modify-write discipline `mergeAgentMergeSettings` already uses
for `permissions.allow`. When `costTracking.enabled` is `false` or absent
(the default), `concertino sync` SHALL NOT modify `.claude/settings.json`'s
`hooks` key at all.

#### Scenario: costTracking enabled on a fresh sync
- **WHEN** `concertino sync` runs for a project with `costTracking.enabled:
  true` and no pre-existing `.claude/settings.json`
- **THEN** the written `.claude/settings.json` includes both a `SessionEnd`
  and a `SubagentStop` hook entry, each invoking
  `scripts/concertino/report-cost.sh`

#### Scenario: costTracking enabled alongside pre-existing settings
- **WHEN** `concertino sync` runs for a project with `costTracking.enabled:
  true` and a pre-existing `.claude/settings.json` containing unrelated
  `permissions.allow` entries
- **THEN** the rewritten `.claude/settings.json` retains every pre-existing
  `permissions.allow` entry unchanged, in addition to the new `SessionEnd`
  and `SubagentStop` hook entries

#### Scenario: costTracking disabled (default)
- **WHEN** `concertino sync` runs for a project with `costTracking.enabled`
  absent or `false`
- **THEN** `.claude/settings.json`'s `hooks` key is left exactly as it was
  before sync ran (untouched, including not being created if absent)

