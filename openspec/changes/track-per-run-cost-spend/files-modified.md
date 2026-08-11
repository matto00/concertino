## Files modified

- `core/scripts/report-cost.sh` — new. The `SessionEnd`/`SubagentStop` hook
  body: reads the hook JSON payload from stdin, sums the incremental
  (per-agent-cursor-tracked) transcript token usage, resolves `$` via the
  pricing table, and emits `run.cost` via `emit-event.sh`.
- `core/scripts/pricing-table.json` — new. Self-maintained, checked-in
  model-id → per-million-token rate map.
- `lib/config.js` — adds the `costTracking` config surface (default
  `{ enabled: false }`), `checkCostTrackingHook()`/`withCostTrackingFixHint()`
  (mirroring `checkAgentMergePermission`/`withAgentMergeFixHint`), and a new
  silent-unless-applicable "Cost tracking" section in `collectConfigIssues`.
- `lib/cli/emit.js` — adds `mergeCostHookSettings(c, out, dry)` (mirroring
  `mergeAgentMergeSettings`), additively wiring the `report-cost.sh` hook
  into **both** `settings.hooks.SessionEnd` and `settings.hooks.SubagentStop`
  when `costTracking.enabled` is true; called from `emitClaude()`.
- `lib/cli/doctor.js` — wires `checkCostTracking()` into `concertino doctor`,
  mirroring `checkAgentMerge`.
- `lib/ui/prompt.js` — `submitTicket()` now unconditionally merges
  `{ CONCERTINO_TICKET: parsed.ticket }` into the spawn env, first (so a
  caller-supplied env, e.g. provider routing, still wins on collision).
- `lib/ui/reducer.js` — adds `'run.cost'` to `TIER2_KINDS`; `emptyRun()`
  gains `costUsd`/`tokens`; a new `run.cost` fold accumulates (never
  overwrites) `cost_usd` (Number-parsed, tolerating `emit-event.sh`'s
  string-encoding of fractional values) and the four token fields.
- `lib/ui/screens/fleet/metrics.js` — `metricsFor()` computes
  `spend.today`/`spend.week` (sum of in-window `run.cost` events plus
  reporting-coverage fractions); `metricsColumnLines()`'s line 1 now renders
  via `layout.fitSegments` (was a hard concatenation) with two new spend
  segments appended.
- `lib/ui/screens/drilldown.js` — adds `costText(run)` and wires it into
  `headerLines()` as a fifth header row.
- `config/concertino.schema.json` — adds the `costTracking` schema entry.
- `docs/dashboard.md` — documents the METRICS spend line and the drill-down
  cost row.
- `docs/config-reference.md` — documents `costTracking.enabled`, the pricing
  table's location/upkeep obligation, and the v1 Claude-Code-only scope.
- `test/config.test.js` — `schemaSectionOrder` fixture updated for the new
  `costTracking` key; new tests for `checkCostTrackingHook`, the "Cost
  tracking" `collectConfigIssues` section, and `withCostTrackingFixHint`.
- `test/emit.test.js` — new tests for `copyAssets` (generic core/scripts/
  passthrough) and `mergeCostHookSettings` (fresh sync, pre-existing settings
  preserved, idempotent re-sync, combined with `mergeAgentMergeSettings`).
- `test/prompt.test.js` — new tests for `CONCERTINO_TICKET` injection (no
  prior env, alongside provider-routing env, caller-supplied env precedence).
- `test/reducer.test.js` — new tests for the `run.cost` fold (single/multi
  event summation, string-encoded fractional `cost_usd`, partial reporting,
  malformed `cost_usd`, no-events-stays-null, `TIER2_KINDS` classification).
- `test/fleet.test.js` — new tests for `metricsFor.spend` (full/partial
  coverage, no-terminal-runs n/a, never-fabricate, week window, malformed
  `cost_usd`) and `metricsColumnLines` line 1 spend rendering.
- `test/drilldown.test.js` — new tests for `costText` (reported cost,
  non-Claude-Code harness-named notice, Claude-Code generic notice).
- `test/scripts/report-cost.test.sh` — new (cycle 2, evaluation-1.md Change
  Request 1). Dedicated shell regression suite for `core/scripts/
  report-cost.sh` itself — the project's established 1:1 `core/scripts/*.sh`
  ↔ `test/scripts/*.test.sh` convention, previously missing for this script.
  Covers: `CONCERTINO_TICKET` unset (clean no-op, no `.concertino/` dir);
  `SessionEnd` (no `agent_type`) → `role=orchestrator` with correct token
  sums and a resolved `cost_usd` for a recognized model; `SubagentStop` with
  `agent_type: "concertino-executor"` → `role=executor`, correct sums from
  `agent_transcript_path`; **the core regression** — two `SubagentStop`
  firings for the same `agent_id` against the same, appended transcript
  (simulating a resumed subagent) → the second firing emits only the
  incremental token delta (30/15), never a re-sum of the whole file
  (130/65); unrecognized model → tokens present, `cost_usd` omitted;
  missing/unreadable transcript → clean no-op. 25/25 pass.
- `package.json` — wires `test/scripts/report-cost.test.sh` into the `test`
  script's shell-suite chain, matching every other `test/scripts/*.test.sh`.

## Cycle 2: evaluator change requests addressed

1. **Blocking — no automated test for `report-cost.sh` itself.** Added
   `test/scripts/report-cost.test.sh` (see above), covering every scenario
   the evaluator's report named, including the core cursor/double-counting
   regression. Wired into `npm test` via `package.json`.
2. **Stale `SessionEnd`-only references in `proposal.md`.** Fixed both named
   spots ("New Capabilities" line ~63-65, "Impact" line ~80-81) to name both
   `SessionEnd` and `SubagentStop`, matching the corrected "What Changes"
   section and every other artifact. Swept the rest of the change for the
   same class of staleness and also fixed `tasks.md`'s section 1 heading
   (`"(SessionEnd hook)"` → `"(SessionEnd/SubagentStop hooks)"`).

Non-blocking suggestion (design.md Context section skim-resistance) also
addressed: added an inline flag at the point Decision 1's correction applies,
directing a skimming reader to the corrected mechanism rather than only
relying on a trailing parenthetical.

## Design/spec corrections from required end-to-end verification (tasks.md 7.1)

`openspec/changes/track-per-run-cost-spend/design.md` (Decisions 1, 3, 5,
Risks), `proposal.md`, `specs/run-cost-telemetry/spec.md`, and `tasks.md`
were all updated to reflect empirically-confirmed findings that corrected
the original doc-derived design: `SessionEnd` fires once per top-level
session only and never carries `agent_type`; `SubagentStop` (not
`SessionEnd`) is the actual per-subagent signal, and fires again — against
the same, appended transcript — on every resume of the same subagent. See
design.md Decision 1's full writeup and the return summary's "Design
correction" section for the probe commands/evidence.
