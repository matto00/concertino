## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` (round 1's REFUTE: 3 numbered change requests +
  2 non-blocking notes) in full, then read the revised `ticket.md`,
  `proposal.md`, `design.md`, `tasks.md`, and `specs/harness-sessions/spec.md`
  in full — cold, not trusting the round-1 report's characterization of what
  changed.
- Cross-checked every round-1 item against the actual revised text:
  - **CR1 (cwd-based misclassification / wrong kill target)**: Decision 6 is
    rewritten so "managed" is the **only** path (tmux cross-reference
    resolves to `session.name` AND window name matches `TICKET_RE`); cwd is
    now explicitly "display-only" (`nearTicket` hint in tasks.md 1.5), with
    the alternative I proposed (route cwd-managed rows through freelance
    actions) explicitly considered and rejected with sound reasoning ("a row
    labeled managed that uses the freelance kill would read as a confusing
    halfway state"). `specs/harness-sessions/spec.md` gained the exact
    missing scenario: "A freelance session inside a live ticket's worktree is
    still freelance" (lines 73-81), which now exercises precisely the
    ambiguous case round 1 flagged as dodged. `tasks.md` 1.5/1.7 updated to
    match. **Fixed.**
  - **CR2 (silently swallowed delegated-kill failure)**: Decision 7 now
    explicitly does *not* reuse `drilldown.js`'s `'kill-confirmed'` case
    verbatim for a managed row's kill — the sessions controller's own
    `killManagedConfirmed(ticket)` calls `control.killConfirmed` directly and
    sets `S.sessionsError` on `{killed: false}`. Verified in source
    (`lib/ui/control.js:33-38`, `lib/ui/controllers/drilldown.js:171-175`)
    that this description of the discarded-return-value bug is accurate, and
    that the fix (checking the return value explicitly, writing to the field
    the sessions screen actually renders) closes it. Spec gained "A delegated
    kill failure is surfaced on the sessions view" (lines 161-166).
    `tasks.md` 3.2/3.3 updated to name `killManagedConfirmed` explicitly.
    **Fixed.**
  - **CR3 (ambiguous confirm-state field)**: Decision 7 now has an explicit
    "Confirm-state field" bullet stating a managed row's `k` still writes
    `S.drillConfirm` while a freelance row's uses `S.sessionsKillConfirm`,
    "two different fields for two different row kinds, stated explicitly
    here so an implementer does not have to infer it." `tasks.md` 3.1/3.3
    both name the two fields explicitly. **Fixed.**
  - **Non-blocking note 1** (no `PHASE_ORDER`-style allow-list exists):
    Decision 8 now says so explicitly, crediting the correction. **Fixed.**
  - **Non-blocking note 2** (`/proc/<pid>/comm` 15-byte truncation): Decision
    3 gained an explicit "Caveat" paragraph acknowledging it. **Fixed.**
- Verified the design's factual groundedness did not regress under revision
  by re-reading the actual source it now cites: `lib/ui/session.js` (`name`
  property, `kill`/`attach`, `assertAddressable`), `lib/ui/control.js`
  (`killConfirmed`'s `{killed:false, reason:'not-live'}` shape),
  `lib/ui/controllers/drilldown.js` (`'kill-confirmed'`/`'confirm-action'`
  cases), `lib/ui/router.js` (`SCREENS` registry shape — Decision 8's
  described addition matches exactly), `lib/ui/app-state.js` (`backToFleet()`
  already resets `S.drillConfirm = null` at line 278 — for free, given
  Decision 7's reuse of that field, so no gap there), `lib/ui/watch.js`
  (`applyAction`'s `'attach'`/`'back'` inline handling vs. everything else
  falling through to `controllers.applyAction`), and
  `lib/ui/controllers/index.js` (`CONTROLLERS` registry).
- Traced every ticket AC against the revised spec — all four remain covered,
  and the new scenario closes the AC ("The view distinguishes
  Concertino-managed sessions from freelance ones") round 1 found under-
  tested.

### Verdict: CONFIRM

All three round-1 change requests are genuinely fixed, not just asserted —
each has a corresponding, sound design-decision rewrite, a matching new spec
scenario, and matching task-list updates, and I independently confirmed the
source-code claims underpinning each fix still hold. I found no new
blocking issues; see two minor non-blocking observations below.

### Non-blocking notes

- **`controllers/index.js`'s `CONTROLLERS` array is never named as a file to
  touch.** `applyAction` in `watch.js` handles `'back'`/`'attach'` inline and
  falls through everything else — including every new sessions-only action
  (`open-sessions`, `refresh-sessions`, `move-sessions`,
  `kill-session-managed`, `attach-session`, `kill-session-confirm`,
  `kill-session-confirmed`) — to `controllers.applyAction(action, ctx)`,
  which iterates `lib/ui/controllers/index.js`'s `CONTROLLERS` array
  (currently `[fleet, draft, escalation, drilldown, launchpad, settings]`).
  Neither `design.md` Decision 8, `tasks.md` section 4, nor `proposal.md`'s
  Impact list mentions adding the new `sessions` controller to that array —
  without it, `v` would never open the screen at all. I judge this
  non-blocking rather than a formal change request: it is a one-line,
  entirely mechanical addition an implementer building `controllers/
  sessions.js` "mirroring `controllers/settings.js`'s shape" (as task 3.2
  already instructs) would almost certainly discover while wiring it up —
  and if missed, task 5.2's own manual verification step would catch it
  immediately (the screen simply wouldn't open), unlike CR1/CR2's silent,
  hard-to-notice failure modes. Still worth a one-line addition to `design.md`
  Decision 8 and `tasks.md` task 4.4 (or a new 4.4a) naming
  `controllers/index.js` explicitly, for the same "don't make an implementer
  infer it" discipline CR3's fix already applied elsewhere in this document.
- **`discover(opts)`'s `opts` shape is never specified to carry the
  configured tmux session name.** Decision 6's classification test is
  `session_name === session.name`, but the actual session name is
  configurable (`watch.js:135`: `createSession(cfg.tmuxSession ||
  'concertino', root)`) — it is not always literally `'concertino'`. Nothing
  in `design.md`/`tasks.md` states that `controllers/sessions.js`'s `open()`/
  `refresh()` must pass `ctx.session.name` into `discover({ sessionName })`
  (or equivalent) for this comparison to work for a project that customizes
  `tmuxSession`. Low risk of actually derailing implementation — `ctx.session`
  is already a well-established, visible convention (`drilldown.js` already
  threads it through as `ctx.session`), so the natural thing to do while
  wiring `controllers/sessions.js` is to pass it along — but worth a one-line
  addition to Decision 6 or task 1.1 so this isn't left to be inferred, on
  the same principle CR3 already established in this revision.
