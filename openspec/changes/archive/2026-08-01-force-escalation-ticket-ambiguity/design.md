## Context

`core/laws/` holds Concertino's "Iron Laws" — canonical, dependency-free behavioral rules that
agents re-read at the point of use (per `core/laws/README.md` and `core/design/architecture.md`).
Two exist today: `systematic-debugging.md` (no fix without a probe-confirmed root cause) and
`verification-before-completion.md` (no completion claim without fresh evidence, including a
"Banned hedge language" list for completion claims specifically). `concertino sync` copies every
file in `core/laws/` verbatim to `.concertino/laws/` in every worktree; role `.md` files reference
individual laws by that path, "at the point of use," not through any code-level `applies_to`
enforcement.

`core/scripts/gather-escalation-context.sh` formats structured context for exactly five
escalation kinds (`dependency`, `api-change`, `budget`, `blocker`, `contradiction`), each requiring
kind-specific `k=v` fields; its output is passed as `context=` on
`emit-event.sh escalation --await`. `core/roles/orchestrator.md`'s "How to raise one" section is
the canonical procedure for raising any escalation.

**Correction from design-gate round 1 (skeptic REFUTE):** Phase 4 step 4 is *not* a
draft-ticket-then-`mcp__linear__save_issue` flow — grep confirms `save_issue` (and `mcp__linear`
generally) appears nowhere in `core/roles/orchestrator.md` or the repo. Step 4 is only a single
one-shot `emit-event.sh escalation --await` call carrying a `question=`/`options=` pair (e.g.
"should I file a follow-up ticket for the sync drift?"). The *only* ticket-adjacent text this step
actually produces is that question string itself — there is no downstream drafting or filing step
to gate. `core/roles/orchestrator.md` also has zero existing "Iron Laws" references anywhere
today (unlike `executor.md`'s explicit bullet list) — a case-insensitive `grep law` across the
whole file returns nothing, so this change introduces the orchestrator's first law reference, not
an addition to an existing list.

CON-50 itself does not have a concrete runtime ticket-drafting flow to modify for two of its three
named consumers: CON-21's TUI draft flow is not yet built, and ad-hoc filing sessions have no
single entry point in this codebase (they're Claude Code sessions with the repo's laws in their
context by virtue of `concertino sync`, not a script). The buildable surface today is: the rule
itself (as a law, so every consumer — present and future — can bind to the same text), a matching
escalation-context kind (so the escalation is checkable and structured, not another guess), and
wiring the rule into the one concrete orchestrator-authored path.

## Goals / Non-Goals

**Goals:**
- Define a *checkable* trigger rule — not "the agent would otherwise hedge" as an intuition, but
  an enumerated phrase list plus a structural check, mirroring the precedent
  `verification-before-completion.md` already sets for a different claim type.
- Give a ticket-ambiguity escalation the same structured-context treatment CON-11 already gives
  the other five kinds, rather than a bespoke free-text `context=`.
- Apply the rule concretely at the one orchestrator-authored ticket-adjacent text that exists
  today — the `question=` string Phase 4 step 4 composes for its one-shot follow-up-ticket
  suggestion — so this change ships a real, scope-consistent behavior change (no new
  draft-then-file flow invented), not only a documentation artifact.

**Non-Goals:**
- Building CON-21's TUI draft flow, or any enforcement hook for ad-hoc filing sessions — neither
  has code to modify yet. This change's deliverable for both is the law text itself; wiring it
  into CON-21 is that ticket's own job when it lands, per the proposal's explicit
  "should probably be designed together with whatever CON-21 lands on" note.
- Any automated/mechanical scanner that greps ticket text for banned phrases at commit or CI time.
  The rule is applied by the drafting agent itself, self-checking against the law at
  point of use — consistent with how the other two Iron Laws work today (no lint rule enforces
  `systematic-debugging.md` either).
- Changing CON-11's five existing escalation kinds' behavior. `ticket-ambiguity` is purely
  additive alongside them.

## Decisions

**A checkable rule = enumerated hedge phrases + a structural open-question check, not vibes.**
The ticket's own scope section explicitly rejects "the agent would otherwise hedge" as
insufficiently checkable. Two independent, mechanically-followable checks:
1. **Banned-hedge-phrase list** (drafting-context analog of `verification-before-completion.md`'s
   existing list): "likely acceptable," "probably fine," "should be fine," "I'll assume," "for
   now, I'll go with," "reasonable default," and similar hedge language. Hitting any of these
   while drafting ticket body text is the trigger.
2. **Structural check**: a ticket draft that names an open question, a design fork, or a scope
   boundary (e.g. "does X belong in this ticket or a follow-up") without a stated resolution is
   not finalized as-is — same shape as this very ticket's own "Needs a concrete trigger
   definition" scope note, which is itself an instance of the pattern being encoded.

*Alternative considered*: a single free-form "use judgment" instruction (status quo). Rejected —
it is what already failed for CON-49; the ticket exists specifically because "use judgment" isn't
structurally checkable by a cold reader or a skeptic gate.

**A new law file, not an addition to `verification-before-completion.md`.** The existing law's
"Banned hedge language" section is scoped to *completion claims* ("tests pass," "it works"); this
rule governs *ticket-drafting text*, a different point of use with a different reader (the human
deciding ticket scope, not a skeptic verifying a gate). Two laws stay independently readable and
independently bound, matching the existing one-concern-per-law pattern
(`systematic-debugging.md` vs. `verification-before-completion.md`).

*Alternative considered*: extend `verification-before-completion.md`'s existing hedge list to
cover ticket drafting too. Rejected — conflates two different "claims" (a completion claim vs. a
scope/design decision) under one law, weakening both.

**A sixth `gather-escalation-context.sh` kind (`ticket-ambiguity`), not a bare `question=`/
`options=` call.** The five existing kinds establish the precedent that any recurring escalation
shape gets structured, checkable context rather than ad hoc prose. Required fields: `signal`
(one of `design-fork`, `scope-boundary`, `hedge-phrase` — which check tripped),
`detail` (the specific fork/boundary/phrase), and `draft_excerpt` (the ticket text it would
otherwise have gone into) — enough for a human to decide from the dashboard screen alone, per
`escalation-context`'s existing purpose statement.

*Alternative considered*: reuse the existing `contradiction` kind (closest existing shape).
Rejected — `contradiction` requires two specific *requirements* that conflict; a ticket-drafting
fork is a broader shape (it may be "no clearly-correct default" between two designs, not a
requirement conflict), and forcing it through `contradiction`'s field names (`requirement_a`/
`requirement_b`) would misrepresent what's actually being escalated.

**Wire into Phase 4 step 4 by binding the law to that step's own question-drafting, not to an
invented draft-then-file flow.** Step 4 already gates "raise any leftover suggestion through
escalation, never bare chat" as a one-shot call whose only output is a `question=`/`options=`
pair. The scope-consistent wiring: composing that question text is itself subject to
`ticket-drafting-escalation.md`. If, while composing it, the orchestrator would otherwise resolve
a fork silently (e.g. unsure whether the observation is worth a follow-up ticket at all, or which
of two framings to suggest) or would embed a hedge phrase into the question text, it must not
collapse that into a single confidently-worded suggestion — it surfaces the fork as part of the
same one-shot escalation (using the multi-part `sub_questions=` form from "How to raise one" when
there is more than one genuinely independent fork) rather than silently picking one. This adds no
second escalation and no new call site: it is a constraint on how the *existing* one-shot
question gets worded, so it stays inside Phase 4's existing one-shot cap by construction — there
is nothing here to double-count against that budget.

*Alternative considered*: gate a hypothetical "draft ticket content, then call
`mcp__linear__save_issue`" sequence, as round 1 of this design proposed. Rejected on skeptic
review — no such sequence exists in `core/roles/orchestrator.md` today (`save_issue` has zero
hits repo-wide); inventing one here would be undisclosed scope growth exactly of the kind the
proposal's Non-Goals section already rules out for CON-21 and ad-hoc sessions, just smuggled in
for this one consumer instead.

## Risks / Trade-offs

[A self-checked law has no mechanical enforcement, so a drafting agent could still miss it] →
Mitigation: this is the same trust model every other Iron Law in this project already runs on
(no lint/CI check enforces `systematic-debugging.md` either); the skeptic gate is the existing
backstop for a drafting agent that silently resolved something it shouldn't have — this change
also gives the skeptic a named, citable law to check against instead of a vague standard.

[Two Iron Laws with overlapping "hedge language" sections could drift out of sync over time] →
Mitigation: each is scoped to a distinct point of use (completion claims vs. ticket-drafting
text) with a distinct phrase list; no shared list is factored out, so there is nothing to drift —
a future change to one has no obligation to touch the other.

[CON-21 and ad-hoc filing sessions get a documented rule but no runtime enforcement in this
change] → Mitigation: explicitly scoped as a Non-Goal above and called out in the proposal;
`core/laws/` is exactly the existing mechanism for "documented rule, applied at point of use by
whichever agent gets there," and CON-21's own ticket is the right place to wire it into a flow
that doesn't exist yet.

## Migration Plan

Purely additive: a new law file, a new `README.md` table row, a new `gather-escalation-context.sh`
case (new kind name, does not touch the existing five), and new instruction text in one section of
`orchestrator.md`. No existing behavior changes for a run that never reaches Phase 4 step 4's
follow-up-suggestion path. No rollback complexity beyond reverting the commit — no data migration,
no config schema change.

## Open Questions

None outstanding — the ticket's own "needs a concrete trigger definition" ask is resolved by the
Decisions section above (enumerated phrase list + structural open-question check).
