# CON-134: Orchestrator deadlocks waiting for a sub-agent message that cannot arrive

## Description

Orchestrators repeatedly end their turn holding for a sub-agent's report,
reasoning explicitly that they are "waiting" for an inbound message. No such
message can arrive: sub-agent roles (executor, evaluator, skeptic, auditor)
have no `SendMessage` tool — `adapters/claude-code/agents.json` grants it to
`orchestrator` only, deliberately (see CON-127). A sub-agent's result is
delivered as its **return value**, not as an inbound message.

This is not a general failure of the spawn/resume mechanism — most runs
complete with zero nudges, the return path works reliably. The defect is
that the orchestrator sometimes waits for a second, message-shaped delivery
of a result it has already been handed (or is about to be, synchronously, as
the tool call's own return).

## Acceptance Criteria

- [ ] `core/roles/orchestrator.md` states explicitly that sub-agents have no
      `SendMessage` and cannot send an inbound message, and that their result
      arrives as a return value.
- [ ] The role doc's phase steps instruct consuming the return value and
      falling back to artifact inspection — never to holding for a message
      from a sub-agent.
- [ ] A run in which a sub-agent completes without the orchestrator holding
      its result ends with the orchestrator inspecting the worktree and
      reporting, not with a silent stop.
- [ ] The guidance is harness-portable: Codex/OpenCode already degrade to a
      sequential single thread (`lib/cli/render.js:194`) and must not be made
      worse, and must not reference `SendMessage` in contexts where it does
      not exist.
- [ ] Verified against the real rendered `.claude/agents/concertino-orchestrator.md`,
      not only the `core/` source.

## Scope boundary

Claude Code only. Do not build cross-harness parity machinery (deferred to
CON-135). Do not grant sub-agents SendMessage (CON-127, complementary,
ships separately). Edits to `core/roles/*.md` render into all adapters, so
guidance must remain adapter-safe (no `SendMessage` references leaking into
harnesses that lack it).
