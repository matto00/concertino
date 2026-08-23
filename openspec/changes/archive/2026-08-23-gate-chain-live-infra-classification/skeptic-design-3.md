## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read cold and in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/gate-chain-live-infra-classification/spec.md`. Verified each of the five
claimed round-2 fixes against actual file text, not the summary:

1. **Red/green mandate removed from the normative Delivery requirement** — CONFIRMED.
   `spec.md:21` now reads "a persisted isolation-test transcript at the fixed,
   predictable destination ... recording a pass verdict for that script". `grep` for
   "red run"/"red/green" across `spec.md` returns nothing; the only surviving
   red/green mentions are historical rationale in `design.md:12,65` (explaining why
   the model was replaced) and stale wording in `proposal.md:12,14` (see note 3).
   `spec.md:46` adds the explicit "SHALL NOT require the target script to behave
   differently across two runs" clause.
2. **Risks section corrected** — CONFIRMED. `design.md:78` now describes the bundled
   known-bad/known-good *reference scripts* model and names
   `test/scripts/test-gate-in-isolation.test.sh` (task 3.2). `grep` for
   `selftest.sh` across all artifacts returns no hits.
3. **Evidence path contradiction fixed, and the contract claim is true** — CONFIRMED
   against ground truth. I read `core/scripts/persist-evidence.sh` (lines 105–135):
   it resolves `SRC_TOPLEVEL` via `git rev-parse --show-toplevel`, computes
   `SRC_REL`, and writes `${ROOT}/.concertino/runs/${TICKET_ID}/evidence/${SRC_REL}`.
   So `design.md:60` / `spec.md:48`'s derived durable path
   `.concertino/runs/<T>/evidence/.concertino/gate-chain-isolation-evidence/<flattened>.md`
   is exactly what the script produces, and `spec.md:20`'s
   `evidence/openspec/changes/<CHANGE_NAME>/design.md` is likewise correct.
   Also verified the write location is safe: `.concertino/` is gitignored in both
   this repo (`.gitignore:4`) and helio (`.gitignore:56`), so writing the transcript
   into `$WORKTREE_PATH/.concertino/` cannot trip `assert-phase.sh:137`'s
   "worktree has uncommitted changes" check.
4. **Per-script binding** — CONFIRMED. `spec.md:21` quantifies over "**every**
   gate-chain-touching script path"; `spec.md:23` states an unrelated script's
   transcript SHALL NOT satisfy the gate; new scenario at `spec.md:33-35`
   (`scripts/foo.mjs` changed, only `scripts/bar.mjs` tested → FAIL naming foo).
   Task 2.2 carries a matching red-before-green test case.
5. **Unimplementable "nothing outside the fixture touched" replaced** — CONFIRMED.
   `design.md:61` and `spec.md:62-64` now specify three concrete invariants
   (`git rev-parse --is-bare-repository`, `git rev-parse HEAD`, `git worktree list`)
   snapshotted before/after, with the `strace`/`inotify` limitation stated openly.
   This is implementable in plain bash and targets the actual damage class.

Independent ground-truth checks beyond the five:
- `core/scripts/assert-phase.sh:14` — `delivery <WORKTREE_PATH> <BRANCH> [TICKET_ID]`;
  Decision 2's "no new argument required" holds.
- `core/roles/orchestrator.md` Phase 3 ordering: step 1 squash → step 2 archive →
  step 3 push + `assert-phase.sh delivery`. Decision 3's premise (evidence must be
  durable because archive precedes the gate) and the pre-squash re-persist placement
  in task 4.2 are both correct against the real file.
- Worktree still exists at Delivery (cleanup is Phase 4), so the classifier can read
  `.husky/pre-commit` + `package.json` at gate time.
- **Would this have caught the actual incident?** Yes. Commit `82d252f0`'s diff
  contained `scripts/check-openspec-hygiene.selftest.mjs`, a script resolved from
  `.husky/pre-commit` via `package.json` → classified, isolation transcript required
  for that exact path, and the helper's fixture (`GIT_DIR` at a
  `.git/worktrees/<name>` shape) reproduces the bare-init corruption. I traced this
  explicitly rather than assuming it.
- No `TODO`/`TBD`/deferred decisions anywhere in the artifacts (the only `TBD` string
  is `design.md:46` describing content the checker must *reject*).
- Acceptance criteria traced: AC1 → Decision 6 (Planning advisory) + Decision 2
  (hard block); AC2 → `design.md:46` + `spec.md:20` linked-worktree sub-item;
  AC3 → Decision 5 + spec Requirement 3 + task 4.3; AC4 → task 4.4;
  AC5 → mechanical gate in `assert-phase.sh delivery`, tasks 2.1/2.2.
- Decision 7's infeasibility statement (commit-staging order unobservable after the
  Phase 3 squash) is verified correct and is stated explicitly with reasoning, as
  the ticket's orchestrator notes demand — not silently downgraded.
- Selftest circularity: re-probed independently. The methodology proof is decoupled
  from the per-ticket target (bundled known-bad/known-good references, assertions
  coupled to observed fixture state). Not self-referential.

### Verdict: CONFIRM

The design is implementable as written, internally consistent on every load-bearing
contract, grounded in contracts I verified in the real scripts rather than in the
executor's narrative, and traceable to every acceptance criterion. All five round-2
change requests are genuinely fixed, not paraphrased.

### Non-blocking notes

1. **Responsibility boundary for the evidence check is stated two ways.**
   `design.md:46` (Decision 4) and the second Risks bullet (`design.md:76`) say
   `check-gate-chain-change.sh` performs the checklist/evidence verification, while
   Decision 2 (`design.md:32`), `spec.md:18-23`, and tasks 2.1/2.2 place that logic
   in `assert-phase.sh delivery`, with `spec.md:4` defining
   `check-gate-chain-change.sh` as classification-only. The normative spec and the
   tasks are unambiguous, so implementation is not blocked — but the executor should
   reword `design.md:46` and `design.md:76` to say `assert-phase.sh delivery`
   performs the check (using the classifier's reported paths), so the classifier's
   contract in spec Requirement 1 stays purely a classification contract.

2. **A wiring-only diff is a residual coverage hole.** If a diff adds a line to
   `.husky/pre-commit` invoking a script whose *file* is unchanged (already
   committed), the set of "gate-chain-touching script paths the diff contains" is
   empty, so `spec.md:21` requires no isolation transcript — yet that diff is exactly
   the act of making a previously-inert script live. Within this ticket's own staging
   guidance (script-first, wiring-second on one branch) the branch diff contains both,
   so it is covered; the hole only opens for a follow-up change that wires an
   already-landed script. Cheap close: have the classifier also report, as a
   gate-chain-touching script path, any script *newly referenced* from
   `.husky/pre-commit` in the diff, even when the script's own file is unchanged.
   Recommend either implementing this in task 1.1 or filing it as a named follow-up.

3. **`proposal.md:12` and `proposal.md:14` still describe the deleted red/green
   model** ("demonstrated (red-before-green)", "writes the red/green evidence log
   the mechanical check consumes"). `design.md` and `spec.md` — the artifacts an
   implementer builds from — are correct; this is stale prose in the summary
   document only, but it should be updated for coherence since a future reader of
   the archived change will hit it first.

4. **`proposal.md`'s Impact section names `scripts/concertino/...` paths where
   `tasks.md` correctly says `core/scripts/...`.** In this repo the source of truth
   is `core/scripts/*`, rendered to `scripts/concertino/*` in consuming repos, so
   both readings are defensible — but the proposal reads as if files under
   `scripts/concertino/` are edited directly. Worth a clarifying half-sentence.

5. Round 2's note stands: `assert-phase.sh`'s `TICKET_ID` is optional with a
   worktree-basename fallback. The new evidence check should fail-closed (not skip)
   if it ever resolves empty.
