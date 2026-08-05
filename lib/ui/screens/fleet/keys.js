'use strict';

// CON-21, design.md Decision 4: the `n` prompt's ticket-shape branch reuses
// `parseTicketInput` (built on the single `looksLikeTicket` predicate) —
// NOT a second, bare `looksLikeTicket(value)` call, which would misroute
// "CON-21 fast"/"CON-21 --agent-merge" (whole-string match, no whitespace
// tolerance) even though those are exactly how `n` launches today.
const { parseTicketInput } = require('../../prompt');
const {
  CONFIRM_RESTORED_QUEUE_KEY, CLEAR_QUEUE_KEY, bucketRuns, buildSections,
} = require('./sections');

// --- key handling ------------------------------------------------------
// Pure: (key, state) -> action | null. watch.js owns selected/prompt/mode and
// interprets the action; this function never touches them directly, which is
// what lets it be unit tested without a tty and keeps the "screens stay pure"
// property true of the seam the router adds, not just of render().

function promptKey(key, prompt) {
  // Arrow keys and friends are multi-byte escape sequences: ignore them
  // outright. Only a BARE escape cancels, or every up-arrow would close the
  // prompt and leave `[A` behind.
  if (key.length > 1) return null;
  if (key === '\x1b' || key === '') return { type: 'cancel-prompt' };   // Escape / Ctrl-C
  // CON-21: while the headless drafting invocation is in flight, the prompt
  // is busy — only the cancel branch above still applies (watch.js's
  // 'cancel-prompt' handler kills the child process); every other key is a
  // no-op rather than mutating a value that has already been sent off as the
  // draft's seed.
  if (prompt.drafting) return null;
  if (key === '\x7f' || key === '\b') return { type: 'prompt-backspace' };
  if (key === '\r' || key === '\n') {
    const value = (prompt.value || '').trim();
    if (!value) return { type: 'cancel-prompt' };        // empty submit = cancel
    // CON-21, design.md Decision 4: ticket-shaped input (including today's
    // "TICKET speed"/"TICKET --agent-merge" forms) keeps the existing launch
    // path unchanged; everything parseTicketInput rejects — free text, and
    // any ticket-adjacent-but-invalid value like "CON-21 nonsense" — opens
    // the ticket-draft flow instead of showing a validation error.
    if (parseTicketInput(value) !== null) return { type: 'submit-prompt', value };
    return { type: 'open-ticket-draft', seed: value };
  }
  if (key >= ' ') return { type: 'prompt-type', char: key };
  return null;
}

// CON-39, design.md Decision 1: the ordered list of sections actually
// rendered THIS frame (buildSections(...) filtered to non-empty groups, in
// existing render order) that digit N resolves against — the exact same
// buildSections()/bucketRuns() call renderFleet/visibleWindow already use,
// so this numbering can never disagree with what is actually on screen. Each
// entry also carries the runs-backed section's first GLOBAL row index (the
// same flat index space `selected` lives in) — `startIndex` is `null` for
// QUEUED, which has its own, separate index space (see 'focus-queue' below)
// and is never a slot in this one.
//
// CON-56: QUICK START is now unconditionally included by buildSections()
// (no visibility flag to thread through), so this function's only remaining
// per-section inclusion parameter is `metricsVisible`.
//
// `metricsVisible` (lazygit-layout pass) — `handleKey`'s own call site always
// passes `true` (METRICS is unconditional, just like QUICK START now is),
// but this function only needs to know whether the section is INCLUDED, not
// what it actually says, so a bare `{}` stand-in is enough; buildSections'
// METRICS branch only checks `o.metrics` for truthiness.
function sectionJumpTargets(runs, queueState, metricsVisible) {
  // CON-40, design.md Decision 4, mechanism step 4: a `forceRender`-flagged,
  // zero-eligible QUICK START is still visibly rendered (renderFleet, above)
  // and must still consume a digit, or digit numbering would disagree with
  // what is actually on screen — the exact defect this whole numbering
  // scheme exists to prevent. METRICS is the same story, always forceRender.
  const sections = buildSections(bucketRuns(runs), queueState, {
    metrics: metricsVisible ? {} : null,
  }).filter((s) => s.group.length > 0 || s.forceRender);
  let index = 0;
  return sections.map((s) => {
    const startIndex = s.unselectable ? null : index;
    if (!s.unselectable) index += s.group.length;
    return { section: s, startIndex };
  });
}

function handleKey(key, state) {
  const runs = (state && state.runs) || [];
  const selected = (state && state.selected) || 0;
  const prompt = state && state.prompt;
  const quitConfirm = state && state.quitConfirm;
  // CON-39: force-start's own y/anything-else confirmation gate — see
  // buildHeadTail's matching comment on why this is intercepted BEFORE
  // quitConfirm, not folded into it. `focus`/`queueFocus` are the QUEUED-
  // local cursor (design.md Decision 1); `queueState` is read directly off
  // state (already read below for the CON-29 confirm key).
  const forceStartConfirm = state && state.forceStartConfirm;
  const focus = (state && state.focus) || 'runs';
  const queueFocus = state && state.queueFocus;
  const queueState = state && state.queueState;
  // CON-40: the QUICK START-local focus cursor (design.md Decision 3) — read
  // straight off `state`, exactly like `queueFocus`/`queueState` just above,
  // since `handleKey` never receives `opts` (only the ticket LIST itself is
  // `opts`-only — see the digit-jump/`a`-key comments below).
  const quickStartFocus = state && state.quickStartFocus;
  // Clear Queue's own y/anything-else confirmation gate — a plain boolean,
  // checked before forceStartConfirm/quitConfirm (the newest-opened gate
  // intercepts first, same discipline as forceStartConfirm's own comment
  // just below).
  const clearQueueConfirm = state && state.clearQueueConfirm;

  if (clearQueueConfirm) {
    if (key === 'y') return { type: 'confirm-clear-queue' };
    return { type: 'cancel-clear-queue' };
  }

  // Checked first, even before quitConfirm: forceStartConfirm is the more
  // recently opened, narrower gate, and the two must never both try to claim
  // the same keypress (design.md Decision 3 / tasks.md 5.3).
  if (forceStartConfirm) {
    if (key === 'y') return { type: 'confirm-force-start', ticket: forceStartConfirm.ticket };
    return { type: 'cancel-force-start' };
  }

  // The quit-confirmation warning intercepts every key while it is up: a
  // repeated q/Ctrl-C confirms, anything else cancels back to the ordinary
  // fleet view rather than being interpreted as its usual action (moving
  // selection, attaching, ...) underneath a warning that is about to vanish.
  if (quitConfirm) {
    if (key === 'q' || key === '\u0003') return { type: 'quit' };
    return { type: 'cancel-quit' };
  }

  if (prompt) return promptKey(key, prompt);

  // CON-29: confirms a queue restored from a previous session — gated on
  // one actually being present and unconfirmed, so this key does nothing
  // (falls through to whatever else 'c' might mean, i.e. nothing today) on
  // an ordinary fleet view with no restored queue on screen.
  if (key === CONFIRM_RESTORED_QUEUE_KEY && queueState && queueState.confirmed === false) {
    return { type: 'confirm-restored-queue' };
  }

  // CON-39, design.md Decision 1: digit-key section jump, resolved
  // positionally over whatever is actually rendered this frame. A runs-
  // backed target emits 'jump' (absolute `selected`); QUEUED emits
  // 'focus-queue' and QUICK START (CON-40) emits 'focus-quickstart' instead,
  // since neither has a slot in that index space at all. Out of range (more
  // digits than sections currently on screen) is a no-op, identical to any
  // other unbound key. Handled uniformly regardless of `focus`, so pressing
  // a different section's digit while focus is 'queue'/'quickstart' exits
  // that focus and jumps as normal (tasks.md 4.3).
  if (key.length === 1 && key >= '1' && key <= '9') {
    // CON-56: QUICK START is unconditionally included (like METRICS), so
    // sectionJumpTargets only needs `metricsVisible` — always `true` here.
    const targets = sectionJumpTargets(runs, queueState, true);
    const n = parseInt(key, 10) - 1;
    if (n < 0 || n >= targets.length) return null;
    const target = targets[n];
    // CON-40, design.md Decision 3: discriminated by `target.section.kind`
    // — the old blanket `if (target.section.unselectable)` collapse was
    // correct only while QUEUED was the sole possible `unselectable`
    // section; with QUICK START (and now METRICS) added, more than one can
    // be on screen at the same time, so `kind` (not `title`, which QUEUED's
    // own is a dynamic string carrying a live pending count) is what
    // disambiguates.
    switch (target.section.kind) {
      case 'queued': return { type: 'focus-queue', index: 0 };
      case 'quickstart': return { type: 'focus-quickstart', index: 0 };
      case 'metrics': return null; // nothing to focus — a plain summary row
      default: return { type: 'jump', index: target.startIndex };
    }
  }

  // CON-39, design.md Decision 1: while focus is on QUEUED, j/k/f/Escape are
  // reinterpreted against the QUEUED-local cursor instead of the ordinary
  // run selection, and Enter/l/n/N are suppressed outright — they would
  // otherwise act on whatever `runs[selected]` was pointing at before queue-
  // focus was entered, which is not what the operator is looking at. q/
  // Ctrl-C deliberately fall through unchanged below, independent of focus.
  if (focus === 'queue') {
    if (key === 'j' || key === '\x1b[B') return { type: 'move-queue-focus', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-queue-focus', delta: -1 };
    if (key === 'f') {
      const pending = queueState && queueState.pending;
      const ticket = (pending && queueFocus != null) ? pending[queueFocus] : null;
      if (!ticket) return null;
      return { type: 'open-force-start-confirm', ticket };
    }
    // CON-54: opens the ticket detail view for the QUEUED-focused row —
    // resolved the same way `f`'s `open-force-start-confirm` just above
    // resolves its own `ticket`, since `queueState` genuinely lives in
    // `state` (unlike QUICK START's eligible-ticket list, `opts`-only —
    // see the `focus === 'quickstart'` block's `a` comment below).
    if (key === 't') {
      const pending = queueState && queueState.pending;
      const ticket = (pending && queueFocus != null) ? pending[queueFocus] : null;
      if (!ticket) return null;
      return { type: 'view-ticket', ticket };
    }
    if (key === '\x1b') return { type: 'exit-queue-focus' };            // bare Escape only
    if (key === '\r' || key === 'l' || key === '\x1b[C' || key === 'n' || key === 'N') return null;
  }

  // CON-40, design.md Decision 3: while focus is on QUICK START, j/k/a/
  // Escape are reinterpreted against the QUICK START-local cursor instead
  // of the ordinary run selection, and Enter/l/n/N are suppressed outright —
  // sibling to the `focus === 'queue'` block above, not folded into it (a
  // ticket row has no run/no pending-queue position; sharing one block would
  // conflate two different index spaces). `a` is emitted UNCONDITIONALLY —
  // `handleKey` has no access to the eligible ticket list at all (it is
  // `opts`-only, never part of `currentState()` — design.md Decision 3's
  // "handleKey has no ticket data" note), so unlike queue-focus's own `f`
  // branch (which can check `queueState.pending[queueFocus]` because
  // `queueState` genuinely lives in `state`), this cannot refuse `a` when
  // nothing is highlighted. Resolution — and the no-op-if-nothing-resolves
  // check — happens in watch.js's `quickstart-add` handler instead, which
  // re-derives the eligible list fresh at handling time regardless.
  if (focus === 'quickstart') {
    if (key === 'j' || key === '\x1b[B') return { type: 'move-quickstart-focus', delta: 1 };
    if (key === 'k' || key === '\x1b[A') return { type: 'move-quickstart-focus', delta: -1 };
    if (key === 'a') return { type: 'quickstart-add', index: quickStartFocus };
    // CON-54: opens the ticket detail view for the QUICK START-focused row.
    // Emitted UNCONDITIONALLY, exactly like `a`/`quickstart-add` immediately
    // above — `handleKey` has no access to the eligible ticket list (it is
    // `opts`-only), so resolution and the no-op-if-nothing-resolves check
    // both happen in watch.js's `view-ticket-quickstart` handler instead.
    if (key === 't') return { type: 'view-ticket-quickstart', index: quickStartFocus };
    if (key === '\x1b') return { type: 'exit-quickstart-focus' };       // bare Escape only
    if (key === '\r' || key === 'l' || key === '\x1b[C' || key === 'n' || key === 'N') return null;
  }

  // Bound whenever a QUEUED section is actually on screen (pending.length,
  // same gate the footer hint above uses), independent of `focus` — an
  // operator should be able to clear the queue whether or not they have
  // drilled into it. Puts the confirmation warning up; nothing is dropped
  // until the very next keypress confirms it (clearQueueConfirm, above).
  if (key === CLEAR_QUEUE_KEY && queueState && queueState.pending && queueState.pending.length) {
    return { type: 'open-clear-queue-confirm' };
  }

  if (key === 'n') return { type: 'open-prompt' };
  // Capital N, deliberately distinct from lowercase n (single-ticket quick
  // launch, already bound). Always bound — even when the feature gate is
  // off — so pressing it explains WHY rather than doing nothing; see
  // launchpad.js's own rendering of linear.js's launchPadStatus reasons.
  // This is also the ONLY new entry point this slice adds: unlike attach (↵),
  // drill-down (l) and the escalation answer screen (↵), which together were
  // flagged as accretion worth watching, the launch pad is reachable from
  // exactly one place — the fleet view — on exactly one key.
  if (key === 'N') return { type: 'open-launchpad' };
  // CON-57: opens the settings screen (view/edit concertino.config.json) —
  // confirmed free in this handleKey before being claimed (ticket.md); bound
  // unconditionally like every other fleet-screen entry point above this
  // point in the function, since every prompt/confirmation gate that would
  // need to intercept it first has already returned above.
  if (key === 's') return { type: 'open-settings' };
  // CON-78: opens the sessions view (every discovered harness process,
  // Concertino-managed or freelance) — `v` chosen because it, and `w`, are
  // the only unclaimed lowercase letters at the fleet screen's top level
  // (design.md Decision 8) — see the letters already bound above:
  // a c d f h H j k l L m n N p P q r s S t y.
  if (key === 'v') return { type: 'open-sessions' };
  if (key === 'q' || key === '\u0003') {                                 // q / Ctrl-C
    // A queue with anything still pending or in flight would otherwise be
    // silently abandoned by an immediate quit — not just on a crash, on a
    // deliberate `q` too. Ask first; `request-quit` puts the warning up
    // (rendered above, in renderFleet) rather than tearing the screen down
    // right away.
    const qs = state && state.queueState;
    const remaining = qs ? (qs.pending.length + (qs.inFlight ? qs.inFlight.size : 0)) : 0;
    if (remaining > 0) return { type: 'request-quit' };
    return { type: 'quit' };
  }
  // Arrow keys arrive as a three-byte escape sequence in raw mode.
  if (key === 'j' || key === '\x1b[B') return { type: 'move', delta: 1 };
  if (key === 'k' || key === '\x1b[A') return { type: 'move', delta: -1 };
  if (key === '\r' && runs[selected]) {
    const run = runs[selected];
    // A live escalation routes to the answer screen instead of straight to
    // tmux — that is the whole point of the control plane. A stale one, or no
    // escalation at all, attaches exactly as before.
    if (run.escalation && !run.escalationStale) {
      return { type: 'open-escalation', ticket: run.ticket };
    }
    return { type: 'attach', ticket: run.ticket };
  }
  // `l` (and its arrow-key alias, matching the existing j/k aliasing below)
  // drills into the selected run — the timeline, gates and evidence panels a
  // one-line fleet row has no room for.
  if ((key === 'l' || key === '\x1b[C') && runs[selected]) {
    return { type: 'open-drilldown', ticket: runs[selected].ticket };
  }
  // CON-54: additive to `l`'s run-drilldown binding just above — opens the
  // ticket detail view (not the drilldown) for the currently selected
  // RUNNING/DONE row. Only reached when neither the QUEUED nor QUICK START
  // focus block above intercepted `t` first (focus === 'runs').
  if (key === 't' && runs[selected]) {
    return { type: 'view-ticket', ticket: runs[selected].ticket };
  }
  return null;
}

module.exports = { promptKey, sectionJumpTargets, handleKey };
