## Why

The launch pad's `inlineStatus()` (`lib/ui/screens/launchpad.js`) only ever checks the live fleet (`runs`) and Linear's own ticket state. It never consults `queueState`, so a ticket sitting in `queueState.pending` or `queueState.inFlight` (CON-28/CON-29's queue) shows its plain Linear status — indistinguishable from a ticket nobody has touched. Separately, queuing a single ticket today requires the full multi-select -> launch plan -> confirm flow; there is no lighter "just queue this one" action, even though CON-40 already built and documented the exact primitive (`queue.enqueueOne`) this ticket is meant to reuse.

## What Changes

- Extend `inlineStatus()` to accept the active `queueState` and, when a ticket's identifier is present in `queueState.pending` or `queueState.inFlight` (and it has no live run yet, in which case `▲ running` still wins), render a distinct `⏳ queued` status, colour-coded with `format.js`'s existing `STATUS_COLOUR.queued`.
- Extend `isSelectable()` (and its callers, `selectableIdentifiers`, `toggle-select`, `select-all`, `open-launchplan`'s re-check, and `confirm-launch`'s own "third and final refusal" re-check) to also refuse an already-queued ticket, the same way it already refuses an already-`▲ running` one — closing the duplicate-queue hazard the ticket's own constraints section calls out.
- Add a new `q` ("add to queue") key on the tickets pane: queues only the currently-highlighted ticket, routed through `queue.createQueue`/`queue.enqueueOne` exactly as `fleet.js`'s QUICK START `a` action and `watch.js`'s `quickstart-add` case already do — no second queuing mechanism.
- Update the tickets-pane hints line to advertise `q` alongside the existing `space`/`↵`/`a`/`s`/`p`/`L` hints, gated on the highlighted ticket actually being eligible (not already running or queued), the same "only hint a key that currently does something" discipline `fleet.js` already applies to its own hints.

## Capabilities

### New Capabilities

- `launchpad-queue-status`: the launch pad's per-ticket queued-status display and its single-ticket "add to queue" action.

### Modified Capabilities

(none — no existing capability spec currently governs `inlineStatus`/`isSelectable`; this behavior predates spec-driven change management for this file.)

## Impact

- `lib/ui/screens/launchpad.js`: `inlineStatus`, `isSelectable`, `selectableIdentifiers`, `ticketRow`, `handleKey`, `renderLaunchPad`'s hints line, module exports.
- `lib/ui/watch.js`: `toggle-select`/`select-all`/`open-launchplan`/`confirm-launch` call sites (pass `queueState` through to `isSelectable`), plus a new `add-to-queue` action case mirroring the existing `quickstart-add` case (creates or appends to `queueState` via `queue.createQueue`/`queue.enqueueOne`, using the ticket's identifier string, not the ticket object).
- No changes to `lib/ui/queue.js` — `enqueueOne`/`createQueue` are reused unchanged, exactly as CON-40's own header comment anticipated this ticket doing.
- No new external dependencies, no breaking API changes.
