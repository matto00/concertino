## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-merge/spec.md` in full from
  `openspec/changes/agent-merge-role/`.
- Read the current (pre-change) source this change touches, to check each
  planned edit against ground truth rather than the artifacts' own
  description of it:
  - `core/roles/skeptic.md`, `core/roles/orchestrator.md`, `core/roles/evaluator.md`
  - `adapters/claude-code/agents.json`, `adapters/claude-code/command.md`
  - `adapters/codex/prompt.md`
  - `config/concertino.schema.json`
  - `lib/ui/prompt.js`, `lib/ui/ticket.js`, `lib/ui/screens/launchplan.js`,
    `lib/ui/screens/fleet.js`, `lib/ui/format.js`, `lib/ui/reducer.js`,
    `lib/ui/watch.js`
  - `scripts/concertino/cleanup.sh` (confirmed it emits
    `run.end ... status=delivered`, matching the spec's claim)

### Verdict: REFUTE

The four-artifact set is well-organized and the core auditor mechanism
(cold spawn, three deterministic checks + one cold AC trace, MERGE/ESCALATE/
BLOCKER vocabulary, durable-evidence discipline) is sound. But there are five
concrete, fixable problems — three of them internal contradictions that would
produce a broken or half-specified implementation if executed as written.

### Change Requests

1. **Codex sequential-stage ordering puts the auditor before the PR exists.**
   `design.md` (lines 82–86) inserts the auditor "between today's steps 5 and
   6" of `adapters/codex/prompt.md`, i.e. as the new step 6, with the
   existing step 6 ("Orchestrator — squash, archive, push, open PR, comment
   on the ticket") renumbered to 7. That means the Codex flow runs the
   auditor **before the PR is created**. But `check-merge-readiness.sh`
   (Decision 1) and the auditor role itself operate entirely on an existing
   PR (`gh pr view "$BRANCH" --json statusCheckRollup`, `mergeable`,
   `mergeStateStatus`, `reviewDecision`) — there is nothing to check yet at
   that point in the Codex sequence. This directly contradicts the
   Claude-Code ordering in the same `design.md` (Decision 4 / `tasks.md`
   3.3), where the auditor is spawned strictly *after* PR creation
   ("after PR creation, spawn the auditor fresh..."). `tasks.md` 2.3's own
   hedge — "after the final skeptic gate, before/replacing today's final
   orchestrator step" — reflects the same unresolved ambiguity rather than
   settling it. Fix: the auditor stage must be sequenced **after** PR
   creation in the Codex flow too (i.e., a new step 7 following today's
   step 6, or folded into step 6 as a sub-step), and the illustrative
   numbered-list text in `design.md` needs correcting to match, not just
   `tasks.md`.

2. **Phase 4's existing precondition text and guardrail directly contradict
   the new auto-merge path, and nothing schedules fixing either.**
   `core/roles/orchestrator.md:269` reads "After the human confirms merge:"
   as the entry condition for Phase 4, and the Guardrails section
   (`core/roles/orchestrator.md:404`) states "Post-merge cleanup requires
   human confirmation — do not clean up speculatively." Both are flatly
   false once `AGENT_MERGE=true` and the auditor returns `MERGE`: Decision 4
   has the orchestrator "proceed directly into Phase 4" with no human
   confirmation at all. `tasks.md` section 3 (3.1–3.5) never schedules an
   edit to the Phase 4 heading or this guardrail line — only Setup, Phase 3,
   the circuit-breaker table, and the spawn-telemetry line are touched. An
   implementer following `tasks.md` literally would ship an
   `orchestrator.md` that instructs itself two contradictory ways depending
   on which section it reads. Add a task updating both the Phase 4 entry
   condition (to "after either a human 'merged' confirmation or an auditor
   `MERGE` verdict") and the Guardrails bullet to match.

3. **`lib/ui/format.js`'s `ROLE_COLOUR` table is missing an `auditor` entry,
   and the Impact list appears to name the wrong file for it.** This table
   (consumed by `drilldown.js:124`, `const colour = f.ROLE_COLOUR[role] ||
   f.dim`) is, per its own comment, "the role gutter that makes handoffs and
   the skeptic's isolated cold spikes readable without swimlanes." Without
   an `auditor: <colour>` entry, every auditor-authored event
   (`agent.spawn agent=auditor`, `verdict role=auditor`) falls back to
   `f.dim` — visually indistinguishable from unattributed `role=script`
   events in the one screen whose whole job is telling roles apart. Neither
   `design.md`'s "What Changes"/Impact section nor `tasks.md` schedules this
   edit. Compounding it, `proposal.md`'s Impact list names
   `lib/ui/screens/fleet.js` as modified — I read `fleet.js` in full and it
   contains no hardcoded role list or role-colour logic at all (it renders
   generically off `run.gates`/`run.lastVerdict`/`run.status`); nothing in
   `design.md` explains what change fleet.js would need, and I could not
   find one. This looks like the Impact list named the file that doesn't
   need a change and missed the one that does. Fix: add a task/impact-list
   entry for `lib/ui/format.js`'s `ROLE_COLOUR`, and correct or drop the
   `fleet.js` entry (or explain, if there is a real reason, what fleet.js
   needs — as written I can't find one).

4. **`check-merge-readiness.sh`'s mergeable check has no specified behavior
   for `mergeStateStatus: "UNKNOWN"`.** Decision 1's item 2 enumerates
   `CLEAN` (pass), `BEHIND`/`DIRTY`/`UNSTABLE` (fail, named), and `BLOCKED`
   (special-cased for `reviewDecision=REVIEW_REQUIRED`). GitHub's own API
   returns `mergeStateStatus: "UNKNOWN"` (and often `mergeable: null`) for a
   transient window immediately after a push/PR update while it computes
   mergeability — precisely the moment right after the orchestrator's own
   `git push` + `gh pr create` in the same Phase 3 that then spawns the
   auditor. The Risks section states a "fail closed, not open" philosophy
   for the CI-check's ambiguous states but never says it also governs this
   unenumerated case. Left as-is, an implementer could reasonably treat
   `UNKNOWN` as falling through to "not explicitly failing" and pass it —
   the opposite of the design's own stated philosophy. Fix: explicitly
   state in Decision 1 (and add a spec scenario for) how `UNKNOWN` (and any
   other `mergeStateStatus` value not in the enumerated list, e.g. `DRAFT`)
   is handled — almost certainly "fail closed, named as a distinct
   not-yet-determined reason," consistent with the CI-check's own rule.

5. **`models.auditor` is never scheduled to be added to the config
   schema's `models` object, which has `additionalProperties: false`.**
   `config/concertino.schema.json`'s `models` property enumerates exactly
   `orchestrator`, `executor`, `evaluator`, `skeptic`, `codex` with
   `additionalProperties: false`. Design Decision 3 explicitly says the
   auditor's model should be "overridable via `models.auditor` exactly like
   the other four roles," but `tasks.md` 4.1 only schedules adding
   `agentMerge` to the schema, and 4.2 only touches `bin/concertino`'s
   runtime `withDefaults()`/`buildConfig()` defaults — neither schedules
   adding `auditor` to the schema's `models.properties` list. As written, a
   project that sets `models.auditor` in `concertino.config.json` would have
   a config the schema itself declares invalid (schema-based editor
   tooling would flag it), even though the feature is meant to exist. Add
   the schema-side `models.auditor` property to task 4.1 explicitly.

### Non-blocking notes

- Decision 4's Codex-flow fix (item 1 above) should also make explicit
  whether, on Codex, an `ESCALATE`/`BLOCKER` auditor verdict still lets the
  (now out-of-order) delivery step run at all, or whether it should stop
  the sequential run entirely and hand off to a human — the Claude-Code
  side has an explicit fallback ("existing wait-for-'merged' flow"); Codex
  has no equivalent concept of "wait in chat," so this deserves one
  sentence once item 1 is fixed.
- `tasks.md` 5.2/5.3's description of splitting the ticket id from a
  trailing `--agent-merge`/`--no-agent-merge` flag in the `n` prompt's
  typed value, and rewriting `plan.launchCommand`'s trailing flag on the
  launch plan, is directionally fine but under-specified on exactly how the
  flag is embedded relative to the existing quoting
  (`claude "/concertino-deliver {{TICKET}}"` — the flag needs to land
  *inside* the quoted argument, not appended after the closing quote, or
  `$ARGUMENTS` on the Claude Code side will never see it). Worth one
  clarifying sentence in `design.md` Decision 6 so the implementer doesn't
  have to reverse-engineer it from the shell string.
