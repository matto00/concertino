## Why

Every ticket-drafting path in this project (ad-hoc filing sessions, and the orchestrator's
one-shot post-cleanup follow-up suggestion in `core/roles/orchestrator.md` Phase 4 step 4) has
the same quiet failure mode: the drafting agent hits an ambiguous scoping or design fork,
silently resolves it with hedge language ("likely acceptable," "probably fine"), and the human
never sees the fork — only the ticket that resulted from one branch of it. CON-49 caught one
instance after the fact; there is no structural reason it would be caught next time. This change
makes "the drafting agent would otherwise hedge" a checkable, mechanical trigger for a real
escalation instead of a vibe a human has to happen to notice.

## What Changes

- Add a new Iron Law, `core/laws/ticket-drafting-escalation.md`, defining a concrete, checkable
  trigger rule for when ticket-drafting text must stop and escalate instead of continuing: (1) an
  enumerated banned-hedge-phrase list (mirroring `verification-before-completion.md`'s existing
  pattern, but for ticket text rather than completion claims), and (2) a structural check — a
  ticket referencing an open question, fork, or scope boundary with no stated resolution must not
  be finalized as-is.
- Add a sixth kind, `ticket-ambiguity`, to `core/scripts/gather-escalation-context.sh` (and its
  `escalation-context` spec), so a ticket-drafting escalation carries the same structured,
  human-readable context the other five kinds already do — the fork/boundary/hedge trigger,
  the options considered, and the draft text it would otherwise have gone into.
- Wire the new law into `core/roles/orchestrator.md`'s Phase 4 step 4 (the one concrete
  orchestrator-authored ticket-adjacent text that exists today: the `question=` string that step
  composes for its existing one-shot follow-up-ticket suggestion — Phase 4 has no downstream
  ticket-drafting-then-`mcp__linear__save_issue` flow to gate). Composing that question text is
  bound by the new law: a trigger hit while wording it means surfacing the fork within that same
  one-shot escalation (via the multi-part `sub_questions=` form when more than one fork applies)
  rather than silently collapsing it into one confidently-worded suggestion. This adds no new
  escalation call and stays inside Phase 4's existing one-shot cap by construction.
- Add the new law to `core/laws/README.md`'s table (bound to: orchestrator; and documented as
  the convention any ad-hoc ticket-filing session or future ticket-drafting flow — including
  CON-21's not-yet-built TUI draft flow — is expected to apply once it exists).

**Non-goals (explicitly out of scope for this change):** CON-21's TUI draft flow does not exist
yet, so there is no runtime code path to wire the law into there; this change's deliverable for
that consumer is the documented, checkable law itself, applied when CON-21 is built. Likewise, ad
hoc ticket-filing sessions have no single code entry point to instrument — the law's presence in
`core/laws/` (synced to `.concertino/laws/` project-wide) is the mechanism for that case, matching
how the existing Iron Laws already reach every agent "at the point of use," not a new enforcement
script.

## Capabilities

### New Capabilities
- `ticket-drafting-escalation`: the checkable trigger rule (hedge-phrase list + open-question
  structural check) that forces a real escalation instead of a silently-resolved ambiguity when
  drafting ticket text, and the orchestrator wiring that applies it at its one existing
  ticket-adjacent touchpoint (Phase 4 step 4's follow-up suggestion).

### Modified Capabilities
- `escalation-context`: add a sixth kind, `ticket-ambiguity`, to
  `gather-escalation-context.sh`'s existing five-kind contract (`dependency`, `api-change`,
  `budget`, `blocker`, `contradiction`), with its own required fields and formatted context block,
  and document the addition in the `escalation-context` spec.

## Impact

- `core/laws/ticket-drafting-escalation.md` (new file)
- `core/laws/README.md` (table entry for the new law)
- `core/scripts/gather-escalation-context.sh` (new `ticket-ambiguity` case)
- `core/roles/orchestrator.md` (Phase 4 step 4 wiring + `VALID_KINDS`/kind list reference update
  in "How to raise one" if the five-kind enumeration is mentioned there)
- `openspec/specs/escalation-context/spec.md` (delta: sixth kind)
- No new external dependencies. No breaking API changes — this is additive (a new law file, a
  new escalation kind alongside the existing five, and instructions text in one role file).
