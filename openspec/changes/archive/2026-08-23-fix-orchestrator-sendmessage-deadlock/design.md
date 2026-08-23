## Context

`core/roles/orchestrator.md` renders into `.claude/agents/concertino-orchestrator.md`
(Claude Code), plus Codex/OpenCode role equivalents. It already documents a
"Harness resume model" and a CON-76 escalation bubble-up protocol that
legitimately uses `SendMessage` between orchestrators — this is a real,
working channel between a bubbled-up orchestrator and its parent
orchestrator. The bug is a *distinct*, narrower misconception: the
orchestrator sometimes treats the executor/evaluator/skeptic/auditor as if
they too could reach it via some inbound channel, when in fact
`adapters/claude-code/agents.json` grants `SendMessage` to `orchestrator`
only — sub-agent roles have no such tool and cannot initiate contact.

## Goals / Non-Goals

**Goals:**
- State plainly, at the point the orchestrator forms its mental model of the
  spawn/resume mechanism, that sub-agents communicate only by returning.
- Make the artifact-inspection fallback the default behavior whenever the
  orchestrator is not holding a result, not only when the harness "can't
  wait inline".
- Keep the fix effective in the file the agent actually reads — the
  rendered `.claude/agents/concertino-orchestrator.md` — not only the
  `core/` source.
- Remain harness-portable: Codex/OpenCode's sequential single-thread default
  path has no spawn/suspend boundary in the first place; the added text
  must not introduce SendMessage-shaped instructions for those harnesses to
  misapply.

**Non-Goals:**
- Granting sub-agents `SendMessage` (CON-127 — complementary, ships
  separately, and would partly mask this defect rather than fix it).
- Cross-harness parity machinery (CON-135).
- Any change to the CON-76 escalation bubble-up protocol, which is a real,
  correct use of `SendMessage` between orchestrators and is left untouched.

## Decisions

1. **Add one explicit, prominent paragraph to `core/roles/orchestrator.md`'s
   "Harness resume model"** section (common to every harness) stating the
   no-inbound-channel fact directly, including the specific failure pattern
   from the ticket ("if you ever catch yourself reasoning that you are
   'still waiting'... that reasoning is the bug"). This paragraph is
   deliberately worded WITHOUT naming `SendMessage` and without an
   unconditional "cannot ever contact you" claim: skeptic-design-1 (round 1)
   found that an earlier draft did both, which (a) rendered a
   `SendMessage`-named sentence into the codex/opencode files where the tool
   does not exist, and (b) flatly contradicted codex's own
   `harnessResume` block, which describes its *optional* worker-dispatch
   path as calling back via `report_agent_job_result` — a real inbound
   callback on that one path. The revised paragraph instead describes "the
   call you use to spawn or resume it" generically, scopes its claim to "the
   ordinary spawn/resume path", and explicitly defers to "the
   harness-specific notes below" (each harness's own `harnessResume` block)
   for any such exception. This keeps the shared paragraph true on every
   harness, including codex's worker-dispatch path, without needing a
   harness-conditional block for the general case.

2. **Also extend the claude-code branch of the `harnessResume` block**
   (`lib/cli/render.js`, the `case 'harnessResume'` default return), because
   this is the text that actually mentions `SendMessage` by name in the
   context of resuming the executor/evaluator, and is the literal source of
   the ticket's "the orchestrator has the tool, so it infers a symmetric
   channel" failure mode. Left the codex/opencode branches of this block
   untouched — they already describe a sequential single-thread model with
   no spawn/suspend boundary, so the misconception cannot arise there.

3. **Reword the Phase 2 spawn/resume/final-gate steps** to describe each
   `Agent`/`SendMessage` call as a single blocking call whose return value
   *is* the result, and generalize the existing "if the harness can't wait
   inline, poll for the artifact" fallback to also cover "or you otherwise
   find yourself not holding a result" — this is the artifact-polling path
   already present for the harness-limitation case, now stated as the
   general, mandatory recovery path CON-134 asks for.

## Risks / Trade-offs

- This is a prose-only fix; it cannot be proven correct by a unit test of
  orchestrator *behavior* (an LLM's reasoning isn't mechanically testable
  here). The verifiable claim is narrower: the corrected guidance is present,
  worded correctly, and actually reaches the rendered file every harness's
  agent reads — verified by rendering into a throwaway directory and
  grepping the output, per CON-133's lesson that a `core/` edit alone proves
  nothing.
- Duplicating the same fact in two places (the shared section and the
  claude-code block) risks drift if one is edited later without the other.
  Accepted as the simplest fix within scope; a follow-up could consolidate
  if this proves to recur.
