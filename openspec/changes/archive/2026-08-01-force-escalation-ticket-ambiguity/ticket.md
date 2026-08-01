# CON-50: Ticket-creation flow: force escalation on ambiguous scoping/design calls before finalizing a ticket

## Description

Every ticket-creation path this project has (CON-21's planned TUI free-text→draft flow, ad-hoc filing sessions like the one that just created CON-49, and orchestrator-authored follow-up tickets per CON-48) has the same quiet failure mode: the drafting agent hits an ambiguous scoping or design call while writing the ticket, makes a silent judgment call, and moves on — the human never sees the fork in the road, only the ticket that resulted from one branch of it.

Concrete instance, just observed: while drafting CON-49, an open question came up (should `--inline` mode get an explicit tool-scope guardrail, given the calling session inherits a broader tool set than the orchestrator role is normally scoped to?). The drafting agent's first instinct was to note it as "likely an acceptable gap" and move on — informed guessing, not an informed human decision. Matt caught it and asked for it to be a forced escalation instead (now reflected in CON-49 directly). The problem is this depends on catching it after the fact, every time — there's no structural reason it would be caught if nobody happened to notice.

## Proposed change

Ticket-creation flows should treat "the drafting agent found itself making an assumption" as a first-class signal, not a thing to silently resolve. When drafting a ticket (whichever path produces it) hits:

* a genuine design fork (two or more reasonable approaches, no clearly-correct default),
* a scope boundary question (does X belong in this ticket, a follow-up, or nothing),
* or any point where the drafting agent would otherwise write "likely acceptable" / "probably fine" / similar hedge language into the ticket body instead of asking,

it should raise a real escalation (per CON-11's existing context-carrying escalation mechanism, and CON-46's multi-part wizard once that lands) rather than embed the hedge in the ticket text and continue. The human's answer becomes part of the ticket's ground truth, not a footnote for someone to notice three rounds into a skeptic review.

This directly extends CON-21's own open question ("worth considering whether the draft should be reviewed by a cold skeptic before creation, the way a design is") — a forced-escalation-on-ambiguity rule is a lighter-weight version of that same instinct, and should probably be designed together with whatever CON-21 lands on rather than separately.

## Scope

* Applies to CON-21's TUI draft flow once built, to ad-hoc ticket-filing sessions (this is a workflow/process convention as much as a code change), and to orchestrator-authored follow-up creation (CON-48).
* Needs a concrete trigger definition — "the agent would otherwise hedge" is the intuition, but whoever plans this should pin down a checkable rule (e.g. specific hedge phrases, or a structural check like "this ticket references an open question with no stated resolution") rather than leaving it to vibes, since a vague rule won't reliably fire any more than the status quo does.

## Related

* CON-21 (ticket-creation workflow in the TUI) — primary consumer of this.
* CON-11 (escalations need context) — the mechanism this reuses.
* CON-46 (multi-part escalation wizard) — relevant once ticket-drafting escalations start bundling more than one open question at a time.
* CON-49 — the concrete instance that prompted this.
