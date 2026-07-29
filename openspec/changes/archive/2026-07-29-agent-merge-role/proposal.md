## Why

Phase 4 stops dead until a human confirms the merge, even when a cold design gate, an evaluation loop, and a cold final gate have already approved the work. For low-risk changes (dependency bumps, one-line script fixes, docs corrections) that fourth human checkpoint is pure toil. The project's premise — replace "human confirms Y" with "an evidence artifact plus a cold checker that verifies Y against ground truth" — has not yet been applied to the one step that still requires it.

## What Changes

- Add a fifth role, **auditor**, to the agent ensemble: cold by construction (spawned fresh, never resumed, like the skeptic), whose sole job is to verify a completed delivery and merge it, or escalate.
- Add `scripts/concertino/check-merge-readiness.sh`, a deterministic procedure script (mirroring `assert-phase.sh`'s contract) that checks the three machine-verifiable merge conditions: CI is green (every required check `SUCCESS`, not merely non-failing), the PR is mergeable against its current base, and this run's own gates passed (latest evaluator `verdict=PASS` and latest skeptic `verdict=CONFIRM` read from the run's event log). The auditor itself judges the fourth condition — whether the diff satisfies the ticket's acceptance criteria — since that is cold subjective judgment, not a deterministic check.
- Add **agent-merge** as a toggle: a project-level config default (`agentMerge.enabled`, `agentMerge.mergeMethod`) plus a per-run override, exposed identically at three points: the `/concertino-deliver` slash command (`--agent-merge` / `--no-agent-merge`), the dashboard's `n` quick-launch prompt, and the launch plan screen (which shows how the toggle resolved before launching, same discipline already applied to ports).
- Update `core/roles/orchestrator.md`'s Phase 3/4 boundary: when agent-merge resolves `true` for the run, spawn the auditor fresh after PR creation instead of stopping for a human "merged" confirmation. A `MERGE` verdict proceeds straight into Phase 4 cleanup; an `ESCALATE` or `BLOCKER` verdict leaves the PR open and the worktree intact and falls back to today's human-confirmation flow.
- Render the auditor into both harnesses: `adapters/claude-code/agents.json` gains an `auditor` entry (own tool grant, cold — no warm resume); `adapters/codex/prompt.md` gains a seventh sequential stage (after today's PR-creation step, not before it) and `adapters/codex/agent.toml.tmpl`'s optional worker-dispatch list gains a fifth entry; `bin/concertino` renders it everywhere the four existing roles are currently iterated (sync, doctor, diff, eject, update validation) and adds `models.auditor` to the config schema.
- Update `docs/harness-capabilities.md`'s capability matrix and `README.md`'s role table to describe a five-agent topology instead of four.
- The auditor's verdict is recorded as evidence via the existing `persist-evidence.sh` (unchanged) and `emit-event.sh` (unchanged) contracts — no new telemetry plumbing, just a new emitter following the pattern the skeptic already established.

**Out of scope** (explicitly deferred, per the ticket's own notes): reconciling the run's local `main` after a self-merge (that is CON-25's job) and any interaction with delivery speeds (CON-22, not yet built). This change does not block on either; it only avoids making either harder to add later.

## Capabilities

### New Capabilities
- `agent-merge`: a cold auditor role that verifies a finished delivery's four merge conditions (CI green, mergeable, this run's own gates passed, ACs satisfied) and either merges the PR or escalates with the specific reason — never both, never a half-merged state. Covers the auditor's role contract, `check-merge-readiness.sh`'s deterministic checks, the orchestrator's conditional Phase 3/4 branch, and the config/override toggle surfaced at invocation, in the `n` prompt, and in the launch plan.

### Modified Capabilities
(none — `evidence-telemetry` and `gate-telemetry`'s existing requirements are reused unchanged: the auditor's report is persisted and its verdict emitted through the same `persist-evidence.sh` / `emit-event.sh` contracts the skeptic already uses, with no change to either script's behavior.)

## Impact

- **New files**: `core/roles/auditor.md`, `scripts/concertino/check-merge-readiness.sh`.
- **Modified**: `adapters/claude-code/agents.json`, `adapters/codex/prompt.md`, `adapters/codex/header.md` (role count reference), `core/roles/orchestrator.md` (including its Phase 4 entry-condition line and Guardrails bullet, both of which currently assume a human always confirms merge), `core/workflow-state.template.md`, `bin/concertino`, `config/concertino.schema.json`, `docs/harness-capabilities.md`, `README.md`, `lib/ui/prompt.js`, `lib/ui/format.js` (`ROLE_COLOUR` gains an `auditor` entry), `lib/ui/screens/launchplan.js`, `lib/ui/watch.js`.
- **No changes** to `lib/ui/reducer.js`'s `PHASE_ORDER` (agent-merge is a branch inside the existing Delivery phase, not a new phase) or to `persist-evidence.sh` / `emit-event.sh` (reused as-is).
- **Dependencies**: none new — uses `gh` (already required for PR creation/delivery gate) and `jq` (already used by the openspec planning flow) for `check-merge-readiness.sh`'s deterministic checks.
