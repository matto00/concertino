# CON-38: Codex's optional worker-dispatch template doesn't carry the sub-agent-orphaning caution inline

## Description

CON-15 fixed the "orchestrator must never end its turn with a sub-agent outstanding" defect for Claude Code, and the equivalent caution for Codex was written into `adapters/codex/header.md`, which explicitly calls out the one place the same risk still applies on Codex: the optional worker-dispatch path (`.codex/agents/*.toml` + `spawn_agents_on_csv`). That file is always read alongside the per-role templates, but the template most relevant to someone actually wiring up worker-dispatch — `adapters/codex/agent.toml.tmpl` — doesn't carry any version of the warning itself.

Flagged at the time by CON-15's own final-gate skeptic (PR #8's "Risks / follow-ups"): "adapters/codex/agent.toml.tmpl ... doesn't carry the same caution that adapters/codex/header.md does. Not blocking since that path isn't the recommended/default Codex flow, but worth folding in if that path is ever adopted." Confirmed still true against the current template.

## Acceptance Criteria

- `adapters/codex/agent.toml.tmpl` carries a short comment pointing at the sub-agent-orphaning caution (wait for `report_agent_job_result` before ending your turn), rather than relying solely on the reader having also read `header.md`.
- No behavioral/rendering change — comment only.
