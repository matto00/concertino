## Why

The launch pad cannot show a ticket's priority at all (the field is not even fetched), and reading a ticket's full description/comments requires leaving the list and losing selection context. Both gaps make the launch pad's core job — choosing which ticket to run next — harder than it needs to be.

## What Changes

- Add `priority` to the Linear GraphQL query (`lib/ui/linear.js`) and to the normaliser, using the same defensive `typeof node.priority === 'number' ? node.priority : null` pattern as neighbouring fields (`0` = None is a real value; no `||` fallback).
- Version the on-disk ticket cache (`lib/ui/cache.js`) so a pre-priority cache is detected as stale-shape rather than silently read as `priority: undefined`, and treat a missing/undefined priority as visibly "unknown" in the UI, never as `0`/None.
- Render priority in `ticketRow` (`lib/ui/screens/launchpad.js`), re-deriving the row's fixed-width budget (`TICKET_ROW_FIXED`) rather than appending a column and hoping; the title remains the elastic element that absorbs the width loss.
- Add the ability to sort the tickets pane by priority.
- Extract `ticketview.js`'s description/comments body rendering into a shared renderer usable by both `ticketview.js` (full-screen) and a new inline detail pane.
- Add a third pane to the launch pad, below the epics/tickets `hsplit` row, showing the selected ticket's title, description, and comments, updating live as the ticket selection moves. `ticketview.js` remains reachable (unchanged full-screen behavior) for long descriptions.
- Re-budget the launch pad's vertical layout for three panes instead of two: `MAX_EPICS_VISIBLE` / `MAX_TICKETS_VISIBLE` may need new values, and the detail pane must degrade (via `layout.degrade()`) or collapse entirely on a short terminal rather than starving the list.
- An empty description renders an explicit "(no description)"-style message, never a blank region. `commentsTruncated` remains visible in the inline pane exactly as it does in `ticketview.js` today.

## Capabilities

### New Capabilities
- `launchpad-detail-pane`: the inline third pane on the launch pad showing the selected ticket's description/comments, the shared renderer it uses (also serving `ticketview.js`), its degrade/collapse behavior on a short terminal, and the "empty description is stated explicitly" / "truncated comments stay visible" guarantees.
- `ticket-priority`: fetching `priority` from Linear, normalising it defensively (including the cache-schema-version migration so a stale cache renders "unknown" rather than a false `0`/None), rendering it in the tickets pane, and sorting by it.

### Modified Capabilities
(none — `dashboard-visual-design` and `dashboard-render-loop` govern the shared layout/render-loop primitives this change reuses, but neither's own requirements change; the layout's existing `degrade()` contract already covers a pane collapsing below its minimum size.)

## Impact

- `lib/ui/linear.js`: GraphQL query, normaliser.
- `lib/ui/cache.js`: on-disk cache shape gains `schemaVersion`; stale-shape detection.
- `lib/ui/screens/launchpad.js`: `ticketRow` width budget, priority rendering/sort, three-pane vertical layout.
- `lib/ui/screens/ticketview.js`: description/comments body rendering extracted to a shared module (new file, e.g. `lib/ui/ticketDetail.js`) used by both screens.
- `lib/ui/watch.js`: `openLaunchPad()`'s `launchPad` initializer gains `ticketSort`, and `applyAction`'s `switch (action.type)` block gains a case wiring the new priority-sort action (from `launchpad.js`'s `P` key) into `launchPad.ticketSort` — without this, the key press is silently dropped by the existing `default:` branch.
- `test/scripts/watch-smoke.test.sh`: gains a new `P`-key/priority-sort case (task 4.8), and its three existing hand-written cache fixtures that predate `schemaVersion` (`LP2_WORK`, `Q_WORK`, `H_WORK`) need that field added so the schema-version invalidation (task 2.3) does not silently break them.
- `.concertino/cache/linear.json` on-disk shape (existing caches predate `priority` and any schema version).
