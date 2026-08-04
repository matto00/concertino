'use strict';

// Ticket-draft actions (CON-21): the headless drafting invocation kicked off
// from the `n` prompt, the draft screen's field editing, and the final
// create-then-launch confirm. Dispatched from watch.js's applyAction — see
// controllers/index.js for the shared contract.
//
// `linear` and `draftHelper` arrive via ctx.deps (never required here): both
// are faked through require-cache substitution by test/watch.test.js, and
// only watch.js is re-required per test — a direct require here would freeze
// the first test's fake for every later one.

function handle(action, ctx) {
  const S = ctx.S;
  switch (action.type) {
    // CON-21, design.md: free text at the `n` prompt (anything
    // parseTicketInput rejects — see fleet.js's promptKey) reaches here
    // instead of an immediate submit. Gated on ticketProvider.kind, matching
    // the launch pad's own provider gate (linear.js's launchPadStatus) — the
    // draft flow is Linear-only for v1, and a non-Linear provider is told so
    // inline rather than the prompt silently doing nothing.
    case 'open-ticket-draft': {
      const provider = (ctx.config && ctx.config.ticketProvider) || {};
      if (provider.kind !== 'linear') {
        if (S.prompt) {
          S.prompt.error = 'ticket drafting needs ticketProvider.kind "linear" — this project uses "' +
            (provider.kind || 'none') + '"';
        }
        return true;
      }
      if (!S.prompt) return true; // defensive — this action only ever fires from an open prompt

      S.prompt.drafting = true;
      S.prompt.error = null;
      const seed = action.seed;
      const seq = ++S.draftSeq;
      const handle_ = ctx.deps.draftHelper.draftTicket(seed);
      S.draftCancel = handle_.cancel;
      // Fire-and-forget, mirroring refreshLaunchPad's own discipline: the
      // 1-second poll timer picks up whichever of these two settles first on
      // its own, nothing here needs to force an extra redraw. `seq` guards
      // against a superseded draft (cancelled, or a second one started
      // before this one settled) still mutating state after the fact.
      handle_.promise.then((result) => {
        if (seq !== S.draftSeq) return;
        S.draftCancel = null;
        S.ticketDraft = {
          seed,
          title: result.title,
          description: result.description,
          acceptanceCriteria: result.acceptanceCriteria,
          field: null,
          error: null,
          creating: false,
        };
        S.prompt = null;
        S.mode = 'ticketdraft';
      }).catch((e) => {
        if (seq !== S.draftSeq) return;
        S.draftCancel = null;
        // A cancelled draft's own rejection is deliberately swallowed —
        // 'cancel-prompt' already bumped draftSeq (and nulled `prompt`
        // itself) BEFORE this ever runs, so `seq !== draftSeq` is what
        // actually distinguishes "human cancelled" from "drafting genuinely
        // failed" here; there is no separate cancelled flag to check.
        if (S.prompt) {
          S.prompt.drafting = false;
          S.prompt.error = String((e && e.message) || e).split('\n')[0];
        }
      });
      return true;
    }

    // CON-21, design.md Decision 3: opens a field for editing, seeded with
    // its current value — mirrors escalation.js's 'open-reply'. Deliberately
    // does NOT clear a prior creation error the way 'draft-field-type'
    // (below) does — merely looking at a field is not yet a correction, and
    // a failed-creation error is exactly the context a human opening a field
    // to fix it needs to still see.
    case 'open-draft-field':
      if (S.ticketDraft) {
        S.ticketDraft.field = { name: action.field, value: String(S.ticketDraft[action.field] || '') };
      }
      return true;

    case 'draft-field-type':
      if (S.ticketDraft && S.ticketDraft.field) {
        S.ticketDraft.field.value += action.char;
        // Stale error text from a previous failed creation must not linger
        // once the human starts actually correcting something — same
        // discipline as 'prompt-type' clearing prompt.error.
        S.ticketDraft.error = null;
      }
      return true;

    case 'draft-field-backspace':
      if (S.ticketDraft && S.ticketDraft.field) S.ticketDraft.field.value = S.ticketDraft.field.value.slice(0, -1);
      return true;

    // Escape while editing a field SAVES it and returns to the overview —
    // unlike escalation.js's reply (a single ephemeral value that Escape
    // discards), each of these three fields is persistent and independently
    // re-editable, so there is nothing to "cancel" here that isn't better
    // served by the top-level 'cancel-draft' below.
    case 'commit-draft-field':
      if (S.ticketDraft && S.ticketDraft.field) {
        S.ticketDraft[S.ticketDraft.field.name] = S.ticketDraft.field.value;
        S.ticketDraft.field = null;
      }
      return true;

    // "Abandon without creating anything" — the ticket.md acceptance
    // criterion. No provider call has been made yet at any point before this
    // (creation only ever happens in 'confirm-draft', below), so there is
    // nothing to undo — clearing the in-memory draft and returning to the
    // fleet IS the whole of "zero side effects".
    case 'cancel-draft':
      S.ticketDraft = null;
      S.mode = 'fleet';
      return true;

    // design.md Decisions 1/5, tasks.md 5.1-5.4: composes the final
    // markdown body, creates the ticket via the one narrowly-scoped Linear
    // write this project makes, then launches the run against the REAL
    // provider-issued id through the existing, unmodified launch path (same
    // {{TICKET}} substitution site as ever), and finally refreshes the
    // launch pad's cache so the new ticket is visible there without a manual
    // refresh. On failure the draft screen stays open with the human's
    // edited content intact and an inline error — no run is ever launched
    // off a failed creation.
    case 'confirm-draft': {
      const draft = S.ticketDraft;
      if (!draft || draft.creating || draft.field) return true;

      const team = ctx.deps.linear.teamKeyFromConfig(ctx.config || {}, process.env);
      if (!team.key) {
        draft.error = 'no ticketProvider.teamKey configured — see config-reference.md';
        return true;
      }

      draft.creating = true;
      draft.error = null;
      const apiKey = process.env.LINEAR_API_KEY;
      // design.md Decision 1: composed once, here, at confirm time — never
      // inside linear.js, which stays a thin transport layer with no
      // knowledge of ticket-body structure. Matches the same
      // "## Acceptance Criteria" heading convention the orchestrator's own
      // Setup phase writes into ticket.md.
      const body = draft.description + '\n\n## Acceptance Criteria\n' + draft.acceptanceCriteria;
      const seq = ++S.draftCreateSeq;

      ctx.deps.linear.createTicket({ apiKey, teamKey: team.key, title: draft.title, description: body })
        .then((issue) => {
          if (seq !== S.draftCreateSeq) return;
          // The launcher for uniformity with every other spawn site — a
          // just-created ticket is not in the cache yet (and carries no
          // labels), so this degrades to the base command today.
          const result = ctx.launcher.launch(issue.identifier);
          S.ticketDraft = null;
          S.mode = 'fleet';
          if (!result.spawned) {
            // No prompt is open at this point to carry the error on —
            // surfaced the same sticky-notice way queueNotice already
            // reports a queued launch that failed to spawn.
            S.queueNotice = 'created ' + issue.identifier + ' but could not start it: ' + result.error;
          }
          ctx.refreshLaunchPad();
        })
        .catch((e) => {
          if (seq !== S.draftCreateSeq) return;
          draft.creating = false;
          draft.error = 'could not create ticket: ' + String((e && e.message) || e).split('\n')[0];
        });
      return true;
    }

    default:
      return false;
  }
}

module.exports = { handle };
