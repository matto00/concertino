## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/orchestrator-subagent-result-delivery/spec.md` in the change dir.
- `git diff` in the worktree: both `core/roles/orchestrator.md` (new
  "Sub-agents have no inbound channel" paragraph + three Phase 2 rewordings)
  and `lib/cli/render.js` (claude-code `harnessResume` return string) are
  already written. `git log --oneline -1` = `6f5837a` (CON-132); the change
  is uncommitted working-tree state.
- Confirmed the premise is true against ground truth:
  `grep -n SendMessage adapters/claude-code/agents.json` → line 26 only, the
  `orchestrator` entry's `baseTools`. No sub-agent role has it. The ticket's
  diagnosis is correct.
- **Rendered all three harnesses from the modified core** into a throwaway
  dir (the task-2.1 check, run early because design decision 1 makes a
  falsifiable claim about the codex/opencode output):
  `node bin/concertino sync --config=config/examples/concertino.json --core=./core --harness=claude-code,codex,opencode --out=<tmp>`
  Then rendered the same three from the **stashed baseline** for comparison.
- claude-code render: the new paragraph lands at line 85 and the extended
  `harnessResume` text at line 124 of
  `.claude/agents/concertino-orchestrator.md`. On this harness the guidance
  is accurate and does address the deadlock — the fix works where it matters.
- Scope: no edits to CON-76's orchestrator→orchestrator `SendMessage`
  protocol, no grant of `SendMessage` to sub-agents (CON-127), no
  cross-harness parity machinery (CON-135). **No scope creep found.**
- `SendMessage` occurrence counts, baseline → modified, rendered
  orchestrator role doc:
  - codex: 6 → 10
  - opencode: 8 → 12
  - claude-code: 8 → 12

### Verdict: REFUTE

The Claude Code half is sound. The harness-portability half fails its own
acceptance criterion, and the design document asserts the opposite of what
the render actually produces.

AC4 ("must not reference `SendMessage` in contexts where it does not
exist"), proposal.md ("No behavior for Codex/OpenCode changes"), design.md
decision 2 ("the added text must not introduce SendMessage-shaped
instructions for those harnesses to misapply") and tasks.md 2.2 ("no new
SendMessage-shaped instructions introduced into their default
sequential-single-thread path") are all contradicted by the rendered codex
and opencode files. The added text is *not* in fact harness-independent.

### Change Requests

1. **`core/roles/orchestrator.md`, "Cycles 2+ — resume" (diff hunk at
   ~line 527) — the reworded paragraph now *opens* on a codex-nonexistent
   tool.** Rendered codex file, lines 552–556:
   `**The same rule applies to a resume as to a fresh spawn: `SendMessage`
   to a sub-agent is a blocking call whose return value *is* the sub-agent's
   result**`. The baseline text there was harness-neutral ("wait for the
   resumed agent to return within this turn"). This is a portability
   regression, not a no-op: on codex/opencode the whole section is meant to
   be read as "switch into that role yourself". Move the `SendMessage`-named
   mechanics into the claude-code `harnessResume` block (where the same
   point is already made, `lib/cli/render.js:196`) and keep the shared prose
   phrased in terms of "the spawn/resume call" without naming the tool.

2. **The new shared paragraph directly contradicts the codex `harnessResume`
   block inside the same rendered file.** New paragraph (codex render line
   64+): *"there is no separate delivery, no later notification, nothing
   else to wait for once you've made the call … Never end a turn on the
   belief that a sub-agent will contact you later; it cannot."* Codex
   `harnessResume` block (codex render line 103, `lib/cli/render.js` codex
   branch, unmodified): *"if you use it to dispatch a worker, you must still
   wait for it to **call `report_agent_job_result`** before your own turn
   ends"*. On codex's optional worker-dispatch path a worker's result
   **does** arrive by a callback the worker initiates — the flat "full stop"
   claim is false there, and the two paragraphs give opposing instructions.
   Either scope the new paragraph to the claude-code block, or qualify it
   ("on harnesses where you dispatch sub-agents with the `Agent` tool …")
   and explicitly except the codex worker-dispatch path.

3. **Same issue, lower severity, at the final-gate skeptic step** (diff hunk
   at ~line 567): "the skeptic cannot send you one any other way" is stated
   unconditionally in shared prose. Fold into the same qualification chosen
   for CR1/CR2 so all three rewordings stay consistent.

4. **The spec delta does not cover the harness-safety property the ticket
   makes an AC.** `specs/orchestrator-subagent-result-delivery/spec.md`
   scopes Requirement 1 to the rendered claude-code file only, and neither
   requirement constrains what may leak into codex/opencode. Add a
   requirement + scenario asserting the rendered codex and opencode
   orchestrator docs introduce no new `SendMessage`-shaped instruction on
   their default sequential path — that is the AC4 check, and it is
   mechanically verifiable exactly the way I verified it above (render both,
   diff/count). Without it, task 2.2 has no acceptance signal beyond "in
   intent".

5. **design.md decision 1's stated rationale is now known to be wrong and
   should be corrected, not just the code.** It claims the shared placement
   is safe because the fact is "a true, harness-independent fact regardless
   of whether a given harness's default path even has sub-agent spawn/suspend
   at all." CR2 shows it is not universally true. Update the decision (and
   proposal.md's "No behavior for Codex/OpenCode changes" line) to reflect
   whatever placement is chosen, so the next reader does not inherit the
   false premise.

### Non-blocking notes

- tasks.md 2.1 as written (`concertino sync --out=<tmpdir>`) does not run in
  this repo: `--core` defaults to the worktree root and fails with
  `ENOENT … /laws`, and no `concertino.config.json` exists at the root. The
  invocation that works is
  `node bin/concertino sync --config=config/examples/concertino.json --core=./core --out=<tmpdir>`.
  Worth writing into the task so the executor does not burn a cycle on it.
- design.md's own "Risks" section already flags the two-places-duplication
  drift risk. Resolving CR1/CR2 by consolidating into the claude-code block
  would incidentally retire that risk too.
- AC3 ("a run in which a sub-agent completes … ends with the orchestrator
  inspecting the worktree and reporting") has no verification task at all.
  Prose changes genuinely cannot be unit-tested for LLM behavior, and I am
  not blocking on it — but the task list should say so explicitly rather
  than leaving the AC silently uncovered.
