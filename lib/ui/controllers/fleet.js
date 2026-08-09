'use strict';

// Fleet-screen actions: run selection and scrolling, the QUEUED and QUICK
// START local cursors, force-start and clear-queue confirmation gates, the
// quit warning, and the `n` prompt. Dispatched from watch.js's applyAction —
// see lib/ui/controllers/index.js for the contract every controller shares
// (`handle(action, ctx) -> boolean`, mutating only ctx.S).
//
// fleetScreen is a pure renderer module, safe to require here directly; every
// stateful dependency (queue, queueCache, the launcher) arrives via ctx so
// the require-cache fakes test/watch.test.js installs keep flowing through
// watch.js alone.

const crypto = require('crypto');
const fleetScreen = require('../screens/fleet');
// CON-98: the /concertino-address-failure command template (design.md
// Decision 3) — a pure require, same precedent drilldown.js already sets
// for this exact module.
const harnessCmd = require('../harness');

// CON-39, design.md Decision 2: the scroll-into-view adjustment `move` has
// always applied, factored out so the `jump` action (an absolute target
// instead of a relative delta) can share it rather than duplicate it. Uses
// the same visibleWindow() the renderer itself calls, so this decision and
// the next draw()'s actual render can never disagree about what "visible"
// means.
function scrollToShow(ctx, targetSelected) {
  const S = ctx.S;
  const gridCols = process.stdout.columns || 80;
  const winOpts = {
    cols: gridCols,
    rows: ctx.computeScreenRows(),
    selected: targetSelected, scrollOffset: S.scrollOffset, prompt: S.prompt,
    queueNotice: S.queueNotice, restoreNotice: S.restoreNotice, queueState: S.queueState,
    quitConfirm: S.quitConfirm,
    // fleet-metrics-grid final-fix 2: forceStartConfirm/clearQueueConfirm
    // were missing here too — both lengthen buildHeadTail()'s tail just
    // like the four fields already above, so omitting them let this
    // opts object over-estimate columnAreaHeight relative to renderFleet's.
    forceStartConfirm: S.forceStartConfirm, clearQueueConfirm: S.clearQueueConfirm,
    // CON-98, design.md Decision 2: markDoneConfirm's own banner lengthens
    // buildHeadTail()'s tail exactly like forceStartConfirm's — same fix,
    // same reasoning.
    markDoneConfirm: S.markDoneConfirm,
  };
  // fleet-metrics-grid final-fix (Finding 1): the same height-aware gate as
  // draw()'s scrollOffset re-clamp (fleetScreen.gridModeEligible) —
  // `winOpts.rows` is already the real computeScreenRows() value here, so
  // eligibility and the window itself agree about what "this frame" means.
  const win = fleetScreen.gridModeEligible(S.runs, winOpts)
    ? fleetScreen.visibleWindowGrid(S.runs, winOpts)
    : fleetScreen.visibleWindow(S.runs, winOpts);
  if (targetSelected < win.firstVisibleIndex) {
    S.scrollOffset = Math.max(0, S.scrollOffset - (win.firstVisibleIndex - targetSelected));
  } else if (targetSelected > win.lastVisibleIndex) {
    S.scrollOffset = Math.min(win.maxScrollOffset, S.scrollOffset + (targetSelected - win.lastVisibleIndex));
  }
}

// CON-110, tasks.md 3.4: the ONE place a resolved jump target (whichever
// section kind it came from) is actually applied to state — shared by the
// 'jump'/'focus-queue'/'focus-quickstart' cases below (unchanged from
// before this ticket, just factored out) AND 'submit-search''s own
// resolution, so a search-driven jump can never diverge from what the
// identical digit-jump/key action would have done for that same row. `jump`
// is `{ type: 'jump', index } | { type: 'focus-queue', index } |
// { type: 'focus-quickstart', index }` — exactly the shape search.js's
// searchTargets() already produces per row (design.md Decision 3).
function applyJumpAction(ctx, jump) {
  const S = ctx.S;
  switch (jump.type) {
    case 'jump':
      S.selected = Math.max(0, Math.min(jump.index, S.runs.length - 1));
      S.focus = 'runs';
      S.queueFocus = null;
      scrollToShow(ctx, S.selected);
      return true;
    case 'focus-queue':
      S.focus = 'queue';
      S.queueFocus = jump.index;
      return true;
    case 'focus-quickstart':
      S.focus = 'quickstart';
      S.quickStartFocus = jump.index;
      return true;
    default:
      return false;
  }
}

function handle(action, ctx) {
  const S = ctx.S;
  const { queue, queueCache } = ctx.deps;
  switch (action.type) {
    case 'move': {
      S.selected = Math.max(0, Math.min(S.selected + action.delta, S.runs.length - 1));
      scrollToShow(ctx, S.selected);
      return true;
    }

    // CON-39, design.md Decision 2: the digit-jump counterpart to `move`
    // above — an absolute target row instead of a relative delta, same
    // scroll-into-view treatment. Also returns focus to 'runs' (clearing any
    // stale QUEUED-local cursor): a runs-backed jump target is, by
    // construction, never QUEUED itself (see fleet.js's handleKey — QUEUED
    // emits 'focus-queue', never 'jump').
    case 'jump':
      return applyJumpAction(ctx, action);

    // CON-39, design.md Decision 1: jumping INTO QUEUED never touches
    // `selected`/`scrollOffset` at all — it only ever sets the separate,
    // QUEUED-local cursor, preserving the row-index hazard CON-28 avoided by
    // making QUEUED unselectable in the first place.
    case 'focus-queue':
      return applyJumpAction(ctx, action);

    // j/k while focus is 'queue' — moves ONLY queueFocus, clamped to the
    // current pending list (design.md Decision 1). Never touches
    // selected/scrollOffset.
    case 'move-queue-focus': {
      const pendingLen = S.queueState && S.queueState.pending ? S.queueState.pending.length : 0;
      if (!pendingLen) return true; // draw()'s own re-clamp resets focus next frame
      const cur = S.queueFocus == null ? 0 : S.queueFocus;
      S.queueFocus = Math.max(0, Math.min(cur + action.delta, pendingLen - 1));
      return true;
    }

    // Escape while focus is 'queue' — returns to the ordinary run selection,
    // `selected` untouched throughout the round trip.
    case 'exit-queue-focus':
      S.focus = 'runs';
      S.queueFocus = null;
      return true;

    // `f` on a focused pending ticket (design.md Decision 3) — puts the
    // load-bearing overage warning up; nothing starts until the very next
    // keypress confirms it (see 'confirm-force-start' below).
    case 'open-force-start-confirm':
      S.forceStartConfirm = { ticket: action.ticket };
      return true;

    case 'cancel-force-start':
      S.forceStartConfirm = null;
      return true;

    // The force-start confirmation's own 'y' — see queue.js's forceStart()
    // for the bookkeeping this performs (identical to tick()'s own pending ->
    // inFlight admission, minus the maxConcurrent gate, and WITHOUT tick()'s
    // hard-coded `confirmed: true` — design.md Decision 4). Mirrors the
    // tick()-driven launch path in watch.js's draw(): launch via the
    // launcher, update queueState, persist via queue-cache.js. A ticket that
    // already left `pending` between the confirm-open and this keypress
    // (admitted normally, or already force-started) is a no-op —
    // forceStart() itself returns `toLaunch: []` for that case, so nothing
    // here ever spawns a second time.
    case 'confirm-force-start': {
      S.forceStartConfirm = null;
      if (S.queueState) {
        const result = queue.forceStart(S.queueState, action.ticket);
        if (result.toLaunch.length) {
          // CON-69: same per-row-spec preference as the queue tick in
          // watch.js's draw() — a force-started overridden ticket keeps its
          // chosen harness/speed/provider.
          const pt = result.queue.perTicket && result.queue.perTicket[action.ticket];
          const launched = pt
            ? ctx.launcher.launchSpec(action.ticket, pt)
            : ctx.launcher.launch(action.ticket, result.queue.launchCommand);
          if (!launched.spawned) S.queueNotice = launched.error;
          S.queueState = result.queue;
          queueCache.write(ctx.root, S.queueState, S.queueSessionId, Date.now());
          S.focus = 'runs';
          S.queueFocus = null;
        }
      }
      return true;
    }

    // --- CON-40: QUICK START (design.md) ------------------------------

    // CON-39/CON-40, design.md Decision 3: jumping INTO QUICK START never
    // touches `selected`/`scrollOffset` — mirrors 'focus-queue' above
    // exactly, only for the QUICK START-local cursor instead.
    case 'focus-quickstart':
      return applyJumpAction(ctx, action);

    // j/k while focus is 'quickstart' — moves ONLY quickStartFocus, clamped
    // to the CURRENT eligible list (re-derived fresh here, same "never trust
    // a value from a previous draw()" discipline 'quickstart-add' below
    // applies). Never touches selected/scrollOffset. Mirrors
    // 'move-queue-focus' above.
    case 'move-quickstart-focus': {
      const len = ctx.quickStartEligible().length;
      if (!len) return true; // draw()'s own re-clamp keeps the cursor at 0
      const cur = S.quickStartFocus == null ? 0 : S.quickStartFocus;
      S.quickStartFocus = Math.max(0, Math.min(cur + action.delta, len - 1));
      return true;
    }

    // Escape while focus is 'quickstart' — returns to the ordinary run
    // selection WITHOUT hiding the panel (CON-56: the panel is always
    // visible now — there is no toggle to hide it). Mirrors
    // 'exit-queue-focus' above.
    case 'exit-quickstart-focus':
      S.focus = 'runs';
      return true;

    // `a` on the highlighted QUICK START ticket (design.md Decision 5) —
    // `action.index` arrives UNRESOLVED (fleet.js's handleKey has no access
    // to the eligible ticket list, so it emits this unconditionally whenever
    // quickstart focus is active — see its own header comment). This handler
    // is therefore the one place that actually resolves `index` to a ticket:
    // re-derive the eligible list fresh (not a value cached from a previous
    // draw() — the highlighted ticket may have started running by hand, or
    // the list may simply never have had anything eligible in it, in the
    // interim) and no-op (no state change) if `action.index` does not
    // resolve to a real entry in THAT list.
    case 'quickstart-add': {
      const eligible = ctx.quickStartEligible();
      const t = eligible[action.index];
      if (!t) return true; // nothing resolved — stale/empty/shrunk list
      const ticket = t.identifier;
      if (!S.queueState) {
        // No active queue: create one for this single ticket —
        // maxConcurrent: 1 (a lone ticket has no concurrency to speak of,
        // and keeps any LATER quickstart-add appended to this same queue
        // sequential unless the operator separately opens the full launch
        // pad), the same default `launchCommand` the plain `n` prompt and
        // restart already use.
        S.queueState = queue.createQueue([ticket], 1, ctx.launcher.launchCommand);
        S.queueSessionId = crypto.randomUUID();
      } else {
        // An active queue already exists (confirmed or not — enqueueOne
        // does not gate on `confirmed`; see its own header comment) —
        // append, preserving its own maxConcurrent/launchCommand rather
        // than starting a second, competing queue.
        S.queueState = queue.enqueueOne(S.queueState, ticket) || S.queueState;
      }
      // No direct spawn call here — the existing queue.tick() call site at
      // the top of watch.js's draw() (already gated by queue.shouldTick)
      // performs the actual launch and persistence write on the very next
      // poll, unchanged, exactly as it already does for a queue built via
      // the full launch pad's 'confirm-launch'.
      return true;
    }

    // Clear Queue's own open/cancel/confirm trio — reachable from either
    // fleet.js or launchpad.js's identical CLEAR_QUEUE_KEY binding, both
    // routed here the same way force-start's are. 'open' just puts the
    // warning up (queue.js's clearPending() runs only once 'confirm'
    // actually arrives, matching every other y/anything-else gate).
    case 'open-clear-queue-confirm':
      S.clearQueueConfirm = true;
      return true;

    case 'cancel-clear-queue':
      S.clearQueueConfirm = false;
      return true;

    // Drops every still-pending ticket (queue.js's clearPending() — never
    // touches inFlight; a run already launched keeps running). Mirrors the
    // tick()/forceStart() call sites: write the reduced queue back to
    // queue-cache.js, or clear the cache file entirely once nothing (pending
    // or inFlight) is left to track. `queueFocus`/`focus` are reset the same
    // way confirm-force-start resets them on success — the QUEUED section
    // this cursor pointed into may have just emptied out from under it.
    case 'confirm-clear-queue': {
      S.clearQueueConfirm = false;
      if (S.queueState) {
        S.queueState = queue.clearPending(S.queueState);
        if (queue.isIdle(S.queueState)) {
          S.queueState = null;
          queueCache.clear(ctx.root);
          S.queueSessionId = null;
        } else {
          queueCache.write(ctx.root, S.queueState, S.queueSessionId, Date.now());
        }
        S.focus = 'runs';
        S.queueFocus = null;
      }
      return true;
    }

    // See fleet.js's handleKey — issued instead of an immediate 'quit' when
    // the queue still has something pending/in flight. Puts the warning on
    // screen; the actual quit only happens on a repeated q/Ctrl-C (which
    // fleet.js turns into a real 'quit' action).
    case 'request-quit':
      S.quitConfirm = true;
      return true;

    case 'cancel-quit':
      S.quitConfirm = false;
      return true;

    case 'open-prompt':
      S.prompt = { value: '', error: null };
      return true;

    case 'cancel-prompt':
      // CON-21: a draft invocation in flight must be killed, not merely
      // abandoned in memory — otherwise the child process keeps running to
      // completion and, without the seq bump below, its late resolution
      // would still open the draft screen behind the human's back after they
      // had already cancelled.
      if (S.prompt && S.prompt.drafting) {
        if (S.draftCancel) S.draftCancel();
        S.draftCancel = null;
        S.draftSeq++;
      }
      S.prompt = null;
      return true;

    case 'prompt-backspace':
      S.prompt.value = S.prompt.value.slice(0, -1);
      return true;

    case 'prompt-type':
      // Stale error text from a previous failed submit must not linger once
      // the user starts correcting their input.
      S.prompt.value += action.char;
      S.prompt.error = null;
      return true;

    case 'submit-prompt': {
      // The launcher validates the ticket shape before it ever reaches
      // session.spawn — see lib/ui/ticket.js for why that matters — then
      // attempts the spawn. Either way, a failure is reported on the prompt
      // and left open rather than taking the dashboard down. The launcher
      // passes commandFor() the BARE id (the typed value may carry a
      // trailing agent-merge/speed token submitTicket itself parses) — an
      // unparseable value degrades to the base command and is then rejected
      // by submitTicket exactly as before.
      const result = ctx.launcher.launch(action.value);
      if (result.spawned) S.prompt = null;
      else S.prompt.error = result.error;
      return true;
    }

    // --- CON-110: the fleet-wide `/` search prompt ------------------------

    // Mirrors 'open-prompt' above exactly, including its precondition: only
    // reachable once fleet/keys.js's own early-return chain has already
    // ruled out every confirmation gate and the `n` prompt (design.md
    // Decision 4) — no redundant re-check needed here.
    case 'open-search':
      S.search = { value: '' };
      return true;

    case 'search-type':
      S.search.value += action.char;
      return true;

    case 'search-backspace':
      S.search.value = S.search.value.slice(0, -1);
      return true;

    // No other field touched (design.md's "esc cancels with no state
    // change" requirement) — typing into or cancelling out of search never
    // mutates selected/scrollOffset/focus; only a successful jump (below)
    // does.
    case 'cancel-search':
      S.search = null;
      return true;

    // CON-110, tasks.md 3.4/3.5, design.md Decision 3: builds the flat,
    // render-ordered target list FRESH (never a value cached from a
    // previous frame — the same "re-derive at handling time" discipline
    // 'quickstart-add'/'confirm-mark-done' already follow) and resolves the
    // first match. A match dispatches through applyJumpAction (above) — the
    // exact same state mutation the corresponding 'jump'/'focus-queue'/
    // 'focus-quickstart' key/digit press would have applied, never a second,
    // parallel implementation — then closes the prompt. No match is a
    // no-op: the prompt stays open, value untouched, so the query can be
    // corrected.
    case 'submit-search': {
      if (!S.search) return true;
      const targets = fleetScreen.searchTargets(
        S.runs, S.queueState, ctx.quickStartEligible(), ctx.queuedTitles ? ctx.queuedTitles() : null,
      );
      const match = fleetScreen.firstMatch(targets, S.search.value);
      if (!match) return true; // no match — prompt stays open, unchanged
      applyJumpAction(ctx, match.jump);
      S.search = null;
      return true;
    }

    // CON-29: a queue restored from a previous session sits paused
    // (`confirmed: false` — see app-state.js's queueState comment) until the
    // operator presses the key fleet.js's QUEUED-section affordance names —
    // this is that keypress's handler. Flips exactly one field;
    // pending/inFlight are untouched, so the very next poll's tick() call
    // (now unblocked by shouldTick()) proceeds against exactly the
    // reconciled contents the operator was shown, no more and no less.
    // Gated defensively even though fleet.js's own handleKey already only
    // emits this action when a restored-and-unconfirmed queue is on screen.
    case 'confirm-restored-queue':
      if (S.queueState && S.queueState.confirmed === false) S.queueState.confirmed = true;
      return true;

    // --- CON-98: FAILED-row remediation (design.md Decisions 1-3) ---------

    // `a` on a FAILED row (fleet.js's handleKey — see design.md Decision 1
    // for why this needs no controller-side stale-index re-resolution: it
    // resolves `ticket` off `runs[selected]` at keypress time, same as `t`/
    // `l`). This handler re-resolves the RUN fresh from S.runs at handling
    // time, never trusting a value cached from a previous frame — the same
    // discipline every other case in this file follows (design.md Decision
    // 3, tasks.md 5.2).
    case 'address-failure': {
      const run = (S.runs || []).find((r) => r.ticket === action.ticket);
      if (!run) return true; // stale — the run is gone by the time this resolved
      // Scoped to claude-code only (Non-Goals) — an inline notice explains
      // why rather than silently doing nothing, the same discipline
      // N/launch-pad-disabled and the local-provider ticket-draft gate
      // already follow.
      if (run.harness !== 'claude-code') {
        S.addressFailureNotice =
          '/concertino-address-failure isn\'t available for ' + (run.harness || 'this harness') + ' yet';
        return true;
      }
      S.addressFailureNotice = null;
      // session.spawn (called inside submitTicket) already kills any
      // existing (dead) window under this ticket's name before creating the
      // new one (lib/ui/session.js) — no separate kill step is needed here,
      // unlike restart-confirmed's isLive-gated kill-then-spawn (which would
      // wrongly refuse: a FAILED run's window is, by definition, not alive —
      // see design.md's "mechanical facts" #1).
      const result = ctx.deps.submitTicket(action.ticket, harnessCmd.addressFailureCommand(), ctx.session);
      if (!result.spawned) S.addressFailureNotice = result.error;
      return true;
    }

    // `d` on a FAILED row — puts the load-bearing warning up (design.md
    // Decision 2); nothing is written until the very next keypress confirms
    // it (see 'confirm-mark-done' below). Mirrors
    // 'open-force-start-confirm'/'cancel-force-start' exactly.
    case 'open-mark-done-confirm':
      S.markDoneConfirm = { ticket: action.ticket };
      return true;

    case 'cancel-mark-done':
      S.markDoneConfirm = null;
      return true;

    // The mark-done confirmation's own 'y'. Re-resolves the run from S.runs
    // fresh — never a cached value — before writing, the same "confirm
    // opened, then re-derive liveness/presence at execution time" discipline
    // control.js's restartConfirmed/killConfirmed already apply. Writes the
    // run.override event in-process (design.md Decision 2) — a manual,
    // sticky bucket override; this does NOT rewrite or reinterpret any other
    // event already in the log.
    case 'confirm-mark-done': {
      S.markDoneConfirm = null;
      const run = (S.runs || []).find((r) => r.ticket === action.ticket);
      if (!run) return true; // stale — nothing left to mark done
      // Routed through ctx.deps (not a direct require of ../session), so
      // the require-cache fakes test/watch.test.js installs for `session`
      // keep flowing through watch.js alone — see controllers/index.js's
      // own header comment.
      ctx.deps.writeOverrideEvent(ctx.root, action.ticket, 'done');
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle, scrollToShow };
