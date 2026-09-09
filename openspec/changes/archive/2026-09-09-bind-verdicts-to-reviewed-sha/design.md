## Context

Condition 3 of `check-merge-readiness.sh` reads the latest `role=evaluator` and `role=skeptic` `verdict` events and checks only their *values*. No event carries a commit SHA (`grep -c head_sha` over a completed run's log returns 0). Four merges land between this ticket's filing and this delivery and constrain it: CON-159 (the resumable `PENDING`/exit-3 precedent), CON-171 (the auditor lease, acquired in `check-merge-readiness.sh`, released in `emit-event.sh`), CON-169 (multi-line field answers), CON-173 (the rendered-scripts drift exemption table is empty, so every `core/scripts/**` edit ships its `scripts/concertino/**` render in the same delivery, by direct `cp`).

The decisive constraint is one the ticket does not know about, established during premise validation and independently confirmed at the design gate: Phase 3 squashes the branch (`squash-branch.sh` resets to the merge-base and re-commits, so the squash tree equals the pre-squash tree) and then commits the archive, and only then does the auditor run this script. HEAD is therefore never a reviewed SHA on a healthy run. On HEL-469, `git diff --stat 154e6ed3 c42bada4` touches only `openspec/**`. A literal reading of the ticket's step 2 would refuse every delivery.

A second constraint, found at the design gate: `check-merge-readiness.sh`'s own condition 0 merges `origin/<base>` into the branch and pushes when the PR is BEHIND, then falls through to condition 3 in the same invocation. A naive reviewed→HEAD diff would make the script declare its own reconciliation stale.

## Goals / Non-Goals

**Goals:**
- Every evaluator/skeptic verdict is bound to the source state it reviewed.
- A merge is mechanically refused when *run-authored* source content has moved since review.
- The refusal is resumable and self-clearing by re-review, in CON-159's shape.
- Every failure mode of the check itself refuses rather than passes.

**Non-Goals:**
- Making the remediation mechanical. A shell script cannot spawn an agent (Decision 4).
- Changing what the evaluator or skeptic reviews, or design-vs-final skeptic semantics.
- Retrofitting SHAs onto historical event logs.

## Decisions

### Decision 1 — Compare reviewed CONTENT, scoped to the branch's own contribution

The check refuses when run-authored source content differs between the reviewed SHA and the head being merged. It does NOT compare SHAs for equality, and it does NOT diff the two commits wholesale.

The comparison is computed per role, against a base ref resolved and freshened first:

0. **Resolve and freshen the base ref (Decision 1b).** `BASE_REF = origin/<baseRefName>`, resolved at a scope condition 3 can see, and `git fetch origin <baseRefName>` before any merge-base is computed. If the base ref cannot be resolved or fetched, or if `git merge-base` does not succeed and return a non-empty SHA for both `<reviewed_sha>` and `<head>` (the unrelated-histories case), the leg REFUSES (Decision 3) rather than proceeding with an unscoped comparison.
1. `MB_R = git merge-base BASE_REF <reviewed_sha>`; `MB_H = git merge-base BASE_REF <head>`.
2. `PATHS = union( git diff --name-only MB_R <reviewed_sha>, git diff --name-only MB_H <head> )` — the set of paths this branch itself touches, at review time and now. **No exclusion is applied here.**
3. **If `PATHS` is empty, the leg PASSES** (Decision 1c). Otherwise refuse when `git -C "$WORKTREE_PATH" diff --name-only <reviewed_sha> <head> -- <PATHS> ':(exclude)<prefix>/*'` is non-empty.

**The archive-prefix exclusion is applied at exactly one site: step 3's pathspec.** An earlier draft excluded it in step 2 as well, which made the step-3 term a no-op on every non-empty-`PATHS` path and rendered Decision 7's headline mutation unsatisfiable — removing the term could not turn anything red. Single-siting it makes that mutation real: with the term gone, a healthy squash-shaped run's archive paths re-enter the comparison and the case goes red as Decision 7 requires.

### Decision 1b — The base ref is resolved explicitly and fetched before use

Three concrete hazards, settled here rather than left to the executor.

*Unset.* `BASE_REF` is today assigned only inside the success branch of one `gh pr view` call, and the script runs under `set -u`. Condition 3 referencing it would abort with an unbound-variable error after the lease acquire, with no `STALE` message. It is therefore resolved at a scope condition 3 can see, in order: the PR's `.baseRefName`, then `CONCERTINO_BASE_BRANCH`, then `main`. Failure to resolve refuses per Decision 3.

*Which ref.* The worktree has no local base branch checked out, so the ref is `origin/<base>`. **It must NOT be required to be an ancestor of `<head>`.** An earlier draft adopted that requirement and it was wrong: `origin/<base>` is an ancestor of a feature head only while the base has not moved since the branch's last reconcile, so the guard would refuse exactly the advanced-base runs the staleness paragraph below declares harmless — the ordinary path in a repo whose premise is many lanes advancing a shared `origin/main`. It was measured false in throwaway fixtures at the design gate (`git merge-base --is-ancestor origin/main feat` returns NO in both the plain advanced-base case and the branch-already-merged case, while `merge-base` returns the correct commit and the diff scopes correctly in both). The only precondition step 1 actually needs is that a common ancestor exists: `merge-base` succeeds and returns a non-empty SHA on both sides.

*Staleness — and the direction that actually bites.* `git fetch` currently runs only on the BEHIND path. Both consuming repos run many worktrees off one clone with a shared `origin/<base>` that sibling lanes advance. The failure direction is a **stale (behind) local remote-tracking ref**, not an advanced one: if `origin/<base>` still points at an older commit than the one this branch already merged, `MB_H` is that older commit, so step 2 re-admits every base-derived path the branch merged in, and those paths differ between the reviewed SHA and the head — round-1 CR 1's false refusal, reintroduced through the very step meant to close it. An *advanced* `origin/<base>` is harmless, because the base only fast-forwards, so the commit the branch merged remains an ancestor of the newer tip and `merge-base` still returns it. Fetching therefore strictly helps, and step 0 fetches unconditionally before any merge-base is computed. This fetch is additional to — and replaces nothing about — condition 0's existing BEHIND-path fetch; the two coexist. Self-tested by advancing `origin/<base>` beyond the merge the branch performed and asserting PASS.

### Decision 1c — Empty `PATHS` passes the leg, explicitly

A pathspec list that is empty except for step 3's exclusion term does not mean "no paths" to git — it means "every path except the excluded prefix", i.e. the whole-commit diff Decision 1 exists to reject, and a mass false refusal on any base-reconciled run. Because the exclusion is single-sited at step 3 (Decision 1), `PATHS` is empty only when the branch touched literally nothing relative to its base — in which case there is by construction nothing this run authored for the head to have moved away from. The leg passes without invoking the diff at all, and this is an explicit guard, not left to the shape of a shell array. Self-tested (task 4.7), including a fixture that would produce the inverted whole-commit diff if the guard were removed.

### Decision 1a — The archive prefix is a parameter, never hardcoded

`core/scripts/**` is copied verbatim by `lib/cli/emit.js` with no variable substitution, and `specProvider.changeDir` is configurable — `kind: none` projects archive under `spec/`, not `openspec/`. Hardcoding `openspec/` would refuse 100% of deliveries in those projects: Decision 1's own failure mode, relocated. The excluded prefix is therefore an explicit argument to `check-merge-readiness.sh`, passed by the auditor from the resolved change-dir root, following the caller-passes-the-path convention the sibling scripts already use. The exclusion is applied as a repo-root-relative pathspec `':(exclude)<prefix>/*'`, never a CWD-relative `-- .`.

The exclusion's *scope* is correct as-is: the archive step writes only inside the change dir and the spec tree, both under that prefix, and the squash preserves the pre-squash tree exactly.

### Decision 2 — The role STATES the SHA it reviewed; inference is a labelled fallback

`emit-event.sh verdict` accepts `head_sha=<sha>`. When present the event records `head_sha_source=stated`; when absent the script infers `git rev-parse HEAD` and records `head_sha_source=inferred`; when neither resolves, the event is written with no SHA and the emission never fails (telemetry must not fail a run — CON-171's header states the same for the lease release).

Requiring the role to state it matters because the executor can commit between the moment the evaluator finished reading the diff and the moment it emits. An emit-time `rev-parse` would certify a commit the evaluator never saw — the defect, reintroduced one layer down. Both roles already write the SHA in their report's first line; this promotes a convention to a contract.

**What is and is not new here.** `emit-event.sh`'s argument loop already folds any unrecognised `k=v` into the event line generically, so "emitting `head_sha=X` records `head_sha`" is precondition-guaranteed by today's script and cannot go red. The genuinely new emit-side behaviour is `head_sha_source` and the inference/absent legs; the RED transcript required by Decision 5 must target those, not the passthrough.

**The trap this is written against.** A silent inference fallback would make the whole check vacuous: if no role ever stated a SHA, the recorded value would be the emit-time HEAD, which the check later compares against, so it would pass unconditionally. `head_sha_source` makes the difference visible, and the mutation test drives the *stated* path so inference cannot satisfy it.

### Decision 3 — Every uncertainty refuses, fail-closed

Condition 3 refuses when: the latest evaluator/skeptic verdict carries no `head_sha`; the recorded SHA does not resolve (`git cat-file -e`); or any git invocation in Decision 1 exits non-zero.

The last leg is the one the design gate caught. A `git diff` that errors prints nothing on stdout, so an emptiness-only test reads a broken invocation as "no drift" — the CON-169/CON-170 shape, inside the very defence Decision 2 claims. Every git call in this path therefore runs as `git -C "$WORKTREE_PATH" …`, has its exit status checked, and refuses on non-zero. A self-test asserts the failing-diff case refuses.

Trade-off on the absent-SHA leg: runs already past their final gate when this lands refuse once and need one re-review, and ~20 existing test fixtures go red (Decision 3a). Accepted: treating an absent SHA as a match restores the defect exactly where the record is weakest.

### Decision 3a — The existing fixture churn is expected, not a regression

`test/scripts/check-merge-readiness.test.sh` has roughly twenty fixtures emitting verdicts with no `head_sha` and asserting PASS. Every one refuses under Decision 3. The retrofit is larger than adding a SHA. Measured: the shared `new_repo()` helper does `git init` plus one `--allow-empty` commit and adds **no remote at all** (the only `remote add origin` calls live inside the two BEHIND-reconcile fixtures' own setup), and the `gh` mock's `CLEAN_MERGE` payload serves neither `baseRefName` nor `headRefOid`. So under this design every one of those fixtures fails step 0's unconditional `git fetch origin <base>` (no remote → refuse per Decision 3) and Decision 5's `headRefOid` check (absent from the stub → exit 1). The helper must therefore gain a bare `origin` with the base branch present and fetchable, real commits so reviewed SHAs resolve, a `head_sha` on each verdict, and a `gh` stub serving `headRefOid` equal to the fixture's local HEAD on the condition-2 field set, plus `baseRefName`. This is stated here so the executor meets that wall as a planned task rather than as evidence that Decision 3 is wrong and should be weakened.

### Decision 4 — Mechanical REFUSAL, prompt-level REMEDIATION

The ticket asks that a mismatch mean "re-run the evaluator", automatically. A script cannot spawn an agent, and CON-171 established a prompt-level obligation is insufficient *on its own*. The two halves are split by what each mechanism can guarantee:

- The **safety property** — a merge cannot proceed on unreviewed source — is entirely mechanical. It holds even if every prompt is ignored, because the auditor cannot merge without this script's PASS.
- The **remediation** — re-run the gate on the new head — is a prompt obligation on the orchestrator, triggered by a distinct machine-readable outcome.

This is strictly stronger than CON-171's position, where the prompt obligation was load-bearing for safety. Here, ignoring the prompt costs a stalled run a human then sees; it cannot cost an unreviewed merge. The outcome is `STALE <role> reviewed=<sha> head=<sha> changed=<paths>` on stderr with **exit 4** — distinct from exit 1 ("failed") and CON-159's exit 3 ("wait, re-invoke unchanged"); exit 4 means "do work, then re-invoke".

### Decision 4a — The lease protocol is NOT changed

An earlier draft released the auditor lease on exit 4. That is withdrawn. It was redundant on the mandated path (task 3.3 requires the auditor to emit a verdict on exit 4, and `emit-event.sh` releases on any `role=auditor` verdict), it rested on a false symmetry claim (exit 1 equally leaves auditor territory and does not release inside the script), and it opened a window CON-171 deliberately closed — the auditor is still alive after the script returns and still has to write and persist its report into the worktree.

The rule, stated in one place: **`check-merge-readiness.sh` acquires; only an auditor verdict releases.** Exit 4 is no different from exit 1 in this respect. CON-171's one-acquire/one-release symmetry is preserved exactly as it stands today.

### Decision 5 — The head being checked is the head being merged

`gh pr merge` merges the PR's `headRefOid`, which the auditor obtains from GitHub, not from the worktree. Checking local HEAD would verify a state that is not the state being merged (a failed push, or a push from elsewhere, is enough to diverge).

**Correction to an earlier draft:** `headRefOid` is fetched nowhere in this script today (`grep -c headRefOid` = 0; the three `gh pr view` calls request `mergeStateStatus,baseRefName`, `statusCheckRollup`, and `mergeable,mergeStateStatus,reviewDecision`). It must be added, and specifically to the **condition-2 query, which runs after condition 0's reconcile-and-push** — a value read from the condition-0 query is pre-push and would mismatch local HEAD on every reconciled run, a false refusal on the healthy path.

The check refuses unless local `HEAD` equals that `headRefOid`, and uses the verified head for all comparisons. GitHub's read-after-push lag is handled by one re-query before refusing; a surviving mismatch, or a failed query, is reported as **exit 1, not exit 4** — it is not a stale review and must not churn a re-review that cannot fix it.

### Decision 6 — A CON-152 owner override waives the skeptic SHA leg only, never the evaluator's

The override is a waiver path through the very gate this change hardens, so it is settled here rather than left to implementation.

When the skeptic gate is cleared by a `proceed-to-delivery` owner override, the skeptic SHA leg is skipped — an `escalation.answered` event carries no reviewed SHA, so there is nothing to compare, and inventing one would be fiction. The script prints a note saying the skeptic content check was not performed, so the log still says what was and was not verified. **The evaluator SHA leg applies unconditionally, including on override runs.** The override is the owner's judgment about the skeptic's outstanding objections; it is not a statement that some later commit was reviewed. Covered by a self-test.

### Decision 6a — Exit 1 dominates exit 4

If a hard failure (CI red, not mergeable, unresolvable state) coexists with a stale verdict, the script exits 1. A "do work and re-invoke" signal must never mask a failure that no amount of re-review will clear. Stated in the script header alongside the CON-159 exit-3 contract, together with Decision 4a's one-sentence lease rule, so neither is re-litigated from the code alone.

### Decision 7 — Mutation is the test, and every assertion is proven RED first

The self-test fabricates a throwaway repo, emits a verdict with a *stated* `head_sha` at commit A, commits a source change B, and asserts exit 4; then emits a fresh verdict at B and asserts the refusal clears. It also asserts the healthy squash-shaped case passes (head moved, only the archive prefix differs), the base-reconcile case passes (base-derived paths the branch never touched), the failing-diff case refuses, the absent-SHA case refuses, and the override case (Decision 6).

**How each assertion is proven, which differs by its polarity.** "RED against the pre-fix script" is only meaningful for assertions that expect a REFUSAL: the pre-fix script passes unconditionally, so every must-PASS assertion is green before and after, precondition-guaranteed by construction — the CON-170 shape, in the very tests meant to guard against it. Worse, a must-PASS assertion is also green if its fixture never reaches condition 3 at all (missing log, failed `gh`), so a broken fixture reads as proof. Therefore:

- **Refusal assertions** (source moved, unresolvable SHA, absent `head_sha`, erroring git invocation, override-evaluator-leg, and the emit-side `head_sha_source`/inference/absent legs) are proven RED against the pre-fix script.
- **Must-PASS assertions** (healthy squash-shaped case, base-derived untouched paths, empty `PATHS`, and the advanced-`origin/<base>` case) are proven by **mutation of the fix itself**: removing step 3's single-sited `':(exclude)<prefix>/*'` term must turn the squash-shaped case red; removing the `PATHS` restriction must turn the base-reconcile case red; removing Decision 1c's empty-`PATHS` guard must turn its case red; removing step 0's unconditional `git fetch origin <base>` must turn the advanced-base case red.

**Every assertion of either polarity must additionally match the exact expected output, not merely the exit code.** For must-PASS assertions this proves the fixture reached condition 3 at all. For refusal assertions it proves the refusal fired *for the leg under test*: red-against-pre-fix shows only that an assertion is not precondition-guaranteed, and every fail-closed leg refuses under Decision 3 — so does a simply broken fixture (missing event log, failed `gh`, unresolvable base ref). A misconfigured `gh` stub would otherwise read as a passing proof of the erroring-diff leg. Refusal assertions therefore match the exact `STALE <role> reviewed=… head=… changed=…` line or the specific fail-closed reason string.

Both kinds are captured as transcripts. Three consecutive lanes shipped precondition-guaranteed assertions (CON-170 found three in one run; CON-169's new parity assertion was an over-escaped BRE matching nothing, printing `ok` against a file containing two live copies of the bug). Both survived green suites. In this change, a green new assertion with no red-before evidence counts as unverified.

## Risks / Trade-offs

- **A base merge touching a file this run also touched refuses**, even though the run authored none of it. Deliberate (Decision 1): it is an unreviewed interaction. Cost is one re-review; the alternative silently passes it.
- **A change whose product genuinely lives under the archive prefix** would have post-review drift there invisible. Accepted: in both consuming repos that tree is planning artifacts.
- **In-flight runs refuse once** when this lands, and ~20 fixtures need updating (Decisions 3, 3a).
- **The reviewed SHA must remain in the object database** across the squash. Verified on HEL-469 (all four SHAs resolvable a day later, including a deleted branch's tip); an aggressive `git gc --prune=now` mid-delivery trips the fail-closed path, the correct direction.
- **`emit-event.sh`'s `write_line` drops all caller fields to `{"truncated":true}`** past its byte cap. A truncated verdict then reads as both verdict-MISSING and SHA-absent — fail-closed, so correct in direction, but noted here so it is not later mistaken for a defect introduced by this change.
- **`head_sha_source=inferred` stays a weaker guarantee** than `stated`. Made visible, not eliminated; tightening it once logs show `stated` is universal is a follow-up.
