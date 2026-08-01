---
name: ticket-drafting-escalation
description: Iron Law for ticket-drafting text — no silently-resolved ambiguity, force a real escalation instead.
applies_to: orchestrator
---

# Ticket-Drafting Escalation

## The Iron Law

**NO SILENTLY-RESOLVED AMBIGUITY IN TICKET-DRAFTING TEXT.**

You may not finalize ticket-drafting text — a ticket body, a follow-up-ticket
suggestion, any text that will become or propose a ticket — while it embeds an
unresolved design fork, scope-boundary question, or hedge phrase. Silently
picking a branch and writing the result is an informed guess, not an informed
human decision. Raise a `ticket-ambiguity` escalation (per
`core/roles/orchestrator.md`'s "How to raise one") instead of continuing.

## The two checks (either one trips the rule)

1. **Banned-hedge-phrase list.** Hitting any of these (or clearly equivalent
   language) while drafting ticket text is the trigger:
   - "likely acceptable"
   - "probably fine"
   - "should be fine"
   - "I'll assume"
   - "for now, I'll go with"
   - "reasonable default"
   - and similar hedge language that resolves an open question by asserting a
     confident-sounding guess instead of stating it as a question

2. **Structural open-question check.** A ticket draft that names an open
   question, a design fork (two or more reasonable approaches, no
   clearly-correct default), or a scope boundary (does X belong in this
   ticket, a follow-up, or nothing) without a stated resolution is not
   finalized as-is — the fork must be surfaced to the human, not left in the
   ticket text for a reviewer to notice later.

## What to do when a check trips

Stop before finalizing the text. Raise a `ticket-ambiguity` escalation via
`core/scripts/gather-escalation-context.sh ticket-ambiguity` with:

- `signal` — which check tripped: `design-fork`, `scope-boundary`, or
  `hedge-phrase`
- `detail` — the specific fork, boundary, or phrase
- `draft_excerpt` — the ticket text it would otherwise have gone into

The human's answer becomes part of the ticket's ground truth, not a footnote
for someone to notice three rounds into a skeptic review.

## Red-flag phrases — STOP and raise the escalation instead

- Any of the banned hedge phrases above, appearing in drafted ticket text
- "I'll note this as an open question and move on"
- Writing a scope boundary into the ticket body without also stating which
  side of the boundary was chosen and why

## Circuit breaker

This law governs point-of-use judgment, not a bounded retry loop — there is no
"N attempts" here. Every trigger hit raises the escalation; there is no
threshold below which a hedge is small enough to skip raising it.
