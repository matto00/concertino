## Context

The authoritative design is `docs/superpowers/specs/2026-10-06-fleet-pane-design.md`; this file only restates the decisions that shape the spec.

## Decisions

- **Reuse `reduce()` through the CLI rather than re-folding in the mod.** The reducer already folds `events.jsonl` into a `Run`. The mod runs in a sandboxed ES-module environment without Node, and an installed plugin copy is not the concertino checkout, so it cannot import the reducer; shelling out to `concertino fleet --json` works wherever the driver works.
- **Liveness comes from the session's Agent calls, not the CLI.** The CLI folds with no tmux windows, so a live run is reported as `unknown` (or `needs-you` with an open escalation). The mod correlates the driver's `Agent` calls (`TICKET_ID=<T>` in the prompt) with `$.agent.list()` to decide running / external / stalled / ended; correlation is decoration, and lanes still render without it.
- **Read-only throughout.** The command never writes a file or emits an event; v1 of the pane is inspect-only.
