# CON-41: Launch pad: show IN QUEUE status per ticket, and an explicit "add to queue" action

## Description

`inlineStatus()` (`lib/ui/screens/launchpad.js:105`) is the whole of what a ticket row can say about itself right now:

```js
function inlineStatus(ticket, runs) {
  const run = (runs || []).find((r) => r.ticket === ticket.identifier);
  if (run && run.status !== 'done' && run.status !== 'failed') return '▲ running';
  if (ticket.state && ticket.state.type === 'started') return 'In Progress';
  return (ticket.state && ticket.state.name) || 'Todo';
}
```

It checks the live fleet (`runs`) for "already running," but never consults `queueState` at all. A ticket sitting in `queueState.pending` or `inFlight` (CON-28/CON-29's queue) shows its plain Linear status — "Todo" — identical to a ticket that was never touched. There is no way to tell, from the launch pad, that something is already queued.

Separately: today, queuing a ticket is only reachable through the full multi-select → launch plan → confirm flow. There's no lighter "just queue this one ticket" action for the common single-ticket case.

## Proposed change

* Extend `inlineStatus()` (or add a sibling check alongside it) to look at `queueState.pending`/`inFlight` the same way it already looks at `runs`, and render a distinct `⏳ queued` (or similar) status — must be visually distinct from `▲ running`, since they mean different things (one is spawned, one is not yet).
* Add an explicit "add to queue" key/action on the ticket pane, alongside the existing multi-select checkbox flow, for queuing a single ticket without building a full launch plan.

## Constraints

* Route through the existing `queue.createQueue`/`queue.tick` primitives — do not introduce a second queuing mechanism alongside CON-28/CON-29's.
* `isSelectable()` (`launchpad.js`, just below `inlineStatus`) already refuses to admit an already-`▲ running` ticket into a new batch, for the tmux-addressing reason documented there. The same refusal must extend to an already-*queued* ticket once that status exists, or "add to queue" on an already-queued ticket becomes a silent duplicate-queue hazard of the same shape CON-28's own design doc worried about.

## Related

Sibling of the fleet-view quick-start widget ticket — both were requested together and should likely share whichever single-ticket-queue action either introduces.

## Links

- CON-28: https://linear.app/helioapp/issue/CON-28/fleet-view-has-no-queued-section-so-a-queued-batch-is-invisible
- CON-29: https://linear.app/helioapp/issue/CON-29/queued-batch-tail-is-lost-if-the-dashboard-restarts
