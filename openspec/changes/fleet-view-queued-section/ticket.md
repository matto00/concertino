# CON-28: Fleet view has no QUEUED section, so a queued batch is invisible

Priority: High
URL: https://linear.app/helioapp/issue/CON-28/fleet-view-has-no-queued-section-so-a-queued-batch-is-invisible

## Problem

The fleet view renders exactly four sections (`lib/ui/screens/fleet.js:186`):

```js
const sections = [
  { title: 'NEEDS YOU', group: needsYou, statusKey: 'needs-you', cap: Infinity, pinned: true },
  { title: 'RUNNING',   group: active,   statusKey: 'running',   cap: Infinity },
  { title: 'FAILED',    group: failed,   statusKey: 'failed',    cap: MAX_FINISHED },
  { title: 'DONE',      group: done,     statusKey: 'done',      cap: MAX_FINISHED },
];
```

Every one of these is derived from `reducer.reduce()` — that is, from runs that have **already started**. A ticket sitting in `queueState.pending` has no run directory, no tmux window, and no event log, so the reducer has nothing to produce and the fleet has nothing to draw.

The consequence is that after confirming a batch on the launch plan screen, the dashboard shows only the first `maxConcurrent` tickets. The rest of the batch is real, will launch, and is completely unrepresented on screen. There is no way to answer "what did I queue?" from the TUI.

This is most acute in exactly the situation the queue exists for: a long unattended batch. The operator sets it running, leaves, and has no way to confirm what is still coming.

## Why this is not just cosmetic

This project's governing property is **absent data must never render as healthy data**. A queued batch currently renders as *nothing at all*, which reads identically to "no batch was ever queued". A user who queues five tickets and sees one RUNNING row cannot distinguish that from having mis-selected and queued only one.

## Proposed change

Add a `QUEUED` section to the fleet view.

Placement: **after RUNNING, before FAILED**. Rationale — the existing order is deliberate (see the comment at `fleet.js:179`): sections are ordered so the Nth rendered row is `runs[N]`, which is the index `watch.js` attaches to, and so that things needing action sort higher. Queued items are *pending*, not *finished*, so they belong with the live half; but they are not yet actionable (nothing to attach to), so they sit below RUNNING.

### The row-index hazard

This is the trap in this ticket, and it should be treated as the primary design constraint.

`watch.js` maps a selected fleet row directly onto `runs[N]`. That invariant holds today only because every rendered row corresponds to a reducer-produced run. Queued rows have **no run object**. Inserting them naively into the rendered list will silently shift the index of every row below them, so selecting a FAILED or DONE row would attach to, kill, or restart the *wrong ticket*.

Any implementation must make this impossible, not merely avoid it. Two viable approaches:

1. Keep queued rows out of the selectable index space entirely (unselectable rows), or
2. Change the selection model to carry a stable identifier (ticket id) rather than a positional index.

Option 2 is more invasive but removes a whole class of future defect; the design gate should weigh it seriously rather than defaulting to option 1. Whichever is chosen, there must be a test that selects a row *below* a non-empty QUEUED section and asserts the resolved ticket is correct.

### Section behaviour

* Queued rows have no status, no elapsed time, and no phase — do not fabricate any. Show the ticket id and, if the ticket cache has it, the title. A queued row is one line, not the two a run row uses.
* The section should show queue position, since order is the one meaningful property a queued item has.
* Respect the existing height-budget/trimming machinery (`sectionHeight`, the `cap` field, the `… and N more` line). QUEUED should be trimmable like RUNNING/FAILED/DONE and must never be `pinned` — NEEDS YOU is the only pinned section and must stay the only one.
* `maxConcurrent` is worth surfacing in the section title (e.g. `QUEUED (3, running 1 at a time)`), because "why is only one running?" is the obvious next question and the answer is otherwise invisible.

## Related

Durability of the queue is a separate concern — see the persistence follow-up. This ticket is only about rendering what is currently in memory.
