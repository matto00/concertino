## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round-1's report (`skeptic-design-1.md`) fresh to recover the three
  required revisions, then re-read `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/followup-triage/spec.md`, and
  `specs/orchestrator-turn-discipline/spec.md` in full from this worktree
  (not from memory of round 1).

- **Point 1 (ticket.md never extended on fold-in) — genuinely fixed.**
  - design.md §Decisions/4 item 1 now explicitly lists `ticket.md`'s
    acceptance-criteria section first among the artifacts to extend, with an
    inline rationale echoing the exact round-1 concern ("this is what the
    evaluator and the final-gate skeptic trace acceptance criteria from...
    unverifiable downstream, and risks the fresh design-gate re-run in step 3
    below flagging the extra scope as unexplained drift").
  - proposal.md's "What Changes" ("Fold-in must actually happen") and
    tasks.md 2.4 both list `ticket.md`'s acceptance criteria alongside
    `proposal.md`/`design.md`/`tasks.md` — consistent across all three plan
    documents.
  - `specs/followup-triage/spec.md`'s new requirement ("A fold-in verdict
    requires the current run's plan to actually be revised before Execution
    proceeds") names `ticket.md` explicitly in its normative text and adds a
    dedicated regression scenario, "Extending tasks.md without extending
    ticket.md does not satisfy the requirement" (lines 120-127), which did
    not exist in round 1 — this is a genuine, checkable closing of the gap,
    not a cosmetic mention.
  - Confirmed via `grep -n "ticket.md"` across all five artifacts: every
    occurrence ties `ticket.md` to the fold-in requirement consistently; no
    stray reference contradicts it.

- **Point 2 (base= default inconsistency) — genuinely fixed.**
  - design.md's Usage block (line 93): `` `base=`, when omitted, defaults to
    `${CONCERTINO_BASE_BRANCH:-main}` — the same convention
    `core/scripts/cleanup.sh` and `core/scripts/assert-phase.sh` already
    use... ``
  - tasks.md 1.1: "optional `base=` ... (defaulting to
    `${CONCERTINO_BASE_BRANCH:-main}` when omitted...)" — no longer says
    "default `main`" with no env-read.
  - `specs/followup-triage/spec.md`'s requirement text states the same
    default explicitly, matching `cleanup.sh`/`assert-phase.sh`'s convention
    by name.
  - `grep -rn "base="` across proposal/design/tasks/spec confirms uniform
    phrasing everywhere the default is stated; the only literal `base=main`
    occurrences are inside two spec scenarios' example invocations (explicit
    caller-supplied values, not default-behavior claims), which is correct
    and not a contradiction.

- **Point 3 (stale "five kinds" / "a sixth" claim) — genuinely fixed.**
  - design.md's Non-Goals now reads: "Not adding another kind to
    `gather-escalation-context.sh` (currently six: `dependency`,
    `api-change`, `budget`, `blocker`, `contradiction`,
    `ticket-ambiguity`)."
  - `grep -rn "five kind\|a sixth\|sixth kind\|five kinds"` across the
    change directory returns zero hits in proposal.md/design.md/tasks.md —
    the only remaining hits are inside the round-1 report itself
    (`skeptic-design-1.md`), which is expected historical record, not live
    plan content.

- **No new inconsistency introduced by the fixes.** Cross-checked all three
  fixed points against every other document that touches the same topic
  (proposal/design/tasks/both spec deltas) — phrasing is uniform, not merely
  fixed in one place and left stale in another.

- **`openspec validate` re-run clean:**
  `openspec validate follow-up-triage-classification --strict` →
  `Change 'follow-up-triage-classification' is valid`.

- **Overall soundness re-confirmed.** The core mechanism from round 1 (decision
  table, shared sub-procedure, standalone/discard handling, one call site
  per surfacing point) is unchanged and was already sound; the fold-in
  re-planning sequencing (revise plan → validate → design-gate → execute) in
  design.md §Decisions/4 is still exactly Phase 1 + the Phase 2 loop
  re-entered, which remains an appropriately scoped, non-novel mechanism.
  Checked `test/scripts/` and `package.json`'s `test` script convention
  (tasks.md 4.2's claim about appending after
  `gather-escalation-context.test.sh`) — matches the actual current
  `package.json` test-script ordering.

### Verdict: CONFIRM

All three required revisions from round 1 are genuinely present in the
normative text (not just a passing mention), consistent across every
document that discusses them, and reinforced with new spec scenarios where
appropriate (point 1). No new contradiction was introduced by the fixes, and
`openspec validate` passes clean. The plan is sound and appropriately scoped
for CON-51's acceptance criteria.

### Non-blocking notes

- Carried over from round 1, still unaddressed but non-blocking: tasks.md
  4.1's test list doesn't explicitly enumerate a test for an out-of-enum
  `ac_relevant`/`effort` value or a non-git-repo `worktree=`, even though
  the spec's failure-contract paragraph covers both. Worth adding for full
  spec-scenario coverage at execution time, but doesn't block design
  soundness.
