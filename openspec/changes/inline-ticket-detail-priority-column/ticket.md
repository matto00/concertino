# CON-35: Launch pad: inline ticket-detail pane and a priority column

## Problem

Two gaps make ticket selection on the launch pad harder than it should be.

**1. Reading a ticket means leaving the page.** The launch pad (`lib/ui/screens/launchpad.js`) is a two-pane layout — epics on the left (`EPICS_WIDTH = 30`), tickets on the right. The full description and comments live on a *separate* screen, `ticketview.js`, reached by navigating away. So choosing between candidates means bouncing in and out of the list, losing the selection context each time. The cache already holds everything needed (`description`, `comments`, `commentCount`, `commentsTruncated` — see `linear.js`'s normaliser); it is purely a layout problem.

**2. Priority is invisible — and not merely unrendered.** `ticketRow` (`launchpad.js:134`) draws marker, checkbox, identifier, title, and run status:

```js
const line = ' ' + marker + ' ' + box + ' ' + body + ' ' + f.padTo(statusCol, statusWidth);
```

Priority is not there. More importantly, it is **not in the data at all**: the GraphQL query at `linear.js:55` selects `id, identifier, number, title, description, url, estimate, updatedAt, state, assignee, labels, project, comments` — no `priority` — and the normaliser (`linear.js:190`) has no corresponding field. So this is not a rendering change; it needs the query, the normaliser, and the cache shape extended first.

Selecting work by priority is the launch pad's main job, and it is currently the one thing the screen cannot show.

## Proposed change

### Detail pane

Add a third pane **below the ticket list**, showing the selected ticket's detail — title, description, and comments — updating as the selection moves. The existing two-pane row (epics | tickets) keeps its `hsplit`; the detail pane spans the full width beneath it.

`ticketview.js` already solves rendering this content (152 lines). Strongly prefer extracting its body-rendering into something both screens call over duplicating it — `ticketview` should remain reachable as the full-screen read for long descriptions, with the inline pane as the at-a-glance version.

Constraints:

* The vertical budget is now split three ways. `MAX_EPICS_VISIBLE = 10` and `MAX_TICKETS_VISIBLE = 12` were chosen against a two-pane layout and will need revisiting; the detail pane must degrade (or collapse entirely) on a short terminal rather than squeezing the list to nothing. `layout.degrade()` already exists for this.
* A ticket with an empty description must say so explicitly. Rendering blank is the "absent data as healthy data" failure this project treats as a wall.
* `commentsTruncated` must stay visible — a silently shortened thread reads as a complete one. The existing normaliser comment makes this point; do not lose it in the move.

### Priority column

Fetch and display it:

1. Add `priority` to the GraphQL query. Linear returns an integer (`0` None, `1` Urgent, `2` High, `3` Medium, `4` Low); `priorityLabel` is also available if the display name is wanted directly.
2. Add it to the normaliser with the same defensive typing the neighbouring fields use — `typeof node.priority === 'number' ? node.priority : null`. Note `0` is a real value meaning None, so any `||` fallback is a bug here.
3. Render it in `ticketRow`, and sort or allow sorting by it.

**Cache migration matters.** Existing `.concertino/cache/linear.json` files predate the field, so every cached ticket will have `priority === undefined` until a refresh. Missing priority must render as visibly unknown, never as `0`/None — otherwise every stale-cache ticket silently displays as the lowest priority, which is exactly the class of defect this project treats as a wall. Consider whether the cache should carry a schema version so a stale shape is detected rather than inferred.

### Row width

`ticketRow` budgets via `TICKET_ROW_FIXED = 8` and a computed `statusWidth`, then truncates to `width`. Adding a column means re-deriving that budget, not appending and hoping. The title is the elastic element and should absorb the loss.

## Related

* CON-18 (https://linear.app/helioapp/issue/CON-18/drill-down-should-show-the-tickets-title-and-description) does the equivalent for the drill-down (ticket title/description on a run's detail screen). Same underlying need, different screen; worth landing whichever ships second on top of the shared renderer the first one extracts.
* CON-20 (https://linear.app/helioapp/issue/CON-20/launch-pad-cannot-distinguish-no-open-tickets-from-misconfigured-team) (launch pad cannot distinguish "no open tickets" from "misconfigured team") also touches this screen's data path.
* CON-9 (https://linear.app/helioapp/issue/CON-9/ticket-cache-is-bounded-by-the-wrong-thing-comments-are-06percent-of) concerns what the cache is bounded by, and this ticket adds a field to it.

## Priority

High
