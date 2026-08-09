# CON-100: Formalize a "design" ticket type (acceptance criteria = escalations raised/answered, not code shipped)

## Description

Raised as decision 7 of CON-98 ("Add failed-run remediation (a address / d done) and audit per-pane fleet controls"), which was itself deliberately underspecified and needed several judgment calls escalated during planning rather than decided silently. The human's answer to that escalation: file this as its own standalone follow-up rather than block CON-98's scoping on it.

### Problem

A ticket like CON-98 has multiple genuinely open questions and no single obviously-correct shape. Dressing it up as an ordinary feature ticket (acceptance criteria = "the described behavior got implemented") is dishonest about what the ticket actually is — its real job is to get the right questions asked and answered, with implementation following from the answers.

### Proposal to evaluate

Should concertino formalize a "design" ticket type, where the acceptance criteria are explicitly "the right escalations got raised and answered" rather than "the described behavior got implemented"? This would let a ticket like CON-98 be filed honestly as a design ticket from the start, rather than looking like a normal feature ticket whose scope turns out to be mostly escalation traffic.

Open questions this ticket should resolve:

* What signals a "design" ticket to the orchestrator (a label? a title/description convention?) and how does Planning/Evaluation change when one is detected?
* Does a design ticket still go through Execution/Evaluation/Delivery, or does it terminate once its escalations are answered (e.g. by spawning the resulting implementation ticket(s))?
* How does the evaluator/skeptic judge "done" for a ticket with no code-shipped acceptance criteria?

## Related

* CON-98: Add failed-run remediation (a address / d done) and audit per-pane fleet controls
