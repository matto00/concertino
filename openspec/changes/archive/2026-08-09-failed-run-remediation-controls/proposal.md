## Why

A FAILED run in the fleet dashboard gets the exact same generic action set as every other row (attach, drill-down, view ticket, move, jump). There is no way to launch a remediation flow against a failed run, and no way to tell concertino "I looked into this myself and it's fine" — an operator either fixes things entirely by hand outside the TUI, or the run just sits in FAILED until it ages out.

Escalated design decisions (raised during Planning, answered by the ticket owner) settle the shape of this change:

1. `a`/`d` bind directly at the fleet screen's top level, conditioned on the
   selected row's status (`runs[selected].status === 'failed'`) — **not** a
   new FAILED-local focus mode. Design-gate review (skeptic round 1) found
   the original premise ("`a`/`d` are already claimed at the top level")
   factually false against the actual code: `d` is unbound anywhere in
   `lib/ui/screens/fleet/keys.js`, and `a` is bound only inside
   `focus === 'quickstart'`, not unconditionally. FAILED rows, unlike
   QUEUED/QUICK START, already live in the ordinary flat `runs`/`selected`
   index space — so `a`/`d` can follow the exact same pattern `t` (view-ticket)
   and `l` (drilldown) already use today: an ordinary top-level binding
   conditioned on `runs[selected]`, no new focus mode, no new local cursor.
2. `/concertino-address-failure` gets write access to the worktree/branch and reuses the existing executor/evaluator/skeptic loop to actually fix and re-deliver — not a read-only audit, and not a new lighter-weight role.
3. `a` opens a new tmux window in the run's existing worktree; its outcome updates the *existing* dashboard row (same ticket, same event log) rather than creating a new one.
4. `d` needs a `y`-confirm gate, consistent with every other state-changing dashboard action (force-start, clear-queue, kill, restart, quit-with-pending).
5. `d` is dashboard-only bookkeeping — it does not drive a ticket-provider status write-back (CON-90's local-provider commit path is out of scope here).
6. Scope for this ticket is FAILED-only. RUNNING/DONE/NEEDS YOU are audited (see design.md) but get no new actions in this change.
7. The longer-horizon "design ticket type" idea is filed as its own standalone follow-up (CON-100), not decided here.

## What Changes

- Bind `a` at the fleet screen's top level, active whenever `runs[selected].status === 'failed'`, to open a new tmux window in the failed run's existing worktree, invoking a new `/concertino-address-failure` skill/command against that ticket — mirroring how `t`/`l` already bind conditioned on `runs[selected]`, no new focus mode.
- Bind `d` the same way, to mark the run DONE on the dashboard, gated behind a `y` confirmation (a new `markDoneConfirm` gate, structurally mirroring `forceStartConfirm`/`clearQueueConfirm` — including its own on-screen confirm banner) — a manual, sticky bucket override that does not rewrite or reinterpret the run's actual `run.end`/telemetry history.
- Add the new `/concertino-address-failure` command (claude-code adapter, mirroring `/concertino-deliver`'s shape): audits the failed run's evidence/timeline/gates, then resumes/re-drives the existing Execution → Evaluation → final-gate → Delivery → Cleanup loop against the same ticket and worktree (re-creating the worktree via `setup-worktree.sh` first if it no longer exists), with write access to actually fix and re-deliver.
- Add a new reducer precedence branch: a manually-overridden run (a new `run.override` event, written in-process by the dashboard, mirroring `session.js`'s existing `run.spawn` in-process write) reports `status: 'done'` regardless of `endStatus`/window state, once written.
- Advertise both new keys in the FAILED section's footer hint, following `sections.js`'s existing "only advertise a key that currently does something" discipline (shown only when a FAILED section is actually rendered this frame — see design.md).
- Document the `a`/`d` keys and `/concertino-address-failure` in `docs/dashboard.md` (no focus mode to document — see design.md's Decision 1).
- Audit NEEDS YOU / RUNNING / DONE per decision 6: documented in design.md as reviewed, with no new actions added in this change.

## Capabilities

### New Capabilities
- `fleet-failed-remediation`: the `a`/`d` key bindings (top-level, conditioned on `runs[selected].status === 'failed'`), the `y`-confirm gate on `d` and its on-screen banner, and the footer-hint advertising discipline for this new control set.
- `address-failure-skill`: the new `/concertino-address-failure` command — its audit step, its write-access re-drive of the executor/evaluator/skeptic/delivery loop against the existing ticket/worktree, and how its outcome updates the existing dashboard row.

### Modified Capabilities
- (none — the manual-override reducer precedence is new behavior gated behind a new event kind that no existing spec documents; it is covered as part of `fleet-failed-remediation` rather than as a delta to an existing capability spec)

## Impact

- `lib/ui/screens/fleet/keys.js` — new top-level `a`/`d` bindings, conditioned on `runs[selected].status === 'failed'`, mirroring the existing `t` binding.
- `lib/ui/screens/fleet/sections.js` — FAILED section footer hint (`a`/`d` advertised only when applicable), and a new `markDoneConfirm` branch in `buildHeadTail`.
- `lib/ui/reducer.js` — new `run.override` event handling and a new `deriveStatus` precedence branch, plus the retry-visibility refinement.
- `lib/ui/session.js` (or a sibling module) — a `writeOverrideEvent`-style in-process event write, and the new-tmux-window spawn for `a`, mirroring `writeSpawnEvent`.
- `lib/ui/controllers/fleet.js` — new action handlers (`address-failure`, `open-mark-done-confirm`, `confirm-mark-done`, `cancel-mark-done`), following the existing `open-force-start-confirm`/`confirm-force-start` shape.
- `lib/ui/screens/fleet/render.js` and `lib/ui/watch.js` — thread `state.markDoneConfirm` through as a render opt, mirroring `state.forceStartConfirm`.
- `adapters/claude-code/` — a new `concertino-address-failure` command file, and its sync-time wiring alongside the existing `concertino-deliver` command.
- `docs/dashboard.md` — new key-table rows and a new subsection documenting `a`/`d` and `/concertino-address-failure`.
