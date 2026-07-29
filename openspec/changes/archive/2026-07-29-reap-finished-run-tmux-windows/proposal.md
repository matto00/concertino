## Why

Nothing ever removes a run's tmux window once it finishes. Dead windows
(`pane_dead=1`, held by `remain-on-exit`) pile up as visual noise the operator
has to close by hand, and live-but-finished windows are worse: each idle
Claude session holds a full process tree (harness + helio-mcp + playwright-mcp),
which is real, unreclaimed memory for zero benefit. A recent batch left five
completed, merged, Done tickets' windows sitting in the session alongside only
two genuinely live runs — all five had to be closed manually.

## What Changes

- On every `concertino watch` poll, close ("reap") the tmux window of any run
  that BOTH has emitted a terminal `run.end` event AND whose pane is already
  dead. This is the conservative policy from the ticket: it can never truncate
  live work, because it only ever acts on a window tmux itself already
  reports as finished.
- A run that never emitted `run.end` — crashed, OOM-killed, `kill -9`'d, a
  harness that exited before Phase 4 — is NEVER reaped, no matter how long its
  dead window sits there. That window is the only remaining evidence the run
  existed and failed (`lib/ui/reducer.js`'s tier-1 telemetry line), and
  destroying it would let the run fall through to `unknown` instead of
  `failed` — a direct violation of "absent data must never render as healthy
  data."
- Before killing a window, its full scrollback is captured to
  `.concertino/runs/<TICKET>/session-scrollback.txt` (`tmux capture-pane -p -S -`),
  preserving the human-facing merge instructions/escalations that are
  otherwise lost the instant the window is killed. This mirrors what is
  already done by hand during manual cleanups.
- `__concertino__` (the session's placeholder/holder window) is never
  reaped — `session.listWindows()` already filters it out of everything this
  change consumes, so no new exclusion logic is needed.
- Test-created sessions (`concertino-smoke-<pid>`) are out of scope by
  construction: they live in their own tmux session, never `concertino`'s,
  so this change's window enumeration never sees them.
- **Aggressive reaping (kill on `run.end` regardless of liveness) is explicitly
  NOT implemented in this change.** Tracing Phase 4 (`core/scripts/cleanup.sh`
  + `core/roles/orchestrator.md`) shows `run.end` is emitted near the end of
  `cleanup.sh`, but the orchestrator still sets the ticket to Done, posts a
  closing comment, and runs a hygiene check AFTER `cleanup.sh` returns — all
  inside the same still-alive tmux window. Reaping on `run.end` alone would
  risk killing that work mid-flight. Conservative-only is the correct scope
  for this ticket; a grace-period-gated aggressive mode is left as a documented
  follow-up, not built speculatively here.

## Capabilities

### New Capabilities
- `window-reaping`: defines the conservative reap policy (terminal `run.end` +
  dead pane, never on liveness alone), the pre-kill scrollback capture, and
  where reaping runs in the dashboard's poll loop.

### Modified Capabilities
(none — this does not change the requirements of any existing capability;
`event-log-retention`'s pruning of `.concertino/runs/` logs is a related but
independent mechanism this change does not alter)

## Impact

- `lib/ui/session.js`: new `captureFull(ticket)` method (`tmux capture-pane -p -S -`,
  full history) alongside the existing bounded `capture()`.
- `lib/ui/store.js`: new `scrollbackPath(root, ticket)` helper.
- New `lib/ui/reap.js`: pure `selectReapable(runs)` + impure `reapFinished(root, session, runs)`
  that captures scrollback then kills each reapable window.
- `lib/ui/watch.js`: calls `reap.reapFinished()` once per poll, right after
  `runs = reduce(...)`.
- `docs/dashboard.md`: documents the reap behavior and where scrollback lands.
- New tests: `test/reap.test.js` (pure selection + capture/kill sequencing,
  including the "no `run.end` is never reaped" guarantee), plus additions to
  `test/session.test.js` for `captureFull`.
