## ADDED Requirements

### Requirement: Inline mode never uses the escalation bubble-up path
Because `--inline` places the orchestrator role directly in the top-level session (no subagent hop, per the existing "Escalations and pauses are handled directly, without a relay hop" requirement), `adapters/claude-code/command.md`'s inline branch SHALL instruct the session to use `--await` directly for every escalation, never `--raise-only`/`ESCALATION-PENDING`, and to never write a `PENDING_ESCALATION` record to `workflow-state.md`.

#### Scenario: Inline mode presents then blocks, exactly as the escalation-bubble-up capability's inline requirement states
- **GIVEN** `--inline` is active
- **WHEN** the session needs to raise an escalation
- **THEN** it presents to its own chat transcript immediately and then calls `--await` directly, never `--raise-only`, and `workflow-state.md` never gains a `PENDING_ESCALATION` entry for this run
