## Why

`core/roles/orchestrator.md`'s escalation raise procedure calls `emit-event.sh escalation --await`/`--raise-only` unconditionally, even when no `concertino watch` dashboard is attached to observe it. With no TUI, `--await` can only ever time out (burning `dashboard.escalationTimeoutMinutes`, default 8 minutes, against a screen nobody can reach) before falling back to the chat channel that was reachable the whole time; `--raise-only` writes telemetry nobody reads. This was observed live this week (CON-131's design-gate escalation): the no-TUI case is the common case for a plain `/concertino-deliver` session, not an edge case.

## What Changes

- Add a single, documented liveness signal — reusing `lib/ui/watch-lock.js`'s existing per-repo dashboard pidfile (`.concertino/cache/watch.lock`), which already tracks true PID liveness rather than heartbeat freshness — exposed to shell callers via a new `core/scripts/tui-attached.sh` script (rendered to `scripts/concertino/tui-attached.sh` by `concertino sync`, exactly like every other procedure script), exit 0 = attached, exit 1 = not attached/ambiguous.
- Gate `core/roles/orchestrator.md`'s "How to raise one" topology branches on that signal, at the one call site CON-127's design.md assumed this change would touch: when no TUI is attached, still call `--raise-only` (non-blocking — writes `escalation.raised` and performs the existing stale-`answer.json` discard) so the run's bookkeeping stays consistent with the TUI-attached path, but perform **no `--await`/`--wait-only` blocking wait** — resolve directly from the already-presented chat transcript via `concertino answer`.
- Preserve, unmodified, everything about the TUI-attached branches: `--await`'s exit-0/non-zero contract, the `TERM`/`INT` trap recording `escalation.timeout`, CON-76 dual-channel delivery, CON-46's multi-part wizard, and "a timeout is never an approval" (both branches).
- `concertino answer <ticket> <value>` remains the single authoritative write path for a chat-collected answer in both branches — the no-TUI branch does not weaken first-write-wins, it just skips the pointless dashboard-facing wait around it.

## Capabilities

### New Capabilities
- `tui-liveness-detection`: a single documented signal (`core/scripts/tui-attached.sh`, rendered to `scripts/concertino/tui-attached.sh`, backed by `lib/ui/watch-lock.js`'s PID-liveness pidfile) that answers "is a Concertino TUI attached to this run?" — safe against staleness in the dangerous direction (a dead dashboard's stale lock never reads as attached).

### Modified Capabilities
- `escalation-bubble-up`: the orchestrator's raise procedure consults TUI liveness before choosing how to resolve an escalation. With no TUI attached, the orchestrator still calls `--raise-only` (non-blocking bookkeeping — `escalation.raised` write + stale-answer discard) and presents in chat (already required today), then resolves directly via `concertino answer` with no `--await`/`--wait-only` blocking wait. With a TUI attached, behavior is unchanged from today.

## Impact

- `core/scripts/tui-attached.sh` (new script; rendered to `scripts/concertino/tui-attached.sh`)
- `core/roles/orchestrator.md` → renders to `.claude/agents/concertino-orchestrator.md` (and Codex/OpenCode equivalents — adapter-safe, no harness-specific tool names added to shared prose)
- `openspec/specs/escalation-bubble-up/spec.md` (delta)
- No change to `emit-event.sh`, `lib/ui/watch-lock.js`, `lib/ui/store.js`, or `concertino answer`'s own implementation — this change only decides *whether* they get called, never *how* they behave once called.
