## Why

Matt drives batches of tickets from a Claude Code session (the `concertino-fleet-driver` skill) instead of tmux windows spawned by the watch TUI. The TUI cannot see those lanes' liveness and lives in a separate terminal, so it goes unused. A fleet view needs a read-only snapshot of every run that does not depend on tmux, and that a Claude Code session can consume.

## What Changes

- **New `concertino fleet` subcommand** — a read-only snapshot of every run under the main checkout, folded by the dashboard reducer with no tmux window data. Default output is one line per run; `--json` prints `{ generatedAt, root, runs[] }`; `--all` includes done runs.
- **A Claude Code mod shipped from the repo root plugin** — a docked Fleet pane that polls `concertino fleet --json` and shows each lane's phase, cycle, gates, agent liveness and pending escalation. Delivered in a second PR; this change's first PR carries the CLI, its spec and docs.

## Capabilities

### New Capabilities
- `fleet-snapshot-cli`: a read-only `concertino fleet [--json] [--all] [--out=DIR]` command that prints every run folded by the dashboard reducer, with ticket excerpt, pending-answer state and a bounded timeline, and writes nothing except the ticket-detail cache `.concertino/cache/fleet-tickets.json` when `--tickets` is given, and emits no event.

### Modified Capabilities
<!-- None. No existing capability's requirements change. -->

## Impact

- `lib/cli/fleet.js` (new), `bin/concertino` (dispatch), `lib/cli/help.js` (usage).
- Second PR: `hooks/`, `types/`, `.claude-plugin/plugin.json`, `package.json` (`files`).
- `docs/dashboard.md` gains a "Fleet pane (Claude Code)" section.
