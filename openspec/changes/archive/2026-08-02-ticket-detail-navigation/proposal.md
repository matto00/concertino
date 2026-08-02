## Why

QUICK START and QUEUED rows are Linear tickets, not runs, and today have no
detail action at all — `fleet.js`'s local-focus key handling explicitly
`return null`s for `l`/`\r` while either is focused. RUNNING and DONE rows do
have a detail action (`l` → the run drilldown), but that opens
`drilldown.js` (timeline/gates/evidence for a live run), never the ticket
itself. There is currently no way to read a ticket's title/description/
comments from any of these four sections without leaving the dashboard for
Linear.

## What Changes

- Add a new keybinding (`t`, for "ticket") that opens the full-screen ticket
  detail view (`ticketview.js`) for the currently focused/selected row, in
  each of: QUICK START, QUEUED, RUNNING, DONE.
  - QUICK START/QUEUED: `t` is new — it replaces the current no-op for
    `l`/`\r`/`t` while either is locally focused (only `t` gains a binding;
    `l`/`\r` stay suppressed exactly as before, since neither section holds
    a run).
  - RUNNING/DONE: `t` is additive, next to the existing `l` → run-drilldown
    binding. `l` is unchanged.
- Pressing `t` on a row with no resolvable ticket identifier at keypress time
  is a no-op — no mode change, no crash, no blank screen.
- `ticketview.js` can now be entered from two different places (the launch
  pad, as before, and the fleet view, new). Its `esc` action keeps the
  identical `{ type: 'back-to-launchpad' }` shape (its pure `handleKey`
  contract, and the existing tests pinning it, are unchanged) — but
  `watch.js`'s handling of that action now returns to whichever screen
  `ticketview.js` was actually opened from, tracked via a new
  `ticketviewReturnMode` field, rather than unconditionally landing on the
  launch pad.
- `docs/dashboard.md`'s keybinding table gains the new `t` row and is
  reconciled against the keys actually bound in `fleet.js`/`drilldown.js`/
  `launchpad.js` today (it is currently missing `l`, digit section-jump,
  `Q`, `f`, `C`, and `s`, per a note from a recent codebase sweep).

## Capabilities

### New Capabilities

- `ticket-detail-navigation`: the `t` keybinding across QUICK START, QUEUED,
  RUNNING, and DONE; its no-op behavior on an unresolvable ticket; and
  `ticketview.js`'s now-origin-aware `esc` return destination.

### Modified Capabilities

(none — no existing capability's requirements change; `l`'s run-drilldown
behavior and `ticketview.js`'s pure key-handling contract are both
unchanged)

## Impact

- `lib/ui/screens/fleet.js`: `handleKey`'s QUICK START/QUEUED local-focus
  blocks (currently `return null` for `l`/`\r`) gain a `t` branch; the
  runs-backed (RUNNING/DONE) branch gains a `t` binding alongside its
  existing `l` binding.
- `lib/ui/watch.js`: new action cases resolving a QUICK START/QUEUED index or
  a RUNNING/DONE run's ticket identifier to a cache-backed ticket object and
  entering `mode = 'ticketview'`; `openLaunchPad`'s lazy cache-init is
  factored out so it can run without also switching to `mode = 'launchpad'`;
  the `'back-to-launchpad'` action case becomes origin-aware via
  `ticketviewReturnMode`.
- `lib/ui/screens/ticketview.js`: unchanged in its pure `handleKey`/render
  contract; still reads `state.launchPad.cache`/`state.launchPad.viewingTicket`
  — `watch.js` is what changes to ensure `launchPad.cache` is populated even
  when the launch pad itself was never opened.
- `docs/dashboard.md`: keybinding table updated.
