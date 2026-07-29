## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec
  deltas (`specs/launchpad-detail-pane/spec.md`, `specs/ticket-priority/spec.md`)
  in full.
- Cross-checked every factual claim the design makes about the current code
  against the actual files, not the design's paraphrase of them:
  - `lib/ui/screens/launchpad.js` — confirmed `ticketRow`'s current fixed-width
    budget (`TICKET_ROW_FIXED = 8`, line 133) and its exact column
    composition (`' ' + marker + ' ' + box + ' ' + body + ' ' + status`,
    lines 134-146) match the design's arithmetic (`8 + 1 + PRIORITY_WIDTH`).
    Confirmed the `p` key is already bound to `set-mode: parallel`
    (line 312) — design's choice of capital `P` for the sort toggle
    correctly avoids that collision (key comparisons are case-sensitive
    strings, verified via `handleKey`).
  - `lib/ui/screens/ticketview.js` — confirmed `wrap`/`commentBlock`/`metaLine`/
    `fmtDate` and the inline description/comments assembly in
    `renderTicketView` (lines 33-131) are exactly the logic design.md
    Decision 2 proposes extracting into `lib/ui/ticketDetail.js`.
  - `lib/ui/linear.js` — confirmed `QUERY` (lines 47-79) has no `priority`
    field and `normaliseTicket` (lines 185-214) has no corresponding output
    field, matching the ticket's problem statement exactly.
  - `lib/ui/cache.js` — confirmed the file's own stated contract ("anything
    not well-formed is empty," lines 36-38) and that `read()`/`write()`
    currently carry no `schemaVersion`, matching design.md Decision 1's
    premise.
  - `lib/ui/layout.js` — confirmed `degrade(width, height)` and
    `MIN_BOX_HEIGHT = 3` exist exactly as design.md Decision 4 relies on them.
  - `lib/ui/watch.js` — confirmed `opts.rows` is plumbed as `0 = unbounded`
    (line 425-430), matching `fleet.js`'s identical convention (line 104),
    which design.md Decision 4 depends on.
- Checked `openspec/specs/dashboard-visual-design/spec.md` for a possible
  conflict with adding a third, non-focus-switchable pane to the launch pad —
  the existing "Focus is visually unambiguous" requirement only governs
  Tab-switchable panes (currently epics/tickets); a plain-bordered, non-focus
  detail pane does not contradict it. `proposal.md`'s "Modified Capabilities:
  none" claim for `dashboard-visual-design`/`dashboard-render-loop` holds up.
- Checked capability-name collisions: `openspec/specs/` has no existing
  `launchpad-detail-pane` or `ticket-priority` directory, so both new
  capabilities are genuinely new, not duplicates.
- **Traced the `P` sort-toggle action end to end and found it does not
  actually wire up.** `handleKey` (task 4.4) returns an action object; that
  action is dispatched through `watch.js`'s `applyAction` `switch
  (action.type)` block (verified at `lib/ui/watch.js:767-990`), which has an
  explicit `case` for every existing launch-pad action (`move-launchpad`,
  `switch-pane`, `toggle-select`, `select-all`, `set-mode`,
  `refresh-launchpad`, `open-ticketview`, etc.) and a `default:` for anything
  else (line ~984). A new `toggle-ticket-sort`-style action from the `P` key
  would fall through to that `default` and be silently dropped — `lp` would
  never actually gain the `ticketSort` field the rest of the design depends
  on, and pressing `P` would do nothing.
  - `design.md`'s own Risks/Trade-offs section explicitly names this:
    "`lp.ticketSort` adds new launch-pad state... that `watch.js`'s reducer
    must initialize and persist across polls."
  - But **no task in `tasks.md` touches `watch.js`** — section 4 (tasks
    4.1-4.6) is scoped entirely to `launchpad.js`. `proposal.md`'s "Impact"
    section also omits `lib/ui/watch.js` from its file list.
  - Confirmed this isn't caught by the planned tests either:
    `test/launchpad.test.js` only `require('../lib/ui/screens/launchpad')`
    (verified via grep) — it never touches `watch.js`, so the task-4.6 test
    "`P` toggles sort order" can pass purely by checking `handleKey`'s return
    value and `renderLaunchPad`'s behavior when `lp.ticketSort` is set
    directly on a hand-built `lp` fixture, without ever exercising the actual
    keypress → state-mutation path a user goes through. The task list, as
    written, can be fully checked off while shipping a `P` key that is a
    no-op in the real app.
  - Confirmed this convention (listing `lib/ui/watch.js` explicitly in
    `proposal.md`'s Impact section and in `tasks.md` whenever new UI state/
    keybindings require reducer wiring) is how this project's own prior
    changes did it: `openspec/changes/archive/2026-07-29-agent-merge-role/`'s
    `tasks.md` has an explicit task ("5.4 Update `lib/ui/watch.js` wherever
    it builds `plan`...") and its `proposal.md`'s Impact list names
    `lib/ui/watch.js` directly. This change's planning artifacts deviate from
    that established practice without acknowledging it.
  - By contrast, the inline-detail-pane half of this change does **not** have
    this problem: it reads existing `lp.ticketIndex`/`opts.rows` state that
    already flows into `launchpad.js` with no new action needed, so no
    `watch.js` wiring is required there — confirmed by reading
    `ticketsForEpic`/`open-ticketview`'s existing lookup pattern
    (`lib/ui/watch.js:791-826`), which the detail pane's task 5.1 correctly
    mirrors.

### Verdict: REFUTE

### Change Requests

1. **`tasks.md` section 4 is missing the task(s) needed to make the `P`
   sort-toggle key actually work.** Add an explicit task (or amend 4.4/4.5)
   to update `lib/ui/watch.js`:
   - `openLaunchPad()`'s `launchPad = { ... }` initializer (currently
     `lib/ui/watch.js:294-308`) should seed `ticketSort: 'identifier'` (or
     rely on `undefined` defaulting correctly in `ticketsForEpic` — either is
     fine, but it must be a stated decision, not an implicit gap).
   - `applyAction`'s `switch (action.type)` block needs a new `case` (sibling
     to the existing `case 'set-mode':` at `lib/ui/watch.js:810-811`) that
     sets `launchPad.ticketSort` from the action `handleKey` returns for the
     `P` key. Without this, the action `handleKey` returns is silently
     swallowed by the `default:` branch and the feature does not function.
2. **`proposal.md`'s "Impact" section should list `lib/ui/watch.js`** as a
   modified file, alongside the existing four entries, so the gap in (1) is
   visible at the proposal level too — matching how the project's own prior
   change (`archive/2026-07-29-agent-merge-role`) listed `lib/ui/watch.js`
   explicitly for an analogous reducer-wiring need.
3. **Add (or amend an existing) test that exercises the real keypress →
   state-mutation path for the sort toggle**, not just `handleKey`'s return
   value and `renderLaunchPad`'s behavior against a hand-built `lp` fixture.
   Task 4.6 as currently scoped (testing only `launchpad.js` in isolation)
   would pass even if `watch.js` never wires the action up — it should either
   move/duplicate into a `watch.js`-level test, or task 4's watch.js addition
   (per Change Request 1) should come with its own test coverage confirming
   `P` actually flips `launchPad.ticketSort` through the real dispatch path.

### Non-blocking notes

- Design.md Decision 1 (invalidate the whole cache on schema-version bump
  rather than inferring per-ticket unknown-priority) is a reasonable,
  well-argued reading of the ticket's open-ended "consider whether the cache
  should carry a schema version" prompt — no objection to the choice itself.
- `cache.js`'s `read()` return-shape contract after the schema-version change
  is slightly underspecified (whether the returned object exposes
  `schemaVersion` or only checks it internally) — worth the executor picking
  one explicitly rather than leaving it to fall out of however `write()`'s
  payload shape happens to look, but this is a small enough decision that it
  doesn't block the design gate.
