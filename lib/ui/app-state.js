'use strict';

// The dashboard's whole mutable state, in one container. Every piece of
// screen state lives here, never in a screen module — that is the whole
// point of the router seam (see lib/ui/router.js): `mode` picks which screen
// is on top; the rest are the sub-states individual screens read out of the
// snapshot `currentState()` builds. Screens never mutate any of this —
// handleKey returns an action describing what happened, and the controller
// modules under lib/ui/controllers/ (dispatched from watch.js's applyAction)
// are the only place state changes.
//
// The field-by-field design notes that used to sit on watch.js's closure
// `let`s live here now, unchanged — they document decisions, not narration.
function createAppState() {
  return {
    mode: 'fleet',
    runs: [],
    selected: 0,
    // How many selectable rows (design.md Decision 2's flat NEEDS YOU/FAILED/
    // RUNNING/DONE index space) are hidden from the start of the scrollable
    // region (everything after the pinned, always-fully-shown NEEDS YOU) —
    // the fleet screen's own scroll position. Owned at the app level, next to
    // `selected`, for the same reason `selected` is: the renderer stays a
    // pure (runs, opts) -> string function, and only the controller layer
    // decides *when* to scroll (CON-6, design.md Decision 3).
    scrollOffset: 0,
    prompt: null,                // null, or { value, error } while `n` is open
    escalationTicket: null,      // which run's escalation the screen shows
    escalationReply: null,       // null, or { value, error } while typing 't'
    escalationNotice: null,      // a write failure ("already answered", ...)
    // The lazygit-layout pass's own scroll offset for escalation.js's context
    // block — reset alongside escalationTicket whenever a different (or no)
    // escalation is shown.
    escalationContextScroll: 0,
    // CON-46: which wizard step a multi-part escalation is showing. Reset
    // alongside escalationTicket, but NOT unconditionally to `0` on
    // `open-escalation` — design.md Decision 7: it is recomputed from any
    // already-recorded sub-answers (store.readSubAnswers) so backing out and
    // reopening a still-live, partially-answered wizard resumes at the first
    // unanswered step rather than silently risking an overwrite. Meaningless
    // (and ignored) for a single-question escalation.
    escalationSubIndex: 0,
    drillTicket: null,           // which run the drill-down screen shows
    drillConfirm: null,          // null, or 'kill'|'restart' awaiting a 'y'
    drillNotice: null,           // a restart-spawn failure, surfaced on screen
    // CON-19, extended by the lazygit-layout pass's four-panel focus model
    // (drilldown.js's DRILL_PANELS): `drillFocus` is always one of 'ticket'
    // (default — the first panel), 'timeline', 'gates', or 'evidence' — never
    // null. Digit keys 1-4 jump directly; \t cycles through all four.
    // `drillEvidenceIndex` is meaningful only while `drillFocus ===
    // 'evidence'`, but kept around (not reset) while focus is elsewhere, so
    // cycling away from EVIDENCE and back never forgets the last selection.
    drillFocus: 'ticket',
    drillEvidenceIndex: 0,
    // The lazygit-layout pass's own free-scroll offsets for the three
    // non-selection panels — TICKET/TIMELINE/GATES each scroll independently
    // via 'drill-panel-scroll' (drilldown.js's own handleKey), unlike
    // EVIDENCE's selection-driven `drillEvidenceIndex` above. Reset to 0
    // alongside drillFocus/drillEvidenceIndex whenever the drill-down opens
    // on a (possibly different) run — a fresh run always starts scrolled to
    // the top of every panel.
    drillTicketScroll: 0,
    drillTimelineScroll: 0,
    drillGatesScroll: 0,
    // The evidence reader's own state (mode = 'docview', entered ONLY via
    // 'open-evidence-doc' — design.md Decision 3a). `docTitle`/`docBody` are
    // the opened entry's resolved { title, body } (body already markdown-
    // stripped and word-wrapped — see the drilldown controller's
    // 'open-evidence-doc' case); `docScroll` is this reader's own scroll
    // offset. `docViewportRows` is recomputed every draw() from the current
    // terminal rows (docview.computeViewportRows) — the SAME budget render()
    // itself uses, precomputed because router.handleKey's own seam carries
    // no `opts` and so cannot recompute it live at keypress time (see
    // docview.js's own comment on this).
    docTitle: null,
    docBody: null,
    docScroll: 0,
    docViewportRows: Infinity,
    // ticketview.js's own scroll state, now that its box is bounded/scrollable
    // rather than always growing to fit (design.md Decision 2) — independent
    // of, and never confused with, the evidence reader's own scroll state
    // above. `ticketviewViewportRows`/`ticketviewBodyLineCount` are the same
    // "precomputed ahead of the next keypress" values docViewportRows is,
    // recomputed every draw() while ticketview.js is on screen.
    ticketviewScroll: 0,
    ticketviewViewportRows: Infinity,
    ticketviewBodyLineCount: 0,
    // The cross-screen escalation banner's own reply sub-state (CON-25) —
    // mirrors escalationTicket/escalationReply's SHAPE but is a fully
    // independent pair, never aliased to it: the banner can be open for a
    // DIFFERENT run than whatever the dedicated escalation screen (if any)
    // is currently showing. Recomputed each poll from `runs`; see
    // frame.computeLiveEscalations() and draw()'s own comment on why the
    // oldest live one is always what this targets.
    globalEscalationTicket: null,
    globalEscalationReply: null, // null, or { value, error } while typing 'g'
    // The whole set the banner could name — recomputed on every draw(); read
    // by onKey() to decide whether 'g' should do anything at all.
    liveEscalations: [],
    // The launch pad's own state. Deliberately NOT reset by backToFleet():
    // the cache, the current epic/ticket selection and the sequential/
    // parallel choice all survive a trip back to the fleet and a later
    // re-entry on `N`, which is what "instant, offline browsing" (design
    // doc, "Ticket cache") actually means in practice — re-opening the
    // launch pad mid-session must not lose your in-progress selection or
    // force a re-read of a cache that has not gone stale. Stays null until
    // `N` is pressed for the first time, so a session that never opens it
    // pays nothing.
    launchPad: null,
    // A point-in-time snapshot built fresh every time `L` is pressed (ports,
    // base commit, concurrency, harness) — unlike launchPad, this is cheap
    // to throw away and rebuild, so cancelling or confirming both null it
    // out.
    launchPlan: null,
    // The lazygit-layout pass's own scroll offset for launchplan.js's ticket
    // list — reset to 0 alongside `launchPlan` itself (a freshly-built plan
    // always starts scrolled to the top).
    launchPlanTicketScroll: 0,
    // The queue runner (lib/ui/queue.js). null whenever nothing is queued.
    //
    // CON-29: persisted to `.concertino/cache/queue.json` on every tick (see
    // the queue.tick() call site in watch.js's draw()) via
    // lib/ui/queue-cache.js — the same durable-cache pattern the dashboard
    // already uses for tickets (cache.js/linear.json) — and removed once the
    // queue goes idle. Read back at startup, reconciled against a one-off
    // fleet snapshot through queue.createRestoredQueue()/reconcileRestored()
    // (the same isRunLive predicate tick() itself uses), and restored into a
    // PAUSED/UNCONFIRMED queue (`confirmed: false`) rather than resumed
    // silently: queue.shouldTick() — the guard at the tick() call site —
    // refuses to call tick() at all until the operator presses the confirm
    // key fleet.js's QUEUED section advertises for a restored queue (see
    // 'confirm-restored-queue' in the fleet controller). A queue built fresh
    // via queue.createQueue() (the 'confirm-launch' action) always sets
    // `confirmed: true` explicitly instead, so that guard is unambiguous for
    // every queue object either path produces. See design.md for the full
    // reconciliation design.
    queueState: null,
    // Threaded through to every queueCache.write() call for the lifetime of
    // one queue: minted fresh (crypto.randomUUID()) when 'confirm-launch'
    // creates a same-session queue, or carried over from the restored
    // record's own sessionId when a queue is restored at startup — either
    // way, null exactly when queueState is null (CON-29). Not used for
    // locking; see queue-cache.js's own header comment on why age, not
    // session identity, is the actual staleness gate.
    queueSessionId: null,
    queueNotice: null,           // a queued ticket's submitTicket failure
    // CON-37: sticky notice naming any pending ticket ids the startup
    // restore block dropped because their run completed DURING the downtime
    // (not before the queue file was even written — see queue.js's
    // reconcileRestored). Same "set once, persists until overwritten"
    // lifecycle as queueNotice above, but deliberately independent of
    // queueState: it must still be shown even when reconciliation leaves
    // nothing to restore at all (createRestoredQueue returns null in exactly
    // that case) — see design.md Decision 4.
    restoreNotice: null,
    // Set by the fleet screen's own 'request-quit' action (see fleet.js's
    // handleKey) the first time `q`/Ctrl-C is pressed while queueState still
    // has anything pending or in flight — the un-started tail of a batch
    // would otherwise be discarded by a deliberate quit exactly as silently
    // as by a crash. A second 'q' (handled while this is true) actually
    // quits; any other key clears it via 'cancel-quit' without quitting.
    quitConfirm: false,
    // CON-39: the QUEUED-local focus cursor (design.md Decision 1). `focus`
    // defaults to 'runs' — the ordinary run selection, unaffected by any of
    // this — and flips to 'queue' only via the digit-jump-into-QUEUED action
    // ('focus-queue') or the launch-pad's own force-start entry point.
    // `queueFocus` is an index into `queueState.pending`, meaningful only
    // while `focus === 'queue'`; re-clamped every draw() (mirroring
    // `scrollOffset`'s own re-clamp) so a queue that shrinks or empties out
    // from under it never leaves a stale, out-of-range cursor on screen
    // (design.md's "Risks" note).
    focus: 'runs',
    queueFocus: null,
    // `{ ticket } | null` — force-start's own y/anything-else confirmation
    // gate (design.md Decision 3), independent of `quitConfirm` above: the
    // two must never both try to claim the same keypress (see fleet.js's
    // handleKey, which checks this one FIRST).
    forceStartConfirm: null,
    // CON-56: QUICK START is always shown now (no visibility flag) — this is
    // just its own local focus cursor, an index into the eligible-ticket
    // list draw() recomputes every poll (quickStartEligible), meaningful
    // only while `focus === 'quickstart'`, same relationship `queueFocus`/
    // `focus === 'queue'` already have. Defaults to `0`: the section is on
    // screen from the first frame, so there is no "not yet shown" state for
    // this to model.
    quickStartFocus: 0,
    // Clear Queue's own y/anything-else confirmation gate — a plain boolean
    // (there is nothing to name but "the queue"), reachable from BOTH the
    // fleet view and the launch pad (fleet.js's and launchpad.js's own
    // CLEAR_QUEUE_KEY bindings), so it lives here at the app level like
    // every other cross-screen sub-state rather than inside either screen's
    // own local state. Checked ahead of forceStartConfirm/quitConfirm in
    // both screens' handleKey — see their own matching comments.
    clearQueueConfirm: false,
    // CON-21: the ticket-draft screen's own state (mode = 'ticketdraft').
    // `ticketDraft` is `null` until the headless drafting invocation
    // resolves — see the draft controller's 'open-ticket-draft' case, which
    // owns `prompt` (not this) while the invocation is in flight.
    // `draftCancel` is that invocation's own cancel() handle (design.md's
    // "drafting…" risk mitigation, tasks.md 2.3), meaningful only while
    // `prompt.drafting` is true. `draftSeq`/`draftCreateSeq` are bumped on
    // every cancel/new attempt so a superseded promise's late resolution can
    // recognise itself as stale and no-op rather than clobbering whatever
    // state has moved on to since (mirrors the launch pad's own
    // generation-free "read the latest snapshot, never trust a captured one"
    // discipline, applied here because these two calls are genuinely async
    // and outlive a single keypress).
    ticketDraft: null,
    draftCancel: null,
    draftSeq: 0,
    draftCreateSeq: 0,
    // CON-57: the settings screen's own session state (mode = 'settings').
    // `null` until `s` is first pressed; rebuilt FRESH by the settings
    // controller's openSettings() every time the screen is entered
    // (design.md Decision 4 — deliberately NOT reused across visits the way
    // `launchPad` is, since config on disk can change between visits and
    // re-reading a local JSON file plus the static schema is cheap). Cleared
    // back to `null` by backToFleet(), same as every other screen's own
    // per-visit state.
    settings: null,
    // CON-54, design.md Decision 5: tracks which screen the ticket detail
    // view (mode = 'ticketview') was most recently opened FROM —
    // 'launchpad' | 'fleet' | null. `ticketview.js`'s own `esc` action keeps
    // emitting the identical `{ type: 'back-to-launchpad' }` shape it always
    // has (its pure handleKey contract, and the tests pinning it, are
    // unchanged); this field is what 'back-to-launchpad''s handler reads to
    // decide the actual destination. Defaults to `null` so a mid-session
    // process upgrade (or any path that reaches 'ticketview' without going
    // through one of the three entry points that set this) degrades safely
    // to the pre-existing backToLaunchPad() behavior. Reset to `null`
    // whenever consumed, and defensively in backToFleet() — same "leaked
    // per-visit state must never survive into an unrelated screen"
    // discipline docTitle/ticketDraft/settings already follow there.
    ticketviewReturnMode: null,
    // CON-78: the sessions screen's own state (mode = 'sessions'). `null`
    // until `v` is first pressed (mirrors settings' own "null until opened"
    // discipline) — rebuilt fresh every time openSessions() runs a
    // discovery pass. `sessionsSelected` is the cursor into `sessionsData`.
    // `sessionsKillConfirm` mirrors forceStartConfirm's own y-confirm shape,
    // but is deliberately a DIFFERENT field from `drillConfirm` (design.md
    // Decision 7's own confirm-state-field bullet) — a managed row's kill
    // confirm reuses `drillConfirm` as its boolean GATE (it delegates to the
    // exact same underlying action the drill-down uses), a freelance row's
    // uses this one instead for both gate and target, since there is no
    // run/ticket for `drillConfirm` to key on.
    //
    // `sessionsConfirmTicket` (evaluator cycle-1 change request 1): the
    // managed row's own captured TARGET, set the moment `k` is pressed —
    // `drillConfirm === 'kill'` alone is not enough to know WHICH ticket is
    // being confirmed, and re-deriving it from `sessionsData[sessionsSelected]`
    // at `y`-press time is exactly the bug this field exists to close: the
    // sessions screen's own background auto-refresh can replace/reorder
    // `sessionsData` while the confirm sits on screen, and the operator's
    // `y` must never land on a different session than the one they read the
    // warning for. `null` whenever no managed kill is being confirmed.
    //
    // `sessionsError` is a one-line failed-kill/attach notice, cleared on
    // the next refresh.
    sessionsData: null,
    sessionsSelected: 0,
    sessionsKillConfirm: null,
    sessionsConfirmTicket: null,
    sessionsError: null,
  };
}

// The read-only snapshot handed to router.render()/handleKey() every frame
// and keypress — exactly the field set the screens have always received.
// Deliberately NOT a spread of the whole container: queueSessionId/
// draftCancel/draftSeq/draftCreateSeq are controller-internal bookkeeping no
// screen reads, and keeping the snapshot's shape fixed keeps every screen
// test's state fixtures meaningful.
function currentState(S) {
  return {
    mode: S.mode, runs: S.runs, selected: S.selected, scrollOffset: S.scrollOffset,
    prompt: S.prompt, escalationTicket: S.escalationTicket, escalationReply: S.escalationReply,
    escalationNotice: S.escalationNotice,
    escalationContextScroll: S.escalationContextScroll, escalationSubIndex: S.escalationSubIndex,
    drillTicket: S.drillTicket, drillConfirm: S.drillConfirm, drillNotice: S.drillNotice,
    launchPad: S.launchPad, launchPlan: S.launchPlan, launchPlanTicketScroll: S.launchPlanTicketScroll,
    queueNotice: S.queueNotice, restoreNotice: S.restoreNotice,
    queueState: S.queueState, quitConfirm: S.quitConfirm,
    globalEscalationTicket: S.globalEscalationTicket, globalEscalationReply: S.globalEscalationReply,
    liveEscalations: S.liveEscalations,
    drillFocus: S.drillFocus, drillEvidenceIndex: S.drillEvidenceIndex,
    drillTicketScroll: S.drillTicketScroll, drillTimelineScroll: S.drillTimelineScroll,
    drillGatesScroll: S.drillGatesScroll,
    docTitle: S.docTitle, docBody: S.docBody, docScroll: S.docScroll, docViewportRows: S.docViewportRows,
    ticketviewScroll: S.ticketviewScroll, ticketviewViewportRows: S.ticketviewViewportRows,
    ticketviewBodyLineCount: S.ticketviewBodyLineCount,
    focus: S.focus, queueFocus: S.queueFocus, forceStartConfirm: S.forceStartConfirm,
    quickStartFocus: S.quickStartFocus, clearQueueConfirm: S.clearQueueConfirm,
    ticketDraft: S.ticketDraft,
    settings: S.settings,
    ticketviewReturnMode: S.ticketviewReturnMode,
    sessionsData: S.sessionsData, sessionsSelected: S.sessionsSelected,
    sessionsKillConfirm: S.sessionsKillConfirm, sessionsConfirmTicket: S.sessionsConfirmTicket,
    sessionsError: S.sessionsError,
  };
}

function backToFleet(S) {
  S.mode = 'fleet';
  S.escalationTicket = null;
  S.escalationReply = null;
  S.escalationNotice = null;
  S.escalationContextScroll = 0;
  S.escalationSubIndex = 0;
  S.drillTicket = null;
  S.drillConfirm = null;
  S.drillNotice = null;
  S.drillFocus = 'ticket';
  S.drillEvidenceIndex = 0;
  S.drillTicketScroll = 0;
  S.drillTimelineScroll = 0;
  S.drillGatesScroll = 0;
  // Defensive — mode = 'docview' always routes back to 'drilldown' (never
  // straight to 'fleet'; see the drilldown controller's
  // 'back-to-drilldown-from-doc' case), but clearing the reader's own state
  // here too means it can never leak into a later, unrelated screen.
  S.docTitle = null;
  S.docBody = null;
  S.docScroll = 0;
  // Defensive, same reasoning — mode = 'ticketdraft' always routes back to
  // 'fleet' via its own 'cancel-draft'/'confirm-draft' handling, which
  // already clears this, but a leaked draft must never survive into a
  // later, unrelated screen either way.
  S.ticketDraft = null;
  // CON-57: mode = 'settings' always routes back to 'fleet' too (Escape
  // discards, a successful save also returns here — see 'settings-save' in
  // the settings controller) — cleared here so a leaked settings session
  // can never survive into a later, unrelated screen (same discipline as
  // ticketDraft/docTitle/etc. just above).
  S.settings = null;
  // CON-54: defensive reset, same discipline as settings/ticketDraft just
  // above — 'back-to-launchpad' already resets this on every consumption,
  // but a leaked value must never survive into an unrelated screen either
  // way.
  S.ticketviewReturnMode = null;
  // CON-78: mode = 'sessions' always routes back to 'fleet' too (Escape
  // discards — see sessions.js's own handleKey) — cleared here so a leaked
  // discovery snapshot/confirm/error can never survive into a later,
  // unrelated screen (same discipline as settings/ticketDraft/etc. above).
  S.sessionsData = null;
  S.sessionsSelected = 0;
  S.sessionsKillConfirm = null;
  S.sessionsConfirmTicket = null;
  S.sessionsError = null;
}

function backToLaunchPad(S) {
  S.mode = 'launchpad';
  S.launchPlan = null;
  S.launchPlanTicketScroll = 0;
}

module.exports = { createAppState, currentState, backToFleet, backToLaunchPad };
