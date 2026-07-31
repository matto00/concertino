# CON-40: Fleet view: a quick-start widget showing the top few priority tickets, queueable without opening the launch pad

## Description

### Problem

Queuing work today means leaving the fleet view entirely: `N` opens the full launch pad (epic pane, ticket pane, now the detail pane from CON-35), select tickets, build a launch plan, confirm. That's the right tool for picking specific work deliberately, but there is no fast path for the common case of "just start whatever's most urgent" without the multi-screen detour.

### Proposed change

A small "quick start" panel on the fleet view itself — not a replacement for the full launch pad, a shortcut in front of it. Shows the next 3-5 tickets by priority (reusing `linear.js`'s cache and the `priorityRank`/`sortByPriority` logic `launchpad.js` already has — see `launchpad.js`'s `PRIORITY_RANK` table, shipped by CON-35), with a key to add one straight to the queue without navigating epics/tickets panes first.

## Design questions worth settling explicitly rather than guessing

* **Where does it live?** Fleet's vertical budget is already tightly accounted for (`sectionHeight`/`height()`/`budget` in `fleet.js`, per CON-28's own comments) — this is a sixth thing competing for rows alongside NEEDS YOU/RUNNING/QUEUED/FAILED/DONE. Consider whether it's a persistent panel or something toggled on demand (a key that shows/hides it), given screen real estate is the resource CON-28 was already careful about.
* **"Top priority" across all epics, or does epic scoping still matter?** The launch pad's whole structure is epic-first; this widget flattens that. Confirm that's actually wanted (it's what was asked for) rather than assumed.
* **What does "add to queue" do differently from the full launch pad's confirm?** This should reuse `queue.createQueue`/`queue.tick` (the same primitives CON-28/CON-29 already built), not a second parallel queuing mechanism — the point is a shortcut UI in front of existing plumbing, not new plumbing.

## Related

Cross-reference the sibling ticket (launch pad IN QUEUE status + explicit add-to-queue action) — these two were requested together and should probably share whatever single-ticket-queue action either one introduces, rather than each screen getting its own.

## Metadata

- Priority: Medium
- URL: https://linear.app/helioapp/issue/CON-40/fleet-view-a-quick-start-widget-showing-the-top-few-priority-tickets
