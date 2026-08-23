## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all change artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three
  spec deltas under `openspec/changes/sub-agent-escalation-raise/specs/`.
- **Ground truth — tool grants.** `cat adapters/claude-code/agents.json`: only `orchestrator`
  carries `SendMessage` in `baseTools`; executor/evaluator/skeptic/auditor are
  `["Read", ("Edit","Write"), "Bash", "Grep", "Glob"]`. Task 1.1's premise is accurate.
- **Ground truth — the false sentence the change corrects.** `lib/cli/render.js` `harnessResume`
  default (claude-code) branch literally contains "the executor/evaluator/skeptic/auditor have no
  `SendMessage` tool of their own and cannot address you". Task 5.2 targets real text; the
  `orchestrator-subagent-result-delivery` MODIFIED delta is warranted.
- **Ground truth — block mechanism.** `lib/cli/render.js:32 block(name, c, harness)` +
  `renderBody`'s `{{block:([a-zA-Z]+)}}` substitution confirms task 5.1's
  `{{block:subagentEscalationNotify}}` approach is implementable exactly as described, including
  per-harness branching and an empty-string return for codex/opencode.
- **Ground truth — orchestrator escalation machinery.** `core/roles/orchestrator.md:105` Signal
  Types table, `:1074` "How to raise one" (`--await` root branch / `--raise-only` subagent branch,
  `ARGS=(ticket=... role=orchestrator question=... options=...)`), `:1337` "Resolves in-loop",
  `:1351` "Always reaches the human", `:632` "Per-spawn model overrides (Claude Code only)".
  Decision 4 / tasks 3.1–3.6 land on real, correctly-named anchors.
- **Ground truth — `emit-event.sh` field handling.** `scripts/concertino/emit-event.sh:237-244`:
  `t` and `kind` passed as payload keys are **explicitly and silently dropped**, with a comment
  naming "the emitter is called from role prose by a language model" as the reason. `role=` (line
  234) is accepted. This directly bears on design Decision 2 (see CR2).
- **Ground truth — existing verdict-emission mandate.** `core/roles/evaluator.md:233-240`,
  `core/roles/skeptic.md:160-167`, `core/roles/auditor.md:181-188` each enumerate the allowed
  `verdict=` values and state "**A verdict must always be emitted**". Bears on CR1.
- **Ground truth — existing `SendMessage` occurrences in shared prose.**
  `grep -n "SendMessage" core/roles/*.md` → `executor.md:26`, `orchestrator.md:95,1150,1289,1294,
  1313,1316`. So the tool name is already present in shared prose that renders to codex/opencode;
  task 6.1's criterion is a *delta* criterion. Bears on CR3.

**Things I specifically tried to refute and could not:**

- *Is the blocking-`Agent()` limitation honestly represented?* Yes. design.md Non-Goals ("A true
  mid-flight, non-terminating communication channel… no tool grant changes that fact"), Decision 1
  ("does **not** create a new inbound channel the orchestrator can observe while still blocked"),
  Decision 7, and the `orchestrator-subagent-result-delivery` delta all state it consistently, and
  consistently with the `harnessResume` text I read. The `SendMessage` self-notify is described as
  a "belt, not a replacement for the suspenders" — an accurate characterisation, not overclaiming.
- *Is the CON-15 mirror-image deadlock created?* No. `subagent-escalation-raise/spec.md`'s
  "SendMessage self-notify does not block the sub-agent's own return" and "A raising sub-agent's
  turn ends by returning `ESCALATION`, not by blocking on a reply" requirements are explicit, with
  scenarios that forbid any poll/sleep/wait step. The orchestrator side is unchanged (task 3.5
  restates, does not weaken, the existing guardrail). This axis is sound.
- *Does the CON-126 composition claim hold?* Yes, and it is the strongest part of the design:
  Decision 6 / the "Sub-agents never call `emit-event.sh` or reason about TUI/topology state"
  requirement keep the topology decision at exactly one call site, which is what makes "the answer
  is the same at every depth" true by construction rather than by convention. The assumption is
  stated explicitly as the ticket asked.
- *Placeholders / TODOs / unscoped deferrals?* None found. "Open Questions: None outstanding" is
  justified, not evasive.

### Verdict: REFUTE

Four specific, cheap-to-fix defects. Three are internal contradictions between artifacts (design
vs. its own spec delta, tasks vs. tasks, design vs. unmodified ground-truth role-doc text) that
would each force the executor into an undocumented judgment call — exactly what this gate exists
to catch before an execution cycle burns on it.

### Change Requests

1. **`ESCALATION` vs. the "a verdict must always be emitted" rule is an unresolved contradiction.**
   `specs/subagent-escalation-raise/spec.md` ("`ESCALATION` and `BLOCKER` are distinguishable")
   requires that *no* `verdict=` event be written for a raise. But `core/roles/evaluator.md:240`,
   `core/roles/skeptic.md:167` and `core/roles/auditor.md:188` each currently state "A verdict must
   always be emitted", and `tasks.md` 2.2/2.3 explicitly instruct keeping the surrounding existing
   sentences **verbatim**. An executor implementing this hits a fork with no documented answer:
   emit `verdict=ESCALATION` (violating the spec delta and AC4's telemetry separation) or emit
   nothing (violating a standing binding instruction, and leaving the dashboard with a role that
   produced no verdict event for that turn).
   **Required:** add an explicit task (and a design sentence) stating what the raising sub-agent
   does at its Output/Step-1 block on an `ESCALATION` — specifically (a) whether it still writes
   and `persist-evidence.sh`-persists a report file, and (b) the exact amended wording of the
   "A verdict must always be emitted" sentence in each of `evaluator.md`/`skeptic.md`/`auditor.md`
   that carves `ESCALATION` out without weakening the rule for the other verdicts. Silence here is
   not "the executor will figure it out" — it is the one place the AC4 claim can be quietly broken.

2. **design.md Decision 2's `kind=subagent` contradicts the spec delta and is unimplementable as
   written against `emit-event.sh`.** Decision 2 says the raise is "tagged `role=<raiser>` … and a
   new `kind=subagent` value in `PENDING_ESCALATION`/context, so the two signal families never
   collide **in the log**". But (a) `specs/escalation-bubble-up/spec.md` states "**No** new
   escalation mechanism, **event kind**, or `emit-event.sh` mode is introduced" and that the two
   are "distinguished **only** by their `role=` field"; and (b) `scripts/concertino/emit-event.sh:
   237-244` silently drops any caller-supplied `kind=`, with a comment naming LLM-authored role
   prose as precisely the source of such a stray key. `kind` is also not a payload field anywhere
   in the existing raise procedure — in `core/roles/orchestrator.md:1074+` it is only an argument
   to `gather-escalation-context.sh`, whose six accepted kinds do not include "subagent".
   **Required:** strike the `kind=subagent` clause from design.md Decision 2 (and its "never
   collide in the log" justification, which is carried entirely by `role=<raiser>`), or, if a
   `PENDING_ESCALATION`-only marker is genuinely wanted, say so unambiguously and state that it is
   a `workflow-state.md` field that is never passed to `emit-event.sh`.

3. **Tasks 3.3/3.4 will write `SendMessage` into `core/roles/orchestrator.md` shared prose, which
   task 6.1 and the `orchestrator-subagent-result-delivery` delta forbid.** Task 3.3 says to state
   resuming the raiser "warm **via `SendMessage`**"; task 3.4 says to add `ORCHESTRATOR_AGENT_REF`
   "so the raising sub-agent has a concrete **`SendMessage`** target". Both are edits to
   `orchestrator.md`, which renders to codex/opencode. Task 6.1's stated pass criterion is
   "codex, opencode: expect **zero change** in `SendMessage` occurrence count for **every** role
   file", and the MODIFIED delta requirement now reads "Rendering any of `core/roles/{orchestrator,
   executor,evaluator,skeptic,auditor}.md` for `codex` or `opencode` SHALL NOT introduce new text
   naming `SendMessage`". design.md's own Risk mitigation lists only `executor.md`/`evaluator.md`/
   `skeptic.md`/`auditor.md` as needing tool-name-free prose — `orchestrator.md` is conspicuously
   omitted from that list while being in scope for the check that will fail.
   **Required:** either (a) extend task 2.5's constraint to the section-3 `orchestrator.md` edits
   and route the tool name through a harness-guarded block there too, or (b) amend task 6.1's
   criterion for `orchestrator.md` specifically to an explicit, enumerated allowed delta and amend
   the delta requirement to match. Do not leave the executor to discover the conflict when 6.1
   fails. (Note for whoever fixes this: `orchestrator.md` already contains 6 bare `SendMessage`
   occurrences at lines 95/1150/1289/1294/1313/1316 and `executor.md` 1 at line 26 — so the
   "zero" in 6.1 is unambiguously a *delta*, and stating that explicitly in the task would prevent
   a second misreading.)

4. **`ESCALATE` vs. `ESCALATION` in `auditor.md` is a one-token-apart collision in the same verdict
   slot, and the design's reconciliation is semantic only.** Decision 3 / task 2.4 keep both
   tokens, in the same role doc, in the same `Verdict:` position, distinguished only by prose about
   *when* the agent noticed the problem — yet they route to materially different orchestrator
   behavior (`ESCALATE` → "fall back to wait-for-'merged', one attempt, no retry" per
   `core/roles/orchestrator.md:1351+`; `ESCALATION` → relay to human, then a fresh cold auditor
   re-spawn that explicitly does *not* consume that no-retry entry). These signals are parsed from
   prose by a language model; "ESCALATE" and "ESCALATION" are not a safe pair to rely on for a
   branch that decides whether the auditor gets a second run.
   **Required:** either rename the new auditor-side signal to something unmistakably distinct
   (e.g. `ESCALATION-RAISE`), or add an explicit disambiguation rule to both `auditor.md` and the
   orchestrator's Signal Types table stating how the orchestrator resolves a return value that is
   ambiguous or uses the wrong one of the two (a documented default is acceptable; silence is not).
   Note the same table will then carry three `ESCALAT*` rows (Planning `ESCALATION`, Auditor
   `ESCALATE`, sub-agent `ESCALATION`) — the fix should leave that table readable at a glance.

### Non-blocking notes

- `ticket.md`'s **Scope** bullet "Raising must NOT end the raiser's turn" survives the CORRECTED
  FRAMING section (which by its own header supersedes only the "no way to raise" wording) and is
  knowingly not satisfied — the design instead satisfies AC2's softer "without the sub-agent's turn
  ending **destructively**". design.md is honest about the harness fact but never names this
  specific scope bullet. Worth one explicit sentence in design.md Decision 1 reconciling the two,
  so a later reader does not conclude the change silently missed a scope line. Not blocking: AC2 is
  the authoritative acceptance signal and it is met.
- `ORCHESTRATOR_AGENT_REF` is required by the spec delta as a spawn-time input but is never added
  to the four sub-agent role docs' own `## Input` sections; it reaches the raiser only inside the
  claude-code-only block from task 5.1. That is actually the adapter-safe choice, so I am not
  asking for a change — but the block text must therefore be self-contained about what
  `ORCHESTRATOR_AGENT_REF` is and where it came from, since nothing else in the sub-agent's doc
  will define it.
- Task 6.5's refusal to invent a vacuous runtime check for LLM-judgment behaviors (AC5) is the
  right call and is well-argued. Flagging it approvingly so a later reviewer does not mistake it
  for a verification gap.
- Tasks 6.1 and 6.2 both specify red-before-green on the *real* source file with a revert — this is
  a notably strong verification design for a docs/config change. No objection.
