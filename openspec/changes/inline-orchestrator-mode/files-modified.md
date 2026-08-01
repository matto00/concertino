# Files modified — CON-49 inline-orchestrator-mode

- `adapters/claude-code/command.md` — added `--inline` as a third independent trailing token (Arguments section); added the inline-mode branch to "What to do" (reads `.claude/agents/concertino-orchestrator.md` directly instead of spawning a `concertino-orchestrator` subagent, drives the workflow itself, spawns executor/evaluator/skeptic/auditor sub-agents directly); added the human-approved tool-scope guardrail text naming the orchestrator role's allowed tool list; added the inline-mode branch to "When the orchestrator returns" noting there is no separate subagent to relay to/from. Default (`--inline` absent) branch text preserved unchanged.
- `adapters/codex/prompt.md` — documented `--inline` as an accepted, no-op flag under Codex, with the one-line reason (Codex's orchestration is already sequential/inline in a single thread with no subagent-spawn primitive to skip).
- `docs/harness-capabilities.md` — added a note under the Claude Code (full fidelity) section describing what `--inline` collapses in the topology, plus a one-line note under the Codex (degraded) section that `--inline` is accepted there but is a no-op.
- `openspec/changes/inline-orchestrator-mode/tasks.md` — checked off all completed tasks (1.1–4.1).

## Rendered/generated files (not hand-edited; produced by `concertino sync` from the templates above, gitignored in this repo)

- `.claude/commands/concertino-deliver.md` — re-rendered from `adapters/claude-code/command.md`. Verified (task 3.2) that the default (`--inline` absent) path is unchanged apart from the new flag's documentation/branch by diffing against a stash-based pre-change render.
- `.codex/prompts/concertino-deliver.md` / `AGENTS.md` — this project's own `concertino.config.json` only enables the `claude-code` harness, so these are not rendered in this worktree by default. Verified the Codex render separately with `node bin/concertino sync --config=config/examples/helio.json --out=<scratch>` (which enables `codex`) — the `--inline` no-op note renders correctly into `.codex/prompts/concertino-deliver.md`.

## Notes

- `scripts/concertino/cleanup.sh` showed as modified by `concertino sync` (pre-existing drift between `core/scripts/cleanup.sh` and the committed `scripts/concertino/cleanup.sh`, already present in the base branch, unrelated to this ticket) — reverted with `git checkout -- scripts/concertino/cleanup.sh` to keep this change scoped to CON-49. Flagging as a spinoff candidate: the base branch's `scripts/concertino/` mirror of `core/scripts/` is currently out of sync and a future `concertino sync` run (from any change) will surface the same diff.
