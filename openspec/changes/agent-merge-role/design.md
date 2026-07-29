## Context

Today Phase 3 (Delivery) ends with the orchestrator presenting the PR URL and waiting for a human to reply "merged" before it runs Phase 4 cleanup. That checkpoint exists because merging is currently the only step in the pipeline with no cold verifier standing behind it — everything upstream (design gate, evaluation loop, final gate) already has one.

The ticket asks for a fifth ensemble member — named `agent-merge` as a feature, with the role itself named **auditor** (the ticket's own suggestion, to avoid colliding with "verifier"/"evaluator") — whose only job is to check the four conditions a safe merge requires and either merge or escalate. It must be cold (spawned fresh, like the skeptic) because "an orchestrator asserting my run finished correctly" is exactly the blind spot a cold reviewer exists to catch.

## Goals / Non-Goals

**Goals:**
- A fifth role, cold by construction, rendered into both harnesses with its own tool grant.
- A deterministic, scriptable check for the three machine-verifiable merge conditions (CI green, mergeable, this run's own gates passed), with the fourth (AC satisfaction) left to the auditor's own cold judgment — consistent with how the skeptic already owns UI/design judgment while the evaluator owns the mechanical checklist.
- A config default + per-run override for whether agent-merge runs at all, surfaced identically at invocation, in the `n` prompt, and in the launch plan.
- Every four-condition failure escalates with the specific reason; a failed attempt never leaves a half-merged state (PR stays open, worktree stays intact).
- Merge and the Phase 4 cleanup that follows it are both auditable from the event log.

**Non-Goals:**
- Reconciling local `main` after a self-merge, or invalidating other in-flight runs' stale base — that is CON-25.
- Any interaction with delivery speeds (`fast`/`slow`) — CON-22 is not yet built; agent-merge's toggle is independent of it today. (The ticket notes a future default-by-speed is worth deciding once CON-22 exists — left as a follow-up, not blocked on here.)
- A bounded retry loop for the auditor. Unlike the skeptic's REFUTE loop (which resumes the *executor* to fix code), an auditor `ESCALATE` reflects a merge-time fact (CI still running, branch behind, review required) that the executor cannot "fix" by writing code. One check, then hand to the human — see Decision 5.
- Deleting the remote/local branch on merge. Out of scope for this change; left exactly as today (unmerged branch cleanup is not currently automated either).

## Decisions

### 1. New procedure script: `scripts/concertino/check-merge-readiness.sh`

Mirrors `assert-phase.sh`'s contract (`PASS`/`FAIL <reason>` on stdout/stderr, non-zero exit on any failed check) because these three conditions are exactly the kind of ground truth a deterministic script should own, not something an LLM should eyeball:

```
check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>
```

1. **CI green** — `(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json statusCheckRollup)`. Every entry's `conclusion`/`state` must be `SUCCESS`; any `PENDING`/`IN_PROGRESS`/`QUEUED`/null is a distinct failure ("CI pending: <name>") from an actual `FAILURE` ("CI failed: <name>") — the ticket is explicit that "a pending check is not a pass," so these are never collapsed into one message. An empty rollup (no required checks configured) passes.
2. **Mergeable** — same `gh pr view` call, `--json mergeable,mergeStateStatus,reviewDecision`. `mergeStateStatus == "CLEAN"` passes. `"BEHIND"`/`"DIRTY"`/`"UNSTABLE"` fail as "not mergeable: <status>". `"BLOCKED"` is inspected further: if `reviewDecision == "REVIEW_REQUIRED"` the failure message is specifically "branch protection requires human review" (the ticket's own required-to-detect case) rather than a generic "not mergeable", so the orchestrator can surface that exact reason without re-deriving it. **Every other value — including `"UNKNOWN"` (GitHub's transient state immediately after a push/PR update, while it is still computing mergeability — exactly the window right after this same Phase 3's own `git push` + `gh pr create`) and `"DRAFT"` or any value not in this enumerated list — fails closed**, named as "mergeability not yet determined: <status>" rather than falling through to a pass. This is the same fail-closed philosophy as the CI check (a pending check is not a pass; an undetermined mergeability is not a pass either) applied consistently, not left as an unenumerated gap an implementer could read the opposite way.
3. **This run's own gates passed** — read `.concertino/runs/<TICKET_ID>/events.jsonl` from the **main checkout** (resolved the same way `emit-event.sh` resolves it, so this works identically from inside the worktree). Find the latest `verdict` event with `role=evaluator`: must be `PASS`. Find the latest `verdict` event with `role=skeptic`: must be `CONFIRM`. See Decision 2 for why "latest" is sufficient without a `gate=design|final` field on the skeptic's event.

`check-merge-readiness.sh` does **not** attempt the fourth condition (AC satisfaction) — that stays entirely with the auditor, which reads `ticket.md` and the diff itself, exactly as the skeptic already does for its final-gate AC trace.

### 2. No new `gate` field on the skeptic's verdict event

The skeptic emits `verdict role=skeptic verdict=<CONFIRM|REFUTE|BLOCKER>` today with no field distinguishing the design gate from the final gate. Adding one would be the more "self-documenting" option, but it touches an existing, already-shipped event contract (`evidence-telemetry`'s spec) for a benefit this change doesn't need: **by the time the auditor ever runs, the orchestrator has already required a final-gate `CONFIRM` to get there** (per `orchestrator.md`'s existing Phase 3 gate). The design gate always occurs earlier in the same run's log, before any execution cycle. So "latest skeptic verdict in the log" is *provably* the final-gate one at the point the auditor reads it — no new field needed. This is recorded here rather than left implicit so a future reader doesn't "fix" it into a field addition without knowing why it was skipped.

### 3. Auditor role: cold, single-pass, its own verdict vocabulary

`core/roles/auditor.md` mirrors the skeptic's shape (evidence discipline, "no verdict without fresh evidence you have read yourself," write-report-then-emit-verdict), but with its own verdict vocabulary — `MERGE | ESCALATE | BLOCKER` — rather than reusing `CONFIRM/REFUTE`, because the auditor's "verdict" is also the record of an action it took (an already-executed merge), not just a judgment for someone else to act on:

- **MERGE** — all four conditions held; the auditor has already run `gh pr merge` (see Decision 4). The orchestrator proceeds straight to Phase 4.
- **ESCALATE** — a legitimate finding: one of the four conditions failed (including the branch-protection case). PR is left open, worktree untouched. This is a real, expected outcome, not a tooling failure — surfaced to the human with the specific reason, same posture as the existing `BLOCKER` row in the Signal Types table ("surface to human, wait for direction — do not loop") but named distinctly so the drill-down can tell "this run's evidence wasn't ready" apart from "the tooling broke."
- **BLOCKER** — environmental only (e.g. `gh` not authenticated, GitHub API unreachable). Never retried as a code change, exactly like every other `BLOCKER` in the system.

Tool grant mirrors the skeptic's: `Read, Write, Bash, Grep, Glob` + `mcp__linear__get_issue` / `mcp__github__get_issue` (cold re-fetch if `ticket.md` is stale) — no UI tools (the skeptic already owns UI judgment; the auditor's job starts after that gate already passed). Model default `sonnet`, overridable via `models.auditor` exactly like the other four roles — this requires adding `auditor` to `config/concertino.schema.json`'s `models` property, which has `additionalProperties: false` and today enumerates only the existing four (see task 4.1); the runtime defaults in `bin/concertino`'s `withDefaults()`/`buildConfig()` are a separate edit and both are needed, not just the latter.

The dashboard's own role-colour table, `lib/ui/format.js`'s `ROLE_COLOUR` (consumed by `drilldown.js`'s role gutter — "makes handoffs and the skeptic's isolated cold spikes readable without swimlanes"), also gets a new `auditor` entry (`red` — the only one of the six named colours the existing four roles don't already use). Without it, every auditor-authored event falls back to `f.dim`, indistinguishable from an unattributed `role=script` event in the one screen whose job is telling roles apart. (`lib/ui/screens/fleet.js` needs no change for this ticket — it renders generically off `run.gates`/`run.lastVerdict`/`run.status` with no hardcoded role list; the earlier proposal draft named it in error and `format.js` is the correct target.)

Merge command: `gh pr merge <BRANCH> --<mergeMethod>` (default `squash`, configurable via `agentMerge.mergeMethod`), run without `--delete-branch` — the branch is still checked out in the live worktree at merge time, and deleting it out from under that checkout is an unforced new failure mode this change doesn't need to take on. Branch cleanup stays exactly as unautomated as it is today.

### 4. Orchestrator integration: a branch inside Phase 3/4, not a new phase

`agentMerge` resolves to a boolean per run: the per-run override (`--agent-merge`/`--no-agent-merge` from the slash command, or the `n` prompt / launch-plan toggle) takes precedence; otherwise the config default `agentMerge.enabled`. This resolution happens once, at Setup, and is persisted in `workflow-state.md` (new `AGENT_MERGE: true|false` line) so it survives compaction/resume exactly like every other run-level decision.

- `AGENT_MERGE=false` (today's behavior, unchanged): after PR creation, present to the human and wait for "merged" before Phase 4.
- `AGENT_MERGE=true`: after PR creation, spawn the auditor fresh (cold — never resumed, matching the skeptic's pattern) with `WORKTREE_PATH, CHANGE_NAME, TICKET_ID, BRANCH, PR_URL`. Wait for its verdict inside the same turn (the identical turn-discipline rule that already governs every other spawn/resume in this file).
  - `MERGE` → present the (now-merged) PR + summary to the human as before, but proceed directly into Phase 4 — the auditor's `MERGE` verdict *is* the confirmation that used to require a human reply.
  - `ESCALATE` / `BLOCKER` → read the report, surface it to the human with the specific reason, and fall back to the existing wait-for-"merged" flow (do not auto-retry; see Non-Goals). The PR remains open and the worktree remains intact, satisfying the "never a half-merged state" acceptance criterion by construction — the auditor's own script/checks all run before `gh pr merge` is ever invoked, so a failure never occurs mid-merge.

No new `PHASE:` value is introduced — agent-merge happens inside the existing Delivery phase, before the existing Cleanup phase; `PHASE_ORDER` in `lib/ui/reducer.js` is untouched.

This requires correcting two lines of `core/roles/orchestrator.md` that currently assume a human is always the one who confirms merge: the Phase 4 heading's entry condition ("After the human confirms merge:") must read "after either a human 'merged' confirmation or an auditor `MERGE` verdict," and the Guardrails bullet "Post-merge cleanup requires human confirmation — do not clean up speculatively" must be qualified the same way. Both are edited as part of this change (not left contradicting the new path) — see task 3.6.

### 5. No bounded retry loop for the auditor

Every other loop in this system (execution↔evaluation, skeptic design gate, skeptic final gate) is bounded because the *next* attempt has a real chance of a different outcome — the executor changed code. An auditor `ESCALATE` is different: "CI is still running" or "branch is behind base" are not things a re-spawned auditor fixes by trying harder, and re-invoking it in a tight loop would just poll GitHub. So this change adds no `budgets.*` field for it; the circuit-breaker table gets a new row documenting "1 attempt, always escalates on any failure" — consistent with the existing "Server start | 1 attempt" row, which is the same shape of decision (an attempt that either works or is handed to a human, no budget to exhaust).

### 6. Config + override surface, three places, one resolution

- `concertino.config.json`: new `agentMerge: { enabled: boolean (default false), mergeMethod: "squash"|"merge"|"rebase" (default "squash") }`, added to `config/concertino.schema.json` and `withDefaults()`/`buildConfig()` in `bin/concertino` (interactive `init` wizard gets one new yes/no + choice prompt, matching the existing UI/gates prompts' style).
- `/concertino-deliver` (`adapters/claude-code/command.md`): `$ARGUMENTS` may contain a trailing `--agent-merge` / `--no-agent-merge` after the ticket id; the command extracts both and passes the override (or "unset") to the orchestrator prompt.
- Dashboard `n` prompt (`lib/ui/prompt.js`): accepts the same trailing flag in the typed value; `submitTicket` validates the ticket portion with the existing `looksLikeTicket` check and passes the flag straight through into the substituted launch command. The flag must land **inside** the quoted `/concertino-deliver` argument, not appended after the launch command's closing quote — the default template is `claude "/concertino-deliver {{TICKET}}"`, so `{{TICKET}}` is substituted with `<ticket> --agent-merge` (e.g. `claude "/concertino-deliver CON-17 --agent-merge"`), not with the flag tacked on after the closing `"`. Otherwise `$ARGUMENTS` on the Claude Code side never sees it, since it only ever receives what's inside that quoted string.
- Launch plan (`lib/ui/screens/launchplan.js`): a new `m` key cycles the plan's resolved `agentMerge` boolean (default seeded from `config.agentMerge.enabled`, mirroring how `harness` seeds from `config.harnesses`) and displays it on the same summary line as harness/concurrency — "same discipline as showing ports pre-flight," per the ticket. Disabled (like harness-cycling) when a custom `launchCommand` override is configured, since there is then no flag slot to safely rewrite.

Because `getVar()` in `bin/concertino` already resolves arbitrary dotted config paths, `core/roles/orchestrator.md` references the config default directly as `{{var:agentMerge.enabled}}` / `{{var:agentMerge.mergeMethod}}` with no new template-var code needed — only `agentMerge` needs to exist on the config object by the time rendering runs, via `withDefaults()`.

### 7. Rendering: extend the four-role loops to five

`bin/concertino` iterates a literal `['orchestrator', 'executor', 'evaluator', 'skeptic']` array in six places (`emitClaude`, `emitCodex`'s AGENTS.md role sections, `cmdDoctor`/`cmdDiff`'s existence checks, `cmdEject`'s validation message, `cmdUpdate`'s model-key validation). Each gains `'auditor'`. The codex **worker-dispatch** list (`emitCodex`'s `.codex/agents/*.toml` loop, currently `['executor', 'evaluator']`, and the matching branch in `cmdEject`) also gains `'auditor'`, per the ticket's explicit "the optional worker template a fifth entry" — the auditor is exactly the kind of single-shot, statelessly-invokable role that benefits from optional worker dispatch on Codex, same as the executor/evaluator already do.

`adapters/codex/prompt.md` gains a **seventh** sequential stage, after today's step 6 (not before it — the auditor's mechanism operates on an *existing* PR via `gh pr view`, so it is meaningless until the PR exists):

> 6. Orchestrator — squash, archive, push, open PR, comment on the ticket. *(unchanged)*
> 7. **Auditor** — when agent-merge is enabled for this run, verify the four merge conditions (`check-merge-readiness.sh` plus a cold AC trace) and merge, or escalate with the reason. On `ESCALATE`/`BLOCKER`, Codex has no "wait in chat" concept the way Claude Code's slash-command layer does — the single thread stops here, states the reason, and hands off to whoever is watching the session, rather than attempting Phase 4 on an unmerged PR.

This mirrors the Claude Code ordering exactly (auditor spawned strictly after PR creation in both harnesses — see Decision 4) rather than diverging between them. `docs/harness-capabilities.md`'s capability matrix and prose, and `README.md`'s role table and four→five agent count, are updated to match.

## Risks / Trade-offs

- **[Risk] A self-merging run makes every other open PR's base stale** (the CON-7/CON-8 conflict the ticket cites) → **Mitigation**: explicitly out of scope here (CON-25's job); noted in the PR description as a known follow-up so it isn't silently forgotten. Agent-merge does make this more frequent, which is exactly why the ticket says it should land alongside CON-25 rather than before it — recorded here for whoever picks up CON-25 next.
- **[Risk] `gh pr view --json statusCheckRollup` shape varies across GitHub Apps/Actions vs. legacy status contexts** (`conclusion` vs. `state`, differently-cased) → **Mitigation**: `check-merge-readiness.sh` checks both fields defensively and treats anything that isn't recognizably `SUCCESS`/`success` as non-passing (fail closed, not open).
- **[Risk] Branch protection configurations the auditor has never seen** (e.g. required status checks not yet reported, so `statusCheckRollup` is empty even though checks are queued) → **Mitigation**: an empty rollup passes only the CI check; the *mergeable* check (`mergeStateStatus`) still has to be `CLEAN` independently, and GitHub reports `UNSTABLE`/`BLOCKED` while required checks are outstanding, so the two checks together fail closed even when the first one alone wouldn't have caught it.
- **[Trade-off] No retry loop means a transiently-pending CI check always escalates to a human**, even though it might go green a minute later → accepted deliberately (Decision 5): a human replying "recheck" and the orchestrator re-spawning a fresh auditor is a fine manual fallback, and it avoids building a poll loop this ticket doesn't ask for.

## Migration Plan

Purely additive: existing projects get `agentMerge.enabled: false` by default on next `concertino sync`/`update`, so today's human-confirms-merge flow is byte-for-byte unchanged until a project (or a single run) opts in. No data migration; no change to any existing event kind's schema.

## Open Questions

None blocking — the ticket's own "worth deciding" note (whether a CON-22 delivery *speed* should carry a default for this toggle) is explicitly deferred to whenever CON-22 lands, per Non-Goals.
