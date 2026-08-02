# CON-54: Add "open ticket detail" navigation from QUICK START, RUNNING, QUEUED, and DONE rows

## Description

Today, only the flat run-selection index (RUNNING/FAILED/DONE/NEEDS YOU) supports `l` / right-arrow to open a detail view, and that action opens the **run drilldown** (`lib/ui/screens/drilldown.js` — timeline/gates/evidence for a live run), not the **ticket detail page** (`lib/ui/screens/ticketview.js` — the Linear ticket's title/description/comments).

QUICK START and QUEUED rows are Linear tickets pulled from the launch-pad cache, not runs, and currently have no detail action at all — their `handleKey` blocks explicitly `return null` for `l`/`\r` while focused (`lib/ui/screens/fleet.js:1195` and `:1217`). RUNNING/DONE rows *do* have a detail action, but it goes to the run drilldown, not the ticket.

Add a way to jump straight to the ticket detail page (`ticketview.js`, routed via `router.js:29`) from all four sections: QUICK START, RUNNING, QUEUED, and DONE (DONE is the section covering merged/completed runs).

## Acceptance Criteria

* A keybinding (proposal: `t` for "ticket", chosen to avoid the existing `l`/`Enter` collisions noted in `fleet.js:1148-1220`) opens the ticket detail page (`ticketview.js`) for the currently focused/selected row in each of: QUICK START (`focus === 'quickstart'`), QUEUED (`focus === 'queue'`), RUNNING, and DONE.
* For QUICK START/QUEUED this is a new action added to their local-focus key handling (`fleet.js:1186-1220`), replacing the current no-op.
* For RUNNING/DONE this is additive — the existing `l`/right-arrow → run drilldown behavior is unchanged; the new keybinding is a second, distinct action.
* Pressing the new key when the row has no resolvable ticket ID is a no-op (no crash, no blank screen).
* `docs/dashboard.md`'s keybinding table is updated to include the new key (it's already missing `Q`, section-jump digits, and `f`/`C`, per a note from a recent codebase sweep — worth reconciling the whole table while touching it).

## Reference

Linear: https://linear.app/helioapp/issue/CON-54/add-open-ticket-detail-navigation-from-quick-start-running-queued-and
