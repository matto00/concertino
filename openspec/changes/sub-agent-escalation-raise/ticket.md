# CON-127: Give sub-agent roles a real escalation path that always bubbles to the orchestrator

## Description

CON-76 established that escalations must bubble up, and its acceptance criteria explicitly
covered deep nesting: "An escalation raised by a subagent at any depth reaches the root agent
while the wait is still open." That was delivered for exactly one hop: orchestrator → root. The
hop below it — sub-agent → orchestrator — was never built.

Only `core/roles/orchestrator.md` has an "Escalation & Circuit Breakers" section with a raise
procedure. `executor.md`/`evaluator.md`/`skeptic.md` have no escalation path — `BLOCKER` is
explicitly scoped to environmental failures only. `auditor.md` has an `ESCALATE` verdict, but it
is a return value read after the agent finishes, not a raise-while-running channel.

A sub-agent that hits a genuine decision-needing situation has no way to raise it mid-flight
without either smuggling the question into a report verdict or deciding unilaterally.

## CORRECTED FRAMING (2026-08-22 ticket comment — supersedes the "no way to raise" wording above)

Sub-agents DO reach the orchestrator reliably today — via their RETURN VALUE (CON-133 validated
this end-to-end, ~135 tool calls, zero external nudges). The real gap is narrower: **a sub-agent
can only speak by terminating.** There is no mid-flight channel. An agent hitting a decision must
end its turn — discarding context, requiring a cold re-spawn — or smuggle the question into a
report verdict. Granting `SendMessage` buys **escalation without death**, not a new ability to
communicate that didn't exist before. Design for that.

## Scope

- Add `SendMessage` to `baseTools` for `executor`, `evaluator`, `skeptic`, `auditor` in
  `adapters/claude-code/agents.json`.
- Define a mid-flight raise procedure in `core/roles/{executor,evaluator,skeptic}.md`, distinct
  from `BLOCKER` and not restricted to environmental failures. Reconcile `auditor`'s existing
  `ESCALATE` verdict with it (a return-value verdict, not a raise-while-running channel).
- Raising must NOT end the raiser's turn.
- The orchestrator relays upward without deciding, per CON-76's "root presents; intermediate
  agents relay without deciding" rule, extended to the sub-agent hop.
- `BLOCKER` keeps its environmental-only meaning; the two signals stay distinguishable in reports
  and telemetry.
- Compose with the (not-yet-built) TUI-gating ticket (CON-126): whether the raise touches
  `emit-event.sh` depends on that signal, and the answer must be the same at every depth. CON-126
  is explicitly out of scope here — design so the answer *can* be uniform once it lands, and state
  assumptions explicitly.

## Explicit scope boundary (this delivery run)

Claude Code only. Cross-harness parity (Codex/OpenCode `SendMessage` equivalents) is deferred to
CON-135. `core/roles/*.md` edits render into all three adapters, so guidance must stay
adapter-safe — no naming of `SendMessage` in shared prose (CON-134's lesson: this leaked
tool-that-doesn't-exist text into Codex/OpenCode renders when done wrong. Harness-specific tool
names belong in `lib/cli/render.js`'s `harnessResume` `claude-code` branch).

Also out of scope: CON-126 (TUI detection), CON-135 (cross-harness parity), CON-136 (Planning
premise validation), CON-119/CON-121 (cleanup.sh defects), CON-103 (local-vs-CI coupling).

## Acceptance Criteria

- [ ] `executor`, `evaluator`, and `skeptic` each have a documented escalation raise procedure
      that is separate from `BLOCKER` and usable for non-environmental decisions.
- [ ] An escalation raised by any sub-agent reaches the orchestrator without the sub-agent's turn
      ending destructively — no branch where it is dropped, absorbed, or downgraded to a report
      finding, within the ordinary spawn/resume path this delivery run targets (Claude Code).
- [ ] The orchestrator relays a sub-agent escalation upward without deciding it, and the human's
      answer is routed back to the raiser so it resumes rather than restarts.
- [ ] `BLOCKER` retains its environmental-only meaning, and the two are distinguishable in reports
      and telemetry.
- [ ] A sub-agent that cannot proceed without a decision never proceeds on its own judgement
      instead of escalating.
- [ ] Guidance is written so it composes correctly once CON-126 (TUI detection) lands, with
      assumptions stated explicitly; TUI detection itself is not built here.
- [ ] `core/roles/*.md` edits do not leak Claude-Code-only tool names into Codex/OpenCode
      renders (verified via CON-134's render-diff proxy).
- [ ] Rendered `.claude/agents/*.md` frontmatter actually carries the new `SendMessage` tool for
      executor/evaluator/skeptic/auditor (not just the source config).
