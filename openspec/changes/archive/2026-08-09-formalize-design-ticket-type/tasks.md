## 1. Workflow state

- [x] 1.1 Add `TICKET_TYPE: design | feature` to `core/workflow-state.template.md`, resolved once at Setup, default `feature`.
- [x] 1.2 Add `DESIGN_QUESTIONS: <JSON array of {question, answer, verdict, action_ref}> | null` to `core/workflow-state.template.md`, so a resumed session recovers exactly which questions were raised, answered, and triaged.

## 2. Setup: design-ticket detection

- [x] 2.1 In `core/roles/orchestrator.md`'s Setup section, add a design-ticket-type check immediately alongside the existing CON-62 harness-label check: label `type:design` (exact match) wins; else title starting with the literal prefix `[DESIGN] `; else `feature`.
- [x] 2.2 Record the resolved `TICKET_TYPE` into `workflow-state.md` at the same point the harness override and `AGENT_MERGE` resolution are recorded (Setup step 6).

## 3. Planning: question extraction and multi-part escalation

- [x] 3.1 In `core/roles/orchestrator.md`'s Phase 1 Planning, add a `TICKET_TYPE == design` branch: after writing `ticket.md` (steps 1–2 unchanged), scan for a line (heading or plain paragraph, any nesting level) matching `/open questions?/i` and extract the bullet list immediately following it as `sub_questions[]` entries — verified against CON-100's own `ticket.md` (a plain paragraph, not a heading), which is why the rule matches on line content rather than assuming a dedicated `##` heading.
- [x] 3.2 If no line matches `/open questions?/i`, or a match exists but no bullet list immediately follows it, raise a single-question Planning ESCALATION ("What should this design ticket resolve?") instead of proceeding silently.
- [x] 3.3 Raise the extracted questions as one multi-part `emit-event.sh escalation --await`/`--raise-only` call (topology rules unchanged from the existing escalation mechanism), and persist each question/answer pair into `DESIGN_QUESTIONS`.

## 4. Planning: per-question triage (reusing `followup-triage`)

- [x] 4.1 Update the "Triaging a suggested follow-up" sub-procedure's intro sentence in `core/roles/orchestrator.md` to name three invocation points: Phase 3 delivery, Phase 4 post-cleanup, and design-ticket Planning (this task).
- [x] 4.2 For each answered question that plausibly implies future work, invoke that sub-procedure with `description` = question + answer, `files=unknown`, and the orchestrator's own `ac_relevant`/`effort` judgment; record the resulting verdict into `DESIGN_QUESTIONS`.
- [x] 4.3 For a question whose answer plainly implies no action, allow recording an implicit `discard` directly (stating why) without a wasted triage round-trip.
- [x] 4.4 `fold-in` verdicts: apply `followup-triage`'s existing plan-revision requirement across the union of every `fold-in` question's scope (single combined `ticket.md`/`proposal.md`/`design.md`/`tasks.md` revision, one `openspec validate`, one fresh design-gate skeptic `CONFIRM`), then proceed into the ordinary Execution/Evaluation/final-gate/Delivery pipeline for that combined scope, unmodified.
- [x] 4.5 `standalone` verdicts: file per `followup-triage`'s existing standalone behavior; record the new ticket's identifier into `DESIGN_QUESTIONS`.

## 5. Definition of done and Phase 4

- [x] 5.1 Add the design-ticket definition-of-done check to `core/roles/orchestrator.md` (all questions triaged; all `standalone` verdicts have a filed ticket id; all `fold-in` scopes delivered) — do not consider a design ticket done on a recorded-but-unactioned verdict.
- [x] 5.2 Add the alternate no-code Phase 4 cleanup precondition: for a design ticket where no question triaged to `fold-in`, the entry condition for Phase 4 becomes "closing comment posted and ticket set Done" in place of the ordinary merged-PR confirmation — Phase 4's own internal step order (`cleanup.sh --phase4` first, then set-Done/closing-comment, then hygiene check) is unchanged. Note explicitly that `cleanup.sh`'s fast-forward-after-merge step is a safe no-op here (nothing new was pushed to `<base>`), requiring no script change.
- [x] 5.3 Update Phase 4's closing-comment requirement to include, for a design ticket, each question/answer/resulting action (in addition to "what shipped + merged PR link" when a `fold-in` scope also executed).

## 6. Specs

- [x] 6.1 Write `specs/design-ticket-type/spec.md` (new capability): detection, Planning procedure, definition of done, no-code Phase 4 precondition.
- [x] 6.2 Write `specs/followup-triage/spec.md` delta (MODIFIED Requirements): update the "orchestrator triages a suggested follow-up before escalating" requirement to name three call sites.

## 7. Validation

- [x] 7.1 `openspec validate --change formalize-design-ticket-type` clean.
- [x] 7.2 Re-read the edited `core/roles/orchestrator.md` end-to-end to confirm the new design-ticket branch composes correctly with existing Setup/Planning/Phase 4 sections (no orphaned step numbering, no contradicted precondition).
