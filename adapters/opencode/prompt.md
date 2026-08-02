---
# concertino:sync — rendered as `.opencode/commands/concertino-deliver.md`.
# Research notes on OpenCode's native file shapes (tasks.md 4.1) live in
# bin/concertino's own comment above emitOpencode(), not here — this comment
# must stay inside the frontmatter block (YAML `#` syntax), never before the
# opening `---`, or OpenCode's frontmatter parser breaks on the whole file.
description: Drive the {{project}} ticket-delivery workflow end-to-end for a ticket (Concertino orchestrator).
agent: concertino-orchestrator
---

Run the Concertino ticket-delivery workflow for the ticket id in `$ARGUMENTS`
(e.g. `{{idExample}}`), optionally followed by a trailing `--agent-merge` or
`--no-agent-merge` flag, independently followed by a trailing `fast` or `slow`
speed token — extract the ticket id and, if present, the flag and/or the speed
token, the same way `core/roles/orchestrator.md`'s Input section describes.
If no agent-merge flag is present, the override is "unset" — fall back to the
project's `agentMerge.enabled` config default. If no speed token is present,
`SPEED` is "unset" — resolves to `default`.

You are already the `concertino-orchestrator` agent for this session — carry
out the Orchestrator role directly, in this turn: Setup → Planning →
Execution/Evaluation loop → Delivery → Post-merge cleanup, switching into the
Executor / Evaluator / Skeptic / Auditor roles as `.opencode/agents/concertino-*.md`
and `core/roles/orchestrator.md` direct (or dispatching them via the Task tool,
where you choose to use that optional path — see `.opencode/agents/concertino-orchestrator.md`
for the turn-boundary rule that applies either way). Surface any `ESCALATION`,
`BLOCKER`, or final PR presentation to the human as you reach it, and continue
once you have their answer — this session persists, so waiting for a human
reply costs nothing.

Respect the circuit-breaker budgets in the Orchestrator spec; when a budget is
exhausted, stop and ask the human. Persist `workflow-state.md` after every
phase so a fresh session can resume — on restart, read it first and continue
from the recorded phase rather than starting over.
