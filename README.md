# 🎼 Concertino

**A harness-agnostic, evidence-gated agent orchestra for autonomous ticket delivery.**

A *concertino* is the small group of soloists that leads a concerto grosso, set against the full ensemble. Here it's the four agents that drive a ticket from spec to merged PR — an **orchestrator** conducting an **executor**, an **evaluator**, and a cold adversarial **skeptic** — bound by hard, re-read-just-in-time behavioral laws so the loop stays diligent and self-correcting with the human out of it.

Concertino runs on both **Claude Code** (full fidelity: native sub-agents, warm resume) and **OpenAI Codex CLI** (a documented, degraded sequential flow). One neutral core, two harness adapters, one per-project config.

---

## Why it exists

Most of what a human does babysitting an agent loop is *verification*, not judgment — confirming a test really failed, the server is really up, the design is really sound. That's mechanizable. For each step, Concertino replaces *"human confirms Y"* with **an evidence artifact + a cold checker that verifies Y against ground truth.** The human survives only for the residue: real decisions and tiebreaks.

Three structural properties — none requiring a human — make the loop self-correcting:

1. **Canonical procedures, re-read just-in-time** — agents call committed scripts and read law docs at the moment of use, never recalling drifting procedure from compacted context.
2. **Evidence-gated transitions** — a claim ("tests pass", "root cause found", "ready to ship") needs fresh, reproduced output, so a wrong step fails *loudly* instead of propagating.
3. **Cold, adversarial verification** — the skeptic is spawned fresh at the gates and derives its verdict from ground truth, never another agent's narrative, so it can't inherit the loop's blind spots.

## The ensemble

| Agent | Posture | Role |
| ----- | ------- | ---- |
| **Orchestrator** | coordinator | Fetches the ticket, sets up an isolated worktree, drives Planning → Execution → Evaluation, delivers, cleans up. Never writes code. Holds only IDs/paths/counters in `workflow-state.md`. |
| **Executor** | builder (warm) | Implements the planned change, runs the configured verification gates, commits. Bound to the Iron Laws and the project's canonical docs. |
| **Evaluator** | reviewer (warm) | Three-phase review (spec / code / UI). Re-runs gates independently. Files specific, actionable change requests. Owns the *mechanical* checklist. |
| **Skeptic** | adversary (cold) | Spawned fresh at two gates — design-soundness (post-planning) and final (post-evaluator-PASS). Tries to *refute*. Owns subjective design judgment and the final sign-off. |

Every loop is bounded by a circuit breaker with a defined escalation — nothing thrashes forever, nothing fails silently. That property ("fails loudly into a known escalation state") is what makes it safe to run a *fleet* of orchestrators unattended.

## Architecture

```
concertino/
├── core/                     # harness- & project-neutral source of truth
│   ├── laws/                 #   the Iron Laws (evidence-gated behavioral rules)
│   ├── roles/                #   the 4 agent role specs as templates ({{placeholders}})
│   ├── scripts/              #   idempotent procedure scripts (READY/FAIL contract)
│   ├── design/architecture.md
│   └── workflow-state.template.md
├── config/
│   ├── concertino.schema.json     # the per-project config schema
│   └── examples/{helio,generic}.json
├── adapters/
│   ├── claude-code/          # frontmatter + plugin manifest templates (full fidelity)
│   └── codex/                # AGENTS.md skeleton + agent TOML templates (degraded)
├── bin/concertino            # the sync CLI (Node, zero deps)
└── docs/
```

**Single source, no drift.** Role bodies live once in `core/roles/`. The `concertino` CLI renders them — substituting your project config (gates, providers, canonical docs, budgets) — into each harness's native layout. Edit core or config, re-run `concertino sync`, both harnesses update.

## Quick start

Install once (or use `npx concertino` with no install):

```bash
npm install -g concertino     # then `concertino ...`
# or, no install:  npx concertino <command>
```

In your project repo:

```bash
# 1. Interactive setup: writes concertino.config.json, copies scripts + laws,
#    and scaffolds the spec provider (openspec init, or a spec/ dir).
concertino init

# 2. Render the harness files from core + your config (re-run after every edit)
concertino sync
```

Then in Claude Code: `/concertino-deliver <TICKET_ID>`.

Prefer a starting profile over the prompts? `concertino init --example=helio` (or `--example=generic`, or `--yes` for defaults).

See [`docs/quickstart.md`](docs/quickstart.md) to get running, [`docs/config-reference.md`](docs/config-reference.md) for every config field, [`docs/adapting-to-your-project.md`](docs/adapting-to-your-project.md) for the full walkthrough, and [`docs/harness-capabilities.md`](docs/harness-capabilities.md) for what differs between Claude Code and Codex.

## Acknowledgements / Prior Art

The **laws** are **inspired by [obra/superpowers](https://github.com/obra/superpowers)** — a coding-agent methodology built around composable skills and hard behavioral gates ("Iron Laws"). Superpowers is the source of the core insight: that evidence-gated refusals, re-read just-in-time, make an agent self-correcting with the human out of the loop.

| Concertino law / gate | Inspired by superpowers skill |
| --------------------- | ----------------------------- |
| `systematic-debugging` | `systematic-debugging` |
| `verification-before-completion` | `verification-before-completion` |
| Skeptic design-soundness gate | `brainstorming` + spec self-review |
| Executor test discipline | `test-driven-development` |
| Worktree procedure scripts | `using-git-worktrees` |
| Evaluator / Skeptic two-stage review | `requesting-code-review` / `subagent-driven-development` |

**What is original here:** the *orchestration* — the worktree-per-ticket fleet model, the executor/evaluator/skeptic topology, the escalation taxonomy and circuit-breaker budgets, the cold-vs-warm reviewer split, and the harness-agnostic render layer. Superpowers provides laws and skills; it has no orchestrator. The laws were rewritten from scratch — there is **no runtime dependency** on superpowers; credit travels with the code.

## License

MIT — see [LICENSE](LICENSE).
