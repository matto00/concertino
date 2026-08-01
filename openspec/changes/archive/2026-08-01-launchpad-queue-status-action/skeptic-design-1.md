## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/launchpad-queue-status/spec.md`, `workflow-state.md` in full.
- Read the actual current source the change targets: `lib/ui/screens/launchpad.js`
  (full file), `lib/ui/queue.js` (full file), `lib/ui/format.js` (STATUS_COLOUR
  table, lines 43-51), `lib/ui/router.js` (mode-dispatch table, line 27),
  `lib/ui/screens/fleet.js` (grep for QUICK START `a` binding at line 1189, `q`
  quit binding at 1088/1213), and the relevant sections of `lib/ui/watch.js`
  (quickstart-add case at 1363-1390, toggle-select/select-all/open-launchplan at
  1751-1830, quickStartEligible at 696-705, and confirm-launch at 1984-2017).
- Confirmed as true: `queue.createQueue`/`queue.enqueueOne` exist and are reused
  unchanged (queue.js:54-65, 337-341); `STATUS_COLOUR.queued = dim` already exists
  unused (format.js:48) and is visually distinct from `STATUS_COLOUR.running = cyan`
  (format.js:45); `q` is unbound in `launchpad.js`'s own `handleKey` today (no `q`
  case exists at all); `q` is bound to quit only in `fleet.js`, and `router.js`'s
  per-mode dispatch table (line 27) confirms only one screen's `handleKey` is ever
  consulted for a given `mode`, so the cross-screen key reuse claim in Decision 2
  is accurate; `CLEAR_QUEUE_KEY = 'C'` is independently defined in both
  `launchpad.js` (line 44) and `fleet.js`, matching the "already reused verbatim"
  claim; `fleet.js`'s QUICK START widget (`quickStartEligible`, watch.js:696-705)
  already excludes queued tickets via its own `inQueue` filter, matching the
  design's Non-Goal that no change to it is needed; the three
  `isSelectable`/`selectableIdentifiers` call sites the design lists
  (`toggle-select` watch.js:1757, `select-all` watch.js:1765, `open-launchplan`
  watch.js:1820) all exist as described and are all in scope to thread
  `queueState` through.
- Traced `queue.js`'s actual data model to check the design's implicit assumption
  about what `queue.pending`/`queue.inFlight` contain: `tick()` (queue.js:110-128)
  builds `byTicket` keyed by `r.ticket` (a run's identifier string) and looks up
  each `queue.pending`/`queue.inFlight` entry directly against it — i.e. `pending`
  and `inFlight` MUST hold identifier strings, not ticket objects. `enqueueOne`
  (queue.js:337-341) confirms the same (`queue.pending.includes(ticket)`). The
  existing reference implementation this ticket is told to mirror,
  `quickstart-add` (watch.js:1363-1390), explicitly extracts `const ticket =
  t.identifier;` (line 1367) before ever calling `createQueue`/`enqueueOne`.

### Verdict: REFUTE

### Change Requests

1. **A real call site that gates admission into `queue.createQueue()` is missing
   from the design's plan, reopening the exact duplicate-queue hazard the ticket's
   own constraints section calls out.** `watch.js`'s `confirm-launch` case
   (lines 1984-2017) re-filters `plan.tickets` through `isSelectable(t, runs)` at
   lines 1995-1996 — its own code comment (lines 1987-1994) calls this "Third and
   final refusal before anything reaches queue.tick," explicitly because a ticket
   selected minutes earlier "can be live by the time Enter is actually pressed."
   `design.md`'s Decision 4 and `proposal.md`'s Impact section enumerate only
   three call sites to thread `queueState` through — `toggle-select`,
   `select-all`, and `open-launchplan`'s re-check — and `tasks.md` task 2.3 copies
   that same list verbatim, omitting `confirm-launch`. If `confirm-launch` is not
   also updated to pass `queueState` into its two `isSelectable` calls
   (watch.js:1995-1996), a ticket that became queued (by the new `q` action, or
   any other queuing path) in the interval between `open-launchplan`'s snapshot
   and the operator's actual confirm keypress will still be treated as
   `startable` and handed to `queue.createQueue()`, producing a real duplicate
   queue entry for that ticket — precisely the hazard the ticket's Constraints
   section names ("a silent duplicate-queue hazard of the same shape CON-28's own
   design doc worried about"). Required revision: add `confirm-launch`
   (watch.js:1995-1996) to `design.md`'s Decision 4 call-site list and
   `proposal.md`'s Impact section, and add it to `tasks.md` task 2.3 (or a new
   subtask) so the executor actually updates it.

2. **Decision 3 / task 3.2 never specify that the ticket passed to
   `queue.enqueueOne`/`queue.createQueue` must be the ticket's identifier string,
   not the ticket object `currentTicket(lp)` returns.** `queue.js`'s actual data
   model (verified above — `tick()` at queue.js:110-128, `enqueueOne` at
   queue.js:337-341) requires `pending`/`inFlight` entries to be identifier
   strings; the reference implementation this decision claims to mirror
   "exactly" (`quickstart-add`, watch.js:1367) explicitly resolves `const ticket =
   t.identifier` before calling either primitive. But `design.md` Decision 3
   ("then `queueState ? queue.enqueueOne(queueState, ticket) : queue.createQueue([ticket],
   1, launchCommand)`") and `tasks.md` task 3.2 ("resolve `currentTicket(lp)`
   fresh... then `queue.enqueueOne(queueState, ticket)`...") both use "ticket" to
   mean the object `currentTicket(lp)` resolves to, with no instruction to extract
   `.identifier` first. An implementer following the literal task text would pass
   a ticket object into `queue.pending`, silently breaking every
   `queueState.pending.includes(id)` check added by this same change (inlineStatus,
   isSelectable, the hints line) — a functional bug the design as written does not
   prevent. Required revision: amend Decision 3 and task 3.2 to explicitly say the
   ticket's `.identifier` (not the ticket object) is what gets passed to
   `queue.enqueueOne`/`queue.createQueue`, matching `quickstart-add`'s pattern
   verbatim.

### Non-blocking notes

- Once Change Request 1 is folded in, consider whether `tasks.md` section 6
  (Tests) should gain an explicit test case for the `confirm-launch` race
  (a ticket queued between `open-launchplan` and the confirm keypress is excluded
  from the new `queue.createQueue()` call) — the existing task 6.2/6.3 tests don't
  obviously cover it, and this is precisely the scenario the ticket's constraints
  section is most worried about.
