# Harness capabilities — Claude Code vs Codex

Concertino's orchestra was designed for a harness with **native multi-agent
orchestration**. Claude Code provides that; Codex does not (yet). "Harness-agnostic"
here means a shared neutral core with **full fidelity on Claude Code** and a
**documented, degraded flow on Codex** — not identical behavior.

## Capability matrix

| Capability | Claude Code | Codex CLI |
| ---------- | ----------- | --------- |
| Spawn a typed sub-agent from the running agent | ✅ `Agent` tool | ⚠️ only `spawn_agents_on_csv` (batch); no targeted dispatch |
| Sub-agent nesting | ✅ up to 5 levels | ⚠️ `max_depth` (default 1) |
| Warm resume / inter-agent messaging | ✅ `SendMessage`, persisted transcripts | ❌ workers `report_agent_job_result`; no routing |
| Orchestrator → executor → evaluator → skeptic topology | ✅ first-class | ❌ not supported directly |
| Background / parallel agents | ✅ | ⚠️ threads run, coordination is manual |
| Custom instructions | `.claude/agents/*.md` (per-agent) | `AGENTS.md` (single shared doc) |
| Slash commands / prompts | `.claude/commands/*.md` | `.codex/prompts/*.md` |
| Plugin distribution | ✅ `.claude-plugin/plugin.json` + marketplace | n/a (config files) |

## What this means for the workflow

### Claude Code (full fidelity)

The orchestrator runs as a coordinator agent and:

- spawns the **executor** and **evaluator** with the `Agent` tool,
- **warm-resumes** them with `SendMessage` across evaluation cycles (so they keep
  their context instead of re-reading everything),
- spawns the **skeptic fresh** at both gates (cold by construction),
- falls back to a `RESUME — do not start over` fresh spawn if `SendMessage` is
  unavailable in the session (state lives in `workflow-state.md`).

This is the topology the design assumes; nothing is approximated.

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

**The one property that degrades is *coldness*.** On Claude Code the skeptic is a
genuinely fresh process with no shared context. On Codex the same thread plays the
skeptic, so it's asked to **deliberately re-derive every conclusion from ground
truth** (the diff, the files, the running app, fresh gate runs) and *ignore its own
earlier narrative*. That's a behavioral discipline, not a structural guarantee — it
catches less than a truly cold reviewer, but the evidence gates (re-run the gates,
trace each AC to real code, screenshot the UI) still hold because they're grounded in
artifacts, not memory.

The `.codex/agents/*.toml` definitions are provided for environments where Codex's
limited worker spawning *is* available — you can optionally dispatch the executor or
evaluator as a worker — but the default and recommended Codex path is the sequential
single-thread flow in `AGENTS.md`.

### Everything that stays identical

The **procedure scripts** (`scripts/concertino/*.sh`) and the **Iron Laws**
(`.concertino/laws/`) are byte-for-byte the same on both harnesses — both just shell
out to the same scripts and read the same law docs. That shared, deterministic
backbone is what makes the cross-harness story honest even where the agent topology
differs.

> Codex's agent model is evolving. If/when it gains targeted sub-agent dispatch and
> inter-agent messaging, the Codex adapter can render the full topology too — the
> neutral `core/roles/` specs already describe it; only the adapter's resume block
> would change.

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

**Codex finding (see above):** the default sequential single-thread flow has
no spawn/suspend boundary at all — the one thread reading `AGENTS.md` plays
every role itself, so there is no child to orphan and this failure mode
cannot reproduce there. The identical risk reappears only if the *optional*
worker-dispatch path (`.codex/agents/*.toml` + `spawn_agents_on_csv`, noted
above) is used: a dispatching thread that returns before a dispatched worker
calls `report_agent_job_result` orphans that worker exactly as an unresumed
Claude Code sub-agent would be. `adapters/codex/header.md` documents this same
caution so the two stay in agreement.
