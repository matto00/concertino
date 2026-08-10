## 1. State shape

- [x] 1.1 Add `S.multiSelect = { failed: new Set(), queued: new Set() }`,
      `S.bulkConfirm = null`, `S.bulkResult = null` to `app-state.js`'s
      `createAppState()` initial state.
- [x] 1.2 Add `multiSelect`, `bulkConfirm`, `bulkResult` to `app-state.js`'s
      `currentState(S)` curated snapshot (~line 311, alongside
      `markDoneConfirm: S.markDoneConfirm, addressFailureNotice:
      S.addressFailureNotice,`) — `handleKey`/`render` only ever see this
      snapshot, never raw `S`; omitting this step means `state.multiSelect`
      is `undefined` and `state.multiSelect.failed.size` throws on the
      first `a`/`d`/`f`/`space` press after this ships (skeptic gate round
      1, finding 1).
- [x] 1.3 Add `bulkConfirm`, `bulkResult`, `multiSelect` to
      `lib/ui/screens/fleet/render.js`'s `mergeRenderOpts` object, alongside
      its existing `markDoneConfirm`/`forceStartConfirm`/
      `clearQueueConfirm`/`addressFailureNotice` fields (skeptic gate round
      1, finding 1 — this is `lib/ui/screens/fleet/render.js`, not
      `lib/ui/render.js`).
- [x] 1.4 Add `bulkConfirm`, `bulkResult` to `controllers/fleet.js`'s
      `scrollToShow`'s `winOpts` object (~line 30-45) AND `watch.js`'s
      separate `heightOpts` object (~line 670-678) — both independently
      duplicate the render-opts "every tail-lengthening field" list, and
      both already carry comments (`fleet-metrics-grid final-fix 2`, and
      the CON-98 `markDoneConfirm` addition) documenting that omitting a
      field here previously caused a real, shipped scroll-miscalculation
      bug (skeptic gate round 1, finding 2).

## 2. `space` key binding and toggle

- [x] 2.1 Bind `space` at the top-level FAILED-row site in
      `fleet/keys.js`'s `handleKey` (mirroring `a`/`d`'s own
      `focus === 'runs' && runs[selected] && runs[selected].status ===
      'failed'` guard), resolving to `{ type: 'toggle-multi-select',
      section: 'failed', ticket: runs[selected].ticket }`.
- [x] 2.2 Bind `space` inside the `focus === 'queue'` block (mirroring
      `f`'s own resolution), resolving to `{ type: 'toggle-multi-select',
      section: 'queued', ticket }`.
- [x] 2.3 Add the `toggle-multi-select` handler in `controllers/fleet.js`:
      add the ticket to `S.multiSelect[action.section]` if absent, delete
      if present.

## 3. Bulk dispatch for `a`/`d`/`f`

- [x] 3.1 In `fleet/keys.js`, before resolving the existing single-row `a`/
      `d` actions, check `state.multiSelect.failed.size > 0`; if so, emit
      `open-bulk-address-confirm` / `open-bulk-mark-done-confirm` with
      `tickets: [...state.multiSelect.failed]` instead.
- [x] 3.2 In `fleet/keys.js`'s `focus === 'queue'` block, before resolving
      the existing single-row `f` action, check
      `state.multiSelect.queued.size > 0`; if so, emit
      `open-bulk-force-start-confirm` with
      `tickets: [...state.multiSelect.queued]` instead.
- [x] 3.3 Verify (unit test) that an empty multi-select set leaves `a`/`d`/
      `f` byte-for-byte unchanged from their pre-change single-row
      resolution.

## 4. Bulk confirmation state and rendering

- [x] 4.1 Add `open-bulk-address-confirm` / `open-bulk-mark-done-confirm` /
      `open-bulk-force-start-confirm` handlers in `controllers/fleet.js`,
      setting `S.bulkConfirm = { section, kind, tickets }`.
- [x] 4.2 Extend `sections.js`'s `buildHeadTail` gate-precedence chain with
      a `bulkConfirm` branch (checked alongside `markDoneConfirm`/
      `forceStartConfirm`/`clearQueueConfirm`, ahead of `quitConfirm`),
      rendering a `confirmLines` banner naming `tickets.length` (and, for
      `kind: 'force-start'`, the resulting concurrency overage against
      `maxConcurrent`).
- [x] 4.3 Thread `bulkConfirm` through `render.js`'s `render()` and
      `watch.js`'s `draw()` opts, mirroring `markDoneConfirm`'s existing
      threading.
- [x] 4.4 Add the any-key-but-`y`-cancels handler
      (`cancel-bulk-address`/`cancel-bulk-mark-done`/
      `cancel-bulk-force-start`, or one shared `cancel-bulk-confirm` type)
      in `fleet/keys.js`/`controllers/fleet.js`, clearing `S.bulkConfirm`
      and the corresponding `S.multiSelect[section]` set.

## 5. Bulk execution and per-row result reporting

- [x] 5.1 Add the `confirm-bulk-mark-done` handler: for each ticket in
      `S.bulkConfirm.tickets`, re-resolve fresh from `S.runs`, apply the
      existing `confirm-mark-done` per-ticket logic (append `run.override`
      with `status: 'done'`), and record `{ ticket, ok, error }` into
      `bulkResult.results`.
- [x] 5.2 Add the `confirm-bulk-address` handler: for each ticket, apply
      the existing `address-failure` per-ticket logic (claude-code-only
      spawn, non-claude-code notice), recording `{ ticket, ok, error }` per
      ticket — a per-ticket non-claude-code notice counts as `ok: false`
      with that reason.
- [x] 5.3 Add the `confirm-bulk-force-start` handler: for each ticket, in
      list order, apply the existing `queue.forceStart`
      admission/launch/persist logic, recording `{ ticket, ok, error }` per
      ticket — a ticket no longer in `pending` by the time it is processed
      records `ok: false` with a stale/no-longer-queued reason rather than
      being silently skipped.
- [x] 5.4 Set `S.bulkResult = { kind, results }` and clear `S.bulkConfirm`/
      `S.multiSelect[section]` at the end of each of the three handlers
      above.
- [x] 5.5 Render `S.bulkResult` (when present) as a tail block in
      `buildHeadTail` — one line per ticket, ✓/✗ marker, error text on
      failure.
- [x] 5.6 Clear `S.bulkResult` in `watch.js`'s `onKey`, immediately before
      its `router.handleKey(key, currentState())` call (~line 1214) — NOT
      as a new intercept branch inside `fleet/keys.js`'s `handleKey` (every
      existing intercept there swallows the triggering key entirely, which
      is wrong here: the key that dismisses a visible `bulkResult`, e.g.
      `j`, must still move the cursor normally). This is the one place
      `S.bulkResult` is ever cleared (skeptic gate round 1, finding 3).
- [x] 5.7 Decide, before implementing 5.1-5.3, whether the bulk handlers
      factor the existing per-ticket `mark-done`/`address-failure`/
      `force-start` logic (currently inline in `controllers/fleet.js`'s
      single-row `switch` cases, no shared helper exists yet) into a
      function shared with the single-row handlers, or duplicate it inline
      — either is acceptable, but leaving it undecided invites the
      single-row and bulk paths to silently drift apart on a future edit to
      only one of them (skeptic gate round 1, non-blocking note).

## 6. Row markers

- [x] 6.1 `renderFinishedRow` (FAILED rows): render the dedicated `✓`
      multi-select marker for any ticket present in `opts.multiSelected`
      (threaded from `state.multiSelect.failed`), independent of the
      existing `▸` cursor marker.
- [x] 6.2 `renderQueuedRow`: render the dedicated `✓` multi-select marker
      for any ticket present in `opts.multiSelected` (threaded from
      `state.multiSelect.queued`), independent of the existing `»` focus
      marker.
- [x] 6.3 Thread `multiSelected` through `render.js`/`grid.js`'s existing
      per-row render call sites.

## 7. Focus-transition clearing

- [x] 7.1 Clear `S.multiSelect.failed` in the `focus-queue`/
      `focus-quickstart` handlers (transitioning away from `focus ===
      'runs'`).
- [x] 7.2 Clear `S.multiSelect.queued` in the existing `exit-queue-focus`
      handler.

## 8. Footer hints and docs

- [x] 8.1 Add `space select` to `sections.js`'s footer hints, gated on a
      FAILED or QUEUED section actually being rendered this frame (same
      discipline as `a address`/`f force-start`).
- [x] 8.2 Update `docs/dashboard.md`'s FAILED and QUEUED key tables with
      `space`, the bulk variants of `a`/`d`/`f`, and the multi-select
      marker.

## 9. Tests

- [x] 9.1 Unit tests for `toggle-multi-select` (add/remove), bulk dispatch
      threshold (empty vs non-empty set), and set-clearing on
      confirm/cancel/focus-transition.
- [x] 9.2 Unit tests for each of the three bulk-execution handlers,
      covering full success, partial failure, and a ticket that vanished
      mid-batch.
- [x] 9.3 Render tests for the multi-select marker (FAILED and QUEUED rows)
      and the bulk confirmation banner / per-row result list text.
- [x] 9.4 Regression test that an open `bulkConfirm` / a rendered
      `bulkResult` is accounted for in the scroll/height budget at all
      three sites (`mergeRenderOpts`, `scrollToShow`'s `winOpts`, `watch.js`'s
      `heightOpts`) — mirroring however the existing `markDoneConfirm`
      threading fix is pinned today (skeptic gate round 1, finding 2).
- [x] 9.5 Test that pressing a non-`y` key (e.g. `j`) while `S.bulkResult`
      is set both clears it AND performs that key's ordinary action (e.g.
      moves the cursor) in the same keypress (skeptic gate round 1,
      finding 3).
