# CON-39: Fleet view: lazygit-style [1]/[2]/[3] section jump, and a richer scrollable QUEUED section

## Description

Two related navigation gaps on the fleet screen (`lib/ui/screens/fleet.js`).

**1. No section-jump keys.** `handleKey` (`fleet.js:384`) binds `j`/`k` to move selection by one row at a time across the *entire* combined run list — there is no way to jump directly to a section. Confirmed nothing in the current bindings touches digit keys at all. lazygit's `[1]`/`[2]`/`[3]`-style pane jump is the requested model: press a number, land on the first row of that section, `j`/`k` still walk within/across sections as they do today.

**2. QUEUED has no detail and (per CON-6, still open) no scrolling.** CON-28 added the QUEUED section, but a queued row today shows only ticket id and position — not the speed or agent-merge setting the batch was launched with, both of which are per-run properties as of CON-22/CON-24. An operator scanning a long queue can't tell what's about to run under what settings. Scrolling within an overflowing section is CON-6's existing, still-open scope (`Fleet view cannot scroll, so selection can move onto a row that isn't rendered`) — this ticket should either subsume that work for the QUEUED section specifically or explicitly build on top of it once it lands; don't solve scrolling twice.

## Proposed change

* Bind `1`/`2`/`3` (matching on-screen section order: NEEDS YOU is pinned and always first when present, so the mapping should probably be positional over *visible* sections rather than a fixed NEEDS YOU=1/RUNNING=2/QUEUED=3/FAILED=4/DONE=5 scheme that shifts meaning depending on what's showing — worth settling this ambiguity explicitly in design rather than guessing).
* QUEUED rows show speed (`fast`/default/`slow`) and agent-merge on/off alongside the ticket id and position — both already carried on the queue entry (see CON-22/CON-24's own config threading) and just not surfaced in `fleet.js`'s QUEUED rendering.
* Land on or after CON-6, not in parallel duplicating its scroll mechanism.

## Notes

Section jump changes the fleet's selection model from "one flat index" to "index within a jump target" — check this doesn't reopen the same row-index hazard CON-28's own ticket flagged (a jump landing on the wrong underlying run). A test that jumps to a section and asserts the resolved ticket is correct is the same discipline CON-28 required for insertion.

## Added scope: manually start a queued ticket now, bypassing maxConcurrent (with a warning)

From within QUEUED (reachable via the `[2]`/whatever-position jump above), an action to force-start a specific pending ticket immediately, regardless of `queue.tick()`'s normal admission order and the `maxConcurrent` cap.

**Where this plugs in:** `queue.tick()`'s only gate on starting work is `inFlight.size < queue.maxConcurrent` (`lib/ui/queue.js:118`, `while (pending.length && inFlight.size < queue.maxConcurrent)`). A manual force-start needs a distinct path that calls `submitTicket()` directly (bypassing `tick()`'s admission loop entirely for this one ticket) while still correctly updating `inFlight`/`pending` afterward so the queue's own bookkeeping doesn't drift out of sync with reality — `tick()` must not then double-admit the same ticket on its next regular pass, and must not miscount the now-exceeded concurrency slot.

**The warning is load-bearing, not decorative.** Confirm before bypassing — this is deliberately breaking the concurrency contract the operator set, and should read as a deliberate override (e.g. "this will run N+1 concurrently, exceeding your maxConcurrent:N setting — proceed?"), not a silent action.

**Interaction with CON-29's persistence:** a force-started ticket needs to land correctly in the persisted queue file's `inFlight` (not `pending`) so a restart-restore reconciles it the same way as a normally-admitted one — don't invent a second "manually started" state that CON-29's restore logic doesn't know about.

## Related tickets

- CON-6: Fleet view cannot scroll, so selection can move onto a row that isn't rendered (still open — land on or after this)
- CON-28: Fleet view has no QUEUED section, so a queued batch is invisible
- CON-22: Delivery speeds trade rigour against turnaround, with harness-aware defaults
- CON-24: Agent-merge: let a verified run merge its own PR
- CON-29: Queued batch tail is lost if the dashboard restarts
