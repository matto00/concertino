## 1. Inline queued status

- [x] 1.1 Extend `inlineStatus(ticket, runs, queueState)` in `lib/ui/screens/launchpad.js` to return `⏳ queued` when the ticket id is in `queueState.pending` or `queueState.inFlight` and has no live run, checked after the live-run check and before the Linear-state fallback.
- [x] 1.2 Thread `queueState` into `ticketRow`'s `inlineStatus` call, and style the `⏳ queued` status with `f.STATUS_COLOUR.queued`, mirroring the existing `▲ running` -> `f.STATUS_COLOUR.running` branch.
- [x] 1.3 Thread `queueState` from `renderLaunchPad` into `ticketRow`'s call site (it is already read into `renderLaunchPad` via `opts.queueState`).

## 2. Selectability refusal

- [x] 2.1 Extend `isSelectable(ticket, runs, queueState)` to also return `false` for a ticket present in `queueState.pending` or `queueState.inFlight`.
- [x] 2.2 Extend `selectableIdentifiers(tickets, runs, queueState)` to thread the new parameter through to `isSelectable`.
- [x] 2.3 Update `lib/ui/watch.js`'s `toggle-select`, `select-all`, `open-launchplan`, and `confirm-launch` (lines ~1984-2017, the "third and final refusal" re-check at ~1995-1996) call sites to pass `queueState` (already in scope in each) through to `isSelectable`/`selectableIdentifiers`. `confirm-launch` is not optional — skipping it reopens the duplicate-queue hazard the ticket's Constraints section calls out (a ticket queued between `open-launchplan`'s snapshot and the operator's confirm keypress would otherwise still be treated as startable).

## 3. Add-to-queue action

- [x] 3.1 Bind `q` in `launchpad.js`'s `handleKey` (tickets pane only) to a new `{ type: 'add-to-queue' }` action.
- [x] 3.2 Add an `add-to-queue` case in `lib/ui/watch.js`'s action switch, mirroring the existing `quickstart-add` case: resolve `currentTicket(lp)` fresh, no-op if absent or not selectable (per section 2), extract `const id = t.identifier;` (matching `quickstart-add`'s `watch.js:1367` pattern — the ticket OBJECT is never passed to the queue primitives, only its identifier string, since `queue.js`'s `pending`/`inFlight` are identifier-string collections), then `queue.enqueueOne(queueState, id) || queueState` if a queue is active, else `queue.createQueue([id], 1, launchCommand)` plus a fresh `queueSessionId`.
- [x] 3.3 Confirm no direct `submitTicket` call is added — the existing `queue.tick()` poll-loop call site performs the actual launch, unchanged.

## 4. Hints line

- [x] 4.1 In `renderLaunchPad`'s hints construction, add a `q add to queue` hint conditioned on `currentTicket(lp)` being selectable per the same `isSelectable(currentTicket(lp), runs, queueState)` check used elsewhere.

## 5. Exports and wiring

- [x] 5.1 Update `module.exports` in `launchpad.js` if any newly-parameterized function needs re-export (signatures only change, names stay the same — verify no export list update is actually needed).
- [x] 5.2 Verify `render()`/`routeHandleKey()` already pass `state.queueState` through (they do, via the existing `Object.assign` in `render`) — no change needed there beyond confirming it.

## 6. Tests

- [x] 6.1 Unit tests for `inlineStatus` covering: pending -> queued, inFlight-no-live-run -> queued, live-run-and-inFlight -> running, absent -> unchanged behavior.
- [x] 6.2 Unit tests for `isSelectable`/`selectableIdentifiers` covering the new queued refusal, deselection still allowed.
- [x] 6.3 Test(s) for the new `add-to-queue` watch.js action: no active queue creates one (with the ticket's identifier string, not the ticket object); active queue appends via `enqueueOne`; ineligible ticket is a no-op.
- [x] 6.4 Test for the hints line's conditional `q add to queue` hint.
- [x] 6.5 Test for `confirm-launch`'s re-check: a ticket selected on the launch plan screen that becomes queued (by any path) before the confirm keypress is excluded from the `queue.createQueue()` call `confirm-launch` makes, not duplicated into a second queue entry.

## 7. Verification

- [x] 7.1 Run the project's full test suite and lint; fix any failures.
- [x] 7.2 Manually sanity-check (or via test harness) that queuing via `q` and via the full launch-plan flow both end up visible identically in `fleet.js`'s QUEUED section (CON-28/CON-29), confirming no second queuing mechanism was introduced.
