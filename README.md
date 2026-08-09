# 🎼 Concertino

**A harness-agnostic, evidence-gated agent orchestra for autonomous ticket delivery.**

A *concertino* is the small group of soloists that leads a concerto grosso, set against the full ensemble. Here it's the five agents that drive a ticket from spec to merged PR — an **orchestrator** conducting an **executor**, an **evaluator**, a cold adversarial **skeptic**, and (opt-in, via **agent-merge**) a cold **auditor** that can verify a finished delivery and merge it itself — bound by hard, re-read-just-in-time behavioral laws so the loop stays diligent and self-correcting with the human out of it.

Concertino runs on **Claude Code** (full fidelity: native sub-agents, warm resume), **OpenAI Codex CLI**, and **OpenCode** (both a documented, degraded sequential flow). One neutral core, three harness adapters, one per-project config. Any role on any harness can optionally be routed through a locally-hosted **Ollama** model instead of a hosted one — see `providers.ollama` in [`docs/config-reference.md`](docs/config-reference.md).

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
| **Orchestrator** | coordinator | Fetches the ticket, sets up an isolated worktree, drives Planning → Execution → Evaluation, delivers, cleans up — including fast-forwarding local `main` after the merge, escalating rather than touching it if that isn't safe. Never writes code. Holds only IDs/paths/counters in `workflow-state.md`. |
| **Executor** | builder (warm) | Implements the planned change, runs the configured verification gates, commits. Bound to the Iron Laws and the project's canonical docs. |
| **Evaluator** | reviewer (warm) | Three-phase review (spec / code / UI). Re-runs gates independently. Files specific, actionable change requests. Owns the *mechanical* checklist. |
| **Skeptic** | adversary (cold) | Spawned fresh at two gates — design-soundness (post-planning) and final (post-evaluator-PASS). Tries to *refute*. Owns subjective design judgment and the final sign-off. |
| **Auditor** | agent-merge (cold, opt-in) | Spawned fresh, once, after PR creation — only when agent-merge is enabled for the run. Verifies CI is green, the PR is mergeable, this run's own evaluator/skeptic gates passed, and the diff satisfies the ticket's acceptance criteria, then merges or escalates with the specific reason. |

Every loop is bounded by a circuit breaker with a defined escalation — nothing thrashes forever, nothing fails silently. That property ("fails loudly into a known escalation state") is what makes it safe to run a *fleet* of orchestrators unattended.

**Agent-merge** is the opt-in toggle (`agentMerge.enabled` in config, overridable per-run with `--agent-merge`/`--no-agent-merge`) that replaces the fourth checkpoint — a human confirming "merged" — with the auditor's cold verification. Disabled by default: existing projects and runs are byte-for-byte unchanged until a project (or a single run) opts in. Under Claude Code, this config key alone does not authorize a merge — see [`docs/config-reference.md`'s `agentMerge` section](docs/config-reference.md#agentmerge) for the harness-level permission grant it also requires.

## Architecture

```
concertino/
├── core/                     # harness- & project-neutral source of truth
│   ├── laws/                 #   the Iron Laws (evidence-gated behavioral rules)
│   ├── roles/                #   the 5 agent role specs as templates ({{placeholders}})
│   ├── scripts/              #   idempotent procedure scripts (READY/FAIL contract)
│   ├── design/architecture.md
│   └── workflow-state.template.md
├── config/
│   ├── concertino.schema.json     # the per-project config schema
│   └── examples/{helio,generic,opencode-ollama}.json
├── adapters/
│   ├── claude-code/          # frontmatter + plugin manifest templates (full fidelity)
│   ├── codex/                # AGENTS.md skeleton + agent TOML templates (degraded)
│   └── opencode/              # agent/command markdown templates (degraded)
├── bin/concertino            # the sync CLI (Node, zero deps)
└── docs/
```

**Single source, no drift.** Role bodies live once in `core/roles/`. The `concertino` CLI renders them — substituting your project config (gates, providers, canonical docs, budgets) — into each harness's native layout. Edit core or config, re-run `concertino sync`, every configured harness updates.

## Quick start

Install once (or use `npx concertino` with no install):

```bash
npm install -g concertino     # then `concertino ...`
# or, no install:  npx concertino <command>
```

In your project repo:

```bash
# Interactive setup: writes concertino.config.json, copies scripts + laws,
# auto-detects gates from package.json/Cargo.toml/go.mod/etc., and renders
# the harness agent files immediately.
concertino init
```

Then in Claude Code: `/concertino-deliver <TICKET_ID>`.

Prefer a starting profile over the prompts? `concertino init --example=helio` (or `--example=generic`, or `--example=opencode-ollama` to start from an OpenCode + local-Ollama profile, or `--yes` for non-interactive defaults with gate auto-detection).

After editing `concertino.config.json`, re-render with `concertino sync`.

## CLI reference

```
concertino            [--config=PATH] [--out=DIR]
                      Launch the live fleet dashboard. Default when no subcommand is
                      given — same as `concertino watch` below. See docs/dashboard.md.

concertino init       [--out=DIR] [--example=helio|generic] [--yes] [--core=PATH]
                      Interactive setup: config → scripts → agent files (all in one).

concertino sync       [--config=PATH] [--out=DIR] [--harness=claude-code,codex,opencode] [--core=PATH] [--dry-run]
                      Render harness files from core + config. Re-run after every edit.

concertino update     <key=value> [...] [--config=PATH] [--out=DIR] [--core=PATH] [--dry-run]
                      Update one or more config fields via dot-notation, then re-sync.
                      Example: concertino update models.claude-code.skeptic=opus budgets.executionCycles=5
                      Example: concertino update agentMerge.enabled=true agentMerge.mergeMethod=squash

concertino validate   [--config=PATH] [--out=DIR]
                      Validate concertino.config.json — structure, gate commands, model
                      aliases, devServer health URLs, canonicalDocs paths.

concertino diff       [--config=PATH] [--out=DIR] [--harness=...] [--core=PATH]
                      Show a unified diff between what sync would write and what's on disk.

concertino doctor     [--config=PATH] [--out=DIR] [--core=PATH]
                      Check the environment: node, git identity, gh auth, each selected
                      harness's CLI (claude/codex/opencode), Linear MCP, Playwright, and
                      Ollama/gateway reachability (if providers.ollama is configured).
                      Also byte-compares the rendered artifacts (scripts/concertino/,
                      .concertino/, the agent files) against core and warns on drift — a
                      stale copy stops emitting telemetry silently.

concertino watch      [--config=PATH] [--out=DIR]
                      Live fleet dashboard — every active run, its phase, gates,
                      and escalations. Needs tmux. Explicit alias for bare
                      `concertino` above. See docs/dashboard.md.

concertino prune      [--dry-run] [--config=PATH] [--out=DIR]
                      Remove event logs under .concertino/runs/ that are both terminal
                      and older than dashboard.retentionDays (default 30).

concertino upgrade    [--out=DIR]
                      Scan generated files for stale version markers; report which need
                      a re-sync.

concertino gates      [--run=NAME] [--config=PATH] [--out=DIR]
                      List all configured gates, or run one by name.

concertino eject      --role=<role> [--harness=claude-code,codex,opencode] [--config=PATH] [--out=DIR] [--core=PATH]
                      Print the fully-rendered agent file for a role to stdout.
                      Respects local overrides in .concertino/roles/. Good for debugging.
                      --harness accepts a comma-separated list, same as sync/diff; naming
                      more than one prints each harness's section in turn, preceded by a
                      "# ---- harness: <name> ----" header. The default single-harness
                      case (claude-code) is unchanged: raw rendered file, no header.

concertino migrate    [--config=PATH] [--out=DIR] [--dry-run]
                      Back-fill any config fields added in a newer version of concertino.
                      Never overwrites existing values.

concertino answer     <ticket> <value> [--sub <index> --total <n>] [--out=DIR]
                      Answer a pending escalation from outside the dashboard TUI.

concertino completion [fish|zsh|bash]
                      Print a shell completion script (defaults to fish).

concertino --version
```

See [`docs/quickstart.md`](docs/quickstart.md) to get running, [`docs/config-reference.md`](docs/config-reference.md) for every config field, [`docs/adapting-to-your-project.md`](docs/adapting-to-your-project.md) for the full walkthrough, and [`docs/harness-capabilities.md`](docs/harness-capabilities.md) for what differs between Claude Code, Codex, and OpenCode.

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
