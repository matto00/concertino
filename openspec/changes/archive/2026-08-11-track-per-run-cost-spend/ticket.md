# CON-108: Track and surface per-run cost/token spend

## Description

No `cost_usd` or token field exists anywhere in the event schema (`lib/ui/reducer.js`'s `TIER2_KINDS`/`TIER3_KINDS`, `emptyRun()`) — there is currently no way to see what a run, or the fleet as a whole, is costing without cross-referencing each harness's own external billing/usage view by hand.

## Proposed

A new tier-2 event (harness-emitted, deterministic — same tier as `run.start`/`gate.result`) carrying cost/token usage, emitted at a point each harness can reliably report it (end of run, or per-phase if the harness exposes incremental usage). Rolled into a new METRICS row (`spend today: $X · week: $Y`) alongside the existing delivered/escalations line.

## Design decisions to escalate

* **Cross-harness support is the crux of this ticket.** Claude Code's `--output-format json` includes usage; it is not yet confirmed what Codex and OpenCode expose (if anything) in a scriptable form. This needs research before a schema can be committed — may end up Claude-Code-only at first, degrading honestly (no spend shown, not a fabricated $0) for other harnesses, the same pattern the FAILED-row `a` action already uses for a claude-code-only feature.
* Per-run vs. fleet-only display — does the drill-down get a per-run cost line too, or is this METRICS-only?

## Acceptance Criteria

* At least one harness reliably reports cost/token usage into a new tier-2 event.
* METRICS shows fleet-wide spend (today/week), degrading honestly (not silently) for runs/harnesses that don't report it.
* Documented in `docs/dashboard.md` and `docs/config-reference.md` if any new config surface is needed.
