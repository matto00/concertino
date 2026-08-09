## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Scoped the real diff.** `main` (`ab2b62e`) does not yet include CON-84
  (`3f16c9b`), so `git diff main...HEAD` conflates an unrelated already-landed
  PR; the actual CON-100 change is the single commit `36aab43` on top of
  `3f16c9b` (`git diff 3f16c9b..HEAD` / `git show 36aab43 --stat`): exactly
  `core/roles/orchestrator.md`, `core/workflow-state.template.md`, and the
  change's own planning artifacts — 13 files, matching the design's "no
  script changes" non-goal and the evaluator's own scoping note. No stray
  files.

- **Re-ran both gates myself, fresh:**
  - `openspec validate formalize-design-ticket-type --strict` → `Change
    'formalize-design-ticket-type' is valid`.
  - `npm test` → exit 0, `# tests 1739 / # pass 1739 / # fail 0`, zero
    `^not ok` lines across the combined `node --test` + all `test/scripts/*.sh`
    output (verified with `grep -c "^not ok"` on the full log, not sampled).

- **Traced all three of `ticket.md`'s open questions to shipped code:**
  1. Detection signal ("both" per the human's transcript answer) →
     `orchestrator.md:156-166`: `type:design` label wins, `[DESIGN] ` title
     prefix fallback, `feature` otherwise — matches `design.md`'s "Detection"
     decision and `specs/design-ticket-type/spec.md`'s first requirement
     verbatim.
  2. Pipeline shape ("conditional") → the new "Design-ticket Planning"
     subsection (`orchestrator.md:388-451`) reuses "Triaging a suggested
     follow-up" as a third call site; `fold-in` pulls the ticket into the
     ordinary Phase 2+ pipeline (step 4), `standalone`/`discard` do not (step
     6, jumps straight to Phase 4). Matches `design.md`'s "Per-question
     triage" decision and the corresponding spec requirement's four scenarios.
  3. Definition of done ("escalations-answered", read per CON-30's stricter
     "actioned, not just recorded" precedent) → the new "Definition of done
     for a design ticket" note (`orchestrator.md:889-897`) and Phase 4's
     alternate no-code entry condition (`orchestrator.md:840-850`). Matches
     `design.md`'s DoD decision and its explicit "Note on DoD reading past
     the literal human answer" justifying the stricter reading as
     self-approvable, not silently substituted.

- **Verified the flagged tasks.md-vs-design.md deviation was the right call.**
  `tasks.md` 5.2's literal wording ("closing comment posted and ticket set
  Done" as the entry condition) contradicts `design.md`'s later,
  round-1-REFUTE-corrected "Step order is unchanged" note, which states the
  actual entry condition is "closing comment posted and every
  `standalone`/`discard` verdict has resolved" — with Done/closing-comment
  remaining *inside* Phase 4's existing step 2, not a precondition to
  entering Phase 4. I read the shipped text directly
  (`orchestrator.md:840-850`, 880-885) and confirmed it implements
  `design.md`'s corrected wording ("every `standalone`/`discard` verdict has
  resolved") and `specs/design-ticket-type/spec.md`'s matching requirement
  (lines 143-159), not `tasks.md`'s stale phrasing. `files-modified.md`'s own
  note explaining this deviation is accurate, not self-serving.

- **Re-verified the two round-1 REFUTE items independently, against ground
  truth, not the skeptic-design-2.md narrative:**
  - Open-questions extraction rule: read `ticket.md` directly — line 15 is
    the plain paragraph "Open questions this ticket should resolve:" (nested
    under `### Proposal to evaluate`, no heading named "Open questions"
    anywhere in the file, confirmed via `grep -n "^#"`), followed by a blank
    line and the three bullets at 17-19. The shipped rule
    (`orchestrator.md:396-406`) scans line-by-line for `/open questions?/i`
    regardless of heading/paragraph structure — correctly matches this real
    shape, unlike the original heading-only rule the round-1 REFUTE caught.
  - Phase 4 step-order: read the shipped text (`orchestrator.md:840-850`,
    899-911) — confirms the no-code branch substitutes only the *entry
    condition*, and Phase 4's internal order (`cleanup.sh --phase4` → set
    Done/closing comment → hygiene check) is unchanged, per the corrected
    `design.md` note.

- **Checked composition against existing (non-design) behavior — purely
  additive.** Every new branch is textually gated on `TICKET_TYPE == design`
  (`orchestrator.md:156-166, 324-330, 380-384, 413-451, 840-850`); Phase 1
  Planning's ordinary steps 1-6 and Phase 4's ordinary numbered steps are
  otherwise unchanged prose (only cross-reference sentences updated, e.g.
  "two" → "three" call sites in "Triaging a suggested follow-up," itself
  necessitated by the third call site genuinely existing now). `npm test`'s
  full suite — including the role-rendering suites that assert on
  `orchestrator.md`'s literal content — passes clean, which would have caught
  a broken/contradicted ordinary-path rendering. `PHASE_ORDER` in
  `lib/ui/reducer.js` is a plain membership check (`PHASE_ORDER.includes`),
  not an enforced-sequential state machine, so a design ticket's Planning →
  Cleanup jump (skipping Execution/Evaluation/Delivery) does not break
  dashboard phase tracking — consistent with this change's explicit
  "no UI configured" scope and its own non-goal of no new evaluator/skeptic
  behavior.

- **`workflow-state.template.md`** — new `TICKET_TYPE`/`DESIGN_QUESTIONS`
  fields match `tasks.md` 1.1/1.2 and `design.md`'s decisions exactly:
  resolved once at Setup, `null` default for an ordinary ticket, documented
  shape.

- **Corroborated the evaluator's PASS is grounded, not just asserted.** The
  worktree's uncommitted `workflow-state.md` diff (`LAST_EVAL_VERDICT: —` →
  `PASS`, `LAST_EVAL_REPORT: .../evaluation-1.md`, `SKEPTIC_CYCLE: 2` → `3`)
  is exactly the bookkeeping a real evaluation run would leave; nothing
  alarming.

- **One pre-existing, out-of-scope wording bug, independently confirmed but
  not blocking:** both the newly-added `orchestrator.md:429` and the
  pre-existing line 704 say `openspec validate --change <CHANGE_NAME>`, but
  the installed CLI has no `--change` flag (`openspec validate --help`
  confirms; `openspec validate --change ... --strict` → `error: unknown
  option '--change'`, reproduced myself). Confirmed via `git show
  3f16c9b:core/roles/orchestrator.md` that this wording already existed
  before CON-100 (line 604 there) — CON-100 copied the existing (wrong)
  phrasing into its new step rather than introducing it. Already flagged as
  a non-blocking suggestion in `evaluation-1.md`; agreeing it's real but
  out of this ticket's scope to fix.

### Verdict: CONFIRM

The shipped `orchestrator.md`/`workflow-state.template.md` text faithfully
and completely implements `design.md`/`specs/design-ticket-type/spec.md`'s
authoritative, twice-skeptic-gated decisions — including correctly following
`design.md`'s corrected Phase-4 entry-condition wording over `tasks.md`
5.2's stale phrasing, which I verified by reading the shipped text directly
rather than trusting `files-modified.md`'s characterization. All three of
`ticket.md`'s open questions trace to concrete, gated code. Both gates
(`openspec validate --strict`, `npm test`) pass fresh under my own
invocation. The change is purely additive — no existing non-design-ticket
behavior is weakened or contradicted, and the ordinary-path role-rendering
test suite (which would catch a broken composition) passes clean.

### Non-blocking notes

- The pre-existing `openspec validate --change <CHANGE_NAME>` CLI-syntax bug
  (now at two call sites, one newly copied by this commit) is real —
  confirmed by running the actual CLI — and worth a follow-up fix, but it
  predates CON-100 and is not this ticket's scope.
- A design ticket whose Planning jumps straight from `PHASE: Planning` to
  `PHASE: Cleanup` (no `fold-in` scope) will render on the dashboard as
  skipping Execution/Evaluation/Delivery in whatever `PHASE_ORDER`-driven
  progress UI exists. `PHASE_ORDER` itself is a plain membership check, not
  an enforced sequence, so nothing breaks — but if a future ticket wants a
  dashboard-visible "no-code design ticket" affordance, that's net-new scope
  beyond this change's explicit "no UI configured" boundary, not a defect in
  this one.
