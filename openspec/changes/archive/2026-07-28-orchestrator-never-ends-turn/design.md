## Context

Concertino renders four role specs (`core/roles/{orchestrator,executor,evaluator,skeptic}.md`)
into harness-specific outputs via `bin/concertino sync`: `.claude/agents/*.md` for
Claude Code, and `AGENTS.md` / `.codex/agents/*.toml` for Codex. The orchestrator
role's "Harness resume model" section is not literal prose in
`core/roles/orchestrator.md` — it's a `{{block:harnessResume}}` placeholder,
filled in per-harness by the `harnessResume` case in `bin/concertino`'s
`block()` function. That function's `claude-code` string is what actually
appears in a rendered `.claude/agents/concertino-orchestrator.md` (confirmed:
it's byte-identical to the "Harness resume model" section in this orchestrator's
own current system prompt).

`core/roles/orchestrator.md` currently instructs the orchestrator to spawn the
executor/evaluator/skeptic and act on signals they return (PASS/FAIL/CONFIRM/
REFUTE/BLOCKER), but never states the turn-boundary rule: an agent must not
*return control* while a spawned child is still outstanding. On Claude Code,
when the orchestrator is the top-level `/concertino-deliver` session, this is a
non-issue — the session persists and receives the child's completion
notification whenever it arrives. When the orchestrator role is itself
dispatched as a sub-agent (fleet driver, queue runner, or a parent
orchestrator), returning control ends its turn permanently: a suspended
sub-agent is not resumed by an external event, so it never sees the child's
notification, and the child, now orphaned, does not survive either. CON-10
demonstrated this twice with the executor specifically, but the same failure
mode applies to every spawn/resume point in the role: the Phase 1 skeptic
design gate, the Phase 2 cycle-1 executor/evaluator spawns, cycle 2+ resumes,
and the final skeptic gate.

## Goals / Non-Goals

**Goals:**
- State the turn-boundary rule in `core/roles/orchestrator.md`, explained (not
  merely asserted) so it survives paraphrase: waiting is free at the top
  level, fatal when nested.
- Repeat a short, concrete form of the rule at each point a sub-agent is
  spawned or resumed, so a single stranded/compacted preamble can't silently
  drop it (the pattern the tier-3 telemetry additions already established:
  point-of-use instructions next to the bash calls they govern).
- State the fallback for harnesses that can't wait inline: poll for the
  artefact the sub-agent was told to produce (e.g. its evaluation report
  path, or a commit on the branch), or escalate — never leave "what if I
  can't wait" undefined.
- Update the actual rendered source of the Claude Code "Harness resume model"
  text — the `harnessResume` case in `bin/concertino`, not just the neutral
  template file — since that's what a real orchestrator session reads.
- Check `adapters/codex/` (`header.md`, `prompt.md`) and the codex branch of
  the same `harnessResume` block for the equivalent gap.
- Record the constraint in `docs/harness-capabilities.md` as a harness-behavior
  fact (like the existing capability matrix), not a workflow preference.

**Non-Goals:**
- No script, gate, or schema change — this is unenforceable-by-test prose, per
  the ticket's own framing. Evaluation is by inspection/judgment, not `npm test`.
- No change to the executor/evaluator/skeptic role specs — they don't spawn
  further sub-agents in this workflow, so the gap doesn't apply to them.
- No change to the default sequential Codex flow's *procedure* — only to
  what's documented about the one place (optional worker dispatch) where an
  analogous risk could appear.

## Decisions

1. **Fix the block-render function in `bin/concertino`, not just the neutral
   template.** `core/roles/orchestrator.md`'s `{{block:harnessResume}}`
   placeholder is inert on its own; the actual words a Claude Code
   orchestrator sees come from the `claude-code` branch of the `harnessResume`
   case. Editing only the markdown template would leave the real, rendered
   instruction unchanged. Both need the same fix: the template's own
   surrounding prose (for readers of the neutral spec / other harness authors)
   and the rendered block text (for the actual running agent).
2. **Repeat the reminder at each spawn/resume point, in addition to (not
   instead of) explaining the distinction once in the harness-resume
   section.** A single upfront explanation is the natural place to justify
   *why* the rule exists (so it survives paraphrase); short reminders at each
   Phase 1/Phase 2/final-gate spawn instruction are what survives compaction,
   which strands preambles but leaves the section a resumed agent is actively
   reading intact. This mirrors the existing pattern already in the file: the
   dashboard-telemetry `emit-event.sh` calls are repeated at each phase
   transition rather than asserted once, and stuck.
3. **State an explicit fallback (poll for the artefact, or escalate) rather
   than leaving "harness can't wait inline" as an unhandled case.** The ticket
   is explicit that leaving this undefined is itself the failure mode being
   fixed. The natural artefacts to poll for already exist in the role:
   `EVALUATION_REPORT_PATH` / evaluator verdict, or a new commit on the
   branch for the executor; a skeptic's `CONFIRM`/`REFUTE` file for the
   skeptic. Where SendMessage already lets an orchestrator resume a warm
   agent and receive its reply in the same call, "wait inside the call" is
   the norm and needs no special handling — the fallback is only for a
   harness where dispatch is genuinely fire-and-forget.
4. **Codex: document the finding rather than restructure the default flow.**
   The default Codex path (`AGENTS.md`, rendered from `adapters/codex/
   prompt.md` and `header.md`) already runs every role sequentially in one
   thread with no spawn call at all — there is no turn boundary to cross, so
   the CON-10 failure mode cannot reproduce there today. The gap that *can*
   reproduce is the optional worker-dispatch path
   (`.codex/agents/*.toml` + `spawn_agents_on_csv`) that
   `docs/harness-capabilities.md` already describes as available in richer
   Codex environments: if a single orchestrating thread dispatches a worker
   that way and returns before calling `report_agent_job_result`, the same
   failure applies. Since that path is optional and not the default/
   recommended flow, the fix is a documented caution (in
   `adapters/codex/header.md` and `docs/harness-capabilities.md`), not a
   redesign of `AGENTS.md`'s sequential procedure.

## Risks / Trade-offs

- [Repeating the reminder five times reads as redundant] → Acceptable and
  intentional: the ticket explicitly calls for point-of-use repetition over a
  single preamble, on the grounds that compaction strands preambles but not
  the instruction the agent is mid-executing.
- [Prose changes are unverifiable by automated test] → Mitigated by asking
  the evaluator/skeptic to judge behaviorally (would a fresh model reading
  this role actually keep going?) rather than by grepping for text, per the
  ticket's explicit note.
- [Codex's optional worker-dispatch path is speculative — no code in this
  repo currently exercises `spawn_agents_on_csv`] → Document it as a caution
  proportional to that: a short note, not new procedure, and no claim that
  it's been exercised end-to-end.

## Migration Plan

None — additive documentation change to role/adapter prose and one docs file.
No archived spec behavior changes (no capability requirements are added,
modified, or removed), so `openspec archive` will not touch
`openspec/specs/*`.

## Open Questions

None outstanding; scope is confined to prose in the four files named in the
proposal's Impact section.
