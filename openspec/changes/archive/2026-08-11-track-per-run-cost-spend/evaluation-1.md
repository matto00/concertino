## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS (with a minor issue noted)

- [x] All ticket acceptance criteria addressed explicitly:
  - AC1 ("at least one harness reliably reports cost/token usage") — `run.cost`
    tier-2 event, emitted by `core/scripts/report-cost.sh` wired to both
    `SessionEnd` and `SubagentStop`. Verified independently (see Phase 2) to
    actually emit correct events.
  - AC2 ("METRICS shows fleet-wide spend, degrading honestly") —
    `metricsFor().spend.{today,week}` + `metricsColumnLines()` render
    `spend today $X (N/M runs reporting) · week $Y (N/M)`, coverage
    parenthetical omitted only at full coverage. Matches design.md Decision 4.
  - AC3 (docs) — `docs/dashboard.md` and `docs/config-reference.md` both
    updated with accurate, consistent descriptions of the new surface.
- [x] No AC silently reinterpreted — the human's escalation answers
  (Claude-Code-only v1, drill-down gets its own cost line) are followed
  faithfully.
- [x] All `tasks.md` items marked done and match what was implemented
  (verified against the diff item-by-item for sections 1-6; section 7's
  end-to-end verification claims independently re-confirmed, see Phase 2).
- [x] No scope creep — every changed file traces to this ticket's stated
  Impact list (reducer, metrics, drilldown, emit, config, doctor, prompt,
  docs, new scripts/data file, tests).
- [x] No regressions — `Object.assign({CONCERTINO_TICKET...}, env || {})` in
  `submitTicket()` preserves existing caller-env precedence; `run.cost`
  fold is purely additive to `applyEvent`; `mergeCostHookSettings` never
  touches `hooks` when disabled (verified by test and by reading the
  function). Full pre-existing test suite still green (see Phase 2).
- [x] API/schema updated: `config/concertino.schema.json` gained
  `costTracking`, and `test/config.test.js`'s `schemaSectionOrder` fixture
  was updated to match.
- [~] Planning artifacts reflect final implemented behavior — **mostly**, with
  one loose end: `proposal.md`'s "New Capabilities" (line 63-65) and
  "Impact" (line 80-81) sections still say "the `SessionEnd` hook that emits
  it" / "`core/scripts/report-cost.sh` (SessionEnd hook body)" with no
  mention of `SubagentStop`, even though the "What Changes" section directly
  above them (lines 24-29) and every other artifact (design.md, tasks.md,
  spec.md, the script's own header comment) were correctly updated to name
  both hooks. This is the class of stale reference the design-correction
  claim needed to be checked against — found, but confined to these two
  sentences; it does not affect `spec.md` (the authoritative, fully
  consistent source) or any code.

### Phase 2: Code Review — FAIL

Ran `npm test` fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` override at this
speed): **2230/2230 `node --test` cases pass, all 30 shell test suites pass,
exit code 0.** `openspec validate track-per-run-cost-spend --strict`:
**"Change 'track-per-run-cost-spend' is valid".** Both independently
re-run, not trusted from the executor's report.

**Independent verification of the core empirical claim** (the reason this
review was asked to scrutinize this cycle closely): built a throwaway repo,
copied `report-cost.sh`/`pricing-table.json`/`emit-event.sh` into it, and
drove the script directly with synthetic hook payloads and transcripts:
- `SubagentStop` with `agent_type: "concertino-executor"` → emitted `run.cost`
  with `role=executor`, correct token sums for a 2-line transcript, cursor
  file written to `2`.
- A second `SubagentStop` firing for the **same `agent_id`** against the
  **same, appended** transcript (3rd line added, simulating a resume) →
  emitted a **second** `run.cost` event carrying only the 3rd line's
  incremental tokens (`input_tokens: 40`, not `170`) — confirms the cursor
  mechanism genuinely prevents the double-count the executor's report
  describes, not just on paper.
- `SessionEnd` (no `agent_type`) → `role=orchestrator`, as designed.
- `CONCERTINO_TICKET` unset → clean no-op, no `.concertino/` directory ever
  created.
- Unrecognized model → event still emitted with token fields, `cost_usd`
  field omitted entirely (not `0`).

All of the above match `design.md` Decision 1/5, `specs/run-cost-telemetry/
spec.md`, and the script's own header comment exactly. The executor's claim
is confirmed correct and faithfully implemented — this is genuinely solid,
carefully-reasoned work.

Reviewed `lib/ui/reducer.js`, `lib/cli/emit.js`, `lib/config.js`,
`lib/cli/doctor.js`, `lib/ui/prompt.js`, `lib/ui/screens/fleet/metrics.js`,
`lib/ui/screens/drilldown.js`, `config/concertino.schema.json` via diff +
full-file context. No DRY/readability/modularity/type-safety/security issues
found; error handling is appropriately best-effort at the telemetry boundary
(matches the project's existing "never let telemetry block delivery"
discipline); no dead code; `mergeCostHookSettings`/`checkCostTrackingHook`
correctly mirror the existing `mergeAgentMergeSettings`/
`checkAgentMergePermission` pattern with no unnecessary duplication beyond
what the file's own "stay standalone" convention for `core/scripts/*.sh`
already establishes project-wide.

**Blocking issue — no automated test for `report-cost.sh` itself:**

Every other script in `core/scripts/` has a dedicated
`test/scripts/<name>.test.sh` counterpart (`check-agent-merge-permission.sh`
→ `check-agent-merge-permission.test.sh`, `emit-event.sh` →
`emit-event.test.sh`, `resolve-speed.sh` → `resolve-speed.test.sh`, etc. — 13
of 14 pre-existing scripts follow this 1:1 convention; only the pre-existing
`setup-worktree.sh` lacks one, and that gap predates this ticket). This
ticket's new `core/scripts/report-cost.sh` — the single most intricate and
previously-*actually-wrong* piece of logic in the whole change (the
`hook_event_name` dispatch, the transcript-JSONL parsing, the per-agent
incremental line cursor that exists specifically to fix a real double-
counting bug the executor found via manual probing) — has **zero** automated
regression coverage. `test/emit.test.js`/`test/reducer.test.js`/
`test/fleet.test.js` etc. only cover the JS-side consumers (schema wiring,
reducer fold, METRICS math) — none of them exercise the actual bash+node
script's own logic (cursor read/write, transcript slicing, role/ticket
derivation, pricing lookup). The `tasks.md` 7.1/7.2 verification was real and
thorough, but it was manual and ephemeral (probe scripts against a
throwaway `.claude/settings.json`, not committed anywhere) — nothing in
`npm test` would catch a future regression to this script (e.g. someone
"simplifying" the cursor logic back to a full re-sum, or breaking the
`SubagentStop`/`SessionEnd` dispatch). This is exactly the kind of
regression the "Tests meaningful" checklist item exists to prevent, on
exactly the piece of this change most likely to silently regress.

### Phase 3: UI Review — N/A

Per role instructions, this project has no UI review configured for this
evaluator; skipped per instructions (dev-server steps not run).

### Overall: FAIL

### Change Requests

1. **Add `test/scripts/report-cost.test.sh`** (matching the project's
   established 1:1 `core/scripts/*.sh` ↔ `test/scripts/*.test.sh`
   convention), covering at minimum:
   - `CONCERTINO_TICKET` unset → exits 0, no event, no `.concertino/`
     directory created.
   - `SessionEnd` payload (no `agent_type`) → emits `run.cost` with
     `role=orchestrator`, correct token sums from `transcript_path`.
   - `SubagentStop` payload with `agent_type: "concertino-executor"` →
     `role=executor`, correct token sums from `agent_transcript_path`.
   - **The core regression this script exists to prevent**: two
     `SubagentStop` firings for the same `agent_id` against the same,
     appended transcript file (simulating a resumed subagent) → the second
     firing's emitted event carries only the incremental token delta, not a
     re-sum of the whole file.
   - Unrecognized `model` id → event emitted with token fields, `cost_usd`
     omitted.
   - Missing/unreadable transcript → exits 0, no event.
   This is directly runnable today — I independently exercised all of these
   exact scenarios by hand while reviewing (see Phase 2) and they all behave
   correctly; the work here is packaging that verification as a permanent,
   automated regression test, not re-deriving correct behavior.

2. **Fix the two stale `SessionEnd`-only references in `proposal.md`**:
   - Line 63-65 ("New Capabilities"): "the `SessionEnd` hook that emits it"
     → should name both `SessionEnd` and `SubagentStop`, matching the
     corrected "What Changes" section directly above it.
   - Line 80-81 ("Impact"): "`core/scripts/report-cost.sh` (SessionEnd hook
     body)" → should say "SessionEnd/SubagentStop hook body", matching the
     script's own header comment and every other artifact.

### Non-blocking Suggestions

- `design.md`'s "Context" section (lines 9-22, predating Decision 1's
  correction) still states the original doc-derived claim ("`agent_type`/
  `agent_id` when the firing session is a Task-tool subagent rather than the
  root session") as apparent fact, only parenthetically pointing to
  "Decision 1" for the correction. Not misleading on a careful read (the
  parenthetical is right there, and Decision 1 is unambiguous and thorough),
  but a reader skimming only the Context section would come away with the
  wrong model. Consider a one-line "corrected below, see Decision 1" flag at
  the start of that bullet, purely for skim-resistance — not required for
  this ticket's correctness.
