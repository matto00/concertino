## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth re-established fresh**, not from the evaluator's narrative: read
  `ticket.md`, `design.md`, `files-modified.md`, `evaluation-1.md` (as claims),
  then `git diff main...HEAD --stat` (33 files, +1992/-63) and read every
  substantive file in full myself.

- **Re-ran gates myself, fresh**:
  - `bash test/scripts/check-merge-readiness.test.sh` → 22/22 passed.
  - `bash test/scripts/auditor-render.test.sh` → 13/13 passed.
  - `npm test` (full suite: `node --test` unit tests + all 13 shell-test files)
    → exit 0, no failures anywhere in the output.
  - `npx openspec validate agent-merge-role --strict` → `Change
    'agent-merge-role' is valid`.
  - `node bin/concertino validate` against both `config/examples/generic.json`
    and `config/examples/helio.json` → both valid, `models.auditor: sonnet`
    resolved cleanly under the new schema.
  - `node bin/concertino doctor` in this worktree (this repo dogfoods itself)
    → `.claude/agents/concertino-auditor.md` present, "copied assets 13 files
    match core", "agent files present for claude-code".

- **AC-by-AC trace, cold:**
  1. *"Fifth role ships, cold by construction, rendered into both harnesses"* →
     `core/roles/auditor.md` (new, mirrors `skeptic.md`'s cold/single-pass
     shape), `adapters/claude-code/agents.json` `auditor` entry, `bin/concertino`
     five-role loops (`emitClaude`, `emitCodex`'s AGENTS.md sections +
     codex-worker-toml list, `checkArtifacts`, `cmdDiff`, `cmdEject`,
     `cmdValidate`). Confirmed live: `.claude/agents/concertino-auditor.md`
     exists in this worktree with its own `tools:` frontmatter
     (`Read, Write, Bash, Grep, Glob, mcp__linear__get_issue`), distinct from
     the skeptic's UI-tool grant.
  2. *"Verdict recorded as evidence via `persist-evidence.sh`"* →
     `auditor.md`'s Output section (lines ~149–169) writes a report, calls
     `persist-evidence.sh`, then emits `verdict role=auditor ref=<durable
     path>` — explicitly **no redundant `evidence` event** ("Do not also emit
     a separate `evidence` event for this report... don't 'fix' this into
     duplication"), matching this project's own governing rule.
  3. *"All four evidence conditions required; any failure escalates with the
     reason"* → `check-merge-readiness.sh` (read in full) implements CI-green,
     mergeable, and gates-passed; `auditor.md` §4 owns the cold AC-trace
     fourth condition; the vocabulary (`MERGE|ESCALATE|BLOCKER`) and the
     "any one failing → ESCALATE, naming the reason" rule are explicit.
  4. *"Config default plus per-run override, exposed at invocation, in the
     `n` prompt, and in the launch plan"* → verified by reading and by tests
     (see below) across `config/concertino.schema.json`, `command.md`,
     `lib/ui/prompt.js`, `lib/ui/screens/launchplan.js`, `lib/ui/watch.js`.
  5. *"Merge and cleanup emit events, self-merged run auditable"* →
     `auditor.md`'s `verdict role=auditor` event plus the unchanged
     `cleanup.sh --phase4` → `run.end status=delivered` event; spec.md's
     "auditable events" requirement traces to both.
  6. *"Failed merge attempt leaves PR open, worktree intact"* → confirmed by
     the ordering in `auditor.md` (all four conditions checked before `gh pr
     merge` is ever invoked; a `gh pr merge` failure itself is `BLOCKER`, not
     a half-merge) and `orchestrator.md`'s `ESCALATE`/`BLOCKER` fallback,
     which is textually the old wait-for-"merged" paragraph (see below).
  7. *"Branch protection requiring human review is detected and escalated
     cleanly, not retried"* → `check-merge-readiness.sh`'s
     `BLOCKED`+`REVIEW_REQUIRED` branch (line 128-134), exercised live by
     shell test `6.1` (re-run, passed), and the circuit-breaker table's new
     "Agent-merge (auditor) | 1 attempt, no retry" row.

- **`check-merge-readiness.sh` fail-closed behavior — read the actual script,
  not just the design doc**, and independently re-ran its test suite:
  - CI: pending/queued/in-progress/waiting/expected/missing-conclusion is a
    *distinct* `FAIL` from an actual `FAILURE` conclusion (lines 99-113,
    tests 2.x/3.x). Empty rollup passes (test 4.1).
  - Mergeable: `CLEAN` passes; `BEHIND`/`DIRTY`/`UNSTABLE` fail naming the
    status (tests 5.x); `BLOCKED`+`REVIEW_REQUIRED` fails with the specific
    branch-protection message (test 6.1); `BLOCKED` without it fails generic
    (test 7.1); **`UNKNOWN`, `DRAFT`, and any other unenumerated value all
    fail closed** via the `case` statement's default arm (lines 135-140),
    confirmed live by tests 8.UNKNOWN / 8.DRAFT / 8.SOMETHING_NEW — none pass
    by falling through.
  - Gates: latest `role=evaluator verdict` must be `PASS`, latest
    `role=skeptic verdict` must be `CONFIRM`, read from the *main checkout*
    via a `main_checkout()` resolution matching `emit-event.sh`'s (duplicated,
    not sourced, deliberately, per the suite's own standalone-script
    convention). A torn/malformed log line is skipped, not fatal (test 12.1).
    "Latest wins" is exercised by test 11.1.
  - Both `core/scripts/check-merge-readiness.sh` and its synced copy
    `scripts/concertino/check-merge-readiness.sh` are **byte-identical**
    (`diff` → no output) — the synced-copy claim in `files-modified.md`
    checks out.

- **Durable evidence / no-redundant-event, and the disabled-run byte-for-byte
  claim — verified by actually running `concertino sync`, not by trusting
  prose.** I checked out the pre-change merge-base commit
  (`897e579`, `git merge-base main HEAD`) into a throwaway worktree, synced
  `config/examples/generic.json` with both the pre-change and post-change
  source trees to separate output dirs, and diffed the results:
  - Only new file: `.claude/agents/concertino-auditor.md`, plus the new
    `scripts/concertino/check-merge-readiness.sh`.
  - `concertino-orchestrator.md`, `concertino-deliver.md`, and
    `workflow-state.template.md` do textually differ (expected — the
    templates themselves gained the `AGENT_MERGE` branch/documentation) —
    but diffing them line-by-line confirms the `AGENT_MERGE = false` branch
    is the **exact pre-change paragraph, character-for-character**
    ("Present to human: PR URL, brief summary, and any non-blocking
    evaluator suggestions...") — i.e. the *behavior* for a disabled run is
    unchanged, which is the claim `README.md`/`design.md`'s Migration Plan
    actually make ("today's human-confirms-merge flow is byte-for-byte
    unchanged" refers to the executed behavior, not literal template bytes —
    confirmed this reads correctly against the diff, not just asserted).
  - `.claude/commands/concertino-deliver.md`'s only substantive change is
    extracting the optional `--agent-merge`/`--no-agent-merge` flag before
    falling back to "unset" — additive, no behavior change when absent.
  - (Cleaned up all three throwaway `git worktree`s afterward.)

- **The "flag lands inside the quoted argument" detail — verified by code +
  passing tests, not just design prose.** `lib/ui/prompt.js`'s
  `parseTicketInput`/`submitTicket` build `parsed.ticket + ' ' + parsed.flag`
  and substitute that whole string into `{{TICKET}}` — confirmed by
  `test/prompt.test.js`'s new assertion:
  `'claude "/concertino-deliver CON-17 --agent-merge"'` (flag inside the
  closing `"`). Re-ran `node --test` and saw these pass live (not just
  reading the file). `lib/ui/screens/launchplan.js`'s `withAgentMergeFlag`
  does the identical inside-the-quotes insertion/replace, confirmed by
  `test/launchplan.test.js`'s round-trip and harness-cycle-preserves-flag
  tests, also re-run and green.

- **Config/CLI/`n`-prompt/launch-plan threading, end to end** — traced the
  chain: `config/concertino.schema.json`'s `agentMerge` (additionalProperties
  false, both fields present) → `bin/concertino`'s `withDefaults()`/
  `buildConfig()` (`agentMerge: { enabled: false, mergeMethod: 'squash' }`
  default) → `core/roles/orchestrator.md`'s `{{var:agentMerge.enabled}}` /
  `{{var:agentMerge.mergeMethod}}` template vars, which I confirmed resolve
  with **zero new code** through `bin/concertino`'s existing generic
  `getVar()` dotted-path fallback (read the function directly, lines
  317-331) — then confirmed the *rendered* output: grepped the synced
  `.claude/agents/concertino-auditor.md` in this worktree and found
  `gh pr merge "$BRANCH" --squash` (the config default correctly baked in,
  no `--delete-branch`) and `AGENT_MERGE`-branching text correctly rendered
  in `concertino-orchestrator.md`.

- **`ROLE_COLOUR.auditor: red`** — confirmed `red` is genuinely unused among
  the pre-existing entries (`orchestrator: blue, executor: cyan, evaluator:
  yellow, skeptic: magenta, script: dim, human: green`) by reading
  `lib/ui/format.js` directly — the design's claim checks out.

- **Iron Laws / evidence discipline**: `auditor.md` mirrors `skeptic.md`'s
  "no verdict without fresh evidence you have read yourself," is spawned
  cold every invocation (never resumed), and its Guardrails explicitly
  forbid invoking `cleanup.sh` itself (Phase 4 remains the orchestrator's
  job, strictly after a `MERGE` verdict).

- **UI/design judgment (step 4): N/A, stated explicitly.** This project has
  no `ui.enabled`/design-standard trigger configured for itself (a CLI +
  terminal-dashboard tool, not a web app under test) — matching the
  evaluator's own Phase 3 "N/A" and consistent with this gate's own
  instructions. The `lib/ui/*` changes (`prompt.js`, `launchplan.js`,
  `watch.js`, `format.js`) were reviewed as **code** above (read in full,
  exercised via `node --test`), not as a rendered screen — there is no dev
  server to attach to for this project's own dashboard views under this
  ticket's scope, and no design-standard doc is configured to judge against.

### Verdict: CONFIRM

### Non-blocking notes

- `proposal.md`'s Impact section's "New files" list names
  `scripts/concertino/check-merge-readiness.sh` but not
  `core/scripts/check-merge-readiness.sh` (the actual source, whose synced
  copy that is) — `files-modified.md` correctly lists both. Cosmetic
  incompleteness in the proposal's Impact bullet only.
- `tasks.md` item 5.5 describes `red` as "unused by the existing five
  entries," but at that point in the ensemble there were only four
  pre-auditor roles — a wording nit, not a functional issue (already flagged
  similarly, for a different phrase, by the design-gate skeptic's round 3
  non-blocking note).
- Reconfirming the evaluator's own two non-blocking notes (both checked
  directly, not just trusted): `adapters/codex/agent.toml.tmpl`'s static
  header comment still says "dispatch the executor/evaluator as workers"
  without mentioning the auditor, even though it's now in that dispatch list
  — cosmetic template-comment staleness only. The Signal Types table's
  `BLOCKER` row is visually wider than its neighbors in raw markdown —
  renders fine, cosmetic only.
