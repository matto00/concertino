## Why

Every ticket gets identical rigour today — full-round design gate, up to 3 execution↔evaluation cycles, a cold final skeptic gate, and the same model for every role — regardless of whether the work is a one-line hotfix or a six-screen redesign. The evidence from 15 delivered tickets (see `ticket.md`) shows the cost is wildly uneven but the treatment isn't, and the fix is not to drop the gates that have repeatedly caught real regressions (CON-10, CON-12, CON-13) — it's to let a run buy less *or* more rigour, deliberately, per invocation.

## What Changes

- Add a **speed** dimension (`fast` / `default` / `slow`) to `/concertino-deliver <TICKET> [fast|slow]`, understood by the rendered slash command and the orchestrator role.
- Add `speeds` presets to `concertino.config.json`: each names a `budgets` override and a `roleTiers` mapping (role → `cheap`/`standard`/`capable`), plus two `slow`-only behavioral flags (`secondFinalGateSkeptic`, `evaluatorCleanWorktree`).
- **Restructure `models`** from flat-per-role to **per harness, per role** (`models.<harness>.<role>`), and add `modelTiers.<harness>.<tier>` so a preset names a tier rather than a provider-specific model string. **BREAKING**: existing flat `models.orchestrator`/`models.codex` config shape is replaced.
- Make the Codex adapter template (`adapters/codex/agent.toml.tmpl`) fully config-driven per role, closing the ROADMAP "Codex model id" item — it currently renders one hardcoded/flat model for every Codex role.
- Add a new script, `resolve-speed.sh`, rendered into every project's `scripts/concertino/`, that resolves `(speed, harness)` → effective budgets + per-role models + the two `slow`-only flags, from a sync-time JSON snapshot of the config's speeds/tiers/models. `harness` is an explicit optional second argument (auto-detected when omitted) so both callers that need it — `setup-worktree.sh`, running inside the live harness process, and the launch plan screen, previewing a human-selected harness pre-flight with no live run to detect from — get correct behavior from one shared script. This is the seam that lets budgets move from sync-time-baked prose (today's `{{var:budgets.*}}` templating) to a runtime-resolved value the orchestrator persists in `workflow-state.md` and every role reads from there.
- Update `core/roles/orchestrator.md`, `core/roles/executor.md`, `core/roles/evaluator.md` so every reference to a budget number reads the resolved value from `workflow-state.md` instead of a template-baked constant, and so the orchestrator resolves per-role models once at Setup and passes them as explicit model overrides on every `Agent` spawn (Claude Code only — Codex's sequential, single-process orchestration has no per-spawn model override, so its model resolution stays sync-time/best-effort, documented as a known limit).
- Update `run.start` telemetry (`emit-event.sh` call site in the orchestrator, `lib/ui/reducer.js`) to carry `speed` and the resolved per-role `models`, and render both on the dashboard drill-down (`lib/ui/screens/drilldown.js`).
- Add speed selection to the TUI: the `n` prompt (`lib/ui/prompt.js`) accepts a trailing speed token the same way it already accepts `--agent-merge`/`--no-agent-merge`; the launch plan screen (`lib/ui/screens/launchplan.js`) shows the resolved speed + per-role models pre-flight and lets `s` cycle it, mirroring the existing `h`/`m` pattern; a batch launched from the launch pad carries one speed for the whole batch (`lib/ui/queue.js`).
- `concertino.schema.json`, `config/examples/*.json`, and the repo's own `concertino.config.json` are updated to the new shape.

## Capabilities

### New Capabilities
- `delivery-speed-presets`: named speed presets (`fast`/`default`/`slow`) resolving to a budgets override + per-harness, per-role model tiers (`models.<harness>.<role>` explicit overrides over `modelTiers.<harness>.<tier>` presets, replacing the old flat `models.*` shape and making the Codex adapter's model fully config-driven per role) + the two `slow`-only behavioral flags, invoked via `/concertino-deliver <TICKET> [fast|slow]` and the TUI, with the resolution auditable via `run.start` and the drill-down.

### Modified Capabilities
None. `run.start`'s `speed`/`models` fields and the launch-plan/TUI display are new behavior owned entirely by the new `delivery-speed-presets` capability below — no existing capability's documented requirements change (in particular, `phase-telemetry` documents the `phase.enter` enum only, which this change does not touch).

## Impact

- **Config schema** (`config/concertino.schema.json`): `models` restructured (breaking); new `modelTiers`, `speeds` blocks.
- **Sync** (`bin/concertino`): renders `scripts/concertino/resolve-speed.sh` and a JSON snapshot of speeds/tiers/models for it to read; Codex `.toml` rendering resolves per role instead of one flat model; `emitClaude()`, `emitCodex()`, `cmdEject()`, `cmdDiff()`, and `cmdValidate()`'s Models section all move onto one shared per-harness resolution helper (the first four independently read `c.models` today and would otherwise drift or break under the new shape).
- **`core/scripts/setup-worktree.sh`**: gains an optional third `SPEED` argument; resolves it (via `resolve-speed.sh`, passing the harness it already detected) and folds `speed=`/`models=` into the `run.start` event it already emits — this is the actual, ground-truth `run.start` emission site (confirmed against the script, not assumed), not a call the orchestrator makes itself.
- **Role docs** (`core/roles/orchestrator.md`, `executor.md`, `evaluator.md`): budget references become runtime lookups from `workflow-state.md` rather than sync-time template constants; orchestrator gains speed parsing, parses the extended `setup-worktree.sh` `READY` output into `workflow-state.md`, applies per-spawn model overrides, and implements the `slow`-only clean-worktree/second-skeptic behavior.
- **Adapters** (`adapters/claude-code/command.md`, `adapters/codex/prompt.md`, `adapters/codex/agent.toml.tmpl`): speed argument parsing; per-role Codex model substitution.
- **Workflow state template** (`core/workflow-state.template.md`): gains `SPEED`, resolved budget fields, resolved models.
- **Dashboard** (`lib/ui/reducer.js`, `lib/ui/screens/drilldown.js`, `lib/ui/screens/launchplan.js`, `lib/ui/prompt.js`, `lib/ui/queue.js`): speed shown/edited pre-flight, carried through a batch, rendered on `run.start` and the drill-down.
- **Examples** (`config/examples/*.json`) and the repo's own `concertino.config.json`: migrated to the new `models`/`modelTiers`/`speeds` shape.
- Escalation behavior (budget exhaustion → human) is unchanged in shape at every speed; only the numeric bound and which model reaches the loop change.
