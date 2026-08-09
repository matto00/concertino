## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/design-ticket-type/spec.md`, `specs/followup-triage/spec.md`
  (delta) in full.
- Read the base (pre-change) `openspec/specs/followup-triage/spec.md`,
  `openspec/specs/harness-identity/spec.md`, and
  `openspec/specs/multi-part-escalation/spec.md` to check for
  contradictions and confirm the reused-machinery claims (CON-62 label
  check, `sub_questions=`, `files=unknown` support, the CON-30 fold-in
  plan-revision requirement).
- Read the live `core/roles/orchestrator.md` Setup (lines 135-193), Phase 1
  Planning (293-358), "Triaging a suggested follow-up" (521-657), and
  Phase 4 (728-820) sections to check where the plan's edits would land
  and whether they compose without contradiction.
- Read `core/workflow-state.template.md` — confirmed `TICKET_TYPE` /
  `DESIGN_QUESTIONS` do not exist yet, so tasks 1.1/1.2 are additive, not
  duplicative.
- Ran `openspec validate formalize-design-ticket-type --strict` myself:
  `Change 'formalize-design-ticket-type' is valid` (exit 0) — confirms
  criterion (c) independently, not just on the executor's say-so.
- Ran `grep -n "^#" ticket.md` and inspected the raw bytes around the
  "Open questions" text (`cat -A`) to check the design's central
  self-referential claim about its own extraction heuristic.

The three human answers ("both" for detection, "conditional" for pipeline
shape via `followup-triage`'s fold-in/standalone/discard, "escalations-
answered" for DoD) are each traceable to a concrete mechanism in
design.md/spec.md, and (b) — reuse of CON-62's label-check pattern and
`followup-triage`'s existing sub-procedure as a third invocation site
rather than a parallel scheme — holds up on inspection. (e) No
contradiction found with `harness-identity` (untouched) or the base
`followup-triage` spec (the delta only extends the "three call sites"
sentence; the CON-30 fold-in mechanics, `triage-followup.sh` contract, and
`files=unknown` support are all reused verbatim, confirmed against the
base spec's own scenario using `files=unknown`). (f) The Setup check and
Planning branch are correctly gated on `TICKET_TYPE == design`/the new
label-title check, additive to the existing Setup/Planning flow with no
edits to non-design-ticket behavior; the new Phase 4 precondition's own
spec.md wording is correctly scoped ("...for a design ticket"), avoiding
accidental application to ordinary tickets even though `tasks.md`'s
shorthand phrasing for the same requirement omits that qualifier (see
non-blocking note below).

However, two concrete problems surfaced under (a)/(d) that block sign-off.

### Verdict: REFUTE

### Change Requests

1. **The stated open-questions extraction heuristic does not match the
   worked example it's justified by (design.md "Extracting open
   questions"; `specs/design-ticket-type/spec.md`'s "Planning extracts a
   design ticket's open questions..." requirement; `ticket.md`).**
   design.md states: "Planning looks for a `##`-headed section in
   `ticket.md` naming open questions (e.g. "Open questions", matching
   CON-100's own body — see `ticket.md`'s own "Open questions this ticket
   should resolve" heading, which this design's own Planning pass used as
   its extraction target)." I ran `grep -n "^#" ticket.md`:
   ```
   1:# CON-100: Formalize a "design" ticket type (...)
   3:## Description
   7:### Problem
   11:### Proposal to evaluate
   21:## Related
   ```
   There is no heading — at `##` or any other level — named "Open
   questions" anywhere in `ticket.md`. The text "Open questions this
   ticket should resolve:" (line 15) is a plain, non-heading sentence
   nested inside the `### Proposal to evaluate` H3, itself nested under
   the single `## Description` wrapper. Applying the literal algorithm as
   specified (scan for a `##`-headed section) to this ticket finds zero
   matches, and per the spec's own fallback rule would incorrectly raise
   the generic "What should this design ticket resolve?" ESCALATION
   instead of extracting the three real questions already stated in the
   body — on the exact ticket the design cites as proof the mechanism
   works. This isn't a one-off fluke of this particular ticket's
   formatting; most real ticket bodies (Linear-authored prose with nested
   Problem/Proposal-style subheadings, not a flat top-level "## Open
   questions" heading) will shape this way, making the fallback path the
   common case rather than the exception. Required revision: fix the
   detection rule (e.g. match a heading of any level whose text matches
   `/open questions?/i`, not strictly `##`; or explicitly specify how
   Planning should locate an open-questions list embedded in prose when no
   dedicated heading exists) and re-verify the corrected rule actually
   extracts CON-100's own three questions from the real file, since that
   was the design's own proof this works.

2. **Ambiguous step ordering for the no-fold-in Phase 4 branch
   (design.md "Definition of done, and the no-code Phase 4 precondition";
   `tasks.md` 5.2; `specs/design-ticket-type/spec.md`'s "Phase 4 cleanup
   proceeds without a merged-PR confirmation..." requirement).** The
   existing (unmodified) Phase 4 section orders its steps: (1)
   `cleanup.sh --phase4` (worktree removal, and — per its documented
   behavior at orchestrator.md:744-745 — fast-forwarding local `<base>`
   "after the merge that just happened"), then (2) set ticket Done + post
   closing comment. The new alternate precondition text says cleanup
   "proceeds directly once the closing comment is posted and the ticket is
   set Done," which reads as requiring step 2's content *before* step 1
   can run — inverting the existing order — but neither design.md nor
   tasks.md 5.2 states whether steps 1/2 are actually reordered for this
   branch, or whether "closing comment + Done" is merely the substitute
   *entry condition* for the section while 1→2→3 stays as-is (in which
   case the wording is just imprecise, not a real reordering). This is not
   academic: `cleanup.sh`'s fast-forward-after-merge behavior presumes a
   merge happened, which is false for the no-fold-in case, and no code
   change here touches `cleanup.sh` (correctly — the design's Non-Goals
   claim no script changes are needed), so the plan needs to state
   explicitly why running it unmodified is still correct (i.e., the
   fast-forward is a harmless no-op when nothing new merged) rather than
   leaving that to be discovered at implementation time. Required
   revision: state the exact step order for the no-fold-in branch in both
   design.md and tasks.md, and confirm the fast-forward step's behavior is
   safe when it has nothing new to fast-forward.

### Non-blocking notes

- design.md's definition of done for a design ticket ("every `standalone`
  verdict has an actually-filed follow-up ticket... every `fold-in`
  verdict's scope has completed ordinary delivery") is stricter than the
  literal human answer "escalations-answered (every escalation raised got
  answered — no additional doc-summary requirement)" — it requires
  verdicts to be *actioned*, not merely recorded/answered. The
  justification (CON-30 precedent, explicitly called out in Risks/Trade-
  offs) is sound and I'm not requiring a change, but since it extends past
  the literal approved answer, it's worth a one-line confirmation from the
  human alongside the fix for change request 1, rather than assuming it's
  self-evidently in scope.
- `followup-triage`'s fold-in sub-procedure step 1 ("make the change
  directory editable again" — undo an already-completed `openspec
  archive`) is inapplicable at the new third (design-ticket Planning)
  call site, since Planning runs before any archive has happened. The
  design/spec correctly omit this step for the new site but never say why
  it's inapplicable there; a one-line note in design.md or the spec delta
  would remove any doubt for an implementer reading the shared
  sub-procedure text end-to-end.
- `tasks.md` 5.2's phrasing ("when no question triaged to `fold-in`, ...")
  omits the "for a design ticket" qualifier that `specs/design-ticket-
  type/spec.md`'s corresponding requirement correctly states explicitly.
  Low risk given the surrounding task-list section is unambiguously
  design-ticket-scoped, but worth tightening for defense-in-depth given
  this precondition governs when a merge confirmation can be skipped.
