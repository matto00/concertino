## Context

`adapters/codex/header.md` already states the caution in full (lines 26-31). `adapters/codex/agent.toml.tmpl` is a static template rendered per-role by `concertino sync`; it has no existing comment about turn-ending discipline.

## Goals / Non-Goals

**Goals:**
- Make the sub-agent-orphaning caution discoverable from the template someone actually edits to wire up worker-dispatch, without duplicating the full explanation.

**Non-Goals:**
- Changing `header.md`'s wording, or any rendering/behavioral logic.

## Decisions

- Add one short comment line near the top of `adapters/codex/agent.toml.tmpl`, pointing at `header.md`'s existing explanation rather than restating it in full — avoids the two copies drifting out of sync.

## Risks / Trade-offs

- None — comment-only change to a template file; nothing reads or parses TOML comments.
