## Why

The fleet view (`lib/ui/screens/fleet.js`) has two related navigation gaps.
First, there is no way to jump directly to a section — `j`/`k` walk the
combined selectable list one row at a time, and an operator with a long
FAILED or DONE section has no lazygit-style `[1]`/`[2]`/`[3]` shortcut to get
there. Second, the QUEUED section (added by CON-28, scrollable as of CON-6)
shows only a ticket's queue position and id — not the speed or agent-merge
setting the batch was launched with, both per-run properties as of
CON-22/CON-24 — so an operator scanning a long queue cannot tell what is
about to run under what settings, and has no way to force a specific queued
ticket to start now if it is urgent, short of waiting out `maxConcurrent`.

## What Changes

- Bind digit keys `1`-`N` to jump the selection to the first selectable row
  of the Nth *currently rendered* section, in on-screen order (NEEDS YOU,
  RUNNING, FAILED, DONE — QUEUED is excluded, since it is unselectable).
  Numbering is positional over what is actually visible this frame, not a
  fixed NEEDS YOU=1/RUNNING=2/... scheme, so a key's meaning never silently
  shifts based on which sections are empty. `j`/`k` continue to move by one
  row, unaffected.
- QUEUED rows show the batch's speed (`fast`/default/`slow`) and agent-merge
  setting (on/off) alongside the existing position/ticket-id/title, parsed
  once from `queueState.launchCommand` (the batch-level command string
  `withSpeedFlag`/`withAgentMergeFlag` already write these into) rather than
  duplicated per ticket — both settings are per-batch, not per-ticket.
- Add a force-start action reachable from the QUEUED section: select a
  pending ticket, invoke force-start, confirm an explicit warning that names
  how many tickets will now run concurrently against the configured
  `maxConcurrent`, and the ticket launches immediately via `submitTicket`
  outside `queue.tick()`'s normal admission loop. The queue's own
  `pending`/`inFlight` bookkeeping (in-memory and the persisted
  `.concertino/cache/queue.json`) is updated the same way a normal
  `tick()`-driven launch would update it, so `tick()`'s next regular pass
  neither double-admits the ticket nor miscounts the now-exceeded
  concurrency slot, and a dashboard restart reconciles the force-started
  ticket as an ordinary in-flight one.

## Capabilities

### New Capabilities
- `fleet-section-jump`: digit-key (`1`-`N`) navigation that jumps the fleet
  view's selection to the first row of the Nth visible selectable section,
  positional over on-screen order.
- `fleet-queue-force-start`: an operator action, reachable from the QUEUED
  section, that starts a specific pending ticket immediately, bypassing
  `queue.tick()`'s `maxConcurrent` admission gate, gated on an explicit
  confirmation and correctly updating both in-memory and persisted queue
  state.

### Modified Capabilities
- `fleet-queue-visibility`: queued rows gain a speed/agent-merge display
  parsed from the queue's `launchCommand`, in addition to their existing
  position/ticket-id/title content.

## Impact

- `lib/ui/screens/fleet.js`: `handleKey` gains digit-key handling and a
  force-start key/confirmation flow; `buildSections`/`renderQueuedRow`
  change to expose section boundaries for jump targeting and to render the
  speed/agent-merge fields.
- `lib/ui/queue.js`: gains a `forceStart` (or equivalently named) function
  that performs the bypass admission + bookkeeping update `tick()` itself
  does not perform.
- `lib/ui/watch.js`: wires the new `jump-section`/`force-start` actions from
  `handleKey` into state changes (selection/scrollOffset for jump;
  queue mutation + `submitTicket` call for force-start), and persists the
  updated queue via the existing `queue-cache.js` write path.
- `lib/ui/queue-cache.js`: no shape change expected — force-start produces
  an ordinary `inFlight` entry, not a new state.
- No changes to `lib/ui/reducer.js` or any backend/API surface.
