# CON-62: Per-ticket agent harness assignment (claude-code / codex, extensible to future harnesses)

## Description

Harness selection today is project-wide, not per-ticket: `concertino.config.json`'s `harnesses` array drives a static `CONCERTINO_HARNESS` default written into `.concertino.env` by `sync`, and `setup-worktree.sh` can override that at runtime via harness-set env vars (`CLAUDECODE` -> claude-code, `CODEX_SANDBOX`/`CODEX_SANDBOX_NETWORK_DISABLED` -> codex). There is no way to say 'run ticket X on Codex and ticket Y on Claude Code' within the same project — every run resolves to whichever single harness the project is configured for (or `unknown` if ambiguous).

This ticket adds a per-ticket override: a ticket can declare which harness should execute it, and the delivery workflow honors that choice instead of falling through to the project-level default. Only the two currently-implemented adapters (`claude-code`, `codex`) are in scope for actual dispatch. A 'local llm' harness was named in the original ask, but no local-model adapter exists anywhere in the codebase today (it appears only as aspirational language in design docs) — building that adapter is a separate, much larger effort and is explicitly out of scope here. This ticket should, however, make the harness field an open enum / clearly extensible so a future local-llm adapter slots in without another schema change, and it must fail loudly (not silently) if a ticket names a harness with no corresponding adapter.

## Acceptance Criteria

* Ticket metadata (via the configured `ticketProvider`, e.g. a Linear label/custom field) supports an optional harness override, read alongside existing ticket fields.
* When a ticket specifies a supported harness (`claude-code` or `codex`), the orchestrator/dispatch flow uses that harness for the run, taking precedence over the project's `harnesses` config default and over runtime env-based detection.
* When a ticket does not specify a harness, current behavior is unchanged: project-level `harnesses` config plus runtime detection resolves it exactly as it does today (no regression for existing single- or multi-harness projects).
* If a ticket specifies a harness with no implemented adapter (e.g. `local-llm`), the workflow errors clearly and early (at validation or dispatch time, before worktree setup begins) with a message naming the unsupported harness — it must not fail silently or mid-run.
* `concertino validate` surfaces per-ticket harness overrides it finds and validates each against the set of implemented adapters.
* `docs/config-reference.md` and `docs/harness-capabilities.md` are updated to document the per-ticket override field, its precedence over the project default, and the current list of implemented harnesses.
* Explicitly out of scope: implementing a local-llm (or any new) harness adapter itself — that is tracked as a separate follow-up ticket.
