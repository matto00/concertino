# Files modified — CON-100 (formalize-design-ticket-type)

- `core/workflow-state.template.md` — added `TICKET_TYPE: design | feature`
  (resolved once at Setup, alongside `AGENT_MERGE`) and `DESIGN_QUESTIONS`
  (per-question `{question, answer, verdict, action_ref}` array, `null` for
  an ordinary ticket) so a resumed/compacted session recovers a design
  ticket's raised/answered/triaged questions.

- `core/roles/orchestrator.md` — the bulk of this change:
  - **Setup:** a design-ticket-type check (label `type:design` exact match,
    else title prefix `[DESIGN] `, else `feature`) added immediately
    alongside the existing CON-62 harness-label check; `TICKET_TYPE` and
    `DESIGN_QUESTIONS: null` recorded into `workflow-state.md` at step 6.
  - **Phase 1: Planning** — step 2 branches a `TICKET_TYPE == design` ticket
    into a new "Design-ticket Planning" subsection (placed after the
    existing numbered steps, which remain unchanged and apply to
    `TICKET_TYPE == feature` only): extracts open questions from `ticket.md`
    via the `/open questions?/i` line-match rule (escalating instead if
    nothing matches), raises them as one multi-part escalation, persists
    Q&A into `DESIGN_QUESTIONS`, then triages each answered question via the
    (now three-call-site) "Triaging a suggested follow-up" sub-procedure.
    `fold-in` verdicts apply that sub-procedure's plan-revision requirement
    once across the combined fold-in scope, then proceed into the ordinary
    Phase 2 pipeline unmodified; `standalone` files a ticket; `discard`
    (explicit or implicit, for a plainly-no-action answer) needs no action.
    A design ticket with no `fold-in` scope skips Phase 2/3 entirely and
    proceeds straight to Phase 4's alternate entry condition.
  - **"Triaging a suggested follow-up"** — intro sentence now names three
    invocation points (Phase 3 Delivery, Phase 4 step 4, design-ticket
    Planning); the `fold-in` branch's step 1 ("make the change directory
    editable again") and steps 5–6 (execute/re-archive) now note why they
    are inapplicable, unchanged, at the new Planning-time call site (no
    prior archive exists yet — the ordinary pipeline performs the (first,
    only) execute+archive itself).
  - **Phase 4: Post-merge cleanup** — new alternate no-code entry condition
    for a design ticket with no `fold-in` scope ("every `standalone`/
    `discard` verdict resolved," substituting only the entry condition —
    Phase 4's own internal step order is unchanged); a new "Definition of
    done for a design ticket" note; the closing-comment step now includes
    each question/answer/resulting action for a design ticket; a note that
    `cleanup.sh`'s local-`<base>` fast-forward is a safe no-op on this
    branch (no script change needed).
  - **Guardrails / "Always reaches the human"** — cross-references added so
    the design-ticket entry-condition exception and Planning-ESCALATION
    usage are visible from those existing summary sections too.

- `openspec/changes/formalize-design-ticket-type/tasks.md` — checkboxes
  marked complete as each task was implemented (all planning artifacts,
  including `specs/design-ticket-type/spec.md` and
  `specs/followup-triage/spec.md`, were already written during Planning
  before this executor run).

## Note on task 5.2's literal wording vs. the implemented behavior

`tasks.md` 5.2 describes the alternate Phase 4 entry condition as "closing
comment posted and ticket set Done." `design.md`'s "Step order is unchanged
(clarified after design-gate round 1 REFUTE)" note supersedes that literal
phrasing (the skeptic caught that framing making it sound like Phase 4's
internal order was inverted): the actual entry condition implemented, and
what `specs/design-ticket-type/spec.md`'s own requirement states, is "every
`standalone`/`discard` verdict has resolved" — posting the closing comment
and setting Done remain **inside** Phase 4's unchanged step 2, not a
precondition to entering it. Followed `design.md`/`spec.md` as the
authoritative, later-corrected source over `tasks.md`'s earlier wording.
