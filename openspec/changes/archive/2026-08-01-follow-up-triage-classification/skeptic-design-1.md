## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec
  deltas (`specs/followup-triage/spec.md`,
  `specs/orchestrator-turn-discipline/spec.md`) in full.
- Compared the modified `orchestrator-turn-discipline` requirement against
  the currently archived spec at
  `openspec/specs/orchestrator-turn-discipline/spec.md` (lines 113-136 there
  vs. the delta) — the MODIFIED block is a complete requirement replacement
  (full requirement text + all three scenarios, including the two carried
  forward from the archived version plus one new one), not a partial/lossy
  diff. No other requirement in that capability is touched, matching the
  proposal's stated "no other requirement changes."
- Verified the `triage-followup.sh` decision table (proposal.md §What
  Changes, design.md §Decisions/1, spec.md's ADDED requirement) is identical
  across all three documents and is exhaustive: 2 (`ac_relevant`) × 2
  (`effort`) × 4 (`overlap`) = 16 input combinations, all assigned a
  recommendation (8 + 1 + 3 + 4 = 16). Deterministic and auditable as
  designed.
- Checked the actual current base-branch-default convention in this
  codebase: `core/scripts/cleanup.sh:56` and
  `core/scripts/assert-phase.sh:139` both use
  `BASE_BRANCH="${CONCERTINO_BASE_BRANCH:-main}"`. `core/scripts/README.md:77`
  confirms `CONCERTINO_BASE_BRANCH` is a `concertino sync`-generated env var
  from `project.baseBranch`.
- Checked the actual current kind count in
  `core/scripts/gather-escalation-context.sh:32`
  (`VALID_KINDS="dependency api-change budget blocker contradiction
  ticket-ambiguity"` — six kinds) and cross-checked against
  `core/roles/orchestrator.md:523` ("one of `gather-escalation-context.sh`'s
  six kinds") and `core/scripts/README.md`'s script table (same six).
- Confirmed `ticket.md` is a one-time snapshot: `core/roles/orchestrator.md`
  Phase 1 step 2 writes it once from "the full ticket content (title,
  description, acceptance criteria)" and nothing in the current role file
  revisits it afterward.
- Confirmed both the evaluator and (my own) final-gate procedure key AC
  verification specifically off `ticket.md`: `core/roles/evaluator.md:29`
  ("Read `WORKTREE_PATH/<change-dir>/ticket.md`") and
  `core/roles/evaluator.md:47` ("All ticket acceptance criteria addressed
  explicitly"); my own final-gate instructions (`core/roles/skeptic.md`)
  likewise say "Read the ticket acceptance criteria (`ticket.md` or the
  ticket provider)" and "For every AC, point to the specific code/behavior
  that satisfies it."
- Confirmed the design-gate procedure I am currently running explicitly
  checks for "Scope drift — work beyond the ticket's acceptance criteria, or
  an AC left uncovered by any task" — i.e. the same check this design
  mandates be re-run (design.md §Decisions/4, step 3) after a fold-in.

### Verdict: REFUTE

The core mechanism (script decision table, shared sub-procedure, one call
site, `standalone`/`discard` handling) is sound and internally consistent
across proposal/design/tasks/spec. But the "fold-in must actually happen"
requirement — the ticket's central ask, and the specific CON-30 gap this
change exists to close — has a real hole: it revises `proposal.md`/
`design.md`/`tasks.md` but never `ticket.md`, and `ticket.md` is exactly what
both the evaluator (each cycle) and the final-gate skeptic (this same role, at
the final gate) use as their sole AC-tracing source. That leaves the
folded-in scope with no checkable acceptance criterion downstream — a milder
recurrence of the same "recorded but unverifiable" failure this ticket names
CON-30 for, plus a design-gate self-contradiction risk (see #1 below).

### Change Requests

1. **`ticket.md`'s acceptance criteria are never updated when a fold-in is
   approved, breaking downstream AC verification and risking a self-defeating
   design-gate re-run.** design.md §Decisions/4 ("Answer handling — the
   CON-30 fix") lists only `proposal.md`/`design.md`/`tasks.md` as the
   artifacts to extend on `fold-in`; `specs/orchestrator-turn-discipline`'s
   MODIFIED requirement and `specs/followup-triage`'s fold-in requirement
   mirror the same omission. Two concrete downstream consequences:
   - The evaluator (`core/roles/evaluator.md:29,47`) and the final-gate
     skeptic (this role, per its own final-gate instructions) both trace
     acceptance criteria from `ticket.md` only. If the folded-in scope's
     acceptance criterion is never written there, neither can verify the
     folded-in work was actually delivered — they have no textual signal it
     was ever supposed to be. This is precisely the "recorded decision,
     no corresponding checkable artifact" failure mode CON-30 named, just
     moved one step later in the pipeline (now unverifiable at evaluation/
     final-gate instead of unexecuted at planning).
   - The mandated fresh design-gate re-run (design.md §Decisions/4 step 3)
     is instructed to re-check "scope drift — work beyond the ticket's
     acceptance criteria" (this is literally one of the design gate's
     standing adversarial checks). An extended `tasks.md` covering scope that
     `ticket.md` still doesn't mention is, by that check's own definition,
     scope drift — creating a real risk that the very gate meant to CONFIRM
     the fold-in instead REFUTEs it for exactly the reason it was approved to
     do in the first place.
   - **Required fix:** add a step to design.md §Decisions/4 (and the
     corresponding spec requirement) that `ticket.md`'s Acceptance Criteria
     section is also extended to record the newly-approved scope (e.g. a note
     that it was added via an approved fold-in escalation, with a pointer to
     the escalation), as part of the same "genuine plan revision" — not
     merely `proposal.md`/`design.md`/`tasks.md`.

2. **`base=`'s default is stated inconsistently between design.md/spec.md and
   tasks.md, and neither matches this codebase's existing convention.**
   `design.md`'s Usage block and `specs/followup-triage/spec.md`'s ADDED
   requirement both say `base=` defaults to "the project's configured base
   branch" (design.md: "defaults to config's baseBranch/main"). `tasks.md`
   1.1, however, reduces this to "optional `base=` (default `main`..." with
   no mention of reading a config/env value at all. The established
   convention in this exact codebase for exactly this default
   (`core/scripts/cleanup.sh:56`, `core/scripts/assert-phase.sh:139`) is
   `${CONCERTINO_BASE_BRANCH:-main}`, not a hardcoded `main`. As written, an
   implementer following `tasks.md` literally (the file executors work from
   task-by-task) would hardcode `main`, silently producing the wrong diff
   base — and thus a wrong file-overlap signal — on any project configured
   with a non-`main` base branch. **Required fix:** make `tasks.md` 1.1
   explicit: default is `${CONCERTINO_BASE_BRANCH:-main}`, matching
   `cleanup.sh`/`assert-phase.sh`'s existing convention.

3. **Stale kind-count claim.** `proposal.md:31` ("that script's pure-formatting
   five kinds") and `design.md:60-61` ("Not adding a sixth kind to
   `gather-escalation-context.sh`. That script's five kinds...") both assert
   `gather-escalation-context.sh` currently has five kinds. It has six today
   (`dependency`, `api-change`, `budget`, `blocker`, `contradiction`,
   `ticket-ambiguity` — `core/scripts/gather-escalation-context.sh:32`,
   confirmed by `core/roles/orchestrator.md:523`'s own "six kinds" and
   `core/scripts/README.md`'s script table), post-CON-50's `ticket-ambiguity`
   addition. The rationale for keeping `triage-followup.sh` a standalone
   script is still correct, but the stated count that motivates it is wrong
   and should read "six kinds" / "a seventh kind" for accuracy.

### Non-blocking notes

- `tasks.md` 4.1's test list covers the decision table's key branches and
  the missing-required-field failure, but doesn't list a test for an
  out-of-enum `ac_relevant`/`effort` value or a `worktree=` that isn't a git
  repo (both are validation-failure cases the spec's requirement text
  covers: "an `ac_relevant`/`effort` value outside the allowed set, or a
  `worktree=` that is not a git repository SHALL... FAIL"). Worth adding to
  4.1 for full spec-scenario coverage, though this is a test-thoroughness
  gap rather than a design-soundness one.
