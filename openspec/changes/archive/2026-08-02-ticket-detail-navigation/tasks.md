## 1. `fleet.js` — key handling

- [x] 1.1 Inside the `focus === 'queue'` block (`lib/ui/screens/fleet.js`,
      around line 1349), add a `t` branch that resolves
      `queueState.pending[queueFocus]` to an identifier (mirroring the
      existing `f` branch's `pending`/`queueFocus` resolution immediately
      above it) and returns `{ type: 'view-ticket', ticket: <identifier> }`,
      or `null` when nothing resolves at that index.
- [x] 1.2 Inside the `focus === 'quickstart'` block (around line 1376), add a
      `t` branch that unconditionally returns
      `{ type: 'view-ticket-quickstart', index: quickStartFocus }` (mirroring
      the existing `a` → `quickstart-add` branch — `handleKey` has no access
      to the eligible-ticket list, so resolution happens in `watch.js`).
- [x] 1.3 At the bottom of `handleKey`, next to the existing `l` /
      `open-drilldown` binding (around line 1435), add:
      `if (key === 't' && runs[selected]) return { type: 'view-ticket',
      ticket: runs[selected].ticket };`. Leave the existing `l` binding
      untouched.
- [x] 1.4 Confirm (by reading, not just by inspection) that `t` was not
      already bound to anything else in `handleKey` before this change — it
      wasn't, per the ticket's own collision table, but re-check against the
      current source since other tickets may have landed since.

## 2. `watch.js` — action handling

- [x] 2.1 Refactor `openLaunchPad()`: extract its existing lazy-init body
      (the `if (!launchPad) { ... }` block that builds the `launchPad`
      object from `cache.read(root)` plus defaults) into a new
      `ensureLaunchPad()` function with no `mode` assignment.
      `openLaunchPad()` becomes `ensureLaunchPad(); mode = 'launchpad';`.
      Behavior for every existing caller of `openLaunchPad()` must be
      byte-identical to before this change.
- [x] 2.2 Declare `let ticketviewReturnMode = null;` alongside the other
      per-screen session state (near `settings`/`ticketDraft`).
- [x] 2.3 In the existing `case 'open-ticketview':` handler, set
      `ticketviewReturnMode = 'launchpad';` alongside `mode = 'ticketview';`.
- [x] 2.4 Add `case 'view-ticket':` — given `action.ticket`, call
      `ensureLaunchPad()`, set `launchPad.viewingTicket = action.ticket`,
      `ticketviewReturnMode = 'fleet'`, `mode = 'ticketview'`.
- [x] 2.5 Add `case 'view-ticket-quickstart':` — re-derive
      `quickStartEligible()` fresh (do not use a cached list), look up
      `eligible[action.index]`; if absent, no-op (`return true` with no state
      change, mirroring `quickstart-add`'s own no-op branch); otherwise call
      `ensureLaunchPad()`, set `launchPad.viewingTicket = t.identifier`,
      `ticketviewReturnMode = 'fleet'`, `mode = 'ticketview'`.
- [x] 2.6 Update `case 'back-to-launchpad':` — if `ticketviewReturnMode ===
      'fleet'`, set `mode = 'fleet'`; otherwise call the existing
      `backToLaunchPad()` unchanged. Either branch resets
      `ticketviewReturnMode = null` afterward.
- [x] 2.7 In `backToFleet()`, add `ticketviewReturnMode = null;` as a
      defensive reset, matching the existing discipline applied to
      `docTitle`/`ticketDraft`/`settings` in that same function.
- [x] 2.8 Add `ticketviewReturnMode` to `currentState()`'s returned object,
      matching how the other per-screen session fields are already exposed
      there.

## 3. Tests

- [x] 3.1 `test/fleet.test.js` (or wherever `handleKey` is tested): add cases
      for `t` from `focus === 'queue'`, `focus === 'quickstart'`, and the
      plain run selection (both a RUNNING and a DONE row), asserting the
      exact action shapes from tasks 1.1–1.3.
- [x] 3.2 Add a case asserting `t` is a no-op (`null`) when: QUEUED is
      focused with no ticket at the focused index; QUICK START is focused
      with `quickStartFocus` out of range (this one is inherently
      `watch.js`-level, since `handleKey` always emits unconditionally —
      cover it in `watch.test.js` instead, see 3.4); and when `runs[selected]`
      is absent.
- [x] 3.3 Assert `l` on a RUNNING and a DONE row is unaffected (still
      `open-drilldown`), proving `t`'s addition didn't disturb the existing
      binding.
- [x] 3.4 `test/watch.test.js`: add cases for `view-ticket` (fleet-originated,
      valid identifier → `mode === 'ticketview'`,
      `launchPad.viewingTicket === ticket`, `ticketviewReturnMode ===
      'fleet'`) and `view-ticket-quickstart` (both a resolving index and an
      out-of-range index that must no-op — no mode change).
- [x] 3.5 `test/watch.test.js`: add a case proving `ensureLaunchPad()` is
      called (i.e. `launchPad.cache.tickets` is populated) even when
      `launchPad` was `null` beforehand (the launch pad was never opened this
      session) — covers Decision 4's actual purpose.
- [x] 3.6 `test/watch.test.js`: add cases for `back-to-launchpad` routing:
      opened from the fleet view → `esc` yields `mode === 'fleet'`; opened
      from the launch pad → `esc` yields `mode === 'launchpad'` (existing
      behavior, must still pass); alternating the two in one session (open
      from launch pad, back, then open from fleet, back) resolves correctly
      each time — proves Decision 5's origin-tracking isn't sticky/stale.
- [x] 3.7 Confirm every existing `ticketview.test.js` test still passes
      unmodified (they pin `ticketview.js`'s own pure `handleKey`/
      `routeHandleKey` contract, which this change does not touch).

## 4. Documentation

- [x] 4.1 Add a `t` row to `docs/dashboard.md`'s keybinding table (around
      line 103), describing it as opening the ticket detail view for the
      focused/selected row in QUICK START, QUEUED, RUNNING, and DONE.
- [x] 4.2 Reconcile the rest of that table against what's actually bound
      today (per a recent codebase sweep, it's missing at least): `l` /
      right-arrow (run drilldown), the digit keys `1`-`N` (section jump),
      `Q` (open the launch pad's tickets pane — confirm the exact key/action
      by reading `launchpad.js`/`fleet.js` rather than assuming), `f`
      (force-start a queued ticket), `C` (clear queue), `c` (confirm a
      restored queue), and `s` (open settings). Verify each addition against
      the actual source rather than the ticket's own possibly-incomplete
      list — the ticket flags these as *known* gaps, not an exhaustive one.

## 5. Verification

- [x] 5.1 Run the full test suite; all existing and new tests pass.
- [x] 5.2 Manually exercise (or write an integration-level test covering) the
      full loop: open the dashboard, press `t` on a QUICK START row, `esc`
      back to fleet; press `t` on a QUEUED row, `esc` back to fleet; press
      `t` on a RUNNING row, `esc` back to fleet; press `t` on a DONE row,
      `esc` back to fleet; then open the launch pad, `↵` on a ticket, `esc`
      back to the launch pad — confirming the pre-existing launch-pad path is
      unaffected.
