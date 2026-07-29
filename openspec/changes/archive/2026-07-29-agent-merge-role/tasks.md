## 1. Deterministic merge-readiness script

- [x] 1.1 Add `scripts/concertino/check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>` mirroring `assert-phase.sh`'s `PASS`/`FAIL <reason>` stdout/stderr contract.
- [x] 1.2 Implement the CI-green check via `gh pr view "$BRANCH" --json statusCheckRollup` (run with cwd `$WORKTREE_PATH`), distinguishing pending/queued/in-progress from an actual failure conclusion; treat an empty rollup as passing.
- [x] 1.3 Implement the mergeable check via `--json mergeable,mergeStateStatus,reviewDecision`: `CLEAN` passes; `BEHIND`/`DIRTY`/`UNSTABLE` fail naming the status; `BLOCKED` + `reviewDecision=REVIEW_REQUIRED` fails with the specific "branch protection requires human review" message; `UNKNOWN`, `DRAFT`, or any other unenumerated value fails closed as "mergeability not yet determined: <status>" (never falls through to a pass).
- [x] 1.4 Implement the gates-passed check by reading `.concertino/runs/<TICKET_ID>/events.jsonl` from the main checkout (resolve the same way `emit-event.sh` does), requiring the latest `role=evaluator` verdict to be `PASS` and the latest `role=skeptic` verdict to be `CONFIRM`.
- [x] 1.5 Make the script executable and add it to whatever asset list `concertino diff`/`doctor` already compares `scripts/concertino/*` against, so a project that hasn't re-synced is flagged as out of date.

## 2. Auditor role (core + Claude Code + Codex)

- [x] 2.1 Write `core/roles/auditor.md`: cold posture (spawned fresh, never resumed), inputs (`WORKTREE_PATH, CHANGE_NAME, TICKET_ID, BRANCH, PR_URL`), evidence discipline reference, the four-condition check (script for three, cold AC trace for the fourth), verdict vocabulary `MERGE | ESCALATE | BLOCKER`, merge command (`gh pr merge <BRANCH> --<mergeMethod>`, no `--delete-branch`), and the write-report → `persist-evidence.sh` → emit `verdict` output contract (no redundant `evidence` event), matching `core/roles/skeptic.md`'s shape.
- [x] 2.2 Add an `auditor` entry to `adapters/claude-code/agents.json` (`baseTools: Read, Write, Bash, Grep, Glob`, `mcpTools` for linear/github `get_issue`, `usesUi: false`, its own `color`, `model: sonnet` default, description distinguishing it from evaluator/skeptic).
- [x] 2.3 Add a **seventh** sequential stage for the auditor to `adapters/codex/prompt.md`, strictly **after** today's step 6 (Orchestrator: squash/archive/push/PR/comment) — not before it, since the auditor operates on an existing PR — gated on "when agent-merge is enabled for this run," and stating that on `ESCALATE`/`BLOCKER` the single Codex thread stops and hands off rather than attempting Phase 4 on an unmerged PR.
- [x] 2.4 Update `adapters/codex/header.md` if it references the role count.

## 3. Orchestrator integration

- [x] 3.1 Update `core/workflow-state.template.md` to add an `AGENT_MERGE: true|false` line.
- [x] 3.2 Update `core/roles/orchestrator.md` Setup to resolve `AGENT_MERGE` once (per-run override wins over `agentMerge.enabled` config default) and persist it.
- [x] 3.3 Update Phase 3 (Delivery): after PR creation + posting the link, branch on `AGENT_MERGE`. `false` → unchanged existing flow. `true` → spawn the auditor fresh, wait for its verdict within the same turn (reuse the existing "never end your turn" language pattern), then:
  - `MERGE` → present the merged PR + summary, proceed directly into Phase 4.
  - `ESCALATE`/`BLOCKER` → read the report, surface the reason to the human, fall back to the existing wait-for-"merged" flow (PR stays open, worktree intact).
- [x] 3.4 Add a circuit-breaker table row: "Agent-merge (auditor) | 1 attempt, no retry | ESCALATE/BLOCKER → human decides next step".
- [x] 3.5 Emit `agent.spawn role=orchestrator agent=auditor` at the spawn point, matching the existing telemetry pattern for the other three sub-agents.
- [x] 3.6 Fix the two lines of `core/roles/orchestrator.md` that currently assume a human always confirms merge, since they otherwise directly contradict the new path: the Phase 4 heading's entry condition ("After the human confirms merge:") → "after either a human 'merged' confirmation or an auditor `MERGE` verdict"; the Guardrails bullet ("Post-merge cleanup requires human confirmation — do not clean up speculatively") → qualified the same way.

## 4. Config schema + rendering loops

- [x] 4.1 Add `agentMerge: { enabled: boolean (default false), mergeMethod: enum[squash,merge,rebase] (default squash) }` to `config/concertino.schema.json`, **and** add `auditor` to the same schema's `models.properties` list (`additionalProperties: false` there today enumerates only orchestrator/executor/evaluator/skeptic/codex — a config setting `models.auditor` would otherwise be schema-invalid).
- [x] 4.2 Add `agentMerge` defaults to `withDefaults()` and `buildConfig()` in `bin/concertino`; add `models.auditor: 'sonnet'` default alongside the other four (this is the runtime-defaults edit, separate from and in addition to the schema edit in 4.1).
- [x] 4.3 Add `'auditor'` to every role array currently hardcoded to the four existing roles in `bin/concertino`: `emitClaude`, `emitCodex`'s AGENTS.md role-section list, `emitCodex`'s codex-worker-toml list (and the matching branch in `cmdEject`), `cmdDoctor`/`cmdDiff`'s existence checks, `cmdEject`'s role-validation error message, `cmdUpdate`'s model-key validation.
- [x] 4.4 Add an `init` wizard prompt (yes/no `agentMerge.enabled`, and a mergeMethod choice when enabled) in the "Extras" section, shown in the summary rows.
- [x] 4.5 Update the `concertino update`/`eject`/`help` usage text to mention `models.auditor` and `agentMerge.*` where the other models/budgets are already documented.

## 5. Per-run override surface

- [x] 5.1 Update `adapters/claude-code/command.md` to extract an optional trailing `--agent-merge`/`--no-agent-merge` flag from `$ARGUMENTS` alongside the ticket id, and pass the resolved override into the orchestrator's spawn prompt.
- [x] 5.2 Update `lib/ui/prompt.js`'s `submitTicket` (and the ticket-shape validation it depends on) to accept the same trailing flag in the `n` prompt's typed value, passing it through into the substituted launch command unchanged — the flag must land inside the quoted `/concertino-deliver` argument (`{{TICKET}}` is substituted with `<ticket> --agent-merge`, e.g. `claude "/concertino-deliver CON-17 --agent-merge"`), not appended after the launch command's closing quote, or `$ARGUMENTS` never sees it.
- [x] 5.3 Update `lib/ui/screens/launchplan.js`: seed `plan.agentMerge` from `config.agentMerge.enabled`, display it on the summary line, add an `m` key (disabled when a custom `launchCommand` override is configured, mirroring the existing harness-cycling guard) that toggles it and rewrites `plan.launchCommand`'s trailing flag using the same inside-the-quotes placement as 5.2.
- [x] 5.4 Update `lib/ui/watch.js` wherever it builds `plan` (mirroring how it already seeds `harness`/`harnesses`) to include `agentMerge`.
- [x] 5.5 Add an `auditor` entry to `lib/ui/format.js`'s `ROLE_COLOUR` table (`red` — unused by the existing five entries) so auditor-authored events (`agent.spawn agent=auditor`, `verdict role=auditor`) are visually distinguishable in `drilldown.js`'s role gutter instead of falling back to `f.dim`.

## 6. Docs

- [x] 6.1 Update `docs/harness-capabilities.md`'s capability matrix and prose to describe five agents instead of four, including the auditor's Claude-Code-vs-Codex fidelity story.
- [x] 6.2 Update `README.md`'s intro paragraph ("the four agents...") and role table to add the auditor's row and describe agent-merge as an opt-in toggle.

## 7. Verification

- [x] 7.1 Add/extend unit tests for `lib/ui/prompt.js`, `lib/ui/screens/launchplan.js`'s new toggle, and `bin/concertino`'s rendering loops (auditor files present after sync), following existing test patterns in `test/`.
- [x] 7.2 Manually exercise `check-merge-readiness.sh` against a real PR in this repo (or a disposable one) covering: all-pass, pending CI, failed CI, behind-base, review-required, and unknown/draft mergeability cases.
- [x] 7.3 Run the full gate suite (lint/test/build) and `openspec validate --change agent-merge-role` before handoff.
