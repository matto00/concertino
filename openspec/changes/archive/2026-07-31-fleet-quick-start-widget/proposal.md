## Why

Starting the most urgent ticket today requires leaving the fleet view entirely: `N` opens the full launch pad (epic pane, ticket pane, detail pane), then select, plan, and confirm. That multi-screen detour is the right tool for deliberately picking specific work, but there is no fast path for the common "just start whatever's most urgent" case.

## What Changes

- Add a toggleable QUICK START section to the fleet view, showing the top 5 open tickets by priority (flattened across all epics, reusing `launchpad.js`'s `PRIORITY_RANK`/`sortByPriority`/`isSelectable`), hidden by default and shown/hidden with a dedicated key (`Q`).
- While the section is focused, `j`/`k` move a local cursor over its rows and `a` adds the highlighted ticket straight to the queue, without opening the launch pad.
- "Add to queue" reuses the existing `queue.createQueue`/`queue.tick` primitives: if no queue is currently active, it creates one (single ticket, `maxConcurrent: 1`, the same default launch command the `n` prompt and restart already use); if a queue is already active, the ticket is appended to its existing `pending` list via a new small `queue.js` helper (`enqueueOne`), reusing that queue's own `maxConcurrent`/`launchCommand` rather than starting a second, competing queue.
- The section participates in the same height-budget trimming and digit-key (`1`-`9`) section-jump numbering every other fleet section already does, and — like `QUEUED` — never perturbs the flat run row-index space `state.selected` resolves against.

## Capabilities

### New Capabilities
- `fleet-quick-start`: the toggleable fleet-view panel showing top-priority open tickets and the add-to-queue action on the highlighted one.

### Modified Capabilities
(none — `fleet-section-jump`'s digit-jump numbering is already derived generically from whatever sections render this frame, so no requirement there changes; `fleet-queue-visibility`'s requirements describe `QUEUED` specifically and are unaffected)

## Impact

- `lib/ui/screens/fleet.js`: new QUICK START section (build/render/height), its own focus cursor and key handling (`Q` toggle, `j`/`k`/`a`/Escape while focused), extended `buildSections`/`sectionJumpTargets`.
- `lib/ui/watch.js`: computes the eligible top-N ticket list each `draw()` (reusing `cache.read(root)` and `launchpadScreen.sortByPriority`/`isSelectable`, deduped against the live queue's `pending`/`inFlight`), threads `quickStartVisible`/`quickStartFocus` state, handles the `quickstart-add`/`toggle-quickstart`/`focus-quickstart`/`move-quickstart-focus`/`exit-quickstart-focus` actions.
- `lib/ui/queue.js`: new `enqueueOne(queue, ticket)` helper (append-with-dedupe onto an existing queue's `pending`), exported for reuse by the sibling ticket (launch pad IN QUEUE status / explicit add-to-queue action) per its own cross-reference note.
- `lib/ui/screens/launchpad.js`: no changes — `sortByPriority`, `priorityRank`, `isSelectable`, `selectableIdentifiers` are already exported and reused as-is.
