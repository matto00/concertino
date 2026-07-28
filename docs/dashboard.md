# The dashboard — `concertino watch`

A terminal fleet view for watching orchestrator runs at a high level.

```bash
concertino watch
```

Requires **tmux**. Runs live in a tmux session (one window per ticket), so they
survive the dashboard crashing, an ssh drop, or a closed laptop.

## Keys

| Key | Action |
| --- | --- |
| `↵` | Attach to the selected run. `Ctrl-b d` detaches back to the dashboard |
| `j` / `k` | Move the selection |
| `q` | Quit the dashboard (runs keep going) |

## What it knows, and how much to trust it

Three tiers of telemetry, and the dashboard degrades down them rather than
pretending:

| Shown | Means |
| --- | --- |
| Phase, cycle, gates, verdicts | Fully instrumented — the agent is emitting events |
| `phase unknown`, gates present | Only the procedure scripts are reporting |
| `no telemetry · idle 11m` | Nothing but the tmux process itself |

A run you cannot see into looks conspicuously uninstrumented, never healthy.

## Configuration

```json
"dashboard": {
  "tmuxSession": "concertino",
  "maxConcurrent": 2,
  "escalationTimeoutMinutes": 60,
  "launchPad": { "enabled": false }
}
```

`dashboard` is distinct from `ui`, which describes whether the *project under
test* has a user interface and how the evaluator reviews it.

## Where the data lives

```
.concertino/runs/<TICKET>/
  events.jsonl    append-only event log — survives cleanup
  answer.json     written by the dashboard to answer an escalation
```

The log lives in the main checkout, not the worktree, so a run's history
survives `cleanup.sh --phase4` removing the worktree. Tail it directly:

```bash
tail -f .concertino/runs/HEL-334/events.jsonl | jq .
```
