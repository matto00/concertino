# CON-46: Multi-part escalations: a wizard-style TUI for several sub-questions that must each be answered before resuming

## Description

The escalation control plane already works for the single-question case: an agent calls `emit-event.sh escalation --await ticket=<ID> question=<text> options=a,b`, which writes `escalation.raised` and blocks polling for `answer.json`; the dashboard's `lib/ui/screens/escalation.js` renders the question with one key per option (or free text via `t`); an answer writes `answer.json`; `--await` picks it up, emits `escalation.answered`, and returns the answer text to the orchestrator. This is real, working plumbing (CON-11, https://linear.app/helioapp/issue/CON-11/escalations-need-surrounding-context-so-a-decision-can-be-made-without) — this ticket extends it, not replaces it.

Today's schema is strictly **one question, one flat options list** per escalation. There is no way for an orchestrator to raise several genuinely independent sub-questions in one escalation.

## Why this is worth the complexity (the alternative, and why it was rejected)

The cheaper alternative — keep the wire format single-question, and have the orchestrator synthesize multiple concerns into one combined question with combined options — was considered and explicitly rejected: multi-part questions are common enough in practice that forcing every one through manual synthesis was judged not worth dodging the real feature.

## The core correctness requirement

**No sub-question may be sent back to the orchestrator until every sub-question in the escalation has been answered.** A partial answer returned as if the whole escalation were resolved is exactly this project's governing failure class — absent data (the unanswered sub-questions) rendering as healthy data (a complete answer). This must be enforced structurally, not by convention:

* The screen must not be able to submit/return before every sub-question has a recorded answer.
* The answer representation must make "3 of 5 answered" a distinct, checkable state from "5 of 5 answered" — not inferred from an incomplete array that happens to look valid.

## Scope

* `escalation.raised` **schema:** extend to carry an ordered list of sub-questions (each with its own text and options), alongside (not replacing) the single-question shape — existing single-question callers must keep working unchanged.
* `answer.json` **shape:** must represent per-sub-question answers, and must be checkable for completeness before `--await` accepts it as a resolution.
* **Screen UX:** a wizard/step-through model — show sub-question N, accept its answer, advance to N+1; don't allow jumping ahead of an unanswered one. Free-text reply (`t`, per-sub-question) should work the same way it does today.
* `--await`**'s poll loop** (`core/scripts/emit-event.sh`) needs to distinguish "file exists but incomplete" from "file exists and complete" — do not treat the mere presence of `answer.json` as done the way the single-question path currently does.

## Related

File alongside/after the `--await` timeout bug (separate ticket) — that bug means escalations are currently resolving via an inferior plain-chat fallback far more often than the 60-minute deadline implies, and a multi-part wizard UI is only as valuable as the poll loop that's supposed to host it staying alive long enough to be used.
