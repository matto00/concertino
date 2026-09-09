## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `8c746fb`, fresh read of `ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, `specs/methodology-carryover/spec.md`, and re-verified against
`core/scripts/assert-phase.sh`, `core/roles/orchestrator.md`,
`core/workflow-state.template.md`, `lib/cli/render.js`.

### What I verified (with evidence)

Round-1 fixes that DO hold up against ground truth:

- **CR1 (phantom phase) — fixed.** `assert-phase.sh` phases are still exactly
  `setup) 119 / servers) 232 / delivery) 247 / cleanup) 375` with the `*)` usage
  string at 392. Decision 2a now targets `delivery`, which is a real phase with a
  real orchestrator call site (`orchestrator.md:1005`). No invented phases.
- **CR2 (input contract) — fixed.** `check-constraints-carryover.sh <WORKTREE_PATH>
  <CHANGE_NAME>`, change-dir resolution stated, `MISSING`≠`OK` stated
  (design.md:157-169, spec.md:76-84, tasks.md 4.1).
- **CR3 (exit-4 collision) — fixed.** Own 0/1/2, folded into `assert-phase.sh`'s
  existing `exit 1` fail path with `gate.result status=fail` preserved
  (design.md:171-180). Consistent with the script's actual `fail()` +
  `gate.result` emission at ~397.
- **CR5 (red-first) — fixed.** 4.2 (script-level, 4 cases) + 4.4 (wiring-level,
  with explicit negative control) is the right shape.
- **CR6 (template invariant) — fixed as to the contradiction.** Template line 4
  ("Holds ONLY ids/paths/counters — never prose procedure") is amended
  deliberately in Decision 2b + task 1.2, and a single-line-JSON/`jq` parse
  contract is now stated.
- **CR4 (marker design blind to omission) — partially fixed, honestly scoped.**
  `CONSTRAINT_REVIEWS` + `SKEPTIC_VERDICTS_TOTAL` do convert silent omission into
  an affirmative record, and design.md:110-119 no longer overstates it. Good.

### Verdict: REFUTE

The round-1 items are genuinely addressed. But CR1's chosen resolution — hanging
the check off the `delivery` phase — was not checked against what Phase 3
actually does before that gate runs, and it makes the gate fail on **every** run.
Two further contradictions were introduced or left standing by the revision.

### Change Requests

1. **BLOCKING — the `delivery` gate runs *after* the change dir has been
   archived, so both input files are always absent and the check always exits
   `2 MISSING` → `assert-phase.sh delivery` fails on every run.**
   `core/roles/orchestrator.md` Phase 3 order is: step 2 squash → **step 3
   "Archive the planned change"** → step 4 push, then
   `assert-phase.sh delivery "$WORKTREE_PATH" "<branch>" "$TICKET_ID"` (lines
   1001-1005). The archive block (`lib/cli/render.js:95-116`) runs
   `rm -f <changeDir>/files-modified.md` and the openspec `archiveCmd`, which
   **moves** `openspec/changes/<CHANGE_NAME>/` to
   `openspec/changes/archive/<YYYY-MM-DD>-<CHANGE_NAME>/`. Verified on disk:
   every archived change carries its `workflow-state.md` and `tasks.md` under the
   date-prefixed archive path (e.g.
   `openspec/changes/archive/2026-09-09-bind-verdicts-to-reviewed-sha/{tasks.md,workflow-state.md}`),
   and `openspec/changes/<CHANGE_NAME>/` no longer exists. So Decision 2a's
   resolution rule `$WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/{tasks.md,workflow-state.md}`
   resolves to nothing at exactly the moment the check fires — a guaranteed
   `MISSING`, folded into `exit 1`, blocking PR creation on every delivery. This
   is the same class of error as round-1 CR1 (a gate wired to a place that isn't
   there), one step later in the pipeline. Decide and write down a placement that
   is checked against Phase 3's real ordering: e.g. (a) invoke the check as an
   explicit orchestrator step *before* the squash/archive (Phase 3 step 0, or at
   the end of Phase 2 when the final-gate skeptic CONFIRMs — the point where the
   run's constraint record is final and the files still exist); or (b) keep it in
   `assert-phase.sh delivery` but have the script resolve the archived path
   (`openspec/changes/archive/*-<CHANGE_NAME>/`) with the live path as fallback —
   and then state the glob's ambiguity rule (date prefix unknown, multiple
   matches possible). Whichever is chosen, task 4.4's wiring proof must exercise
   the gate in the state the run is actually in when it fires (post-archive),
   not a hand-built pre-archive fixture — otherwise the red-first proof passes
   against a tree shape that never occurs.

2. **BLOCKING — Planning-agreed constraints make the three-way equality
   unsatisfiable.** `spec.md:16-21` and `design.md:127` both allow
   `agreed_at: "planning"` — the orchestrator "SHALL append an entry the moment a
   methodology-shaped constraint is agreed — **a Planning ESCALATION answer**, or
   a design-gate/final-gate skeptic REFUTE round…". But `CONSTRAINT_REVIEWS` is
   defined as one entry **per skeptic verdict** only (`spec.md:46-54`,
   tasks.md 2.1), so a Planning-escalation constraint has no review to appear in.
   The check requires **three-way set equality** including "the union of every
   `CONSTRAINT_REVIEWS[].promoted`" (`spec.md:79-82`, tasks.md 4.1). Any run that
   promotes a constraint at Planning therefore diverges permanently, with no
   possible reconciliation. Resolve explicitly: either weaken the third
   comparison (e.g. `union(promoted) ⊆ CONSTRAINTS`, with equality required only
   between `tasks.md` markers and `CONSTRAINTS`, plus the count check), or define
   a review-equivalent record for Planning promotions (e.g. a
   `{"gate":"planning",...}` `CONSTRAINT_REVIEWS` entry not counted against
   `SKEPTIC_VERDICTS_TOTAL`). State the chosen rule in both `design.md` Decision 2
   and the spec requirement, and add the corresponding case to task 4.2's fixture
   matrix.

3. **BLOCKING — absent-field semantics for pre-existing / in-flight runs are
   undefined, and task 4.4(b)'s negative control depends on them.** Every
   `workflow-state.md` written before this change (and every in-flight run at the
   moment it lands) has **no** `CONSTRAINTS`, `CONSTRAINT_REVIEWS`, or
   `SKEPTIC_VERDICTS_TOTAL` line at all — verified across the archived runs on
   disk and against `core/workflow-state.template.md`, which has none of the three
   today. Nothing in `spec.md` or tasks.md 4.1 says whether an absent field is
   read as `[]`/`0` (backward-compatible pass) or as a parse failure. Task 4.4(b)
   asserts the pre-fix tree "passes" as its negative control, which silently
   assumes the lenient reading — but that assumption is exactly what an
   implementer could get wrong, and getting it wrong breaks every in-flight run's
   delivery gate. Also note this run's own change dir currently has **no**
   `workflow-state.md` at all (`ls openspec/changes/promote-methodology-into-state/`),
   which under CR1's current wiring is `MISSING`, not `OK (none)`. State the rule:
   absent `CONSTRAINTS`/`CONSTRAINT_REVIEWS` → empty set; absent
   `SKEPTIC_VERDICTS_TOTAL` → `0`; malformed JSON → its own distinct failure
   (not silently empty). Add a fixture case for each to task 4.2.

4. **Task 5.2's self-application is under-specified and will fail this run's own
   gate.** 5.2 says to record "any `CONSTRAINTS`/`CONSTRAINT_REVIEWS` this design
   gate itself agreed". But the check also compares
   `len(CONSTRAINT_REVIEWS) == SKEPTIC_VERDICTS_TOTAL`, and this run has already
   returned skeptic verdicts (round 1 REFUTE, this round-2 verdict) with no
   reviews recorded and no counter incremented, plus every final-gate verdict
   still to come. Unless 5.2 explicitly requires backfilling one
   `CONSTRAINT_REVIEWS` entry per verdict already returned **and** setting
   `SKEPTIC_VERDICTS_TOTAL` to match, this delivery fails its own new check —
   the one self-referential outcome the ticket most wants avoided. Make 5.2
   say so, and state that the final-gate CONFIRM's review must be recorded
   *before* the gate that reads it runs (which interacts with CR1's placement
   choice — the two must be decided together).

### Non-blocking notes

- The `retired`-flag / id-never-removed design does hold together: retired ids
  stay in all three sources, so set equality is unaffected, and roles are told to
  skip them (`design.md:128-132`, `spec.md:40-44`). No change needed.
- `delivery`-only timing (one check per run, not per cycle) is acceptable as
  argued in Risks — provided CR1 relocates it somewhere it can actually read the
  files.
- `- [C<n>] <text>` in `tasks.md` is shaped like a markdown checkbox with `C1` as
  its state. No script in this repo parses tasks.md checkboxes, but `openspec
  validate` may; worth a one-line check during implementation, and worth
  considering a marker that can't be mistaken for a checkbox (e.g.
  `- **C1** — <text>`).
- `proposal.md`'s Impact bullet still says only "`core/workflow-state.template.md`
  — new `CONSTRAINTS` field", while the What Changes section (correctly) adds
  three fields. Cosmetic drift; worth aligning.
