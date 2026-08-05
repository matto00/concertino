# CON-79: Codex launches never receive the delivery prompt — `/concertino-deliver` is passed as literal text, not expanded

## Description

Concertino launches Codex as:

```
codex "/concertino-deliver CON-75 --agent-merge"
```

A leading-slash prompt is a **TUI slash command** — expanded from `.codex/prompts/concertino-deliver.md` when typed into the interactive session. Passed as the initial positional prompt it appears not to be expanded: the model receives the literal string `/concertino-deliver CON-75 --agent-merge` and is left to guess what it means.

## Evidence

Full scrollback of the CON-75 window (`gpt-oss:latest` via `--oss`). The session tried to resolve the slash text as a shell command, never opened `AGENTS.md`, never opened any role file, and never ran `setup-worktree.sh`:

```
› /concertino-deliver CON-75 --agent-merge
• Explored          └ List ls -R
• Ran ./bin/concertino -h
• Ran ./bin/concertino deliver CON-75 --agent-merge     <- treated it as a CLI subcommand
• Ran ./bin/concertino help
• Explored          └ Search deliver in .
• Ran which concertino-deliver
  └ which: no concertino-deliver in (...)
• Explored          └ Read quickstart.md, List commands, Read concertino-deliver.md   <- the CLAUDE CODE one
```

It then concluded, incorrectly, that no harness was available and wrote an explanation instead of delivering the ticket. A grep of the whole scrollback for `AGENTS`, `.codex/roles`, or `setup-worktree` returns nothing.

Decisive detail: the one file it did read was `.claude/commands/concertino-deliver.md` — Claude Code's copy, found by grepping for "deliver". Had `.codex/prompts/concertino-deliver.md` been expanded into the conversation, the instructions (read the role file, run `setup-worktree.sh` first, persist `workflow-state.md`) would have been in context from turn one and there would have been nothing to search for.

Both local Codex attempts this session (CON-59, CON-75) failed this way, and neither produced a `.concertino/runs/<TICKET>/` directory — which is also why neither appeared on the dashboard (CON-77).

## Confirmatory test before fixing

This is strong circumstantial evidence, not proof — a weak model ignoring instructions it *did* receive would look similar. Distinguish with:

```bash
codex exec --oss --local-provider ollama -m gpt-oss:latest "/concertino-deliver CON-1"
```

If the reasoning references the prompt's own wording (e.g. "sequentially in a single thread", `setup-worktree.sh`), it was expanded and this is a model-capability problem instead. If it flails as above, it was not.

## Likely fix

Stop relying on slash expansion for the non-interactive launch. Options, roughly in order of preference:

1. Pass the prompt's *content* rather than its name — read `.codex/prompts/concertino-deliver.md` at spawn time and substitute the ticket, so the instructions are unconditionally in the first message. Costs ~900 tokens, needs no TUI feature, and works on every model.
2. Keep the slash form only where it is known to expand (a genuinely interactive session the human drives).
3. If Codex supports expansion via a flag for the initial prompt, use that explicitly.

This is the same class of bug as the OpenCode positional-argument fix: the launch template assumed a CLI contract that does not hold. `LAUNCH_TEMPLATES` in `lib/ui/harness.js` is the single place to change.

## Acceptance criteria

* A Codex launch receives the delivery instructions in its first message, verified from a real run's scrollback (it should run `setup-worktree.sh` before anything else).
* A run reaches `run.start` and appears on the dashboard.
* Covered by a test that pins whatever the launch string becomes, so this cannot silently regress again.
* Re-check the same assumption for OpenCode's `--prompt "/concertino-deliver …"`, which may have the identical problem.
