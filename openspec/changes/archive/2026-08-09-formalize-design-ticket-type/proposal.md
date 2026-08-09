## Why

A ticket like CON-98 is dressed up as a normal feature ticket (acceptance
criteria = "the described behavior got implemented") even though its real job
is to get several genuinely open questions asked and answered, with any
implementation following from the answers. Filing that honestly — as its own
"design" ticket type, whose acceptance criteria are "the right escalations
got raised and answered," not "code got shipped" — lets the orchestrator
treat that traffic as the deliverable instead of forcing Planning to
silently invent answers just to produce a normal-shaped proposal/tasks list.

## What Changes

- **Setup detects a design ticket.** A Linear label `type:design` (checked
  alongside the existing CON-62 `harness:` label check), or, absent that
  label, a title starting with the literal prefix `[DESIGN] `. The label
  wins when both are present; absent either signal, a ticket is an ordinary
  (`feature`/`task`/`bug`) ticket, unchanged. Recorded as `TICKET_TYPE` in
  `workflow-state.md`.
- **Planning, for a design ticket, extracts and raises its open questions**
  as a single multi-part escalation (the same `sub_questions=` mechanism
  Planning ESCALATIONs already use), rather than drafting proposal/design/
  tasks.md from guessed answers. A design ticket with no explicit open
  questions in its body is itself escalated (asking the human what the
  ticket should resolve) rather than silently treated as a normal ticket.
- **Each answered question is triaged via the existing "Triaging a
  suggested follow-up" sub-procedure** (`followup-triage`), reused as a
  third invocation site alongside its existing two (Phase 3 delivery, Phase
  4 post-cleanup) — `fold-in` (small, do it now, in this same run),
  `standalone` (file a separate ticket), or `discard` (no action). This is
  the concrete mechanism behind the "conditional" pipeline shape: `fold-in`
  answers pull the design ticket into the ordinary Execution → Evaluation →
  final-gate → Delivery pipeline (via `followup-triage`'s existing
  plan-revision requirement — extend `ticket.md`/`proposal.md`/`design.md`/
  `tasks.md`, re-validate, re-run the design gate); `standalone`/`discard`
  answers do not.
- **Definition of done for a design ticket**: every posed question has a
  recorded triage verdict (satisfying "escalations answered"); every
  `standalone` verdict has an actually-filed follow-up ticket; every
  `fold-in` verdict's scope has completed ordinary delivery. A recorded
  answer alone, with no corresponding filed ticket or completed delivery,
  does not satisfy this — the same principle `followup-triage` already
  established for CON-30, extended here.
- **A new Phase 4 cleanup precondition** for the case where no question
  triaged to `fold-in`: since nothing was ever executed or pushed, cleanup
  proceeds directly once the closing comment is posted and the ticket is
  set Done — the existing "human 'merged' confirmation or auditor `MERGE`
  verdict" precondition does not apply to a design ticket that produced no
  code.
- **The closing comment for a design ticket** (in place of, or in addition
  to, "what shipped + merged PR link" for a ticket that also executed a
  `fold-in` scope) lists each question, its answer, and the resulting
  action (fold-in → merged/PR link, standalone → new ticket id, discard →
  no action).

## Capabilities

### New Capabilities

- `design-ticket-type`: detection of a design ticket at Setup, Planning's
  question-extraction/multi-part-escalation/triage procedure for one, its
  definition of done, and the alternate no-code Phase 4 cleanup
  precondition.

### Modified Capabilities

- `followup-triage`: the "Triaging a suggested follow-up" sub-procedure
  gains a third invocation site (design-ticket Planning, for each answered
  question that plausibly implies future work), alongside its existing two
  (Phase 3 delivery, Phase 4 post-cleanup).

## Impact

- `core/roles/orchestrator.md`: Setup's harness-label-check step gains a
  parallel design-ticket-type check; Phase 1 Planning gains a
  design-ticket branch; Phase 4 gains the alternate no-code cleanup
  precondition and the closing-comment content requirement; the
  "Triaging a suggested follow-up" sub-procedure's intro sentence is
  updated to name three call sites instead of two.
- `core/workflow-state.template.md`: new `TICKET_TYPE` and
  `DESIGN_QUESTIONS` fields, so a resumed/compacted session can recover
  which questions were raised, their answers, and their triage verdicts.
- `openspec/specs/design-ticket-type/spec.md` (new),
  `openspec/specs/followup-triage/spec.md` (delta).
- No script changes: detection reuses the existing inline label-check
  pattern (CON-62), and triage reuses `scripts/concertino/triage-followup.sh`
  and the existing `standalone`/`fold-in`/`discard` machinery verbatim
  (`files=unknown`, since no code diff exists yet at Planning time — already
  a supported input).
