# CON-29: Queued batch tail is lost if the dashboard restarts

## Problem

`queueState` in `lib/ui/watch.js:202` is in-memory only. If the dashboard process exits — crash, closed terminal, killed tmux session, OOM — every ticket that has not yet been handed to `submitTicket()` is forgotten. There is no resume on the next `concertino watch`.

This was a deliberate trade, documented at `watch.js:182`:

> Judgement call: this is IN-MEMORY ONLY, not written to disk. [...] This is a deliberate trade for this slice, not an oversight [...] persisting the pending tail durably would mean reconciling a queue file against live tmux/event-log state on every restart (was a "queued" ticket launched by hand in the meantime? was it cancelled? is the cached ticket data it was queued against now stale?) — real complexity with no usage data yet on how often this actually happens.

The reasoning still stands. What has changed is the last clause: there is now usage data. The queue's actual use is unattended overnight batches, which is precisely the window in which an unnoticed restart is most likely and most costly. A crash at hour one of an eight-hour batch currently means seven hours of nothing, discovered in the morning.

## Blast radius (what is *not* at risk)

Worth stating precisely, because it bounds the fix:

* Runs already launched are fully durable. The tmux window and `.concertino/runs/<ticket>/events.jsonl` survive the dashboard exactly as they do for a run started with the single-ticket `n` prompt.
* Only the un-started tail is lost, and only across a restart during the batch.

So this is not "the batch is fragile" — it is "the not-yet-started remainder is fragile".

## Existing partial mitigation

`watch.js` already has a quit-confirmation guard: pressing `q`/Ctrl-C with a non-empty queue warns `N queued ticket(s) not yet started — they will not resume automatically` and requires a second press. That covers *deliberate* exit. It does nothing for a crash or a closed terminal, which are the cases that matter here.

## Proposed change

Persist the pending tail to `.concertino/cache/queue.json`, written on every `queue.tick()` and read back at startup — the same durable-cache pattern this file already uses for Linear tickets (`linear.json`).

### The reconciliation problem is the actual work

Writing the file is trivial; reading it back safely is not. The original comment names the hazards, and they are real. On startup, for each persisted pending ticket:

* **Already live?** A ticket started by hand (or by another dashboard) while this one was down must not be double-launched. `queue.tick()` already drops pending tickets it finds live — that same predicate should govern restore, so this is mostly a matter of routing restore through the existing logic rather than around it.
* **Already finished?** A ticket that ran to completion during the downtime must not be re-run.
* **Stale?** A queue file from a batch three days ago should not spring back to life. Needs an age bound or an explicit session marker.
* **Cache drift?** The ticket data the batch was queued against may no longer match.

### Required safety property

Restoring a queue must never launch anything the operator did not see and confirm. Strong preference for restoring the queue in a **paused//unconfirmed** state that renders in the QUEUED section with an explicit "resumed from a previous session — press X to continue" affordance, rather than silently resuming launches at startup. A dashboard that starts spawning agents on its own the moment it opens is a worse failure than the one this ticket fixes.

`.concertino/` is gitignored in full, so the queue file inherits that. Confirm it does not capture anything beyond ticket ids and queue metadata — no ticket bodies, which is where the sensitive content lives.

## Related

Depends on the QUEUED fleet section for the resume affordance to have somewhere to live. Ship that first. (CON-28, already merged — see `4b78c6c CON-28 Add a QUEUED section to the fleet view`.)

## Metadata

- Ticket: CON-29
- URL: https://linear.app/helioapp/issue/CON-29/queued-batch-tail-is-lost-if-the-dashboard-restarts
- Priority: High
