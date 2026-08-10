'use strict';

// Escalation actions: the dedicated escalation screen (open, context scroll,
// reply box, option-key and wizard answers) and the cross-screen banner's own
// reply namespace (CON-25 — see banner.js's header comment on why the
// `banner-*` verbs must never collide with the bare reply-type/submit-reply
// verbs). Dispatched from watch.js's applyAction — see controllers/index.js
// for the shared contract.
//
// `store` arrives via ctx.deps (never required here) so require-cache fakes
// installed by test/watch.test.js keep flowing through watch.js alone.
// escalationScreen is a pure renderer module, safe to require directly.

const escalationScreen = require('../screens/escalation');

// Writes answer.json and reports what happened — never throws (see
// store.writeAnswer). A confirmed write heads back to the fleet: there is
// nothing left to do on this screen, and the row itself clears once
// `emit-event.sh --await` notices the file and logs `escalation.answered`
// (the dashboard deliberately does not emit that event a second time — see
// store.js). A refusal stays on the escalation screen and is shown, not
// swallowed — but what happens to a typed reply depends on *why* it was
// refused. "already answered" (reason: 'answered') means this decision is
// genuinely moot, so clearing it is correct. Any other failure (reason:
// 'error' — a permissions/IO problem) has nothing to do with what the human
// typed; discarding it there would make someone who wrote a long free-text
// reply retype it after a transient failure, so when there is a reply in
// flight, keep its value and surface the error inline on that reply instead
// of clearing it. (An option-key answer, e.g. pressing 'a' for approve, has
// no typed text to lose — that path has no `escalationReply` at all, so the
// error still needs the banner.)
function answerEscalation(ctx, ticket, value) {
  const S = ctx.S;
  const result = ctx.deps.store.writeAnswer(ctx.root, ticket, value);
  if (result.ok) {
    ctx.backToFleet();
  } else if (result.reason === 'answered') {
    S.escalationReply = null;
    S.escalationNotice = result.error;
  } else if (S.escalationReply) {
    S.escalationReply.error = result.error;
  } else {
    S.escalationNotice = result.error;
  }
}

// CON-46's `answer-sub` write path — mirrors answerEscalation()'s own shape
// and error handling (task 5.3: the "already answered" race is surfaced as a
// notice, not a crash) for a single wizard step instead of the whole
// escalation. Only the last sub-question's write (the one that makes
// `store.writeSubAnswer`'s result `complete: true`) returns to the fleet —
// design.md task 5.2, exactly mirroring `answerEscalation`'s existing
// single-question behaviour with no separate "waiting" interim screen state.
// Any other successful write stays on the escalation screen and advances
// `escalationSubIndex` by exactly one; no action type here accepts an
// arbitrary target index (design.md Decision 6).
function answerEscalationSub(ctx, ticket, index, value, total) {
  const S = ctx.S;
  const result = ctx.deps.store.writeSubAnswer(ctx.root, ticket, index, value, total);
  if (result.ok && result.complete) {
    ctx.backToFleet();
  } else if (result.ok) {
    S.escalationReply = null;
    S.escalationSubIndex = Math.min(index + 1, Math.max(0, total - 1));
  } else if (result.reason === 'answered') {
    S.escalationReply = null;
    S.escalationNotice = result.error;
  } else if (S.escalationReply) {
    S.escalationReply.error = result.error;
  } else {
    S.escalationNotice = result.error;
  }
}

// The banner's own write path (CON-25) — reuses store.writeAnswer, the exact
// function answerEscalation() above calls, so the write side is genuinely
// unchanged. Deliberately does NOT call backToFleet() on success: the whole
// point of the banner is that answering it must leave whatever screen you
// were on exactly as it was (design.md Decision 6). An "already answered"
// race (someone else answered first, e.g. from the dedicated escalation
// screen) is treated the same as success here — the decision is moot either
// way, so there is nothing left for this reply box to hold onto.
function answerBannerEscalation(ctx, ticket, value) {
  const S = ctx.S;
  const result = ctx.deps.store.writeAnswer(ctx.root, ticket, value);
  if (result.ok || result.reason === 'answered') {
    S.globalEscalationReply = null;
    S.globalEscalationTicket = null;
  } else if (S.globalEscalationReply) {
    S.globalEscalationReply.error = result.error;
  }
}

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    case 'open-escalation': {
      S.mode = 'escalation';
      S.escalationTicket = action.ticket;
      // CON-107, design.md Decision 4's round-2 correction: a stale
      // S.escalationHistoryItem left over from a previously-opened
      // historical view must never leak into a genuinely live escalation
      // opened afterward (render()'s opts.historical takes precedence over
      // run.escalation unconditionally) — opening a live escalation always
      // starts from a clean slate.
      S.escalationHistoryItem = null;
      S.escalationReply = null;
      S.escalationNotice = null;
      S.escalationContextScroll = 0;
      // design.md Decision 7: a multi-part escalation must not
      // unconditionally start the wizard at step 0 — a human can back out
      // and reopen the SAME still-live escalation after already answering
      // one or more steps, or the dashboard process itself can restart
      // mid-wizard. Read back any already-recorded sub-answers and resume at
      // the first `null` slot (or 0 when no file exists yet — nothing
      // answered). This is a read, not a second write path — it changes
      // nothing about how an answer is recorded, only which step the wizard
      // opens on.
      const openRun = S.runs.find((r) => r.ticket === action.ticket);
      if (openRun && openRun.escalation && Array.isArray(openRun.escalation.subQuestions)
          && openRun.escalation.subQuestions.length > 0) {
        const recorded = ctx.deps.store.readSubAnswers(ctx.root, action.ticket);
        S.escalationSubIndex = escalationScreen.resumeSubIndex(
          recorded, openRun.escalation.subQuestions.length,
        );
      } else {
        S.escalationSubIndex = 0;
      }
      return true;
    }

    // Lazygit-layout pass: scrolls escalation.js's own context block —
    // upper-bound clamping to the block's real (possibly re-wrapped) size
    // happens lazily at render time (docview.windowBody's own clampScroll),
    // same discipline as every other panel scroll.
    case 'scroll-escalation-context':
      S.escalationContextScroll = Math.max(0, S.escalationContextScroll + action.delta);
      return true;

    case 'open-reply':
      S.escalationReply = { value: '', error: null };
      return true;

    case 'cancel-reply':
      S.escalationReply = null;
      return true;

    case 'reply-backspace':
      S.escalationReply.value = S.escalationReply.value.slice(0, -1);
      return true;

    case 'reply-type':
      S.escalationReply.value += action.char;
      S.escalationReply.error = null;
      return true;

    case 'submit-reply':
      answerEscalation(ctx, action.ticket, action.value);
      return true;

    case 'answer':
      answerEscalation(ctx, action.ticket, action.value);
      return true;

    case 'answer-sub':
      answerEscalationSub(ctx, action.ticket, action.index, action.value, action.total);
      return true;

    // --- cross-screen escalation banner (CON-25) ----------------------
    // Its own action namespace — see banner.js's own header comment for why
    // these must never collide with escalation.js's bare
    // reply-type/submit-reply/... verbs above.

    case 'banner-open-reply':
      S.globalEscalationTicket = action.ticket;
      S.globalEscalationReply = { value: '', error: null };
      return true;

    case 'banner-reply-backspace':
      S.globalEscalationReply.value = S.globalEscalationReply.value.slice(0, -1);
      return true;

    case 'banner-reply-type':
      S.globalEscalationReply.value += action.char;
      S.globalEscalationReply.error = null;
      return true;

    // No backToFleet() here, unlike 'cancel-reply' — cancelling the banner's
    // reply box must leave `mode` and every other screen's state exactly as
    // it was (design.md Decision 6).
    case 'banner-cancel-reply':
      S.globalEscalationReply = null;
      S.globalEscalationTicket = null;
      return true;

    case 'banner-submit-reply':
      answerBannerEscalation(ctx, action.ticket, action.value);
      return true;

    default:
      return false;
  }
}

module.exports = { handle };
