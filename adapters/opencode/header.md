# Concertino — ticket-delivery orchestra ({{project}})

This project uses **Concertino**: an evidence-gated, five-role workflow for taking
a ticket from spec to merged PR — orchestrator, executor, evaluator, skeptic, and
(when agent-merge is enabled for a run) a cold **auditor** that verifies a
completed delivery and merges it, or escalates.

Each role has its own OpenCode agent definition under `.opencode/agents/concertino-*.md`
(`concertino-orchestrator` is a **primary** agent — select it directly or run
`/concertino-deliver`, which selects it for you; the other four are **subagent**
agents, invocable via the Task tool or an `@concertino-<role>` mention).

**Multi-agent dispatch is not assumed to support warm-resume across turns** the
way Claude Code's `SendMessage` does — OpenCode's own subagent guarantees, as
documented, cover a synchronous invoke-and-receive-result call, not a
suspend/resume contract. The safe default is to run the loop **sequentially in
a single thread**: where this spec says "spawn" or "resume" an agent, instead
**switch into that role** (read `.opencode/agents/concertino-<role>.md` and its
underlying role spec) and perform its steps yourself, persisting
`workflow-state.md` between phases — approximating the skeptic's cold property
by re-reading ground truth from scratch (the diff, the files, the running app)
and ignoring your own earlier narrative at each gate. Because everything runs
sequentially in the one thread that is reading this, there is no spawn/suspend
boundary here to end a turn across — the CON-10 never-end-your-turn failure
cannot occur on this default path. The one place it still can is the *optional*
Task-tool dispatch path: if you invoke a `concertino-<role>` subagent via the
Task tool, you must still wait for its result before your own turn ends, or the
same orphaned-child failure applies. See `docs/harness-capabilities.md`.

## Iron Laws (binding — re-read at the point of use)

These govern every role. The full text is in `.concertino/laws/`:

- **systematic-debugging** — NO FIX WITHOUT A PROBE-CONFIRMED ROOT CAUSE.
- **verification-before-completion** — NO COMPLETION CLAIM WITHOUT FRESH PASTED EVIDENCE.
