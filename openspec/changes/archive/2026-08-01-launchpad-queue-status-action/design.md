## Context

`lib/ui/screens/launchpad.js`'s `inlineStatus(ticket, runs)` and `isSelectable(ticket, runs)` are pure functions consulted from several places: `ticketRow` (rendering), `handleKey`'s `toggle-select`/`select-all` (via `watch.js`'s action handlers), and `open-launchplan`'s re-check. None of them currently see `queueState`. CON-40 (fleet-view QUICK START) already built and exercised the shared queuing primitives (`queue.createQueue`, `queue.enqueueOne`) this ticket needs — its own header comment on `enqueueOne` explicitly anticipates this ticket reusing it. `format.js` already carries a `queued: dim` entry in `STATUS_COLOUR`, unused until now.

## Goals / Non-Goals

**Goals:**
- Make `queueState.pending`/`queueState.inFlight` membership visible per-ticket on the launch pad, distinct from `▲ running`.
- Add a lightweight single-ticket "add to queue" action reusing `queue.createQueue`/`queue.enqueueOne`.
- Extend the existing running-ticket selection refusal to also cover queued tickets.

**Non-Goals:**
- No new queuing mechanism, no changes to `queue.js`'s primitives themselves.
- No change to the full multi-select -> launch plan flow — this is an additional, lighter path alongside it, not a replacement.
- No change to `fleet.js`'s QUICK START widget (CON-40) beyond nothing — it already excludes queued tickets from its own list independently.

## Decisions

### Decision 1: Status precedence — running beats queued beats Linear state

`inlineStatus(ticket, runs, queueState)` checks, in order: (1) a live run in `runs` -> `▲ running`; (2) ticket id in `queueState.pending` or `queueState.inFlight` -> `⏳ queued`; (3) fall through to the existing Linear-state logic. Running is checked first because an `inFlight` ticket is, by definition, one `queue.tick()` just admitted and handed to the caller to `submitTicket` — by the time `runs` reflects it, it should read as running, not queued; checking `queueState` first would make an actively-running ticket regress to `queued` on any render that races ahead of `runs` catching up. Checking `inFlight` at all (not just `pending`) is deliberate belt-and-braces for the brief window between `tick()` returning and `submitTicket` actually being called — the ticket's own problem statement explicitly calls out both `pending` and `inFlight` as needing to stop showing a plain Linear status.

Alternative considered: only check `pending`, on the theory that `inFlight` always also has a live run. Rejected — the race window is real (poll-and-render is not transactional against `submitTicket`), and checking is free; the cost of NOT checking is a passing "Todo" flash on the one ticket that just started, this file's own north star.

### Decision 2: `q` for "add to queue"

Every other short letter meaningful to queuing (`s` sequential, `p`/`P` parallel/sort, `a` select-all, `L` launch, `C` clear queue) is already bound within the tickets pane. `q` is unbound in `launchpad.js`'s own `handleKey` and is not intercepted globally — `fleet.js` binds `q` to quit, but mode-based dispatch (`router.js`) means `launchpad.js`'s `handleKey` is the only one consulted while `mode === 'launchpad'`, so reusing the letter across screens for different actions is safe and matches this project's existing precedent (`C`/`CLEAR_QUEUE_KEY` is itself reused verbatim across `fleet.js` and `launchpad.js` for the SAME action, not a different one — this is the first case of the same letter meaning two different things on two different screens, which is acceptable because the screens are never both active at once).

Alternative considered: reuse fleet.js's QUICK START `a` binding. Rejected outright — `a` is already `select-all` here, and repurposing it would either break select-all or make `q`'s job discoverable only while multi-select is otherwise idle, which is worse than a dedicated key.

### Decision 3: `add-to-queue` action mirrors `quickstart-add` exactly

The new `watch.js` case follows the same shape as the existing `quickstart-add` case: resolve the target ticket fresh from current state (not a stale cached list), no-op if it doesn't resolve or isn't currently selectable (covers both "already running" and "already queued" — Decision 1's same refusal, re-checked at the actual mutation site exactly as `open-launchplan` already re-checks). As with `quickstart-add` (`watch.js:1367`, `const ticket = t.identifier;`), the value handed to the queue primitives is the ticket's **identifier string**, never the ticket object `currentTicket(lp)` returns — `queue.js`'s data model (`tick()`'s `byTicket`/`queue.pending` lookups, `enqueueOne`'s `queue.pending.includes(ticket)`) requires plain identifier strings throughout `pending`/`inFlight`, exactly like every other queue entry this change reads (`inlineStatus`'s and `isSelectable`'s own `queueState.pending`/`inFlight` membership checks, both keyed on `ticket.identifier`, would silently stop matching a queue entry holding a ticket object instead of its id). Concretely: `const id = t.identifier; queueState ? queue.enqueueOne(queueState, id) : queue.createQueue([id], 1, launchCommand)`. No direct `submitTicket` call — the existing `queue.tick()` call site in `draw()`'s poll loop performs the actual launch on the next poll, unchanged.

### Decision 4: Selectability refusal threads `queueState` through, not a new parallel function

`isSelectable(ticket, runs, queueState)` gains a third, optional parameter (`undefined` behaves as "no queue," preserving every existing call site and every existing test that calls it two-arg) rather than a new `isQueued`-style sibling predicate. `selectableIdentifiers` and every `watch.js` call site that gates admission into a queue thread `queueState` through the same way they already thread `runs`. This is not just `toggle-select`/`select-all`/`open-launchplan`'s in-pane re-check: `confirm-launch` (`watch.js:1984-2017`) re-filters `plan.tickets` through `isSelectable(t, runs)` at lines 1995-1996 — its own code comment labels this the "Third and final refusal before anything reaches queue.tick," specifically because a ticket selected minutes earlier on the launch plan screen can go live (or, after this change, become queued via someone else's `q`/QUICK START action) by the time Enter is actually pressed on the confirm screen. Leaving this site un-threaded reopens exactly the duplicate-queue hazard the ticket's Constraints section names: a ticket queued in that interval would still read as `startable` at `confirm-launch` and get handed to `queue.createQueue()` a second time. All four sites — `toggle-select`, `select-all`, `open-launchplan`'s re-check, and `confirm-launch`'s re-check — are therefore in scope to thread `queueState` through.

## Risks / Trade-offs

- [Risk] A third parameter change to `isSelectable`/`selectableIdentifiers` touches several call sites in `watch.js`. -> Mitigation: parameter is optional/additive (`queueState` undefined = prior behavior unchanged), so every call site not yet updated still behaves exactly as before; only sites that should honor the new refusal are updated.
- [Risk] Hint-line gating on "is the highlighted ticket eligible" could get out of sync with the actual keypress handler's own eligibility check if the two are computed differently. -> Mitigation: both read the identical `isSelectable(currentTicket(lp), runs, queueState)` call, not independently re-derived logic.
