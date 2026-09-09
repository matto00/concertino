## 1. Record the reviewed SHA

- [x] 1.1 In `core/scripts/emit-event.sh`, for `kind=verdict`: record `head_sha_source=stated` when an explicit `head_sha=<sha>` argument is present. (Note: the generic `k=v` passthrough already records `head_sha` itself — that half cannot go red and is not the new behaviour. Decision 2.)
- [x] 1.2 When `head_sha` is absent, infer `git rev-parse HEAD` and record `head_sha_source=inferred`; when neither resolves, write the event with no SHA and never fail the emission.
- [x] 1.3 Leave the CON-171 lease release block untouched and verify it still fires for `kind=verdict role=auditor` (Decision 4a — the lease protocol is explicitly NOT changed by this ticket).

## 2. Refuse a merge whose reviewed source has moved

- [x] 2.1 Accept the archive-prefix argument in `core/scripts/check-merge-readiness.sh`, document it in the usage header, and pass it from `core/roles/auditor.md`'s invocation (Decision 1a).
- [x] 2.2 Extract `head_sha` and `head_sha_source` for the latest evaluator PASS and skeptic CONFIRM in the same `jq` pass that already extracts the verdict values.
- [x] 2.3 Add `headRefOid` to the CONDITION-2 `gh pr view` query (it is fetched nowhere today, and a condition-0 value would be pre-push); assert local `HEAD` equals it, re-query once on mismatch, and refuse with EXIT 1 on a surviving mismatch or failed query (Decision 5).
- [x] 2.4 Resolve `BASE_REF` (`.baseRefName` -> `CONCERTINO_BASE_BRANCH` -> `main`) at a scope condition 3 can see, guarding against `set -u`; `git fetch origin <base>` before any merge-base; refuse if unresolvable, or if `git merge-base` fails or returns empty on either side (unrelated histories). Do NOT require the base ref to be an ancestor of the head — that refuses the ordinary advanced-base run (Decision 1b).
- [x] 2.5 Implement the branch-contribution comparison: merge-bases on both sides, union of branch-touched paths with NO exclusion applied at this step, then `git -C "$WORKTREE_PATH" diff --name-only <reviewed_sha> <head> -- <paths> ':(exclude)<prefix>/*'`. No CWD-relative `-- .` (Decision 1).
- [x] 2.6 Guard empty `PATHS` explicitly: pass the leg without invoking the diff, never letting the pathspec degenerate to "every path except the prefix" (Decision 1c).
- [x] 2.7 Check the exit status of every git invocation in this path; refuse on non-zero, on an unresolvable SHA (`git cat-file -e`), and on an absent `head_sha` (Decision 3).
- [x] 2.8 Report as `STALE <role> reviewed=<sha> head=<sha> changed=<paths>` on stderr with exit 4, distinct from exit 1 and CON-159's exit 3 (Decision 4).
- [x] 2.9 Document the exit-precedence rule (exit 1 dominates exit 4) and Decision 4a's lease rule in the script header (Decision 6a); implement Decision 6: an owner override skips the skeptic SHA leg with a printed note; the evaluator SHA leg applies unconditionally.

## 3. Role and orchestrator obligations

- [x] 3.1 Require `core/roles/evaluator.md` and `core/roles/skeptic.md` to capture the SHA before review and pass `head_sha=<that SHA>` on their verdict emission.
- [x] 3.2 Add the exit-4 remediation obligation to `core/roles/orchestrator.md` (delivery/auditor section and the circuit-breaker table).
- [x] 3.3 Update `core/roles/auditor.md`: pass the archive prefix, treat exit 4 as not-mergeable, and emit a distinct verdict on it (which is what releases the lease — Decision 4a).

## 4. Prove it by mutation

- [x] 4.1 Self-test: verdict with a stated `head_sha` at commit A, source commit B, assert exit 4; fresh verdict at B clears it (Decision 7).
- [x] 4.2 Self-test the healthy squash-shaped case: head moved, only the archive prefix differs, must PASS.
- [x] 4.3 Self-test the base-reconcile case: base-derived paths the branch never touched must PASS; a base-merged change to a branch-touched path must refuse.
- [x] 4.4 Self-test the fail-closed legs: failing/erroring git invocation, unresolvable SHA, absent `head_sha` — each must REFUSE.
- [x] 4.5 Self-test Decision 6's override behaviour on both legs.
- [x] 4.6 Self-test the empty-`PATHS` case (Decision 1c) and the advanced-`origin/<base>` case (Decision 1b): advance `origin/<base>` past the merge the branch performed and assert PASS.
- [x] 4.7 Evidence, by polarity (Decision 7). REFUSAL assertions: transcript showing RED against the pre-fix script, targeting `head_sha_source` and the inference/absent legs on the emit side, never the `head_sha` passthrough. MUST-PASS assertions: transcript showing each goes RED under a stated mutation OF THE FIX (drop step 3's single-sited exclude term; drop the `PATHS` restriction; drop the empty-`PATHS` guard; drop step 0's unconditional fetch). EVERY assertion of either polarity must match exact expected output, not just the exit code — for must-PASS this proves condition 3 was reached, for refusals it proves the refusal fired for the leg under test rather than from a broken fixture. Include both in the executor's report.

## 5. Existing suite, renders and gates

- [x] 5.1 Retrofit the ~20 fixtures in `test/scripts/check-merge-readiness.test.sh` that emit verdicts with no `head_sha` and assert PASS (Decision 3a). This is more than adding a SHA: the shared `new_repo()` helper adds no `origin` remote, so step 0's unconditional fetch fails; and the `gh` mock serves neither `headRefOid` nor `baseRefName`. Give the helper a bare `origin` with the base branch present and fetchable, real commits so reviewed SHAs resolve, a `head_sha` on each verdict, and extend the `gh` stub to serve `headRefOid` (= fixture local HEAD, on the condition-2 field set) and `baseRefName`.
- [x] 5.2 Copy every changed `core/scripts/**` file to its `scripts/concertino/**` render by direct `cp` — never `concertino sync` (CON-173). Note this repo tracks no rendered agent definitions, so `core/roles/**` changes have no render target here.
- [x] 5.3 Run the repo's own test suite and the rendered-scripts drift gate green.
