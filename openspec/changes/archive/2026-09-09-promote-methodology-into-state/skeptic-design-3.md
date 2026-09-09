## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Fresh cold read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/methodology-carryover/spec.md`, re-verified against
`core/roles/orchestrator.md`, `core/scripts/assert-phase.sh`,
`core/workflow-state.template.md`, and the on-disk archived runs. Prior reports
`skeptic-design-1.md` / `skeptic-design-2.md` read first, and each of their
change requests re-checked against ground truth rather than against the
orchestrator's summary.

### What I verified (with evidence)

- **Round-2 CR1 (post-archive placement) — genuinely fixed, and the new
  placement is valid against the real step sequence.** `orchestrator.md:968`
  "## Phase 3: Delivery" numbers its steps 1–8: 1 `persist-evidence.sh
  design.md`, 2 `squash-branch.sh`, 3 "Archive the planned change"
  (`{{block:specArchive}}`), 4 push + `assert-phase.sh delivery`, 5 `gh pr
  create`, 6 `pr` event, 7 post link, 8 `AGENT_MERGE` branch. Nothing before
  step 1 moves, deletes, or rewrites the change dir, so a new **step 0** runs
  at a point where `openspec/changes/<CHANGE_NAME>/{tasks.md,workflow-state.md}`
  still exist at exactly the path Decision 2a resolves. `grep -n assert-phase.sh
  core/roles/orchestrator.md` still shows only `setup`/`servers`/`delivery`/
  `cleanup` call sites, and the plan now edits none of them —
  `assert-phase.sh`'s phase enum and exit-code contract are untouched, which
  also closes round-1 CR1 and CR3 more cleanly than the round-1 resolution did.
- **The record really is final before Phase 3 is entered.** `orchestrator.md:696`
  "### Final gate (Skeptic)" — CONFIRM "proceed to Delivery" is reached only
  after the verdict is consumed as the spawn's return value; task 2.1 writes the
  review/counter "immediately after every skeptic verdict is received". The
  `slow`-only second final-gate skeptic (`orchestrator.md:748`) is also a skeptic
  verdict and is covered by 2.1's "every round" wording, so the counter and the
  review list stay in step on that path too.
- **The planning-exclusion count rule is unambiguous and implementable.**
  `design.md:124`, `tasks.md` 4.1, and `spec.md:96-97` all state the identical
  predicate: id-union comparison includes `gate:"planning"` entries;
  `len(CONSTRAINT_REVIEWS where gate != "planning") == SKEPTIC_VERDICTS_TOTAL`.
  That is one `jq 'map(select(.gate!="planning"))|length'` — no residual
  ambiguity, and round-2 CR2's unsatisfiability is gone: a Planning promotion now
  has a review to appear in, so three-way equality is reachable.
- **Absent vs. malformed vs. missing is now stated three times, consistently.**
  `design.md:212-225`, `spec.md:99-103`, `tasks.md` 4.1: file present + field
  absent → `[]`/`[]`/`0`, never a failure; field present + unparseable →
  `DIVERGED`/exit 1; file itself absent → `MISSING`/exit 2. That is the
  backward-compatible reading every pre-change and in-flight run needs, and
  round-2 CR3's guess-space is closed.
- **Task 5.2 is concrete enough to execute.** It names the specific backfill
  (one `CONSTRAINT_REVIEWS` entry per skeptic verdict already returned this run,
  each `promoted: []`, `SKEPTIC_VERDICTS_TOTAL` set to match, final-gate verdict
  added once it concludes) and the ordering constraint (all of it before Phase 3
  step 0 runs). The entry field values are derivable without further decisions.
- **Template invariant / parse contract (round-1 CR6) still holds** —
  `core/workflow-state.template.md:4` is amended deliberately by task 1.2, and
  `jq` is named as the parser.
- **Neither round-2 fix introduced a new contradiction that I could find.** I
  specifically re-checked the fold-in tail (`orchestrator.md:877-905`), which
  restores the archived change dir and re-runs the design gate after Phase 3 has
  begun: it re-enters Execution and therefore re-enters Phase 3 (and its step 0)
  before re-archiving, so the check is not bypassed by that path.

### Verdict: CONFIRM

All four round-2 blocking items are addressed against ground truth, not just in
prose, and the two placement errors that killed rounds 1 and 2 (a phase that
doesn't exist; a gate that fires after the files are gone) are both genuinely
resolved — the new placement is the first one I could verify by reading the
actual step sequence rather than inferring it. The plan is sound enough to
implement. My remaining objections are proof-completeness and ordering nits,
listed below; none of them changes what an implementer must build, because
`tasks.md` 4.1 and `spec.md:89-97` already state the three-way comparison
unambiguously. They are enforceable at the final gate, where the pasted fixture
output is actually read.

### Non-blocking notes (the first two should be handled during implementation)

1. **The 7-case fixture matrix in 4.2 never turns the third comparison leg red.**
   (a) and (b) are `tasks.md`↔`CONSTRAINTS` asymmetries; (c) is the count check;
   (f) exercises the `promoted` union only in the *green* direction. There is no
   red case where `tasks.md` and `CONSTRAINTS` agree on `C1` but no
   `CONSTRAINT_REVIEWS[].promoted` contains it. An implementation that compared
   only two sets plus the count would pass all seven fixtures — precisely this
   batch's "precondition guarantees its own assertion" trap. Add an eighth case:
   `tasks.md` `C1` + `CONSTRAINTS` `C1` + a single review with `promoted: []` and
   `SKEPTIC_VERDICTS_TOTAL: 1` → must exit 1. Also, 4.2(b) says only "the reverse
   asymmetry"; spell out what its `CONSTRAINT_REVIEWS` holds so the case is
   reproducible.
2. **4.4(b)'s negative control and 5.2's backfill compete for the same tree.**
   4.4(b) requires running against "the current, pre-fix, pre-archive tree state
   (no markers, no reviews/fields at all)", but 5.2 writes those fields into this
   run's own `workflow-state.md`. Run 4.4(b) before the 5.2 backfill, or against
   a copy of the pre-backfill change dir, and say which in the pasted evidence —
   otherwise the negative control quietly becomes untestable.
3. **This run's change dir has no `workflow-state.md` today** (`ls
   openspec/changes/promote-methodology-into-state/` — seven entries, none of
   them `workflow-state.md`, and `find . -name workflow-state.md` finds only
   archived runs). `orchestrator.md:340` (Setup step 7) says one is written at
   Setup, so it should exist by the time Execution transitions write it; but if
   it still does not exist when Phase 3 step 0 fires, the check exits 2 `MISSING`
   and blocks this delivery on itself. 5.2's backfill implies creating it —
   worth making that explicit rather than implied.
4. `proposal.md`'s Impact bullet list is now aligned with What Changes (round-2's
   cosmetic drift note is fixed).
5. Round-2's marker-shape note stands: `- [C1] <text>` is shaped like a markdown
   checkbox with `C1` as its state. Still worth a one-line `openspec validate`
   check during implementation, per that note.
