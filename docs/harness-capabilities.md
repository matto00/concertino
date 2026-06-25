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
