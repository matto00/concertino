## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/gate-chain-live-infra-classification/spec.md`.

Ground-truth checks against the worktree (not the artifacts' claims):

- **Decision 1's premise (assert-phase sources the hardened git wrapper) — TRUE.**
  `core/scripts/assert-phase.sh:31` → `source "${SCRIPT_DIR}/lib/git-child-env.sh"`;
  `core/scripts/lib/git-child-env.sh` exists.
- **Decision 2's signature claim — TRUE.** `core/scripts/assert-phase.sh:15` documents
  `delivery <WORKTREE_PATH> <BRANCH> [TICKET_ID]`, and the `delivery)` case reads
  `TICKET_ID="${4:-}"`. No new argument is in fact needed.
- **Decision 3's Phase-3 ordering claim — TRUE.** `core/roles/orchestrator.md:771-795`:
  step 1 squash → step 2 `openspec archive` → step 3 push + `assert-phase.sh delivery`
  → step 4 `gh pr create`. So the change dir really is archived before the gate runs,
  and the gate really does run before PR creation. The reasoning for putting evidence
  in the durable dir instead of the worktree change dir is sound.
- **Durable evidence path — TRUE.** `core/scripts/persist-evidence.sh:17,134` writes to
  `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/`, and resolves the main
  checkout from any linked worktree via `git rev-parse --git-common-dir` (line 74-82),
  so `assert-phase.sh` can locate it from `WORKTREE_PATH` alone. Feasible.
- **Phase 1 step 6 persists `design.md` — TRUE.** `core/roles/orchestrator.md:358-365`
  enumerates `design.md` explicitly.
- **Concertino repo has no `.husky/`** (`ls -a` and `package.json` `scripts` show no
  husky/prepare hook) — confirms the classifier is for the *rendered target* repo, and
  that this change is not self-applicable. Consistent with the design's framing.
- **`openspec` is an external dependency** (`package.json:51 "openspec": "^0.0.0"`);
  `core/` contains no design.md template (`core/design/` holds only `architecture.md`;
  no template file anywhere renders the design artifact). This refutes task 4.1's
  premise — see CR3.

The classification + Delivery-block mechanism does clear the ticket's hardest bar
(mechanical, fail-closed, not agent-recall), and Decision 7 does state its
non-enforcement reasoning explicitly (squash-before-delivery makes commit count
unobservable at gate time) rather than silently dropping it — that specific
instruction from the ticket is satisfied.

Three defects below are load-bearing enough to block implementation.

### Verdict: REFUTE

### Change Requests

1. **Decision 5 step 6 ("exit non-zero if green does not differ observably from red")
   makes the mandated evidence unobtainable for a correctly-written gate.**
   The ticket requires *every* new/modified gate to be exercised in isolation
   (AC3), and `check-gate-chain-change.sh` will demand isolation evidence for every
   flagged diff. But a gate script that is already safe produces an intact fixture in
   both runs — red and green are identical — so the helper exits non-zero and no
   passing evidence artifact can be produced. As written, the only way to satisfy the
   Delivery gate is to submit a gate script that is actually broken. The
   differ-or-fail rule is a sound *selftest* assertion (against the known-bad target
   in task 3.2) but is wrong as a rule for the general helper. `spec.md`'s scenario
   "Green run demonstrates the fix holds" encodes the same rule normatively and must
   be revised with it. Respecify: the helper's pass condition should be "the fixture
   survives the hook-shaped run and nothing outside the fixture was touched"; the
   red/green contrast requirement belongs to the selftest, or to an explicitly opt-in
   mode used when a vulnerability is being demonstrated.

2. **Decision 5 step 4 ("re-invokes the same script with the project's own
   `git_child`/env-hardening wrapper applied") is not implementable as stated.**
   The helper cannot apply an internal wrapper to an arbitrary target script it does
   not own — `git_child` is a bash function inside `lib/git-child-env.sh`; it cannot
   be injected into a target `.mjs` gate. The only lever the helper actually has over
   a third-party target is the *environment* it exports. State the red/green axis
   concretely — e.g. red = target invoked with hook-shaped `GIT_DIR`/`GIT_WORK_TREE`/
   `GIT_INDEX_FILE` exported (linked-worktree shape), green = the same target invoked
   with the `GIT_*` prefix stripped as `git_child` strips it — and say what
   observation distinguishes them. Without this, task 3.1 is a task a competent
   implementer cannot execute without inventing the core mechanism.

3. **Task 4.1 targets a template that does not exist in this repository.**
   It says to add the `## Gate-Chain Implications Checklist` section "to the `design`
   artifact's template/instruction text (wherever `openspec instructions design`
   sources its template from in this repo)". There is no such source here: `openspec`
   is an external npm dependency (`package.json:51`) and nothing under `core/` renders
   a design.md template. Task 4.1 is the task that makes the required heading actually
   appear in a flagged change's design.md — the mechanical check in 2.1 greps for that
   exact heading, so if 4.1 no-ops, every flagged run fails the Delivery gate with no
   in-workflow way to comply. Respecify where the checklist template lives (the
   natural home is `core/roles/orchestrator.md` Planning and/or
   `core/roles/executor.md`, with the verbatim heading + five sub-item labels quoted
   so the grep target and the template can't drift apart), and state that the check's
   expected strings and the template's strings must be kept in one canonical place.

4. **No re-persist step is specified for a `design.md` that gains the checklist during
   Execution.** Decision 2 explicitly acknowledges the common case: the executor writes
   the gate script during Execution, so the change is often only *known* to be
   gate-chain-touching after Planning ended. But the only `persist-evidence.sh` call
   for `design.md` is Phase 1 step 6 (`core/roles/orchestrator.md:358-365`), which runs
   at the end of Planning. The Delivery check reads that Planning-time copy
   (Decision 3), so a checklist added to the worktree `design.md` during Execution is
   invisible to the gate: the run reaches Delivery, fails fail-closed, and no artifact
   documents the remedy. Tasks 4.2's "note the persist-evidence.sh step that makes
   design.md durable before Phase 3's archive" is too vague to close this. Specify a
   concrete re-persist point (e.g. executor or orchestrator re-runs
   `persist-evidence.sh "$TICKET_ID" "<worktree>/openspec/changes/<change>/design.md"`
   after Execution and before Phase 3 step 2's archive — note the default
   overwrite-on-repersist behavior documented at `persist-evidence.sh:36-40` makes this
   safe), and add the corresponding task + a `FAIL` message that names this remedy.

### Non-blocking notes

- Risks section claims the classifier's invocation-style false negatives are
  "documented ... in `design.md`'s 'Non-Goals'"; the Non-Goals section does not
  currently mention them. Add the line or drop the cross-reference.
- Task 5.3 says "run the full existing `npm test` suite (all `test/scripts/*.test.sh`)";
  `package.json`'s `test` script enumerates suites individually, so new selftests must
  be appended there explicitly or 5.3 will silently not run them. Worth an explicit
  sub-task.
- `check-gate-chain-change.sh` resolving `.husky/pre-commit`'s command list at the
  *worktree's HEAD* vs. the base is worth pinning down: a diff that removes a script
  from the hook is still a gate-chain change and should be classified from the union of
  both sides.
