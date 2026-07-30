## Why

`adapters/codex/header.md` already documents that dispatching a worker via the optional `.codex/agents/*.toml` + `spawn_agents_on_csv` path requires waiting for `report_agent_job_result` before ending your turn, or the dispatched worker is orphaned exactly like an unresumed Claude Code sub-agent (CON-15). `adapters/codex/agent.toml.tmpl` — the template someone actually wiring up that path edits — carries none of that warning itself, relying entirely on the reader having also read `header.md`.

## What Changes

- Add a short comment to `adapters/codex/agent.toml.tmpl` restating the caution inline.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — this is a comment added to a template file, not a behavioral or rendering change)

## Impact

- `adapters/codex/agent.toml.tmpl`
