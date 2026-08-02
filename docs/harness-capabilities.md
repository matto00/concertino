# Harness capabilities — Claude Code vs Codex vs OpenCode

Concertino's orchestra was designed for a harness with **native multi-agent
orchestration**. Claude Code provides that; Codex does not (yet), and OpenCode's
own multi-agent guarantees, while real, don't publicly document the specific
warm-resume-across-turns contract Claude Code's `SendMessage` provides.
"Harness-agnostic" here means a shared neutral core with **full fidelity on
Claude Code** and a **documented, degraded flow on Codex and OpenCode** — not
identical behavior across all three.

## Capability matrix

| Capability | Claude Code | Codex CLI | OpenCode |
| ---------- | ----------- | --------- | -------- |
| Spawn a typed sub-agent from the running agent | ✅ `Agent` tool | ⚠️ only `spawn_agents_on_csv` (batch); no targeted dispatch | ⚠️ Task tool / `@name` mention invokes a `mode: subagent` agent and returns a result |
| Sub-agent nesting | ✅ up to 5 levels | ⚠️ `max_depth` (default 1) | ⚠️ `subagent_depth` (default 1) |
| Warm resume / inter-agent messaging | ✅ `SendMessage`, persisted transcripts | ❌ workers `report_agent_job_result`; no routing | ❓ no documented warm-resume-across-turns contract equivalent to `SendMessage` |
| Orchestrator → executor → evaluator → skeptic → (agent-merge) auditor topology | ✅ first-class | ❌ not supported directly | ❌ not assumed (treated conservatively — see below) |
| Background / parallel agents | ✅ | ⚠️ threads run, coordination is manual | ⚠️ Task tool calls are synchronous per invocation |
| Custom instructions | `.claude/agents/*.md` (per-agent) | `AGENTS.md` (single shared doc) | `.opencode/agents/*.md` (per-agent) + `AGENTS.md` (read automatically if present) |
| Slash commands / prompts | `.claude/commands/*.md` | `.codex/prompts/*.md` | `.opencode/commands/*.md` |
| Native local-model (Ollama) support | ⚠️ only via an Anthropic-compatible gateway (e.g. LiteLLM) — see `model-providers` below | ✅ `[model_providers.ollama]` in `.codex/config.toml` | ✅ `provider.ollama` (OpenAI-compatible) in `opencode.json` |
| Plugin distribution | ✅ `.claude-plugin/plugin.json` + marketplace | n/a (config files) | n/a (config files) |

## What this means for the workflow

### Claude Code (full fidelity)

The orchestrator runs as a coordinator agent and:

- spawns the **executor** and **evaluator** with the `Agent` tool,
- **warm-resumes** them with `SendMessage` across evaluation cycles (so they keep
  their context instead of re-reading everything),
- spawns the **skeptic fresh** at both gates (cold by construction),
- spawns the **auditor fresh**, once, after PR creation — only when agent-merge
  resolves `true` for the run — to verify the delivery and merge it, or escalate,
- falls back to a `RESUME — do not start over` fresh spawn if `SendMessage` is
  unavailable in the session (state lives in `workflow-state.md`).

This is the topology the design assumes; nothing is approximated.

`/concertino-deliver <TICKET_ID> --inline` collapses one hop out of this
topology: the calling session skips spawning `concertino-orchestrator` as a
subagent and instead reads `.claude/agents/concertino-orchestrator.md` and
plays the role itself, in its own turn, still spawning the
executor/evaluator/skeptic/auditor sub-agents directly. This is the one-off,
single-ticket-per-session path — it trades away the cold orchestrator
subagent's context isolation, which buys nothing when the calling session was
already started fresh for exactly one ticket. The default (`--inline` absent)
remains the cold-spawn topology above, unchanged — `--inline` is additive, not
a default-behavior change. See `adapters/claude-code/command.md`'s inline-mode
branch for the exact instructions, including the self-imposed tool-scope
guardrail (the calling session's own tool set may be broader than
`concertino-orchestrator`'s frontmatter-scoped list; inline mode instructs it
to use only that list anyway).

### Codex (degraded — sequential single-thread)

Codex has no programmatic multi-tier dispatch and no warm-resume routing, so the
rendered `AGENTS.md` instructs a **single agent to run the loop sequentially**,
playing each role in turn:

1. Orchestrator: setup (scripts) → plan → persist `workflow-state.md`.
2. Skeptic (design gate): re-read the plan from scratch; CONFIRM / required revisions.
3. Executor: implement → run gates → commit.
4. Evaluator: re-run gates → three-phase review → PASS / change requests.
5. Skeptic (final gate): re-establish ground truth, trace ACs, run the app, judge UI.
6. Orchestrator: squash → archive → push → PR → comment.
7. Auditor (agent-merge only): verify the four merge conditions
   (`check-merge-readiness.sh` plus a cold AC trace) and merge, or escalate with
   the reason — strictly after step 6, since it operates on the PR step 6 just
   created. Skipped entirely when agent-merge is disabled for the run.

**The one property that degrades is *coldness*.** On Claude Code the skeptic (and,
when agent-merge is enabled, the auditor) is a genuinely fresh process with no
shared context. On Codex the same thread plays both, so it's asked to
**deliberately re-derive every conclusion from ground truth** (the diff, the
files, the running app, fresh gate runs, the event log) and *ignore its own
earlier narrative*. That's a behavioral discipline, not a structural guarantee — it
catches less than a truly cold reviewer, but the evidence gates (re-run the gates,
trace each AC to real code, screenshot the UI, re-check `check-merge-readiness.sh`)
still hold because they're grounded in artifacts, not memory.

The `.codex/agents/*.toml` definitions are provided for environments where Codex's
limited worker spawning *is* available — you can optionally dispatch the executor,
evaluator, or auditor as a worker — but the default and recommended Codex path is
the sequential single-thread flow in `AGENTS.md`.

Codex accepts `--inline` too (e.g. copy-pasted from a Claude Code invocation)
but it is a documented no-op here: Codex already plays the orchestrator role
directly in this one thread, with no subagent-spawn step to skip.

### OpenCode (degraded — sequential single-thread, conservative by design)

OpenCode has a genuine subagent/Task-tool mechanism (a primary agent can invoke a
`mode: subagent` agent and receive its result), but no publicly documented
guarantee of Claude Code's warm-resume-across-turns semantics (`SendMessage` to a
suspended agent). Per this project's own preference for understating rather than
overstating a harness's capability (a mis-assumed capability is exactly the CON-10
failure class — see below), Concertino treats OpenCode like Codex: the rendered
`.opencode/commands/concertino-deliver.md` selects the `concertino-orchestrator`
primary agent (`.opencode/agents/concertino-orchestrator.md`), which runs the same
seven-step loop as Codex's sequential flow above, switching into each role by
reading its own `.opencode/agents/concertino-<role>.md` and the underlying
`core/roles/<role>.md` spec, persisting `workflow-state.md` between phases.

The five `.opencode/agents/concertino-*.md` definitions are provided for
environments where OpenCode's Task-tool dispatch *is* used — an operator can
optionally invoke the executor, evaluator, skeptic, or auditor as a subagent — but
the default and recommended path is the sequential single-thread flow the primary
orchestrator agent's own body describes, exactly like Codex's default.

Like Codex, the model each role runs on is fixed at the last `concertino sync`
(baked into each `.opencode/agents/concertino-<role>.md`'s own `model:`
frontmatter) — there is no per-spawn model override on OpenCode either, since that
would require the same warm, per-invocation contract this section already
declines to assume.

### Everything that stays identical

The **procedure scripts** (`scripts/concertino/*.sh`) and the **Iron Laws**
(`.concertino/laws/`) are byte-for-byte the same across all three harnesses —
each just shells out to the same scripts and reads the same law docs. That
shared, deterministic backbone is what makes the cross-harness story honest
even where the agent topology differs.

> Codex's and OpenCode's agent models are both evolving. If/when either gains
> targeted sub-agent dispatch and inter-agent messaging with the same
> guarantees Claude Code documents, that adapter can render the full topology
> too — the neutral `core/roles/` specs already describe it; only the
> adapter's resume block would change.

## Harness-behavior fact: a suspended agent is never resumed by an external event

This is a fact about how these harnesses behave, not a workflow preference, so
it's recorded here rather than only as an instruction inside
`core/roles/orchestrator.md`.

On Claude Code, a spawned sub-agent that suspends without an active caller
waiting on it (via `SendMessage`, or a re-spawned `RESUME — do not start over`
prompt) is **not woken by any external event**. There is no notification queue
that reaches back into a suspended turn later. Its own spawned children, in
turn, do not survive its turn ending either — they are orphaned along with it.

That has opposite consequences depending on where the orchestrator role is
running:

- **As the top-level `/concertino-deliver` session**, this is harmless: the
  session is the thing waiting, so it simply receives the sub-agent's result
  whenever the tool call returns. Waiting is free.
- **As a sub-agent itself** (dispatched by a fleet driver, a queue runner, or
  another orchestrator), returning control before a spawned/resumed child
  reports back is fatal: the now-suspended orchestrator is never resumed by
  the child's completion, so it never sees the result, and the child it
  spawned dies with it. CON-10 hit this twice in one delivery — the
  orchestrator said it would "pause and wait for a notification" and the run
  went dead until a human noticed and re-prompted it.

The mitigation (see `core/roles/orchestrator.md`'s "Harness resume model" and
its point-of-use reminders at each spawn/resume instruction): drive every
phase to completion within the same turn regardless of context, and if the
harness genuinely cannot wait for a sub-agent inline, poll for the artefact
the sub-agent was told to produce (its report path, or a new commit on the
branch) instead of returning control speculatively, or escalate.

**Codex and OpenCode finding (see above):** the default sequential single-thread
flow has no spawn/suspend boundary at all — the one thread reading `AGENTS.md`
(Codex) or `.opencode/agents/concertino-orchestrator.md` (OpenCode) plays every
role itself, so there is no child to orphan and this failure mode cannot
reproduce there. The identical risk reappears only if the *optional*
worker-dispatch path is used — Codex's `.codex/agents/*.toml` +
`spawn_agents_on_csv`, or OpenCode's Task tool invoking a `concertino-<role>`
subagent: a dispatching thread that returns before the dispatched
worker/subagent reports back (`report_agent_job_result` on Codex; the Task
tool's own result on OpenCode) orphans it exactly as an unresumed Claude Code
sub-agent would be. `adapters/codex/header.md` and `adapters/opencode/header.md`
both document this same caution so all three stay in agreement.

## Harness-behavior fact: a lingering post-completion turn is invisible to the dashboard (CON-48)

This is the mirror image of the fact above — recorded here for the same
reason: it's a fact about how these harnesses and the dashboard behave, not
just an instruction inside `core/roles/orchestrator.md`.

Where the fact above is about a turn ending *too early*, this one is about a
turn that never ends at all once the orchestrator's real work is genuinely
done. CON-16's orchestrator ran Phase 4 to completion — `cleanup.sh
--phase4` removed the worktree and emitted `run.end` (status=`delivered`),
the ticket was set to Done with a closing comment, and the hygiene check was
reported — and then, in plain chat, asked a genuine follow-up question with
**zero telemetry**: no `escalation.raised`, nothing any dashboard poll could
ever surface. The tmux window and the underlying process were both still
alive over an hour later, sitting at that unanswered chat prompt.

Why this is invisible from *both* directions at once:

- **The dashboard's own terminal signal already fired.** `run.end` had
  already been logged with `status=delivered`, so `deriveStatus`
  (`lib/ui/reducer.js`) correctly, unavoidably rendered the row as `DONE` —
  a human watching the dashboard has no reason to suspect anything is still
  waiting on them behind a row that reads as finished.
- **`window-reaping`'s conservative rule protects the very session stuck in
  this bug.** Reaping intentionally refuses to touch a live tmux window even
  after `run.end` has fired (CON-25/CON-34) — correct in isolation, since an
  orchestrator legitimately finishing Phase 4's tail (ticket Done + hygiene,
  which run *after* `run.end`) must not be killed mid-cleanup. But that same
  rule cannot distinguish "still legitimately finishing up" from "done with
  everything and stuck on an unstructured question" — both are just "a live
  window past `run.end`" from the reaper's point of view. A session stuck in
  this bug is therefore never reaped either, and persists indefinitely with
  no distinguishing signal.

The mitigation (see `core/roles/orchestrator.md`'s Phase 4, "genuinely
complete" + the escalation/end-of-turn steps that follow it): define
precisely when the orchestrator's own work is done, route anything left to
say through `emit-event.sh escalation --await` (which *does* emit telemetry —
`escalation.raised`, rendered as `NEEDS YOU`, not a falsely-idle `DONE` row —
see `post-completion-escalation-visibility` in `lib/ui/reducer.js`), and then
actually end the turn once that one-shot escalation resolves. No config or
harness capability can make an LLM literally terminate a process — this is a
behavioral instruction, unenforceable at the code level, exactly like the
"never end early" mitigation above — but giving the leftover suggestion a
durable, dashboard-visible event trail is what turns an invisible stuck
session into a visible `NEEDS YOU` row instead.
