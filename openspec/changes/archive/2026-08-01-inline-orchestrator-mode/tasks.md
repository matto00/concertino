## 1. Claude Code adapter — `--inline` parsing and branch

- [x] 1.1 Update `adapters/claude-code/command.md`'s Arguments section to document `--inline` as a third independent trailing token, alongside `--agent-merge`/`--no-agent-merge` and `fast`/`slow`.
- [x] 1.2 Add the inline-mode branch to the "What to do" section: when `--inline` is present, the calling session reads `.claude/agents/concertino-orchestrator.md` directly and carries out the Orchestrator role itself (Setup → Planning → Execution/Evaluation → Delivery → Cleanup), spawning executor/evaluator/skeptic/auditor sub-agents directly.
- [x] 1.3 Add the explicit tool-scope guardrail text to the inline-mode branch, naming the orchestrator role's allowed tool list (`Read, Write, Edit, Bash, Grep, Glob, Agent, SendMessage, TaskCreate, TaskUpdate, TaskGet, TaskList`, plus configured ticket-provider MCP tools) and instructing the session to use only those tools even though its own broader tool set remains available.
- [x] 1.4 Update the "When the orchestrator returns" section to note that in inline mode there is no separate subagent to relay to/from — the session surfaces `ESCALATION`/`BLOCKER`/pause-for-"merged" directly and continues in its own turn.
- [x] 1.5 Preserve the default (`--inline` absent) branch text unchanged, so a diff against the current file shows only additions for the new branch, not edits to the existing default path.

## 2. Codex adapter — documented no-op

- [x] 2.1 Update `adapters/codex/prompt.md` to document that `--inline` is accepted but has no effect under Codex, with a one-line reason (Codex orchestration is already sequential/inline in a single thread, no subagent-spawn primitive to skip).

## 3. Sync and verify rendered output

- [x] 3.1 Run `concertino sync` (or the project's existing sync entry point) to re-render `.claude/commands/concertino-deliver.md` and `.codex/prompts/concertino-deliver.md` from the updated adapter templates.
- [x] 3.2 Diff the rendered `.claude/commands/concertino-deliver.md` against its pre-change version to confirm the default (`--inline` absent) path is byte-for-byte unchanged apart from the new flag's documentation/branch being added.
- [x] 3.3 Manually trace through the rendered inline-mode instructions against each new requirement in `specs/inline-orchestrator-mode/spec.md` (parsing, subagent-spawn skip, direct escalation handling, tool-scope guardrail, Codex no-op) and confirm each scenario is satisfied by the rendered text.

## 4. Documentation cross-check

- [x] 4.1 Check `docs/harness-capabilities.md` and any other doc that describes `/concertino-deliver`'s existing flags for a place that should mention `--inline`; update if such a place exists, skip if none does.
