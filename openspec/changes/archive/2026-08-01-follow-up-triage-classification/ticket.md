# CON-51: Follow-up triage: determine fold-in vs. standalone vs. discard before asking for approval

## Description

Deliveries routinely surface suggested follow-up work (evaluator non-blocking notes, skeptic non-blocking notes, an orchestrator's own "should I file a ticket for X?"). Matt has been approving essentially everything he sees, but by his own description that approval is uninformed: there's currently no signal distinguishing "this is genuinely separable follow-up work" from "this is small/related enough it should just be folded into the current change" from "this isn't actually worth doing." The suggestion arrives as a bare yes/no with no structured basis for the call.

This has already gone wrong once in a way worth naming directly: CON-30's fold-in of CON-42/CON-43 was approved, Linear was updated, `escalation.answered` recorded it correctly — and the actual planning/execution never covered that scope, because the fold-in decision never got threaded into a fresh planning pass. The eventual fix was splitting it back out. A triage step that actually distinguished "fold in" (which requires re-planning, not just a flag) from "file separately" (which requires nothing further from the current run) would have surfaced that gap before approval, not after a wasted round-trip.

## Proposed change

Before a suggested follow-up reaches the human for a bare approve/reject, run it through an explicit classification step with concrete, checkable signals rather than raw judgment:

* **File overlap** — does the suggested work touch files already modified in this change? High overlap favors fold-in (avoids a second PR re-touching the same lines); low/no overlap favors standalone.
* **Acceptance-criteria relevance** — is this actually required to satisfy the current ticket's acceptance criteria (i.e. it's in scope already and shouldn't be "follow-up" at all), or is it a genuine adjacent enhancement?
* **Effort/size** — small, no new design-gate-worthy decisions → fold-in candidate; needs its own design/skeptic pass → standalone ticket.
* **Cost of folding in** — folding in extends the current run's cycles/budget; that tradeoff should be visible to whoever approves it, not implicit.

The classification's output — not just a raw suggestion — is what gets presented at escalation time (reusing CON-11's context-carrying escalation mechanism, and routed through escalation rather than bare chat per CON-48), so Matt's approval is against stated reasoning ("high file overlap + small effort → recommend fold-in") rather than a title alone.

**Whichever path is chosen must actually happen, not just get recorded.** CON-30's failure was a recorded decision with no corresponding action — if "fold in" is chosen, the current run's plan must be genuinely revised (a real fresh planning pass covering the added scope, re-running the design gate) before execution continues, not merely flagged as decided while the original plan/tasks are left untouched.

## Open question

Where does this triage step live — inside the orchestrator's own follow-up-suggestion path (extending CON-48), as a shared script/procedure multiple roles call, or something else? Whoever plans this should decide, but it should be one shared mechanism rather than reimplemented per-role (evaluator, skeptic, and orchestrator all currently surface follow-up suggestions independently).

## Related

* CON-48 (route follow-up suggestions through escalation, not bare chat) — this ticket is about *what informs* that escalation, not the escalation delivery mechanism itself; likely sequenced after or alongside CON-48.
* CON-11 (escalations need context) — the presentation mechanism this reuses.
* CON-30's fold-in failure — the concrete cautionary precedent for why "recorded decision" and "actually executed" must not be allowed to drift apart again.
