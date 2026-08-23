## 1. Tool grant (Claude Code adapter)

- [x] 1.1 In `adapters/claude-code/agents.json`, add `"SendMessage"` to `baseTools` for `executor`,
      `evaluator`, `skeptic`, and `auditor` (orchestrator already has it — leave unchanged).

## 2. Core role docs — new `ESCALATION` raise procedure

- [x] 2.1 `core/roles/executor.md`: add a new section defining the `ESCALATION` raise —
      when to use it (genuine non-environmental decision outside the executor's authority),
      distinct from `BLOCKER` (which stays environmental-only, unchanged) and from "flag an
      impossible change request and stop" (which is a normal report finding, not a raise). Return
      shape: `Verdict: ESCALATION` / `Question:` / `Options:` / `Context:`. Add the harness-guarded
      self-notify step (`{{block:subagentEscalationNotify}}` or equivalent — see task 5.1) as the
      step immediately before returning. Add a guardrail: never proceed on unilateral judgment in
      place of raising.
- [x] 2.2 `core/roles/evaluator.md`: same addition, as `Overall: ESCALATION` alongside existing
      `PASS | FAIL | BLOCKER`. Do not alter the existing "`BLOCKER` is for environmental failures
      only" sentence — keep it verbatim, add `ESCALATION` as a clearly distinct, separate signal.
- [x] 2.3 `core/roles/skeptic.md`: same addition, as `Verdict: ESCALATION` alongside existing
      `CONFIRM | REFUTE | BLOCKER`. Same "keep the existing BLOCKER sentence verbatim" constraint
      as 2.2. Note explicitly that an `ESCALATION` from the skeptic still results in a **fresh
      cold** re-spawn once resolved (skeptic is never warm-resumed, unchanged) — but with the
      resolved answer supplied as an explicit additional input, so it isn't re-asked.
- [x] 2.4 `core/roles/auditor.md`: add a distinctly-named **`ESCALATION-RAISE`** verdict as
      **additive** to the existing `MERGE | ESCALATE | BLOCKER` vocabulary, not merged into it, and
      NOT named bare `ESCALATION` (design-gate round-1 REFUTE CR4: `ESCALATE`/`ESCALATION` is an
      unsafe one-token-apart pair for a value parsed from LLM-generated prose in the same
      `Verdict:` slot). Add an explicit paragraph distinguishing `ESCALATE` (post-hoc finding after
      a completed pass, one-shot, unchanged) from `ESCALATION-RAISE` (a raise for an ambiguity
      encountered *before* a verdict can be reached). State that an `ESCALATION-RAISE` does not
      consume or interact with the "one attempt, no retry" circuit-breaker entry for
      `ESCALATE`/`BLOCKER`.
- [x] 2.5 (Design-gate round-1 REFUTE CR1.) In `evaluator.md`/`skeptic.md`/`auditor.md`, do
      **NOT** alter or carve exceptions into the existing "a verdict must always be emitted"
      sentence. Instead, add one clarifying sentence next to each role's verdict enumeration
      stating that `ESCALATION` (or, for the auditor, `ESCALATION-RAISE`) is an ordinary member of
      that enumeration: it is written, `persist-evidence.sh`-persisted, and
      `emit-event.sh verdict verdict=ESCALATION[-RAISE]`-emitted exactly like `PASS`/`FAIL`/
      `BLOCKER`/`CONFIRM`/`REFUTE`/`MERGE`/`ESCALATE` already are — no new emission path, no
      dropped step. Distinguishability from `BLOCKER` (AC4) is satisfied by the two simply being
      different `verdict=` values, not by suppressing emission for one of them. For `executor.md`
      (no existing verdict enumeration/"must always emit" sentence to preserve), state the
      equivalent: an `ESCALATION` return is written as a short report exactly like the normal
      handoff summary, not smuggled into free prose.
- [x] 2.6 In each of the four files above, ensure **no line names `SendMessage` directly** in the
      raise-procedure prose — reference the harness-specific self-notify via a `{{block:...}}`
      placeholder resolved only by `lib/cli/render.js`'s `claude-code` branch (per task 5), so
      Codex/OpenCode renders carry no new `SendMessage` text (CON-134's lesson — re-verify with
      the render-diff proxy in task 6).

## 3. `core/roles/orchestrator.md` — relay + resume handling

- [x] 3.1 Add two rows to the "Signal Types" table: `ESCALATION | executor/evaluator/skeptic |
      Relay to human via the existing raise procedure — do not decide it yourself` and
      `ESCALATION-RAISE | auditor | same, before the auditor has reached MERGE/ESCALATE/BLOCKER —
      distinct from ESCALATE`. Keep the table readable at a glance despite the now-three
      `ESCALAT*`-prefixed rows (Planning `ESCALATION`, auditor `ESCALATE`, auditor
      `ESCALATION-RAISE`, other-roles `ESCALATION`) — group or annotate as needed.
- [x] 3.2 In "Escalation & Circuit Breakers" → immediately after "How to raise one"'s topology
      branch, add a paragraph stating a sub-agent `ESCALATION`/`ESCALATION-RAISE` verdict is raised
      through the exact same `--await`/`--raise-only` procedure already defined, substituting the
      sub-agent's question/options/context and tagging `role=<raiser>` instead of
      `role=orchestrator`. State explicitly this reuses `escalation.raised`/`.answered` — no new
      event kind, no new `emit-event.sh` mode, no `kind=` parameter (struck per design-gate
      round-1 REFUTE CR2 — `emit-event.sh` silently drops unrecognized fields; `role=<raiser>`
      alone carries the distinction).
- [x] 3.3 State the resume contract: once resolved, resume the raising executor/evaluator **warm**
      (their existing warm-resume mechanism, now also legitimate after an `ESCALATION`, not only
      after `FAIL`) with the answer as new input; re-spawn a raising skeptic/auditor
      **fresh/cold**, passing the resolved answer as an explicit additional input. **This sentence
      names the resume mechanism — route it through the harness-guarded block from task 3.4/5.1,
      do not write it as bare shared prose** (design-gate round-1 REFUTE CR3).
- [x] 3.4 Add `ORCHESTRATOR_AGENT_REF` as a new input every executor/evaluator/skeptic/auditor
      `Agent(...)` spawn passes (Claude Code only) so the raising sub-agent has a concrete
      self-notify target. **This entire note — including task 3.3's resume-mechanism sentence —
      MUST be written inside a harness-guarded `{{block:...}}` placeholder** (extend the existing
      `{{block:harnessResume}}` claude-code branch, or add a sibling block), never as bare text in
      `orchestrator.md`'s shared body: `orchestrator.md` renders to codex/opencode exactly like the
      four sub-agent role files, and task 6.1's zero-**delta** `SendMessage`-occurrence criterion
      for codex/opencode applies to it too (design-gate round-1 REFUTE CR3 — the round-1 draft left
      this file out of the "route through a block" constraint while leaving it in scope for the
      check that would then fail on it).
- [x] 3.5 State the CON-15-safety restatement from design.md Decision 5: the orchestrator still
      never ends its own turn holding for a sub-agent; the sub-agent's `ESCALATION`/
      `ESCALATION-RAISE` return is its normal way of yielding control back (not a wait-for-reply
      loop on its own side) — no new exception to "never end your turn" is introduced here.
- [x] 3.6 Do not add anything to the "Resolves in-loop (no human)" table for `ESCALATION`/
      `ESCALATION-RAISE` — it always reaches the human, add both explicitly to the "Always reaches
      the human" list.
- [x] 3.7 State explicitly (design-gate round-1 REFUTE CR1): on receiving `ESCALATION`/
      `ESCALATION-RAISE`, the orchestrator first observes the sub-agent's already-emitted
      `verdict=ESCALATION`/`verdict=ESCALATION-RAISE` event and report (unchanged verdict-emission
      mechanism — see task 2.6 below), and *separately, additionally* raises the human-facing
      `escalation.raised` relay itself — the relay does not replace or wait on the verdict event;
      both exist for the same raise.

## 4. Spec corrections (`openspec/specs/`)

- [x] 4.1 Confirm the delta specs already drafted in
      `openspec/changes/sub-agent-escalation-raise/specs/{subagent-escalation-raise,
      orchestrator-subagent-result-delivery,escalation-bubble-up}/spec.md` accurately describe the
      final core/roles/*.md and render.js wording once 2–3 land; adjust wording only if it drifted
      from what was actually written (do not silently reinterpret the requirements).

## 5. `lib/cli/render.js`

- [x] 5.1 Add a new block case (e.g. `subagentEscalationNotify`) resolved only for
      `harness === undefined` / claude-code (default branch), returning the concrete
      `SendMessage`-naming instruction (self-notify the orchestrator via
      `ORCHESTRATOR_AGENT_REF`, fire-and-forget, immediately followed by the `ESCALATION` return —
      no wait for a reply). Return an empty string (or omit the step entirely) for `codex` and
      `opencode`.
- [x] 5.2 Update the existing `harnessResume` `claude-code` branch text (the one CON-134 last
      touched) to state the corrected, narrower fact from design.md Decision 7: sub-agents now
      hold `SendMessage`, but this cannot be observed by the orchestrator before its blocking
      `Agent()`/`SendMessage` call returns; a sub-agent's authoritative result remains the return
      value of that call, and the `ESCALATION` verdict travels inside it like every other verdict.
      Remove/replace the now-false "have no SendMessage tool and cannot address you" sentence with
      this corrected statement — do not simply delete it and leave the gap unstated.
- [x] 5.3 Leave the `codex`/`opencode` `harnessResume` branches untouched unless task 5.2's edit
      requires a matching clarification there too for internal consistency — check both after 5.2
      lands; if no contradiction is introduced, no edit is needed (record this check's outcome in
      the final report either way).

## 6. Verification

- [x] 6.1 **Render-diff proxy (CON-134's mechanical check), reused, not reinvented.** In a
      throwaway temp dir (never against this repo or any real worktree), run `concertino sync`
      (or the equivalent render entry point `lib/cli/render.js` exposes) against a **baseline**
      checkout (this branch's parent commit) and against the **modified** worktree, for all three
      harnesses (claude-code, codex, opencode). Diff `SendMessage` occurrence counts per rendered
      role file between baseline and modified:
      - claude-code: expect the count to **increase** for executor/evaluator/skeptic/auditor
        (new tool grant + raise procedure text) and orchestrator.md's own count to change only at
        the one corrected `harnessResume` sentence (task 5.2) — state the exact before/after count
        for every claude-code role file in the final report.
      - codex, opencode: expect **zero change** in `SendMessage` occurrence count for every role
        file (this is the adapter-safety criterion — hard evidence, not an assertion).
      Prove this check can fail (red-before-green): temporarily reintroduce a bare `SendMessage`
      mention into shared prose in one of `core/roles/executor.md`'s edits, re-run the diff, confirm
      it now shows a nonzero codex/opencode delta, then revert that temporary mutation and re-run
      to confirm it goes back to zero. Do this on the *real* modified role file (mutate then
      revert the actual source), not a copy — an assertion bound to a reimplementation or an
      inline copy is not evidence (see the orchestrator's stated "evidence-shaped non-evidence"
      list).
- [x] 6.2 **Rendered frontmatter assertion.** After `concertino sync` renders
      `.claude/agents/concertino-{executor,evaluator,skeptic,auditor}.md` in the throwaway dir
      from 6.1, grep each rendered file's YAML frontmatter `tools:` line and assert `SendMessage`
      is present, for all four files. This must run against the **rendered** file, never the
      source `adapters/claude-code/agents.json` alone (CON-133's lesson: a config edit alone is
      not proof). Red-before-green: temporarily remove `SendMessage` from one role's `baseTools`
      in the real `adapters/claude-code/agents.json`, re-render, confirm the assertion fails,
      revert, re-render, confirm it passes.
- [x] 6.3 **`openspec validate` clean** for this change (already passing as of Planning — re-run
      after any wording adjustments from task 4.1).
- [x] 6.4 **Gate-chain check**: confirm this change touches no `.husky/**` file and adds no script
      `.husky/pre-commit` invokes — if true, `scripts/concertino/test-gate-in-isolation.sh` and the
      `## Gate-Chain Implications Checklist` (CON-132) do not apply; state this explicitly in the
      final report rather than silently skipping.
- [x] 6.5 **LLM-runtime behaviors are not mechanically testable — state this explicitly, do not
      invent a vacuous check for:** (a) whether a sub-agent actually recognizes a genuine
      non-environmental decision and raises `ESCALATION` instead of guessing or misusing `BLOCKER`;
      (b) whether the orchestrator's relay correctly avoids deciding the substance of a raised
      question. These map to AC5 ("never proceeds on its own judgement") and part of the
      orchestrator-relay AC — record in the final report that these are judged by role-doc review
      (are the instructions unambiguous and complete?) and by the design's own reasoning, not by a
      runtime probe, since there is no fixture that can force an LLM's judgment call inside a
      spawned sub-agent.
- [x] 6.6 Run the existing test suite relevant to rendering/config (e.g.
      `test/scripts/codex-role-render.test.sh`, `test/scripts/opencode-render.test.sh`,
      `test/scripts/auditor-render.test.sh`, and any `npm test` suite covering `lib/cli/render.js`)
      to confirm nothing regresses; paste pasted command output with exit codes, not prose.

## 7. Handoff

- [x] 7.1 Write `files-modified.md` enumerating every file touched, per the executor's standard
      handoff format.
